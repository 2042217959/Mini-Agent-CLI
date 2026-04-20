import { z } from "zod";
import type { ToolDefinition } from "./registry";
import { filter_env, PassthroughSandbox, type SandboxRunner } from "./sandbox";

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
    const env = filter_env(process.env);

    let sandbox: SandboxRunner = ctx.sandbox ?? new PassthroughSandbox();

    const result = await sandbox.run({
      command: args.command,
      cwd,
      timeout_ms: timeout,
      env,
      abort_signal: ctx.abort_signal,
    });

    const combined = result.stderr
      ? `${result.stdout}\n[stderr]\n${result.stderr}`
      : result.stdout;
    const truncated = combined.length > OUT_MAX;
    const out = truncated ? `${combined.slice(0, OUT_MAX)}\n[...truncated]` : combined;

    const timed_note = result.timed_out ? " [timed_out]" : "";
    return {
      ok: result.exit_code === 0 && !result.timed_out,
      content: `$ ${args.command}\n[sandbox=${result.backend}]${timed_note} [exit=${result.exit_code}]\n${out}`,
      metadata: {
        truncated,
        bytes: out.length,
        timed_out: result.timed_out,
        backend: result.backend,
      },
    };
  },
};
