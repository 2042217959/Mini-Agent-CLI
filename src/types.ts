/** OpenAI 兼容协议里的 tool_calls 项（第 1 章 provider 类型会引用）。 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/** 工具执行结果（模型只看到 content 字符串）。 */
export interface ToolResult {
  ok: boolean;
  content: string;
  metadata?: unknown;
}

/** 工具运行时上下文（第 6 章起会扩展用法）。 */
export interface ToolContext {
  cwd: string;
  session_id: string;
  abort_signal: AbortSignal;
  logger: Pick<Console, "log" | "error" | "warn" | "debug">;
  on_progress: () => void;
}

/** 应用内消息（可持久化、带 id/ts）；与 LlmMessage 分离。 */
export type AgentMessage =
  | { id: string; role: "user"; content: string; ts: number }
  | {
      id: string;
      role: "assistant";
      content: string | null;
      tool_calls?: ToolCall[];
      ts: number;
    }
  | {
      id: string;
      role: "tool";
      tool_call_id: string;
      name: string;
      content: string;
      ts: number;
    };
