import type { ToolCall } from "../types";
import type { ChatStreamDelta } from "./stream";

export interface AggregatedMessage {
  content: string | null;
  tool_calls: ToolCall[] | undefined;
}

export async function aggregateStream(
  stream: AsyncIterable<ChatStreamDelta>,
  onContent?: (chunk: string) => void,
): Promise<AggregatedMessage> {
  const contentParts: string[] = [];
  const toolCalls = new Map<number, {
    id: string;
    name: string;
    args_parts: string[];
  }>();

  for await (const delta of stream) {
    if (delta.content) {
      contentParts.push(delta.content);
      onContent?.(delta.content);
    }
    if (delta.tool_calls) {
      for (const t of delta.tool_calls) {
        const idx = t.index;
        const entry = toolCalls.get(idx)
          ?? { id: "", name: "", args_parts: [] };
        if (t.id) entry.id = t.id;
        if (t.function?.name) entry.name = t.function.name;
        if (t.function?.arguments) entry.args_parts.push(t.function.arguments);
        toolCalls.set(idx, entry);
      }
    }
  }

  const content = contentParts.length ? contentParts.join("") : null;
  const tool_calls: ToolCall[] | undefined = toolCalls.size
    ? [...toolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, v]) => ({
          id: v.id,
          type: "function" as const,
          function: { name: v.name, arguments: v.args_parts.join("") },
        }))
    : undefined;

  return { content, tool_calls };
}
