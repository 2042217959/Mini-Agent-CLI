import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { ToolDefinition } from "./registry";

const MAX_CHARS = 32_000;

const DENY_HOME_TOP = new Set([".ssh", ".aws", ".config", ".gnupg"]);

function expand_user_path(path: string): string {
  if (path === "~" || path.startsWith("~/")) {
    return path.replace(/^~(?=$|[\\/])/, homedir());
  }
  return path;
}

/** 与沙箱默认策略一致：这些家目录子树只能经 bash（受沙箱约束）访问，避免 read 绕过隔离。 */
function is_sandboxed_home_subpath(abs: string): boolean {
  const home = resolve(homedir());
  const abs_norm = resolve(abs);
  const rel = relative(home, abs_norm);
  if (rel.startsWith("..") || rel === "") return false;
  const top = rel.split(sep)[0];
  return DENY_HOME_TOP.has(top);
}

export const ReadArgs = z.object({
  path: z.string().describe("文件路径，绝对或相对当前目录"),
  start_line: z.number().int().positive().optional().describe("起始行（1-based），默认 1"),
  end_line: z.number().int().positive().optional().describe("结束行（含），默认到文件末尾"),
});

export const read_tool: ToolDefinition<z.infer<typeof ReadArgs>> = {
  name: "read",
  description:
    "读取本地文件内容。大文件会被截断或可用 start_line/end_line 精确读取。路径可含 ~/ 前缀。家目录下的 .ssh/.aws/.config/.gnupg 请改用 bash（cat 等），以便走沙箱。",
  parameters: ReadArgs,
  needs_permission: false,
  async execute(args, ctx) {
    const expanded = expand_user_path(args.path);
    const abs = isAbsolute(expanded) ? expanded : resolve(ctx.cwd, expanded);
    if (is_sandboxed_home_subpath(abs)) {
      return {
        ok: false,
        content:
          "该路径受沙箱策略约束，不能通过 read 直接读取（read 在宿主进程内执行，会绕过沙箱）。请改用 bash 执行 cat 等命令。",
      };
    }
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
