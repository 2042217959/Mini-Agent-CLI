import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./registry";

export const LsArgs = z.object({
  path: z.string().optional().describe("目录路径，默认工具上下文 cwd"),
});

export const ls_tool: ToolDefinition<z.infer<typeof LsArgs>> = {
  name: "ls",
  description: "列举目录中的文件和子目录（不递归）；目录名以 / 结尾。",
  parameters: LsArgs,
  needs_permission: false,
  async execute(args, ctx) {
    const path = args.path
      ? isAbsolute(args.path)
        ? args.path
        : resolve(ctx.cwd, args.path)
      : ctx.cwd;
    const entries = readdirSync(path);
    entries.sort();
    const lines = entries.map((name) => {
      const s = statSync(join(path, name));
      return s.isDirectory() ? `${name}/` : name;
    });
    return { ok: true, content: `${path}:\n${lines.join("\n")}` };
  },
};
