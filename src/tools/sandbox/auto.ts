import { BwrapRunner } from "./bwrap";
import { DockerRunner } from "./docker";
import { SandboxExecRunner } from "./sandbox-exec";
import { PassthroughSandbox, type SandboxRunner } from "../sandbox";

export interface PickSandboxOptions {
  force?: "sandbox-exec" | "bwrap" | "docker" | "passthrough";
  warn?: (msg: string) => void;
}

function build_forced(force: NonNullable<PickSandboxOptions["force"]>): SandboxRunner {
  switch (force) {
    case "sandbox-exec":
      return new SandboxExecRunner();
    case "bwrap":
      return new BwrapRunner();
    case "docker":
      return new DockerRunner();
    case "passthrough":
      return new PassthroughSandbox();
  }
}

export function order_for_platform(): SandboxRunner[] {
  if (process.platform === "darwin") {
    return [new SandboxExecRunner(), new DockerRunner()];
  }
  if (process.platform === "linux") {
    return [new BwrapRunner(), new DockerRunner()];
  }
  return [new DockerRunner()];
}

export async function pickSandbox(opts: PickSandboxOptions = {}): Promise<SandboxRunner> {
  const warn = opts.warn ?? console.warn;
  if (opts.force) {
    const r = build_forced(opts.force);
    if (!(await r.isAvailable()) && opts.force !== "passthrough") {
      warn(`[sandbox] force=${opts.force} 不可用，退回 passthrough`);
      return new PassthroughSandbox();
    }
    return r;
  }
  for (const r of order_for_platform()) {
    if (await r.isAvailable()) return r;
  }
  warn(
    "[sandbox] 未检测到 sandbox-exec / bwrap / docker；退回 passthrough（无隔离）。建议安装其一或使用 --unsafe-bash 显式裸跑。",
  );
  return new PassthroughSandbox();
}
