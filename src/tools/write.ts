import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./registry";

export const WriteArgs = z.object({
  path: z.string().describe("文件路径，绝对或相对当前目录"),
  content: z.string().describe("完整文件内容；此工具是全量覆盖，不是追加"),
});

export const write_tool: ToolDefinition<z.infer<typeof WriteArgs>> = {
  name: "write",
  description:
    "全量写入文件。会覆盖已有内容。如果目标目录不存在会自动创建。若只想改几行，用 edit 而非 write。",
  parameters: WriteArgs,
  needs_permission: true,
  async execute(args, ctx) {
    const abs = isAbsolute(args.path) ? args.path : resolve(ctx.cwd, args.path);
    const dir = dirname(abs);
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = `${abs}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      writeFileSync(tmp, args.content, "utf-8");
      renameSync(tmp, abs);
    } catch (err) {
      return { ok: false, content: `写入失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    const bytes = Buffer.byteLength(args.content, "utf-8");
    return {
      ok: true,
      content: `已写入 ${abs} (${bytes} bytes)`,
      metadata: { file_written: abs, bytes },
    };
  },
};
