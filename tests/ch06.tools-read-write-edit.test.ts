import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { edit_tool } from "../src/tools/edit";
import { read_tool } from "../src/tools/read";
import { write_tool } from "../src/tools/write";
import type { ToolContext } from "../src/types";

function toolCtx(cwd: string): ToolContext {
  return {
    cwd,
    session_id: "ch06",
    abort_signal: new AbortController().signal,
    logger: console,
    on_progress: (_chunk: string) => {},
  };
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "mini-agent-ch06-"));
}

test("read: 文本全文", async () => {
  const dir = tempDir();
  try {
    const f = join(dir, "a.txt");
    writeFileSync(f, "hello\nworld", "utf-8");
    const r = await read_tool.execute({ path: f }, toolCtx(dir));
    expect(r.ok).toBe(true);
    expect(r.content).toContain("hello");
    expect(r.content).toContain(f);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read: 行区间", async () => {
  const dir = tempDir();
  try {
    const f = join(dir, "b.txt");
    writeFileSync(f, "L1\nL2\nL3\n", "utf-8");
    const r = await read_tool.execute({ path: "b.txt", start_line: 2, end_line: 2 }, toolCtx(dir));
    expect(r.ok).toBe(true);
    expect(r.content).toContain("L2");
    expect(r.content).not.toContain("L1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read: ENOENT", async () => {
  const dir = tempDir();
  try {
    const r = await read_tool.execute({ path: "nope.txt" }, toolCtx(dir));
    expect(r.ok).toBe(false);
    expect(r.content).toContain("文件不存在");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read: 二进制拒绝", async () => {
  const dir = tempDir();
  try {
    const f = join(dir, "bin.txt");
    writeFileSync(f, "text\x00binary", "utf-8");
    const r = await read_tool.execute({ path: f }, toolCtx(dir));
    expect(r.ok).toBe(false);
    expect(r.content).toContain("二进制");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write: 新建", async () => {
  const dir = tempDir();
  try {
    const r = await write_tool.execute({ path: "new/x.txt", content: "x" }, toolCtx(dir));
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "new/x.txt"), "utf-8")).toBe("x");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write: 覆盖", async () => {
  const dir = tempDir();
  try {
    const f = join(dir, "w.txt");
    writeFileSync(f, "old", "utf-8");
    const r = await write_tool.execute({ path: "w.txt", content: "new" }, toolCtx(dir));
    expect(r.ok).toBe(true);
    expect(readFileSync(f, "utf-8")).toBe("new");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write: 自动建父目录", async () => {
  const dir = tempDir();
  try {
    const r = await write_tool.execute({ path: "a/b/c.txt", content: "d" }, toolCtx(dir));
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "a/b/c.txt"), "utf-8")).toBe("d");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write: UTF-8 字节数 metadata", async () => {
  const dir = tempDir();
  try {
    const r = await write_tool.execute({ path: "u.txt", content: "你好" }, toolCtx(dir));
    expect(r.ok).toBe(true);
    expect(r.metadata).toEqual({ file_written: join(dir, "u.txt"), bytes: 6 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edit: 唯一替换", async () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "e.txt"), "foo bar foo", "utf-8");
    const r = await edit_tool.execute(
      { path: "e.txt", old_string: " bar ", new_string: " BAZ " },
      toolCtx(dir),
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, "e.txt"), "utf-8")).toBe("foo BAZ foo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edit: 未找到", async () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "e.txt"), "a", "utf-8");
    const r = await edit_tool.execute(
      { path: "e.txt", old_string: "zzz", new_string: "y" },
      toolCtx(dir),
    );
    expect(r.ok).toBe(false);
    expect(r.content).toContain("未找到");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edit: 多处匹配", async () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "e.txt"), "let x\nlet x\n", "utf-8");
    const r = await edit_tool.execute(
      { path: "e.txt", old_string: "let x", new_string: "let y" },
      toolCtx(dir),
    );
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/出现 2 次/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edit: 文件不存在", async () => {
  const dir = tempDir();
  try {
    const r = await edit_tool.execute(
      { path: "missing.txt", old_string: "a", new_string: "b" },
      toolCtx(dir),
    );
    expect(r.ok).toBe(false);
    expect(r.content).toContain("write 创建");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("edit: old 与 new 相同", async () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, "e.txt"), "same", "utf-8");
    const r = await edit_tool.execute(
      { path: "e.txt", old_string: "x", new_string: "x" },
      toolCtx(dir),
    );
    expect(r.ok).toBe(false);
    expect(r.content).toContain("相同");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
