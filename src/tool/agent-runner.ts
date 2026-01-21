/**
 * Agent Runner Tool - Execute OpenCode agents via CLI for internal delegation.
 * Runs `opencode run` with controlled cwd/env to ensure project config is loaded.
 * @module agent-runner
 */

import { tool } from "@opencode-ai/plugin";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes for long-running agents
const SHORT_ID_REGEX = /^[a-z0-9_-]+$/i;

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};

function findProjectRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const configPath = path.join(current, ".opencode", "opencode.json");
    if (fs.existsSync(configPath)) return current;
    const fallbackConfig = path.join(current, "opencode.json");
    if (fs.existsSync(fallbackConfig)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function buildEnv(projectRoot: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
  };

  if (!env.OPENCODE_CONFIG && projectRoot) {
    const configDir = path.join(projectRoot, ".opencode");
    const configPath = path.join(configDir, "opencode.json");
    if (fs.existsSync(configPath)) {
      // OPENCODE_CONFIG expects file path, not directory
      env.OPENCODE_CONFIG = configPath;
    } else {
      // Fallback to opencode.json in project root
      const fallbackPath = path.join(projectRoot, "opencode.json");
      if (fs.existsSync(fallbackPath)) {
        env.OPENCODE_CONFIG = fallbackPath;
      }
    }
  }

  return env;
}

function runOpencode(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("opencode", args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += String(data);
    });

    child.stderr.on("data", (data) => {
      stderr += String(data);
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        timedOut,
      });
    });

    child.on("error", (error) => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        exitCode: 1,
        timedOut,
      });
    });
  });
}

function buildOutputSummary(
  agent: string,
  model: string | undefined,
  format: string,
  exitCode: number | null,
  timedOut: boolean,
  fallbackNote?: string
): string {
  const lines = [
    `agent: ${agent}`,
    `model: ${model ?? "default"}`,
    `format: ${format}`,
    `exitCode: ${exitCode ?? "unknown"}`,
    timedOut ? "timedOut: true" : null,
    fallbackNote ? `note: ${fallbackNote}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

function normalizeTextOutput(result: RunResult): string {
  const text = result.stdout.trim();
  if (text) return text;
  return result.stderr.trim();
}

function isSafeAgentName(agent: string): boolean {
  return SHORT_ID_REGEX.test(agent);
}

export default tool({
  description:
    "Run OpenCode agents via CLI for internal delegation. " +
    "Use this when Task tool cannot access custom agents (jogyo/baksa).",
  args: {
    agent: tool.schema
      .string()
      .describe("Agent name to run (e.g., 'jogyo', 'baksa')"),
    prompt: tool.schema
      .string()
      .describe("Prompt to pass to the agent"),
    model: tool.schema
      .string()
      .optional()
      .describe("Override model (e.g., 'anthropic/claude-haiku-4-5')"),
    format: tool.schema
      .enum(["default", "json"])
      .optional()
      .describe("Output format for opencode run (default|json)"),
    timeoutMs: tool.schema
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 300000)"),
  },

  async execute(args) {
    const { agent, prompt, model, format, timeoutMs } = args;
    if (!agent || !prompt) {
      throw new Error("agent and prompt are required");
    }
    if (!isSafeAgentName(agent)) {
      throw new Error("Invalid agent name");
    }

    const projectRoot = findProjectRoot(process.cwd());
    const cwd = projectRoot ?? process.cwd();
    const env = buildEnv(projectRoot);
    const effectiveTimeout = typeof timeoutMs === "number" ? timeoutMs : DEFAULT_TIMEOUT_MS;

    const baseArgs = ["run", "--agent", agent, prompt];
    if (model) {
      baseArgs.push("--model", model);
    }

    let requestedFormat = format ?? "default";
    let result = await runOpencode(
      requestedFormat === "default" ? baseArgs : [...baseArgs, "--format", requestedFormat],
      cwd,
      env,
      effectiveTimeout
    );

    let outputText = normalizeTextOutput(result);
    let fallbackNote: string | undefined;

    if (requestedFormat === "json") {
      try {
        JSON.parse(outputText);
      } catch {
        const fallbackResult = await runOpencode(baseArgs, cwd, env, effectiveTimeout);
        outputText = normalizeTextOutput(fallbackResult);
        result = fallbackResult;
        requestedFormat = "default";
        fallbackNote = "json parse failed; fallback to default";
      }
    }

    const summary = buildOutputSummary(
      agent,
      model,
      requestedFormat,
      result.exitCode,
      result.timedOut,
      fallbackNote
    );

    if (!outputText) {
      outputText = "(no output)";
    }

    return `${summary}\n\n${outputText}`.trim();
  },
});
