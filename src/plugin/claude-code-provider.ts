import type { Plugin } from "@opencode-ai/plugin";
import type { Auth } from "@opencode-ai/sdk";
import { spawn } from "child_process";
import { Readable } from "stream";

type ClaudeCodeProviderOptions = {
  enabled?: boolean;
  apiKey?: string;
  cliPath?: string;
  timeoutMs?: number;
  modelMap?: Record<string, string>;
  forceGlobalFetch?: boolean;
  permissionMode?: string;
  noSessionPersistence?: boolean;
  maxTurns?: number;
};

type ClaudeCodeModelOptions = {
  cliModel?: string;
};

type ClaudeCodeProviderConfig = {
  options?: {
    claudeCode?: ClaudeCodeProviderOptions;
  };
  models?: Record<string, { options?: { claudeCode?: ClaudeCodeModelOptions } }>;
};

type ClaudeCodeClient = {
  messages: {
    create: (params: Record<string, unknown>) => Promise<unknown>;
    createStream: (params: Record<string, unknown>) => AsyncIterable<unknown>;
  };
};

type ClaudeCliExecutor = {
  cliPath: string;
  defaultTimeout: number;
  env: Record<string, string>;
  buildArgs: (params: Record<string, unknown>) => string[];
};

type ResolvedClaudeCodeConfig = {
  enabled: boolean;
  apiKey?: string;
  cliPath?: string;
  timeoutMs?: number;
  modelMap: Record<string, string>;
  modelOverrides: Record<string, string>;
  forceGlobalFetch: boolean;
  permissionMode: string;
  noSessionPersistence: boolean;
  maxTurns: number;
};

type AnthropicMessage = {
  role: string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
};

type AnthropicMessageResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<{ type: "text"; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
};

const PROVIDER_ID = "anthropic";
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_CLI_PATH = "claude";
const FETCH_OVERRIDE_KEY = "__gyoshuClaudeCodeFetchOverride";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveClaudeCodeConfig(provider: unknown): ResolvedClaudeCodeConfig {
  if (!isRecord(provider)) {
    return {
      enabled: false,
      modelMap: {},
      modelOverrides: {},
      forceGlobalFetch: true,
      permissionMode: "dontAsk",
      noSessionPersistence: true,
      maxTurns: 1,
    };
  }

  const options = isRecord(provider.options) && isRecord(provider.options.claudeCode)
    ? (provider.options.claudeCode as ClaudeCodeProviderOptions)
    : undefined;

  const enabled = options?.enabled === true;
  const modelMap = options?.modelMap ?? {};
  const modelOverrides: Record<string, string> = {};

  if (isRecord(provider.models)) {
    for (const [modelId, modelConfig] of Object.entries(provider.models)) {
      if (!isRecord(modelConfig)) continue;
      const modelOptions = isRecord(modelConfig.options) && isRecord(modelConfig.options.claudeCode)
        ? (modelConfig.options.claudeCode as ClaudeCodeModelOptions)
        : undefined;
      if (modelOptions?.cliModel) {
        modelOverrides[modelId] = modelOptions.cliModel;
      }
    }
  }

  return {
    enabled,
    apiKey: options?.apiKey,
    cliPath: options?.cliPath ?? DEFAULT_CLI_PATH,
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    modelMap,
    modelOverrides,
    forceGlobalFetch: options?.forceGlobalFetch ?? true,
    permissionMode: options?.permissionMode ?? "dontAsk",
    noSessionPersistence: options?.noSessionPersistence ?? true,
    maxTurns: typeof options?.maxTurns === "number" ? options.maxTurns : 1,
  };
}

function extractAuthApiKey(auth: Auth | undefined): string | undefined {
  if (!auth || !isRecord(auth)) return undefined;
  if (typeof auth.apiKey === "string") return auth.apiKey;
  if (typeof auth.key === "string") return auth.key;
  if (typeof auth.token === "string") return auth.token;
  if (typeof auth.value === "string") return auth.value;
  return undefined;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textParts = content
      .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text));
    if (textParts.length > 0) {
      return textParts.join("\n");
    }
    return JSON.stringify(content);
  }
  if (isRecord(content)) return JSON.stringify(content);
  if (content === undefined || content === null) return "";
  return String(content);
}

function normalizeMessages(messages: unknown): AnthropicMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    if (!isRecord(message)) {
      return { role: "user", content: contentToText(message) };
    }
    const role = typeof message.role === "string" ? message.role : "user";
    const content = contentToText(message.content);
    return { role, content };
  });
}

function applySystemPrompt(system: unknown, messages: AnthropicMessage[]): AnthropicMessage[] {
  if (typeof system !== "string" || system.trim().length === 0) {
    return messages;
  }
  return [{ role: "system", content: system }, ...messages];
}

function resolveCliModel(modelId: string | undefined, config: ResolvedClaudeCodeConfig): string | undefined {
  if (!modelId) return undefined;
  if (config.modelOverrides[modelId]) return config.modelOverrides[modelId];
  if (config.modelMap[modelId]) return config.modelMap[modelId];
  return undefined;
}

function extractResponseText(result: unknown): string {
  if (!isRecord(result)) return "";
  if (typeof result.result === "string") return result.result;
  if (Array.isArray(result.content)) {
    const textParts = result.content
      .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text));
    if (textParts.length > 0) return textParts.join("\n");
  }

  if (Array.isArray(result.choices)) {
    const firstChoice = result.choices[0];
    if (isRecord(firstChoice) && isRecord(firstChoice.message)) {
      if (typeof firstChoice.message.content === "string") {
        return firstChoice.message.content;
      }
    }
  }

  if (typeof result.text === "string") return result.text;
  return "";
}

function normalizeResponse(result: unknown, modelId: string): AnthropicMessageResponse {
  if (isRecord(result) && result.type === "message" && Array.isArray(result.content)) {
    const usage = isRecord(result.usage) ? result.usage : { input_tokens: 0, output_tokens: 0 };
    return {
      id: typeof result.id === "string" ? result.id : `claude_code_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: typeof result.model === "string" ? result.model : modelId,
      content: result.content.map((part) => {
        if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
          return { type: "text", text: part.text };
        }
        return { type: "text", text: contentToText(part) };
      }),
      usage: {
        input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
        output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
      },
      stop_reason: typeof result.stop_reason === "string" ? result.stop_reason : "end_turn",
    };
  }

  if (isRecord(result) && typeof result.result === "string") {
    const usage = isRecord(result.usage) ? result.usage : { input_tokens: 0, output_tokens: 0 };
    return {
      id: typeof result.uuid === "string" ? result.uuid : `claude_code_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: modelId,
      content: [{ type: "text", text: result.result }],
      usage: {
        input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
        output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
      },
      stop_reason: "end_turn",
    };
  }

  const text = extractResponseText(result);
  return {
    id: `claude_code_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: modelId,
    content: [{ type: "text", text }],
    usage: { input_tokens: 0, output_tokens: 0 },
    stop_reason: "end_turn",
  };
}

async function readBodyText(input: RequestInfo, init?: RequestInit): Promise<string | null> {
  if (init?.body) {
    if (typeof init.body === "string") return init.body;
    if (init.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
    if (typeof (init.body as Blob)?.text === "function") return (init.body as Blob).text();
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    try {
      const cloned = input.clone();
      return await cloned.text();
    } catch {
      return null;
    }
  }

  return null;
}

function stripUnsupportedCliParams(params: Record<string, unknown>): Record<string, unknown> {
  const {
    max_tokens: _maxTokens,
    temperature: _temperature,
    top_p: _topP,
    stop_sequences: _stopSequences,
    ...rest
  } = params;
  return rest;
}

type FetchOverrideState = {
  originalFetch: typeof fetch;
};

function getRequestUrl(input: RequestInfo): URL | null {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  if (typeof Request !== "undefined" && input instanceof Request) {
    return new URL(input.url);
  }
  return null;
}

function isAnthropicMessagesUrl(url: URL | null): boolean {
  return Boolean(url && url.host === "api.anthropic.com" && url.pathname.startsWith("/v1/messages"));
}

function installClaudeCodeFetchShim(
  client: ClaudeCodeClient,
  config: ResolvedClaudeCodeConfig
): void {
  if (!config.enabled || !config.forceGlobalFetch) return;
  if (typeof globalThis.fetch !== "function") return;

  const existing = (globalThis as Record<string, unknown>)[FETCH_OVERRIDE_KEY] as FetchOverrideState | undefined;
  if (existing?.originalFetch) return;

  const originalFetch = globalThis.fetch.bind(globalThis);
  const cliFetch = createClaudeCodeAnthropicFetch(client, config);

  (globalThis as Record<string, unknown>)[FETCH_OVERRIDE_KEY] = { originalFetch };

  globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
    const url = getRequestUrl(input);
    if (isAnthropicMessagesUrl(url)) {
      return cliFetch(input, init);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

function executeCliCommand(
  executor: ClaudeCliExecutor,
  params: Record<string, unknown>
): Promise<string> {
  const args = executor.buildArgs(params);
  const timeoutMs = typeof params.timeout === "number" ? params.timeout : executor.defaultTimeout;

  return new Promise((resolve, reject) => {
    const childProcess = spawn(executor.cliPath, args, {
      env: executor.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timeoutId = setTimeout(() => {
      childProcess.kill();
      const error = new Error(`Claude CLI execution timed out after ${timeoutMs}ms`) as Error & { status?: number };
      error.status = 408;
      reject(error);
    }, timeoutMs);

    childProcess.stdout.on("data", (data) => {
      stdout += String(data);
    });

    childProcess.stderr.on("data", (data) => {
      stderr += String(data);
    });

    childProcess.on("error", (error) => {
      clearTimeout(timeoutId);
      const enhancedError = new Error(
        `Claude CLI execution failed: ${error.message}${stderr ? `\nStderr: ${stderr}` : ""}`
      ) as Error & { status?: number };
      enhancedError.status = 500;
      reject(enhancedError);
    });

    childProcess.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        const enhancedError = new Error(
          `Claude CLI process exited with code ${code}${stderr ? `\nStderr: ${stderr}` : ""}`
        ) as Error & { status?: number };
        enhancedError.status = code ?? 500;
        reject(enhancedError);
        return;
      }
      if (stderr) {
        console.error("Claude CLI stderr:", stderr);
      }
      resolve(stdout);
    });
  });
}

function executeCliStream(
  executor: ClaudeCliExecutor,
  params: Record<string, unknown>
): Readable {
  const args = executor.buildArgs(params);
  const timeoutMs = typeof params.timeout === "number" ? params.timeout : executor.defaultTimeout;
  if (params.outputFormat === "stream-json" && !args.includes("--verbose")) {
    args.push("--verbose");
  }
  const childProcess = spawn(executor.cliPath, args, {
    env: executor.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const outputStream = new Readable({
    read() {},
  });

  const timeoutId = setTimeout(() => {
    childProcess.kill();
    outputStream.emit("error", new Error(`Claude CLI stream timed out after ${timeoutMs}ms`));
    outputStream.push(null);
  }, timeoutMs);

  childProcess.stdout.on("data", (data) => {
    outputStream.push(data);
  });

  childProcess.stderr.on("data", (data) => {
    console.error("Claude CLI Stream stderr:", String(data));
  });

  childProcess.on("error", (error) => {
    clearTimeout(timeoutId);
    outputStream.emit("error", error);
    outputStream.push(null);
  });

  childProcess.on("close", (code) => {
    clearTimeout(timeoutId);
    if (code !== 0) {
      outputStream.emit("error", new Error(`Claude CLI process exited with code ${code}`));
    }
    outputStream.push(null);
  });

  return outputStream;
}

function applyCliDefaults(
  params: Record<string, unknown>,
  config: ResolvedClaudeCodeConfig
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...params };
  if (typeof merged.permissionMode === "undefined") {
    merged.permissionMode = config.permissionMode;
  }
  if (typeof merged.noSessionPersistence === "undefined") {
    merged.noSessionPersistence = config.noSessionPersistence;
  }
  if (typeof merged.maxTurns !== "number") {
    merged.maxTurns = config.maxTurns;
  }
  if (Array.isArray(params.tools) && params.tools.length > 0) {
    const maxTurns = typeof merged.maxTurns === "number" ? merged.maxTurns : 0;
    if (maxTurns < 2) {
      merged.maxTurns = 2;
    }
  }
  return merged;
}

function patchClaudeCodeClient(
  client: ClaudeCodeClient,
  config: ResolvedClaudeCodeConfig
): void {
  const executor = (client as unknown as { executor?: ClaudeCliExecutor }).executor;
  if (!executor || typeof executor.buildArgs !== "function") {
    return;
  }

  const patchedClient = client as ClaudeCodeClient & {
    executeCommand?: (params: Record<string, unknown>) => Promise<string>;
    executeStreamCommand?: (params: Record<string, unknown>) => Readable;
  };

  patchedClient.executeCommand = (params) =>
    executeCliCommand(executor, applyCliDefaults(params, config));
  patchedClient.executeStreamCommand = (params) =>
    executeCliStream(executor, applyCliDefaults(params, config));
}

function buildSseStream(iterator: AsyncIterable<unknown>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of iterator) {
          const payload = `data: ${JSON.stringify(chunk)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function buildAnthropicEvents(response: AnthropicMessageResponse): Array<Record<string, unknown>> {
  const text = response.content.map((part) => part.text).join("\n");
  return [
    {
      type: "message_start",
      message: {
        id: response.id,
        type: "message",
        role: response.role,
        model: response.model,
        content: [],
        usage: response.usage,
        stop_reason: null,
        stop_sequence: null,
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: {
        type: "text",
        text: "",
      },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text,
      },
    },
    {
      type: "content_block_stop",
      index: 0,
    },
    {
      type: "message_delta",
      delta: {
        stop_reason: response.stop_reason,
        stop_sequence: null,
      },
      usage: response.usage,
    },
    {
      type: "message_stop",
    },
  ];
}

function enqueueSseEvents(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  events: Array<Record<string, unknown>>
): void {
  for (const event of events) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    controller.enqueue(encoder.encode(payload));
  }
}

function buildAnthropicStream(response: AnthropicMessageResponse): ReadableStream<Uint8Array> {
  const events = buildAnthropicEvents(response);
  const iterator = (async function* () {
    for (const event of events) {
      yield event;
    }
  })();

  return buildSseStream(iterator);
}

function buildAnthropicStreamFromCli(
  cliStream: AsyncIterable<unknown>,
  modelId: string
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of cliStream) {
          if (!isRecord(chunk)) continue;
          if (chunk.type !== "assistant" && chunk.type !== "message") {
            continue;
          }
          const message = isRecord(chunk.message) ? chunk.message : chunk;
          const response = normalizeResponse(message, modelId);
          enqueueSseEvents(controller, encoder, buildAnthropicEvents(response));
          controller.close();
          return;
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export function createClaudeCodeAnthropicFetch(
  client: ClaudeCodeClient,
  config: ResolvedClaudeCodeConfig
): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo, init?: RequestInit) => {
    const bodyText = await readBodyText(input, init);
    if (!bodyText) {
      return new Response(JSON.stringify({ error: "Missing request body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const modelId = typeof body.model === "string" ? body.model : "claude-code";
    const cliModel = resolveCliModel(modelId, config);

    const messages = applySystemPrompt(body.system, normalizeMessages(body.messages));
    const requestParams: Record<string, unknown> = {
      model: cliModel ?? modelId,
      messages,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
      top_p: body.top_p,
      stop_sequences: body.stop_sequences,
      tools: Array.isArray(body.tools) ? body.tools.map((tool) => {
        if (!isRecord(tool)) return tool;
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema,
        };
      }) : undefined,
    };

    const cliParams = stripUnsupportedCliParams(requestParams);

    if (body.stream === true) {
      const result = await client.messages.create(cliParams);
      const response = normalizeResponse(result, modelId);
      return new Response(buildAnthropicStream(response), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    const result = await client.messages.create(cliParams);
    const response = normalizeResponse(result, modelId);

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

export function createClaudeCodeAnthropicAuth(): NonNullable<Plugin["auth"]> {
  return {
    provider: PROVIDER_ID,
    async loader(getAuth: () => Promise<Auth>, provider: unknown) {
      const config = resolveClaudeCodeConfig(provider);
      if (!config.enabled) {
        return {};
      }

      let apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
      try {
        const auth = await getAuth();
        apiKey = apiKey ?? extractAuthApiKey(auth);
      } catch {
        // Ignore auth lookup errors and rely on env/config.
      }

      let ClaudeCodeCtor: { new (options?: Record<string, unknown>): ClaudeCodeClient } | undefined;
      try {
        const sdkModule = await import("claude-code-sdk");
        ClaudeCodeCtor = (sdkModule as { ClaudeCode?: { new (options?: Record<string, unknown>): ClaudeCodeClient }; default?: { new (options?: Record<string, unknown>): ClaudeCodeClient } }).ClaudeCode
          ?? (sdkModule as { default?: { new (options?: Record<string, unknown>): ClaudeCodeClient } }).default;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`claude-code-sdk is required for Claude Code provider: ${message}`);
      }

      if (!ClaudeCodeCtor) {
        throw new Error("claude-code-sdk did not export a ClaudeCode client");
      }

      const client = new ClaudeCodeCtor({
        apiKey,
        cliPath: config.cliPath,
        timeout: config.timeoutMs,
      });

      patchClaudeCodeClient(client, config);
      installClaudeCodeFetchShim(client, config);

      return {
        apiKey: apiKey ?? "claude-code-sdk",
        fetch: createClaudeCodeAnthropicFetch(client, config),
      };
    },
    methods: [
      {
        label: "API Key",
        type: "api" as const,
      },
    ],
  };
}

export default createClaudeCodeAnthropicAuth;
