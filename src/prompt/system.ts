import type { ClaudeMd } from "./claude-md";
import type { Skill } from "./skill";
import { escapeXml, renderSkillsBlock } from "./skill";

const HEAD = `你是 mini-agent，一个跑在终端的 coding agent。`;

const TOOL_GUIDELINES = `<tool_use_guidelines>
- 任何修改文件或执行命令的工具都会请求用户确认，不要假设已获批准
- 大量只读操作（read / grep / glob / ls）可以放心并行发起
- 写入前先用 read 确认当前内容；避免覆盖用户未保存的改动
- bash 输出超过 32k 字符会被截断；遇到长输出优先用 head / tail / grep 过滤
</tool_use_guidelines>`;

export interface SystemPromptInput {
  cwd: string;
  tool_names: string[];
  claude_md?: ClaudeMd | null;
  skills?: Skill[];
  sandbox_mode: string;
  now?: Date;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const now = input.now ?? new Date();
  const parts: string[] = [];

  parts.push(HEAD);
  parts.push(`cwd: ${input.cwd}`);
  parts.push(`time: ${now.toISOString()}`);
  parts.push(`registered_tools: ${input.tool_names.join(", ") || "(none)"}`);
  parts.push("");

  parts.push(TOOL_GUIDELINES);

  if (input.claude_md) {
    parts.push("");
    parts.push(`<project_context path="${escapeXml(input.claude_md.file_path)}">`);
    parts.push(input.claude_md.content.trim());
    parts.push("</project_context>");
  }

  const skills_block = renderSkillsBlock(input.skills ?? []);
  if (skills_block) {
    parts.push("");
    parts.push(skills_block);
    parts.push("若任何 skill 名称与当前任务相关，先用 read 工具把对应 path 的 SKILL.md 整文件读进来再执行。");
  }

  if (input.sandbox_mode === "passthrough") {
    parts.push("");
    parts.push(
      "⚠️ 当前 bash 工具未启用沙箱（passthrough）。只执行用户明确授权的命令，不要主动探查凭证或发起外联。",
    );
  }

  return parts.join("\n");
}
