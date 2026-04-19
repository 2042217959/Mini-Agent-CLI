import { aggregateStream } from "../provider/aggregate";
import type { LlmClient, LlmMessage } from "../provider/types";
import type { PermissionChecker } from "../tools/permission";
import type { ToolRegistry } from "../tools/registry";
import type { AgentMessage, ToolContext, ToolResult } from "../types";
import type { AgentEvent } from "./events";

const MAX_STEPS = 20;

let idSeq = 0;
function newId(): string {
  return `m_${Date.now().toString(36)}_${(idSeq++).toString(36)}`;
}

export interface AgentLoopOptions {
  client: LlmClient;
  model: string;
  tools: ToolRegistry;
  history: AgentMessage[];
  user_input: string;
  tool_ctx_factory: (call_id: string) => ToolContext;
  /** 为 needs_permission 的工具在 execute 前做 y/n/a 等确认；未传则不做交互检查。 */
  permission?: PermissionChecker;
}

function toLlmMessage(m: AgentMessage): LlmMessage {
  if (m.role === "user") {
    return { role: "user", content: m.content };
  }
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content,
      tool_calls: m.tool_calls,
    };
  }
  return {
    role: "tool",
    tool_call_id: m.tool_call_id,
    name: m.name,
    content: m.content,
  };
}

export async function* agentLoop(opts: AgentLoopOptions): AsyncIterable<AgentEvent> {
  const { client, model, tools, history, tool_ctx_factory, permission } = opts;

  const user_msg: AgentMessage = {
    id: newId(),
    role: "user",
    content: opts.user_input,
    ts: Date.now(),
  };
  history.push(user_msg);
  yield { kind: "turn_start", user_message: user_msg };

  for (let step = 0; step < MAX_STEPS; step++) {
    try {
      const specs = tools.to_llm_specs();
      const llm_messages = history.map(toLlmMessage);

      let delta_buf = "";
      const stream = client.chatStream({ model, messages: llm_messages, tools: specs });
      const aggregated = await aggregateStream(stream, (chunk) => {
        delta_buf += chunk;
      });
      if (delta_buf) yield { kind: "message_delta", text: delta_buf };

      const assistant_msg: AgentMessage = {
        id: newId(),
        role: "assistant",
        content: aggregated.content,
        tool_calls: aggregated.tool_calls,
        ts: Date.now(),
      };
      history.push(assistant_msg);
      yield { kind: "message_complete", message: assistant_msg };

      if (!aggregated.tool_calls || aggregated.tool_calls.length === 0) {
        yield { kind: "turn_end", reason: "stop" };
        return;
      }

      for (const call of aggregated.tool_calls) {
        yield { kind: "tool_call_start", call };
        const tool = tools.get(call.function.name);
        let result: ToolResult;

        if (!tool) {
          result = { ok: false, content: `未注册的工具: ${call.function.name}` };
        } else {
          try {
            const args_raw = call.function.arguments ? JSON.parse(call.function.arguments) : {};
            const args = tool.parameters.parse(args_raw);

            if (tool.needs_permission && permission) {
              const decision = await permission.check(tool.name, args);
              if (decision === "deny") {
                result = { ok: false, content: "用户拒绝了该工具调用" };
              } else {
                const ctx = tool_ctx_factory(call.id);
                result = await tool.execute(args, ctx);
              }
            } else {
              const ctx = tool_ctx_factory(call.id);
              result = await tool.execute(args, ctx);
            }
          } catch (err) {
            result = { ok: false, content: err instanceof Error ? err.message : String(err) };
          }
        }

        yield { kind: "tool_result", call, result };

        history.push({
          id: newId(),
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: result.content,
          ts: Date.now(),
        });
      }
    } catch (err) {
      yield {
        kind: "turn_end",
        reason: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      };
      return;
    }
  }

  yield { kind: "turn_end", reason: "max_steps" };
}
