export type PermissionDecision = "allow_once" | "allow_always" | "deny";

export interface PermissionChecker {
  check(tool_name: string, args: unknown): Promise<PermissionDecision>;
}

export class InMemoryPermissionState {
  private readonly always = new Set<string>();

  is_always_allowed(tool: string): boolean {
    return this.always.has(tool);
  }

  mark_always_allowed(tool: string): void {
    this.always.add(tool);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

/** 测试用：固定返回某一决定，不读 stdin。 */
export class StaticPermissionChecker implements PermissionChecker {
  constructor(private readonly decision: PermissionDecision) {}

  async check(_tool_name: string, _args: unknown): Promise<PermissionDecision> {
    return this.decision;
  }
}

export class StdinPermissionChecker implements PermissionChecker {
  constructor(
    private readonly state: InMemoryPermissionState,
    private readonly auto_allow: ReadonlySet<string>,
    private readonly auto_deny: ReadonlySet<string>,
    private readonly prompt: (q: string) => Promise<string>,
    private readonly timeout_ms = 60_000,
  ) {}

  async check(tool_name: string, args: unknown): Promise<PermissionDecision> {
    if (this.auto_allow.has(tool_name) || this.state.is_always_allowed(tool_name)) {
      return "allow_once";
    }
    if (this.auto_deny.has(tool_name)) return "deny";

    const question = `\n[权限] 调用 ${tool_name}(${truncate(JSON.stringify(args), 200)})？(y/n/a) `;
    const answer = await Promise.race([
      this.prompt(question),
      new Promise<string>((r) => setTimeout(() => r("n"), this.timeout_ms)),
    ]);

    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "y" || trimmed === "yes") return "allow_once";
    if (trimmed === "a" || trimmed === "always") {
      this.state.mark_always_allowed(tool_name);
      return "allow_always";
    }
    return "deny";
  }
}
