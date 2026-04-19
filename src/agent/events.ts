import type { AgentMessage, ToolCall, ToolResult } from "../types";

export type AgentEvent =
  | { kind: "turn_start"; user_message: AgentMessage }
  | { kind: "message_delta"; text: string }
  | { kind: "message_complete"; message: AgentMessage }
  | { kind: "tool_call_start"; call: ToolCall }
  | { kind: "tool_result"; call: ToolCall; result: ToolResult }
  | { kind: "turn_end"; reason: "stop" | "max_steps" | "error"; error?: Error };
