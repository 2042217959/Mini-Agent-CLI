import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { agentLoop } from "../src/agent/loop";
import type { ChatStreamDelta } from "../src/provider/stream";
import type { LlmClient } from "../src/provider/types";
import { bash_tool } from "../src/tools/bash";
import { glob_tool } from "../src/tools/glob";
import { grep_tool } from "../src/tools/grep";
import { ls_tool } from "../src/tools/ls";
import {
  InMemoryPermissionState,
  StaticPermissionChecker,
  StdinPermissionChecker,
} from "../src/tools/permission";
import { ToolRegistry } from "../src/tools/registry";
import type { AgentMessage, ToolContext } from "../src/types";

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

function toolCtx(cwd: string, session_id = "ch07"): ToolContext {
  return {
    cwd,
    session_id,
    abort_signal: new AbortController().signal,
    logger: console,
    on_progress: (_chunk: string) => {},
  };
}

function tempDir(prefix = "mini-agent-ch07-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// --- agent loop + permission ---

test("agentLoop: 权限 deny 仍写入 tool 消息", async () => {
  const client = scriptedClient([
    [
      {
        tool_calls: [
          {
            index: 0,
            id: "c1",
            type: "function",
            function: { name: "mutate", arguments: "{}" },
          },
        ],
      },
    ],
    [{ content: "好的" }],
  ]);

  const tools = new ToolRegistry();
  tools.register({
    name: "mutate",
    description: "需要权限",
    parameters: z.object({}),
    needs_permission: true,
    execute: async () => ({ ok: true, content: "不该执行" }),
  });

  const history: AgentMessage[] = [];
  let toolContent: string | undefined;

  for await (const ev of agentLoop({
    client,
    model: "mock",
    tools,
    history,
    user_input: "x",
    tool_ctx_factory: noopCtx,
    permission: new StaticPermissionChecker("deny"),
  })) {
    if (ev.kind === "tool_result") toolContent = ev.result.content;
  }

  expect(toolContent).toBe("用户拒绝了该工具调用");
  const toolMsg = history.find((m) => m.role === "tool");
  expect(toolMsg?.role).toBe("tool");
  if (toolMsg?.role === "tool") {
    expect(toolMsg.content).toBe("用户拒绝了该工具调用");
  }
});

// --- StdinPermissionChecker / StaticPermissionChecker ---

test("StdinPermissionChecker: auto_allow 短路", async () => {
  const state = new InMemoryPermissionState();
  let prompts = 0;
  const checker = new StdinPermissionChecker(
    state,
    new Set(["bash"]),
    new Set(),
    async () => {
      prompts++;
      return "n";
    },
  );
  expect(await checker.check("bash", { x: 1 })).toBe("allow_once");
  expect(prompts).toBe(0);
});

test("StdinPermissionChecker: auto_deny 短路", async () => {
  const state = new InMemoryPermissionState();
  let prompts = 0;
  const checker = new StdinPermissionChecker(
    state,
    new Set(),
    new Set(["bash"]),
    async () => {
      prompts++;
      return "y";
    },
  );
  expect(await checker.check("bash", {})).toBe("deny");
  expect(prompts).toBe(0);
});

test("StdinPermissionChecker: a 之后同工具不再问", async () => {
  const state = new InMemoryPermissionState();
  let prompts = 0;
  const checker = new StdinPermissionChecker(
    state,
    new Set(),
    new Set(),
    async () => {
      prompts++;
      return prompts === 1 ? "a" : "should-not-be-used";
    },
    10_000,
  );
  expect(await checker.check("bash", {})).toBe("allow_always");
  expect(await checker.check("bash", {})).toBe("allow_once");
  expect(prompts).toBe(1);
});

test("StdinPermissionChecker: 乱输入视为 deny", async () => {
  const state = new InMemoryPermissionState();
  const checker = new StdinPermissionChecker(state, new Set(), new Set(), async () => "maybe", 10_000);
  expect(await checker.check("write", {})).toBe("deny");
});

test("StdinPermissionChecker: 超时视为 deny", async () => {
  const state = new InMemoryPermissionState();
  const checker = new StdinPermissionChecker(
    state,
    new Set(),
    new Set(),
    () => new Promise(() => {}),
    20,
  );
  expect(await checker.check("bash", {})).toBe("deny");
});

test("StaticPermissionChecker: 固定返回", async () => {
  const allow = new StaticPermissionChecker("allow_once");
  expect(await allow.check("x", {})).toBe("allow_once");
  const deny = new StaticPermissionChecker("deny");
  expect(await deny.check("x", {})).toBe("deny");
});

// --- bash ---

test("bash: 捕获 stdout", async () => {
  const dir = tempDir();
  try {
    const r = await bash_tool.execute({ command: "echo hello" }, toolCtx(dir));
    expect(r.ok).toBe(true);
    expect(r.content).toContain("hello");
    expect(r.content).toContain("[exit=0]");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bash: 非 0 退出码", async () => {
  const dir = tempDir();
  try {
    const r = await bash_tool.execute({ command: "exit 7" }, toolCtx(dir));
    expect(r.ok).toBe(false);
    expect(r.content).toContain("[exit=7]");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bash: cwd 参数", async () => {
  const dir = tempDir();
  try {
    const sub = join(dir, "sub");
    mkdirSync(sub);
    const r = await bash_tool.execute({ command: "pwd", cwd: sub }, toolCtx(dir));
    expect(r.ok).toBe(true);
    expect(r.content).toContain(sub);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bash: stderr 合并进 content", async () => {
  const dir = tempDir();
  try {
    const r = await bash_tool.execute({ command: 'echo err >&2; echo out' }, toolCtx(dir));
    expect(r.ok).toBe(true);
    expect(r.content).toContain("[stderr]");
    expect(r.content).toContain("err");
    expect(r.content).toContain("out");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- glob / ls / grep（原第 13 章文件系统集成） ---

test("glob: 匹配 ts 文件", async () => {
  const dir = tempDir("mini-agent-ch13-");
  try {
    writeFileSync(join(dir, "a.ts"), "", "utf-8");
    mkdirSync(join(dir, "nested"));
    writeFileSync(join(dir, "nested/b.ts"), "", "utf-8");
    const r = await glob_tool.execute({ pattern: "**/*.ts" }, toolCtx(dir, "ch13"));
    expect(r.ok).toBe(true);
    expect(r.content).toContain("a.ts");
    expect(r.content).toContain(join("nested", "b.ts").replace(/\\/g, "/"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ls: 一层目录与后缀", async () => {
  const dir = tempDir("mini-agent-ch13-");
  try {
    mkdirSync(join(dir, "d"));
    writeFileSync(join(dir, "f.txt"), "x", "utf-8");
    const r = await ls_tool.execute({}, toolCtx(dir, "ch13"));
    expect(r.ok).toBe(true);
    expect(r.content).toContain("d/");
    expect(r.content).toContain("f.txt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grep: 能搜到文本", async () => {
  const dir = tempDir("mini-agent-ch13-");
  try {
    writeFileSync(join(dir, "x.txt"), "needle here\n", "utf-8");
    const r = await grep_tool.execute({ pattern: "needle", path: dir }, toolCtx(dir, "ch13"));
    expect(r.ok).toBe(true);
    expect(r.content.toLowerCase()).toContain("needle");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grep: 无匹配仍 ok", async () => {
  const dir = tempDir("mini-agent-ch13-");
  try {
    writeFileSync(join(dir, "x.txt"), "nope\n", "utf-8");
    const r = await grep_tool.execute({ pattern: "zzz", path: dir }, toolCtx(dir, "ch13"));
    expect(r.ok).toBe(true);
    expect(r.content).toContain("(无匹配)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
