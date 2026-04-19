import { z } from "zod";
import type { ToolDefinition } from "./registry";

const OUT_MAX = 32_000;

export const BashArgs = z.object({
  command: z.string().describe("要执行的 shell 命令（支持管道、变量等，经 sh -c 解释）"),
  cwd: z.string().optional().describe("工作目录，默认使用工具上下文 cwd"),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("超时毫秒数，默认 60000；到期发送 SIGTERM"),
});

export const bash_tool: ToolDefinition<z.infer<typeof BashArgs>> = {
  name: "bash",
  description: "通过 sh -c 执行 shell 命令并返回 stdout+stderr。调用前会经权限确认。",
  parameters: BashArgs,
  needs_permission: true,
  async execute(args, ctx) {
    const cwd = args.cwd ?? ctx.cwd;
    const timeout = args.timeout_ms ?? 60_000;

    const proc = Bun.spawn({
      cmd: ["sh", "-c", args.command],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, timeout);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exit_code = await proc.exited;
    clearTimeout(timer);

    const combined = stderr ? `${stdout}\n[stderr]\n${stderr}` : stdout;
    const truncated = combined.length > OUT_MAX;
    const out = truncated ? `${combined.slice(0, OUT_MAX)}\n[...truncated]` : combined;

    return {
      ok: exit_code === 0,
      content: `$ ${args.command}\n[exit=${exit_code}]\n${out}`,
      metadata: { truncated, bytes: out.length },
    };
  },
};
