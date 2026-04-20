import type { SandboxRunOptions, SandboxRunResult, SandboxRunner } from "../sandbox";
import { command_exists, spawn_collect } from "../sandbox";

export class DockerRunner implements SandboxRunner {
  readonly backend = "docker";

  constructor(private readonly opts: { image?: string; allow_network?: boolean } = {}) {}

  async isAvailable(): Promise<boolean> {
    if (!(await command_exists("docker"))) return false;
    try {
      const proc = Bun.spawn({ cmd: ["docker", "info"], stdout: "ignore", stderr: "ignore" });
      return (await proc.exited) === 0;
    } catch {
      return false;
    }
  }

  async run(opts: SandboxRunOptions): Promise<SandboxRunResult> {
    const image = this.opts.image ?? "alpine:3.20";
    const argv: string[] = [
      "docker",
      "run",
      "--rm",
      "-i",
      "--memory",
      "512m",
      "--pids-limit",
      "128",
      "-v",
      `${opts.cwd}:/workspace`,
      "-w",
      "/workspace",
    ];
    if (!this.opts.allow_network) argv.push("--network", "none");
    for (const [k, v] of Object.entries(opts.env)) {
      argv.push("-e", `${k}=${v}`);
    }
    argv.push(image, "sh", "-c", opts.command);
    return spawn_collect(argv, { ...opts, cwd: process.cwd() }, this.backend);
  }
}
