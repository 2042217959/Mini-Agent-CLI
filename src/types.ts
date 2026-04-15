/** OpenAI 兼容协议里的 tool_calls 项（第 1 章 provider 类型会引用）。 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}
