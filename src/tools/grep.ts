import { z } from "zod";
import type { ToolDefinition } from "./registry";

async function commandExists(name: string): Promise<boolean> {
  const proc = Bun.spawn({
    cmd: ["sh", "-c", `command -v ${name}`],
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  return code === 0;
}

export const GrepArgs = z.object({
  pattern: z.string().describe("搜索用的正则表达式"),
  path: z.string().optional().describe("根路径，默认工具上下文 cwd"),
  include: z
    .string()
    .optional()
    .describe("可选：仅匹配某 glob，如 *.ts（rg 用 --glob，grep 用 --include）"),
});

export const grep_tool: ToolDefinition<z.infer<typeof GrepArgs>> = {
  name: "grep",
  description: "在文件树中搜索匹配正则的行。优先 ripgrep (rg)；最多返回 100 条匹配。",
  parameters: GrepArgs,
  needs_permission: false,
  async execute(args, ctx) {
    const path = args.path ?? ctx.cwd;
    const have_rg = await commandExists("rg");
    const cmd = have_rg
      ? [
          "rg",
          "--no-heading",
          "--line-number",
          "--color=never",
          ...(args.include ? ["--glob", args.include] : []),
          args.pattern,
          path,
        ]
      : [
          "grep",
          "-rEn",
          "--color=never",
          ...(args.include ? ["--include", args.include] : []),
          args.pattern,
          path,
        ];

    const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exit = await proc.exited;

    if (exit !== 0 && exit !== 1) {
      return { ok: false, content: `搜索失败 (exit=${exit}): ${stderr}` };
    }

    const lines = stdout.trim() ? stdout.trim().split("\n") : [];
    const truncated = lines.length > 100;
    const shown = lines.slice(0, 100);
    const summary =
      lines.length === 0
        ? "(无匹配)"
        : truncated
          ? `${shown.join("\n")}\n[...另外还有 ${lines.length - 100} 条匹配未显示]`
          : shown.join("\n");
    return {
      ok: true,
      content: `${have_rg ? "[rg]" : "[grep]"} ${args.pattern} in ${path}\n${summary}`,
    };
  },
};
