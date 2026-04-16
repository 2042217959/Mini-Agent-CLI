// src/provider/ark-client.ts
import type { ToolCall } from "../types";
import { parseSse } from "./stream";
import type { ChatStreamChunk, ChatStreamDelta } from "./stream";
import type { ChatRequest, ChatResponse, LlmClient } from "./types";

export class ArkError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ArkError";
  }
}

/** 与全局 `fetch` 调用签名一致，但不包含 `typeof fetch` 上的静态成员（如 `preconnect`），便于单测注入 mock。 */
export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ArkClientOptions {
  base_url?: string;
  api_key: string;
  fetch?: FetchImpl;
}

interface ArkChatRaw {
  model: string;
  choices?: Array<{
    message: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: ChatResponse["usage"];
}

export class ArkClient implements LlmClient {
  private readonly base_url: string;
  private readonly api_key: string;
  private readonly fetchImpl: FetchImpl;

  constructor(opts: ArkClientOptions) {
    this.base_url = opts.base_url ?? "https://ark.cn-beijing.volces.com/api/v3";
    this.api_key = opts.api_key;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await this.fetchImpl(`${this.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.api_key}`,
      },
      body: JSON.stringify({ ...req, stream: false }),
    });

    if (!res.ok) throw new ArkError(`Ark ${res.status}: ${await res.text()}`, res.status);

    const json = (await res.json()) as ArkChatRaw;
    const choice = json.choices?.[0];
    if (!choice) throw new ArkError("Ark response missing choices", 0);

    return {
      model: json.model,
      content: choice.message.content ?? null,
      tool_calls: choice.message.tool_calls,
      finish_reason: choice.finish_reason,
      usage: json.usage,
    };
  }
  async *chatStream(req: ChatRequest): AsyncIterable<ChatStreamDelta> {
    const res = await this.fetchImpl(`${this.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.api_key}`,
        accept: "text/event-stream",                    // (A)
      },
      body: JSON.stringify({ ...req, stream: true }),   // (B)
    });
  
    if (!res.ok) throw new ArkError(`Ark ${res.status}: ${await res.text()}`, res.status);
    if (!res.body) throw new ArkError("Ark streaming response has no body", 0);
  
    for await (const frame of parseSse(res.body)) {      // (C)
      if (frame.data === "[DONE]") return;               // (D)
      let chunk: ChatStreamChunk;
      try {
        chunk = JSON.parse(frame.data) as ChatStreamChunk; // (E)
      } catch {
        continue;                                        // (F)
      }
      const delta = chunk.choices?.[0]?.delta;           // (G)
      if (delta) yield delta;
    }
  }
}
