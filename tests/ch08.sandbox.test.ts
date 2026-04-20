import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "../src/types";
import { read_tool } from "../src/tools/read";
import { command_exists, filter_env, PassthroughSandbox } from "../src/tools/sandbox";
import { pickSandbox } from "../src/tools/sandbox/auto";
import { BwrapRunner } from "../src/tools/sandbox/bwrap";
import { DockerRunner } from "../src/tools/sandbox/docker";
import { SandboxExecRunner } from "../src/tools/sandbox/sandbox-exec";

function toolCtx(cwd: string): ToolContext {
  return {
    cwd,
    session_id: "ch08-read",
    abort_signal: new AbortController().signal,
    logger: console,
    on_progress: () => {},
  };
}

test("read: ~/.ssh 等敏感家目录须走 bash，避免绕过沙箱", async () => {
  const r = await read_tool.execute({ path: "~/.ssh/id_rsa" }, toolCtx(process.cwd()));
  expect(r.ok).toBe(false);
  expect(r.content).toContain("bash");
});

test("filter_env: 剔除敏感键名", () => {
  const out = filter_env({
    PATH: "/bin",
    ARK_API_KEY: "secret",
    GITHUB_TOKEN: "x",
    NORMAL: "ok",
  });
  expect(out.PATH).toBe("/bin");
  expect(out.NORMAL).toBe("ok");
  expect(out.ARK_API_KEY).toBeUndefined();
  expect(out.GITHUB_TOKEN).toBeUndefined();
});

test("filter_env: 跳过 undefined 值", () => {
  const out = filter_env({ X: undefined, Y: "1" });
  expect(out.X).toBeUndefined();
  expect(out.Y).toBe("1");
});

test("PassthroughSandbox: echo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mini-agent-ch08-"));
  try {
    const s = new PassthroughSandbox();
    expect(await s.isAvailable()).toBe(true);
    const r = await s.run({
      command: "echo hi",
      cwd: dir,
      timeout_ms: 5000,
      env: filter_env(process.env),
    });
    expect(r.exit_code).toBe(0);
    expect(r.stdout.trim()).toBe("hi");
    expect(r.backend).toBe("passthrough");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PassthroughSandbox: 超时", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mini-agent-ch08-"));
  try {
    const s = new PassthroughSandbox();
    const r = await s.run({
      command: "sleep 10",
      cwd: dir,
      timeout_ms: 80,
      env: filter_env(process.env),
    });
    expect(r.timed_out).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("command_exists: sh 存在", async () => {
  expect(await command_exists("sh")).toBe(true);
});

test("command_exists: 虚构命令不存在", async () => {
  expect(await command_exists("__not_a_real_cmd_zz__")).toBe(false);
});

test("pickSandbox: force passthrough", async () => {
  const s = await pickSandbox({ force: "passthrough" });
  expect(s.backend).toBe("passthrough");
});

test("pickSandbox: force 不可用后端时降级", async () => {
  const warns: string[] = [];
  const s = await pickSandbox({
    force: "bwrap",
    warn: (m) => {
      warns.push(m);
    },
  });
  if (process.platform === "linux" && (await command_exists("bwrap"))) {
    expect(s.backend).toBe("bwrap");
  } else {
    expect(s.backend).toBe("passthrough");
    expect(warns.some((w) => w.includes("force=bwrap"))).toBe(true);
  }
});

test("SandboxExecRunner: macOS 上可用性探测", async () => {
  const r = new SandboxExecRunner();
  if (process.platform === "darwin" && (await command_exists("sandbox-exec"))) {
    expect(await r.isAvailable()).toBe(true);
  } else {
    expect(await r.isAvailable()).toBe(false);
  }
});

test("BwrapRunner: Linux 上可用性探测", async () => {
  const r = new BwrapRunner();
  if (process.platform === "linux" && (await command_exists("bwrap"))) {
    expect(await r.isAvailable()).toBe(true);
  } else {
    expect(await r.isAvailable()).toBe(false);
  }
});

test("DockerRunner: 与 docker 一致", async () => {
  const r = new DockerRunner();
  const has = await command_exists("docker");
  const info_ok = has
    ? (await Bun.spawn({ cmd: ["docker", "info"], stdout: "ignore", stderr: "ignore" }).exited) === 0
    : false;
  expect(await r.isAvailable()).toBe(has && info_ok);
});
