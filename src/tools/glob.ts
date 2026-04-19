import { Glob } from "bun";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./registry";

const MAX_MATCHES = 200;

export const GlobArgs = z.object({
  pattern: z.string().describe("glob 模式，如 **/*.ts"),
  cwd: z.string().optional().describe("扫描根目录，默认工具上下文 cwd；可相对或绝对"),
});

export const glob_tool: ToolDefinition<z.infer<typeof GlobArgs>> = {
  name: "glob",
  description: "按 glob 模式列出匹配的文件路径（相对 ctx.cwd），最多 200 条。",
  parameters: GlobArgs,
  needs_permission: false,
  async execute(args, ctx) {
    const root = args.cwd
      ? isAbsolute(args.cwd)
        ? args.cwd
        : resolve(ctx.cwd, args.cwd)
      : ctx.cwd;
    const glob = new Glob(args.pattern);
    const matches: string[] = [];
    for await (const f of glob.scan({ cwd: root, onlyFiles: true })) {
      matches.push(f);
      if (matches.length >= MAX_MATCHES) break;
    }
    matches.sort();
    const out =
      matches.length === 0
        ? "(无匹配)"
        : matches.map((m) => relative(ctx.cwd, join(root, m))).join("\n");
    return { ok: true, content: `glob ${args.pattern} in ${root}:\n${out}` };
  },
};
