import { createInterface } from "node:readline";
import { join } from "node:path";
import { z } from "zod";
import { agentLoop } from "./agent/loop";
import { parseRuntimeEnv, resolvedModel } from "./config/schema";
import { ArkClient, ArkError } from "./provider/ark-client";
import { ToolRegistry } from "./tools/registry";
import { bash_tool } from "./tools/bash";
import { glob_tool } from "./tools/glob";
import { grep_tool } from "./tools/grep";
import { ls_tool } from "./tools/ls";
import { InMemoryPermissionState, StdinPermissionChecker } from "./tools/permission";
import { read_tool } from "./tools/read";
import { write_tool } from "./tools/write";
import { edit_tool } from "./tools/edit";
import { PassthroughSandbox } from "./tools/sandbox";
import { pickSandbox, type PickSandboxOptions } from "./tools/sandbox/auto";
import type { AgentMessage } from "./types";
import { loadClaudeMd } from "./prompt/claude-md";
import { defaultUserSkillsDir, loadSkills } from "./prompt/skill";
import { buildSystemPrompt } from "./prompt/system";
import { VERSION } from "./version";

function parse_cli_flags(argv: string[]): {
  unsafe_bash: boolean;
  force_sandbox?: PickSandboxOptions["force"];
  no_skills: boolean;
} {
  let unsafe_bash = false;
  let no_skills = false;
  let raw: string | undefined;
  for (const a of argv) {
    if (a === "--unsafe-bash") unsafe_bash = true;
    if (a === "--no-skills") no_skills = true;
    const m = /^--force-sandbox=(.+)$/.exec(a);
    if (m) raw = m[1];
  }
  const allowed = ["sandbox-exec", "bwrap", "docker", "passthrough"] as const;
  if (raw && !(allowed as readonly string[]).includes(raw)) {
    console.warn(`[sandbox] 未知 --force-sandbox=${raw}，忽略。`);
    return { unsafe_bash, force_sandbox: undefined, no_skills };
  }
  return { unsafe_bash, force_sandbox: raw as PickSandboxOptions["force"], no_skills };
}

const TOOL_ARGS_DISPLAY_MAX = 160;

function truncateDisplay(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

async function main(): Promise<void> {
  const env = parseRuntimeEnv(process.env as Record<string, string | undefined>);
  const apiKey = env.ARK_API_KEY;
  if (!apiKey) {
    console.error("缺少 ARK_API_KEY：请复制 .env.example 为 .env 并填入密钥。");
    process.exit(1);
  }

  const argv_flags = parse_cli_flags(process.argv.slice(2));
  const sandbox = argv_flags.unsafe_bash
    ? new PassthroughSandbox()
    : await pickSandbox({ force: argv_flags.force_sandbox });

  const cwd = process.cwd();
  const claude_md = loadClaudeMd(cwd);
  const skills = argv_flags.no_skills
    ? []
    : loadSkills({
        project_dir: join(cwd, ".mini-agent", "skills"),
        user_dir: defaultUserSkillsDir(),
      });

  const model = resolvedModel(env);
  const client = new ArkClient({ api_key: apiKey });
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const GetWeatherArgs = z.object({
    city: z.string().describe("城市名，例如 北京、上海"),
  });

  const tools = new ToolRegistry();
  tools.register(read_tool);
  tools.register(write_tool);
  tools.register(edit_tool);
  tools.register({
    name: "get_weather",
    description: "查询指定城市的当前天气（温度、天气状况）。",
    parameters: GetWeatherArgs,
    needs_permission: false,
    execute: async (args) => ({
      ok: true,
      content: `${args.city} 晴 22°C`,
    }),
  });
  tools.register(bash_tool);
  tools.register(grep_tool);
  tools.register(glob_tool);
  tools.register(ls_tool);

  const history: AgentMessage[] = [];

  const permission_state = new InMemoryPermissionState();
  const permission = new StdinPermissionChecker(
    permission_state,
    new Set(),
    new Set(),
    (q) => new Promise((resolve) => rl.question(q, resolve)),
  );

  console.log(`mini-agent ${VERSION}`);
  console.log(`model: ${model}`);
  console.log(`sandbox: ${sandbox.backend}`);
  console.log(`tools: ${tools.list().map((t) => t.name).join(", ")}`);
  if (skills.length > 0) {
    console.log(`skills: ${skills.map((s) => s.name).join(", ")}`);
  }
  if (argv_flags.unsafe_bash) {
    console.warn("[sandbox] --unsafe-bash 开启：bash 将裸跑，无隔离。");
  }
  console.log("写文件 / 跑命令前会问你 y/n/a。输入 /exit 退出。");

  const ask = (): void => {
    rl.question("> ", async (line) => {
      const text = line.trim();
      if (text === "/exit") {
        console.log("再见。");
        rl.close();
        return;
      }
      if (text === "") {
        ask();
        return;
      }
      try {
        const events = agentLoop({
          client,
          model,
          tools,
          history,
          user_input: text,
          permission,
          build_system_prompt: () =>
            buildSystemPrompt({
              cwd,
              tool_names: tools.list().map((t) => t.name),
              claude_md,
              skills,
              sandbox_mode: sandbox.backend,
            }),
          tool_ctx_factory: () => ({
            cwd: process.cwd(),
            session_id: "repl-1",
            abort_signal: new AbortController().signal,
            logger: console,
            on_progress: (_chunk: string) => {
              /* 第 7 章 bash 会流式上报 stdout */
            },
            sandbox,
          }),
        });

        for await (const ev of events) {
          switch (ev.kind) {
            case "message_delta":
              process.stdout.write(ev.text);
              break;
            case "tool_call_start": {
              const argsShown = truncateDisplay(ev.call.function.arguments ?? "", TOOL_ARGS_DISPLAY_MAX);
              process.stdout.write(`\n[tool] ${ev.call.function.name}(${argsShown})...`);
              break;
            }
            case "tool_result":
              process.stdout.write(` ${ev.result.ok ? "\u2713" : "\u2717"}\n`);
              break;
            case "turn_end":
              if (ev.reason === "error" && ev.error) {
                console.error(ev.error.message);
              }
              process.stdout.write("\n");
              break;
            default:
              break;
          }
        }
      } catch (e) {
        if (e instanceof ArkError) {
          console.error(e.message);
        } else {
          console.error(e instanceof Error ? e.message : e);
        }
      }
      ask();
    });
  };

  rl.on("close", () => {
    process.exit(0);
  });

  ask();
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
