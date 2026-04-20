import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentLoop } from "../src/agent/loop";
import type { ChatStreamDelta } from "../src/provider/stream";
import type { ChatRequest, LlmClient } from "../src/provider/types";
import { loadClaudeMd } from "../src/prompt/claude-md";
import { ToolRegistry } from "../src/tools/registry";
import {
  escapeXml,
  loadSkills,
  parseFrontmatter,
  renderSkillsBlock,
} from "../src/prompt/skill";
import { buildSystemPrompt } from "../src/prompt/system";
import type { AgentMessage } from "../src/types";

async function* iter(deltas: ChatStreamDelta[]): AsyncIterable<ChatStreamDelta> {
  for (const d of deltas) yield d;
}

// --- parseFrontmatter ---

test("parseFrontmatter: 正常字段", () => {
  const raw = `---
name: code-review
description: 帮你做代码审查
disable_model_invocation: false
---

# Hi
`;
  const fm = parseFrontmatter(raw);
  expect(fm).not.toBeNull();
  expect(fm!.name).toBe("code-review");
  expect(fm!.description).toBe("帮你做代码审查");
  expect(fm!.disable_model_invocation).toBe(false);
});

test("parseFrontmatter: 无 frontmatter → null", () => {
  expect(parseFrontmatter("# Only body")).toBeNull();
});

test("parseFrontmatter: 缺 description → null", () => {
  const raw = `---
name: x
---
`;
  expect(parseFrontmatter(raw)).toBeNull();
});

test("parseFrontmatter: 布尔识别", () => {
  const raw = `---
description: ok
disable_model_invocation: true
---
`;
  const fm = parseFrontmatter(raw);
  expect(fm!.disable_model_invocation).toBe(true);
});

// --- loadSkills ---

test("loadSkills: 项目覆盖用户同名 skill", () => {
  const root = mkdtempSync(join(tmpdir(), "mini-ch09-sk-"));
  try {
    const user = join(root, "user");
    const proj = join(root, "proj");
    mkdirSync(join(user, "dup"), { recursive: true });
    mkdirSync(join(proj, ".mini-agent", "skills", "dup"), { recursive: true });
    writeFileSync(
      join(user, "dup", "SKILL.md"),
      "---\ndescription: from user\n---\n",
    );
    writeFileSync(
      join(proj, ".mini-agent", "skills", "dup", "SKILL.md"),
      "---\ndescription: from project\n---\n",
    );
    const skills = loadSkills({
      project_dir: join(proj, ".mini-agent", "skills"),
      user_dir: user,
    });
    expect(skills.map((s) => s.name)).toEqual(["dup"]);
    expect(skills[0]!.description).toBe("from project");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadSkills: 无 description 静默跳过", () => {
  const root = mkdtempSync(join(tmpdir(), "mini-ch09-skip-"));
  try {
    mkdirSync(join(root, "bad"), { recursive: true });
    writeFileSync(join(root, "bad", "SKILL.md"), "# no fm\n");
    expect(loadSkills({ user_dir: root })).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadSkills: extras 优先级最高", () => {
  const root = mkdtempSync(join(tmpdir(), "mini-ch09-ex-"));
  try {
    const extra = join(root, "e");
    const user = join(root, "u");
    mkdirSync(join(extra, "x"), { recursive: true });
    mkdirSync(join(user, "x"), { recursive: true });
    writeFileSync(join(extra, "x", "SKILL.md"), "---\ndescription: extra\n---\n");
    writeFileSync(join(user, "x", "SKILL.md"), "---\ndescription: user\n---\n");
    const skills = loadSkills({ extras: [extra], user_dir: user });
    expect(skills[0]!.description).toBe("extra");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadSkills: 目录不存在不抛错", () => {
  expect(loadSkills({ user_dir: join(tmpdir(), "nope-nope-nope-xyz") })).toEqual([]);
});

// --- renderSkillsBlock ---

test("renderSkillsBlock: 正常渲染", () => {
  const xml = renderSkillsBlock([
    {
      name: "a",
      file_path: "/p/SKILL.md",
      description: "d1",
      base_dir: "/p",
      disabled: false,
    },
  ]);
  expect(xml).toContain('<skill name="a" path="/p/SKILL.md">d1</skill>');
});

test("renderSkillsBlock: 空列表 → 空串", () => {
  expect(renderSkillsBlock([])).toBe("");
});

test("renderSkillsBlock: XML 转义", () => {
  const xml = renderSkillsBlock([
    {
      name: 'a&b',
      file_path: "/p",
      description: '<x>"y"',
      base_dir: "/",
      disabled: false,
    },
  ]);
  expect(xml).toContain("a&amp;b");
  expect(xml).toContain("&lt;x&gt;&quot;y&quot;");
});

test("escapeXml", () => {
  expect(escapeXml(`<&>"`)).toBe("&lt;&amp;&gt;&quot;");
});

// --- loadClaudeMd ---

test("loadClaudeMd: 当前目录命中", () => {
  const root = mkdtempSync(join(tmpdir(), "mini-ch09-claude-"));
  try {
    writeFileSync(join(root, "CLAUDE.md"), "hello");
    const md = loadClaudeMd(root, { stop_at: root });
    expect(md?.content.trim()).toBe("hello");
    expect(md?.file_path).toBe(join(root, "CLAUDE.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadClaudeMd: 向上找到父目录", () => {
  const root = mkdtempSync(join(tmpdir(), "mini-ch09-walk-"));
  try {
    writeFileSync(join(root, "CLAUDE.md"), "root rules");
    const sub = join(root, "a", "b");
    mkdirSync(sub, { recursive: true });
    const md = loadClaudeMd(sub, { stop_at: root });
    expect(md?.content.trim()).toBe("root rules");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadClaudeMd: 找不到且受 stop_at 限制 → null", () => {
  const root = mkdtempSync(join(tmpdir(), "mini-ch09-none-"));
  try {
    const sub = join(root, "a");
    mkdirSync(sub, { recursive: true });
    expect(loadClaudeMd(sub, { stop_at: root })).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- buildSystemPrompt ---

test("buildSystemPrompt: 含 tool 列表与通则", () => {
  const s = buildSystemPrompt({
    cwd: "/tmp",
    tool_names: ["read", "bash"],
    sandbox_mode: "sandbox-exec",
    now: new Date("2026-04-14T12:00:00.000Z"),
  });
  expect(s).toContain("cwd: /tmp");
  expect(s).toContain("time: 2026-04-14T12:00:00.000Z");
  expect(s).toContain("read, bash");
  expect(s).toContain("<tool_use_guidelines>");
});

test("buildSystemPrompt: project_context 与 passthrough 警示", () => {
  const s = buildSystemPrompt({
    cwd: "/x",
    tool_names: [],
    claude_md: { file_path: "/x/CLAUDE.md", content: "use bun" },
    sandbox_mode: "passthrough",
    now: new Date(0),
  });
  expect(s).toContain('<project_context path="/x/CLAUDE.md">');
  expect(s).toContain("use bun");
  expect(s).toContain("passthrough");
});

test("buildSystemPrompt: 非 passthrough 无警示", () => {
  const s = buildSystemPrompt({
    cwd: "/x",
    tool_names: [],
    sandbox_mode: "docker",
  });
  expect(s).not.toContain("passthrough");
});

test("buildSystemPrompt: skill 块与读后说明", () => {
  const s = buildSystemPrompt({
    cwd: "/",
    tool_names: ["read"],
    sandbox_mode: "sandbox-exec",
    skills: [
      {
        name: "greet",
        file_path: "/h/skills/greet/SKILL.md",
        description: "打招呼",
        base_dir: "/h",
        disabled: false,
      },
    ],
  });
  expect(s).toContain("<available_skills>");
  expect(s).toContain("greet");
  expect(s).toContain("SKILL.md 整文件读进来");
});

test("buildSystemPrompt: disable 的 skill 不渲染", () => {
  const s = buildSystemPrompt({
    cwd: "/",
    tool_names: [],
    sandbox_mode: "sandbox-exec",
    skills: [
      {
        name: "off",
        file_path: "/p",
        description: "x",
        base_dir: "/",
        disabled: true,
      },
    ],
  });
  expect(s).not.toContain("<available_skills>");
});

// --- agentLoop + system ---

test("agentLoop: build_system_prompt 注入 system 消息", async () => {
  let captured: ChatRequest | undefined;
  const client: LlmClient = {
    async chat() {
      throw new Error("unimplemented");
    },
    chatStream(req: ChatRequest) {
      captured = req;
      return iter([{ content: "ok" }]);
    },
  };
  const history: AgentMessage[] = [];
  for await (const _ of agentLoop({
    client,
    model: "mock",
    tools: new ToolRegistry(),
    history,
    user_input: "hi",
    tool_ctx_factory: () => ({
      cwd: "/tmp",
      session_id: "t",
      abort_signal: new AbortController().signal,
      logger: console,
      on_progress: () => {},
    }),
    build_system_prompt: () => "SYSTEM_LINE",
  })) {
    /* drain */
  }
  expect(captured?.messages[0]).toEqual({ role: "system", content: "SYSTEM_LINE" });
  expect(captured?.messages[1]?.role).toBe("user");
});

test("agentLoop: build_system_prompt 返回 null 则不注入", async () => {
  let captured: ChatRequest | undefined;
  const client: LlmClient = {
    async chat() {
      throw new Error("unimplemented");
    },
    chatStream(req: ChatRequest) {
      captured = req;
      return iter([{ content: "ok" }]);
    },
  };
  const history: AgentMessage[] = [];
  for await (const _ of agentLoop({
    client,
    model: "mock",
    tools: new ToolRegistry(),
    history,
    user_input: "hi",
    tool_ctx_factory: () => ({
      cwd: "/tmp",
      session_id: "t",
      abort_signal: new AbortController().signal,
      logger: console,
      on_progress: () => {},
    }),
    build_system_prompt: () => null,
  })) {
    /* drain */
  }
  expect(captured?.messages[0]?.role).toBe("user");
});
