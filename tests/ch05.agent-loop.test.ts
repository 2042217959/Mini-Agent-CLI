import { expect, test } from "bun:test";
import { z } from "zod";
import { agentLoop } from "../src/agent/loop";
import type { ChatStreamDelta } from "../src/provider/stream";
import type { LlmClient } from "../src/provider/types";
import { ToolRegistry } from "../src/tools/registry";
import type { AgentMessage } from "../src/types";

async function* iter(deltas: ChatStreamDelta[]): AsyncIterable<ChatStreamDelta> {
  for (const d of deltas) yield d;
}

function scriptedClient(streams: ChatStreamDelta[][]): LlmClient {
  let n = 0;
  return {
    async chat() {
      throw new Error("unimplemented");
    },
    chatStream() {
      const deltas = streams[n++];
      if (!deltas) throw new Error("unexpected chatStream call");
      return iter(deltas);
    },
  };
}

const noopCtx = () => ({
  cwd: "/tmp",
  session_id: "test",
  abort_signal: new AbortController().signal,
  logger: console,
  on_progress: (_chunk: string) => {},
});

test("agentLoop: 纯文本 turn", async () => {
  const client = scriptedClient([[{ content: "你好" }]]);
  const tools = new ToolRegistry();
  const history: AgentMessage[] = [];
  const events: string[] = [];

  for await (const ev of agentLoop({
    client,
    model: "mock",
    tools,
    history,
    user_input: "hi",
    tool_ctx_factory: noopCtx,
  })) {
    events.push(ev.kind);
  }

  expect(events).toEqual(["turn_start", "message_delta", "message_complete", "turn_end"]);
  expect(history.length).toBe(2);
  expect(history[0]?.role).toBe("user");
  expect(history[1]?.role).toBe("assistant");
  if (history[1]?.role === "assistant") {
    expect(history[1].content).toBe("你好");
  }
});

test("agentLoop: tool 后再答最终文本", async () => {
  const client = scriptedClient([
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "call_echo",
            type: "function",
            function: { name: "echo", arguments: '{"msg":"ping"}' },
          },
        ],
      },
    ],
    [{ content: "Done" }],
  ]);

  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "回声",
    parameters: z.object({ msg: z.string() }),
    needs_permission: false,
    execute: async (args) => ({ ok: true, content: args.msg }),
  });

  const history: AgentMessage[] = [];
  const kinds: string[] = [];

  for await (const ev of agentLoop({
    client,
    model: "mock",
    tools,
    history,
    user_input: "say",
    tool_ctx_factory: noopCtx,
  })) {
    kinds.push(ev.kind);
  }

  expect(kinds).toEqual([
    "turn_start",
    "message_complete",
    "tool_call_start",
    "tool_result",
    "message_delta",
    "message_complete",
    "turn_end",
  ]);
  expect(history.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
});

test("agentLoop: 未知工具 → ok:false，模型可继续", async () => {
  const client = scriptedClient([
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "c1",
            type: "function",
            function: { name: "nope_tool", arguments: "{}" },
          },
        ],
      },
    ],
    [{ content: "没有该工具，我改用文字说明。" }],
  ]);
  const tools = new ToolRegistry();
  const history: AgentMessage[] = [];
  let sawBadResult = false;

  for await (const ev of agentLoop({
    client,
    model: "mock",
    tools,
    history,
    user_input: "x",
    tool_ctx_factory: noopCtx,
  })) {
    if (ev.kind === "tool_result" && !ev.result.ok) sawBadResult = true;
  }

  expect(sawBadResult).toBe(true);
  expect(history.some((m) => m.role === "tool")).toBe(true);
  const last = history[history.length - 1];
  expect(last?.role).toBe("assistant");
});

test("agentLoop: 非法 JSON 参数 → ok:false", async () => {
  const client = scriptedClient([
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "c2",
            type: "function",
            function: { name: "echo", arguments: "not-json" },
          },
        ],
      },
    ],
    [{ content: "参数坏了" }],
  ]);
  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "回声",
    parameters: z.object({ msg: z.string() }),
    needs_permission: false,
    execute: async (args) => ({ ok: true, content: args.msg }),
  });
  const history: AgentMessage[] = [];
  let bad: string | undefined;

  for await (const ev of agentLoop({
    client,
    model: "mock",
    tools,
    history,
    user_input: "x",
    tool_ctx_factory: noopCtx,
  })) {
    if (ev.kind === "tool_result" && !ev.result.ok) bad = ev.result.content;
  }

  expect(bad).toBeDefined();
  expect(bad!.length).toBeGreaterThan(0);
});
