import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ClaudeMd {
  file_path: string;
  content: string;
}

export function loadClaudeMd(start_dir: string, opts: { stop_at?: string } = {}): ClaudeMd | null {
  let dir = resolve(start_dir);
  const stop = opts.stop_at ? resolve(opts.stop_at) : null;

  while (true) {
    const candidate = join(dir, "CLAUDE.md");
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return { file_path: candidate, content: readFileSync(candidate, "utf-8") };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    if (stop && dir === stop) return null;
    dir = parent;
  }
}
