import type { SandboxRunOptions, SandboxRunResult, SandboxRunner } from "../sandbox";
import { command_exists, spawn_collect } from "../sandbox";

export class BwrapRunner implements SandboxRunner {
  readonly backend = "bwrap";

  constructor(private readonly opts: { allow_network?: boolean } = {}) {}

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "linux") return false;
    return command_exists("bwrap");
  }

  async run(opts: SandboxRunOptions): Promise<SandboxRunResult> {
    const argv: string[] = [
      "bwrap",
      "--die-with-parent",
      "--unshare-user",
      "--unshare-pid",
      "--unshare-uts",
      "--unshare-ipc",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/bin",
      "/bin",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind-try",
      "/lib64",
      "/lib64",
      "--ro-bind",
      "/etc",
      "/etc",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--tmpfs",
      "/tmp",
      "--bind",
      opts.cwd,
      opts.cwd,
      "--chdir",
      opts.cwd,
      "--setenv",
      "HOME",
      "/tmp",
    ];
    if (!this.opts.allow_network) {
      argv.splice(1, 0, "--unshare-net");
    }
    argv.push("sh", "-c", opts.command);
    return spawn_collect(argv, opts, this.backend);
  }
}
