// src/provider/types.ts
import type { ToolCall } from "../types";
import type { ChatStreamDelta } from "./stream";

export type LlmRole = "user" | "assistant" | "tool" | "system";

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  model: string;
  content: string | null;
  tool_calls?: ToolCall[];
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream(req: ChatRequest): AsyncIterable<ChatStreamDelta>;
}