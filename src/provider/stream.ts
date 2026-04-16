import type { ToolCall } from "../types";

export interface SseFrame {
  data: string;
}

/** 流式 delta 里单条 tool_call 片段（含 index，字段可分批到达）。 */
export interface ToolCallStreamDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** OpenAI 兼容流式 `choices[0].delta`（增量片段）。 */
export interface ChatStreamDelta {
  role?: string;
  content?: string | null;
  tool_calls?: ToolCallStreamDelta[];
}

/** 单条 SSE `data:` JSON 解析后的形状（简化）。 */
export interface ChatStreamChunk {
  choices?: Array<{
    delta?: ChatStreamDelta;
    finish_reason?: string | null;
  }>;
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncIterable<SseFrame> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        if (line.startsWith(":")) continue;
        if (line.startsWith("data:")) {
          yield { data: line.slice(5).trim() };
        }
      }
    }
    const tail = buffer.replace(/\r$/, "");
    if (tail.startsWith("data:")) yield { data: tail.slice(5).trim() };
  } finally {
    reader.releaseLock();
  }
}
