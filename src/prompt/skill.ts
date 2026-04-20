import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface SkillFrontmatter {
  name?: string;
  description: string;
  disable_model_invocation: boolean;
}

export interface Skill {
  name: string;
  file_path: string;
  description: string;
  base_dir: string;
  disabled: boolean;
}

export interface LoadSkillsOptions {
  extras?: string[];
  project_dir?: string;
  user_dir?: string;
}

export function defaultUserSkillsDir(): string {
  return join(homedir(), ".mini-agent", "skills");
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function parseFrontmatter(raw: string): SkillFrontmatter | null {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!m || !m[1]) return null;
  const body = m[1];
  const out: Record<string, string | boolean> = {};
  for (const line of body.split("\n")) {
    const kv = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
    if (!kv) continue;
    const key = kv[1]!;
    let raw_val = kv[2] ?? "";
    if (
      (raw_val.startsWith('"') && raw_val.endsWith('"')) ||
      (raw_val.startsWith("'") && raw_val.endsWith("'"))
    ) {
      raw_val = raw_val.slice(1, -1);
    }
    if (raw_val === "true") out[key] = true;
    else if (raw_val === "false") out[key] = false;
    else out[key] = raw_val;
  }
  if (typeof out.description !== "string" || !out.description) return null;
  return {
    name: typeof out.name === "string" ? out.name : undefined,
    description: out.description,
    disable_model_invocation: out.disable_model_invocation === true,
  };
}

function parseSkillFile(file_path: string, dir_name: string, base_dir: string): Skill | null {
  const raw = readFileSync(file_path, "utf-8");
  const fm = parseFrontmatter(raw);
  if (!fm) return null;
  return {
    name: fm.name ?? dir_name,
    file_path,
    description: fm.description,
    base_dir,
    disabled: fm.disable_model_invocation,
  };
}

function scanDir(base: string): Skill[] {
  const abs = resolve(base);
  if (!existsSync(abs)) return [];
  const out: Skill[] = [];
  for (const entry of readdirSync(abs)) {
    const sub = join(abs, entry);
    if (!statSync(sub).isDirectory()) continue;
    const file_path = join(sub, "SKILL.md");
    if (!existsSync(file_path)) continue;
    const parsed = parseSkillFile(file_path, entry, abs);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function loadSkills(opts: LoadSkillsOptions): Skill[] {
  const dirs: string[] = [];
  for (const d of opts.extras ?? []) dirs.push(d);
  if (opts.project_dir) dirs.push(opts.project_dir);
  if (opts.user_dir) dirs.push(opts.user_dir);

  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const base of dirs) {
    for (const skill of scanDir(base)) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      out.push(skill);
    }
  }
  return out;
}

export function renderSkillsBlock(skills: Skill[]): string {
  const enabled = skills.filter((s) => !s.disabled);
  if (enabled.length === 0) return "";
  const lines = enabled.map(
    (s) =>
      `  <skill name="${escapeXml(s.name)}" path="${escapeXml(s.file_path)}">${escapeXml(s.description)}</skill>`,
  );
  return `<available_skills>\n${lines.join("\n")}\n</available_skills>`;
}
