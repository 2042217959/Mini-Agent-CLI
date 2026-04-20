/** 第 8 章：沙箱抽象、Passthrough、共享 spawn、环境变量过滤 */

export interface SandboxRunOptions {
  command: string;
  cwd: string;
  timeout_ms: number;
  env: Record<string, string>;
  abort_signal?: AbortSignal;
}

export interface SandboxRunResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  backend: string;
}

export interface SandboxRunner {
  readonly backend: string;
  isAvailable(): Promise<boolean>;
  run(opts: SandboxRunOptions): Promise<SandboxRunResult>;
}

const DENY_ENV = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

/** 剔除疑似密钥的环境变量键（宁可误杀）。 */
export function filter_env(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (DENY_ENV.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export class PassthroughSandbox implements SandboxRunner {
  readonly backend = "passthrough";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(opts: SandboxRunOptions): Promise<SandboxRunResult> {
    return spawn_collect(["sh", "-c", opts.command], opts, this.backend);
  }
}

export async function spawn_collect(
  argv: string[],
  opts: SandboxRunOptions,
  backend: string,
): Promise<SandboxRunResult> {
  const proc = Bun.spawn({
    cmd: argv,
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env,
  });

  let timed_out = false;
  const timer = setTimeout(() => {
    timed_out = true;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, opts.timeout_ms);

  const on_abort = () => {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  };
  opts.abort_signal?.addEventListener("abort", on_abort);

  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exit_code = await proc.exited;
    return { exit_code, stdout, stderr, timed_out, backend };
  } finally {
    clearTimeout(timer);
    opts.abort_signal?.removeEventListener("abort", on_abort);
  }
}

export async function command_exists(name: string): Promise<boolean> {
  try {
    const proc = Bun.spawn({
      cmd: ["sh", "-c", `command -v ${JSON.stringify(name)}`],
      stdout: "pipe",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}
