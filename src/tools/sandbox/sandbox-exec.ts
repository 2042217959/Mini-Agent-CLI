import type { SandboxRunOptions, SandboxRunResult, SandboxRunner } from "../sandbox";
import { command_exists, spawn_collect } from "../sandbox";

function escape_sb_string(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function default_profile(cwd: string): string {
  const c = escape_sb_string(cwd);
  return `
(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)

(allow file-read*
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/System")
  (subpath "/Library")
  (subpath "/private/etc")
  (subpath "/dev")
  (literal "/"))

(allow file-read* file-write*
  (subpath "${c}")
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/private/var/folders"))

(deny file-read*
  (subpath (string-append (param "HOME") "/.ssh"))
  (subpath (string-append (param "HOME") "/.aws"))
  (subpath (string-append (param "HOME") "/.config"))
  (subpath (string-append (param "HOME") "/.gnupg")))

(deny network*)
`;
}

export class SandboxExecRunner implements SandboxRunner {
  readonly backend = "sandbox-exec";

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "darwin") return false;
    return command_exists("sandbox-exec");
  }

  async run(opts: SandboxRunOptions): Promise<SandboxRunResult> {
    const profile = default_profile(opts.cwd);
    const home = opts.env.HOME ?? "";
    const argv = ["sandbox-exec", "-D", `HOME=${home}`, "-p", profile, "sh", "-c", opts.command];
    return spawn_collect(argv, opts, this.backend);
  }
}
