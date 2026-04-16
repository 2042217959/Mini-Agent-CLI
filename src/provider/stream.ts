import type { ToolCall } from "../types";

export interface SseFrame {
  data: string;
}

/** OpenAI 兼容流式 `choices[0].delta`（增量片段）。 */
export interface ChatStreamDelta {
  role?: string;
  content?: string | null;
  tool_calls?: ToolCall[];
}

/** 单条 SSE `data:` JSON 解析后的形状（简化）。 */
export interface ChatStreamChunk {
  choices?: Array<{
    delta?: ChatStreamDelta;
    finish_reason?: string | null;
  }>;
}

export async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncIterable<SseFrame> {
    const reader = stream.getReader();                       // (1)
    const decoder = new TextDecoder();                       // (2)
    let buffer = "";                                         // (3)
  
    try {
      while (true) {                                         // (4)
        const { done, value } = await reader.read();         // (5)
        if (done) break;
        buffer += decoder.decode(value, { stream: true });   // (6)
  
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {         // (7)
          const line = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          if (!line) continue;                               // (8)
          if (line.startsWith(":")) continue;                // (9)
          if (line.startsWith("data:")) {
            yield { data: line.slice(5).trim() };            // (10)
          }
        }
      }
      const tail = buffer.replace(/\r$/, "");                // (11)
      if (tail.startsWith("data:")) yield { data: tail.slice(5).trim() };
    } finally {
      reader.releaseLock();                                  // (12)
    }
  }