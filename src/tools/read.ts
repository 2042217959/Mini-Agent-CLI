import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./registry";

const MAX_CHARS = 32_000;

export const ReadArgs = z.object({
  path: z.string().describe("文件路径，绝对或相对当前目录"),
  start_line: z.number().int().positive().optional().describe("起始行（1-based），默认 1"),
  end_line: z.number().int().positive().optional().describe("结束行（含），默认到文件末尾"),
});

export const read_tool: ToolDefinition<z.infer<typeof ReadArgs>> = {
  name: "read",
  description: "读取本地文件内容。大文件会被截断或可用 start_line/end_line 精确读取。",
  parameters: ReadArgs,
  needs_permission: false,
  async execute(args, ctx) {
    const abs = isAbsolute(args.path) ? args.path : resolve(ctx.cwd, args.path);
    let raw: string;
    try {
      raw = readFileSync(abs, "utf-8");
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "ENOENT") {
        return { ok: false, content: `文件不存在: ${abs}` };
      }
      return { ok: false, content: `读取失败: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (raw.indexOf("\x00") !== -1) {
      return { ok: false, content: `${abs} 看起来是二进制文件，read 工具只处理文本` };
    }

    const lines = raw.split("\n");
    const start = (args.start_line ?? 1) - 1;
    const end = args.end_line ?? lines.length;
    const slice = lines.slice(start, end).join("\n");

    let truncated = false;
    let output = slice;
    if (output.length > MAX_CHARS) {
      output = output.slice(0, MAX_CHARS);
      truncated = true;
    }

    const header =
      args.start_line || args.end_line
        ? `--- ${abs} (lines ${start + 1}-${Math.min(end, lines.length)}) ---\n`
        : `--- ${abs} ---\n`;
    const footer = truncated ? `\n--- [truncated at ${MAX_CHARS} chars] ---` : "";

    return {
      ok: true,
      content: header + output + footer,
      metadata: { file_read: abs, truncated, bytes: Buffer.byteLength(output, "utf-8") },
    };
  },
};
