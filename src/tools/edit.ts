import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./registry";

export const EditArgs = z.object({
  path: z.string().describe("要编辑的文件路径"),
  old_string: z.string().describe("要被替换的原内容；必须在文件中唯一出现"),
  new_string: z.string().describe("替换后的新内容"),
});

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

export const edit_tool: ToolDefinition<z.infer<typeof EditArgs>> = {
  name: "edit",
  description:
    "在文件中将 old_string 替换为 new_string。old_string 必须在文件中唯一出现，否则失败。新建文件请用 write。",
  parameters: EditArgs,
  needs_permission: true,
  async execute(args, ctx) {
    const abs = isAbsolute(args.path) ? args.path : resolve(ctx.cwd, args.path);

    let original: string;
    try {
      original = readFileSync(abs, "utf-8");
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "ENOENT") {
        return { ok: false, content: `文件不存在，请用 write 创建: ${abs}` };
      }
      return { ok: false, content: `读取失败: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (args.old_string === args.new_string) {
      return { ok: false, content: "old_string 与 new_string 相同，没有改动" };
    }
    if (args.old_string === "") {
      return { ok: false, content: "old_string 不能为空。若要新建文件，请用 write 工具" };
    }

    const occurrences = countOccurrences(original, args.old_string);
    if (occurrences === 0) {
      return {
        ok: false,
        content: `在 ${abs} 中未找到 old_string。请确认内容（包括空白）是否完全一致`,
      };
    }
    if (occurrences > 1) {
      return {
        ok: false,
        content: `old_string 在 ${abs} 中出现 ${occurrences} 次。请扩大 old_string 上下文使其唯一`,
      };
    }

    const updated = original.replace(args.old_string, args.new_string);
    try {
      mkdirSync(dirname(abs), { recursive: true });
      const tmp = `${abs}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      writeFileSync(tmp, updated, "utf-8");
      renameSync(tmp, abs);
    } catch (err) {
      return { ok: false, content: `写入失败: ${err instanceof Error ? err.message : String(err)}` };
    }

    const bytes = Buffer.byteLength(updated, "utf-8");
    return {
      ok: true,
      content: `已编辑 ${abs}（替换 1 处，文件现 ${bytes} bytes）`,
      metadata: { file_written: abs, bytes },
    };
  },
};
