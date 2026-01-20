import { describe, expect, test } from "bun:test";
import { createClaudeCodeAnthropicFetch } from "../src/plugin/claude-code-provider";

type FakeClient = {
  messages: {
    create: (params: Record<string, unknown>) => Promise<unknown>;
    createStream: (params: Record<string, unknown>) => AsyncIterable<unknown>;
  };
};

const baseConfig = {
  enabled: true,
  modelMap: {},
  modelOverrides: {},
};

describe("claude-code provider", () => {
  test("normalizes non-anthropic response into message payload", async () => {
    const capturedParams: Array<Record<string, unknown>> = [];
    const fakeClient: FakeClient = {
      messages: {
        create: async (params) => {
          capturedParams.push(params);
          return {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "hello from cli",
                },
              },
            ],
            usage: {
              prompt_tokens: 2,
              completion_tokens: 3,
              total_tokens: 5,
            },
          };
        },
        createStream: async function* () {
          yield { type: "message_stop" };
        },
      },
    };

    const fetcher = createClaudeCodeAnthropicFetch(fakeClient, baseConfig);
    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-opus-4-5-high",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        max_tokens: 32,
      }),
    });

    const payload = await response.json();
    expect(payload.type).toBe("message");
    expect(payload.content[0].text).toBe("hello from cli");
    expect(payload.model).toBe("claude-opus-4-5-high");
    expect(capturedParams[0]?.max_tokens).toBeUndefined();
    expect(capturedParams[0]?.temperature).toBeUndefined();
    expect(capturedParams[0]?.top_p).toBeUndefined();
    expect(capturedParams[0]?.stop_sequences).toBeUndefined();
  });

  test("streams SSE lines for stream responses", async () => {
    const fakeClient: FakeClient = {
      messages: {
        create: async () => ({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-4-5-high",
          content: [{ type: "text", text: "hello stream" }],
          usage: { input_tokens: 1, output_tokens: 2 },
          stop_reason: "end_turn",
        }),
        createStream: async function* () {
          throw new Error("unexpected stream path");
        },
      },
    };

    const fetcher = createClaudeCodeAnthropicFetch(fakeClient, baseConfig);
    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-opus-4-5-high",
        messages: [{ role: "user", content: "stream" }],
        stream: true,
      }),
    });

    const text = await response.text();
    expect(text).toContain("data:");
    expect(text).toContain("message_start");
    expect(text).toContain("content_block_delta");
    expect(text).toContain("message_delta");
    expect(text).toContain("hello stream");
  });

  test("returns 400 on invalid body", async () => {
    const fakeClient: FakeClient = {
      messages: {
        create: async () => ({ type: "message", content: [] }),
        createStream: async function* () {
          yield { type: "message_stop" };
        },
      },
    };

    const fetcher = createClaudeCodeAnthropicFetch(fakeClient, baseConfig);
    const response = await fetcher("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "not-json",
    });

    expect(response.status).toBe(400);
  });
});
