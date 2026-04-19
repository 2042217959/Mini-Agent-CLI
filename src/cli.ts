import { createInterface } from "node:readline";
import { z } from "zod";
import { agentLoop } from "./agent/loop";
import { parseRuntimeEnv, resolvedModel } from "./config/schema";
import { ArkClient, ArkError } from "./provider/ark-client";
import { ToolRegistry } from "./tools/registry";
import { read_tool } from "./tools/read";
import { write_tool } from "./tools/write";
import { edit_tool } from "./tools/edit";
import type { AgentMessage } from "./types";
import { VERSION } from "./version";

const env = parseRuntimeEnv(process.env as Record<string, string | undefined>);
const apiKey = env.ARK_API_KEY;
if (!apiKey) {
  console.error("缺少 ARK_API_KEY：请复制 .env.example 为 .env 并填入密钥。");
  process.exit(1);
}

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

const history: AgentMessage[] = [];

console.log(`mini-agent ${VERSION}`);
console.log(`model: ${model}`);
console.log(`tools: ${tools.list().map((t) => t.name).join(", ")}`);
console.log("输入 /exit 或按 Ctrl-D 退出。");

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
        tool_ctx_factory: () => ({
          cwd: process.cwd(),
          session_id: "repl-1",
          abort_signal: new AbortController().signal,
          logger: console,
          on_progress: (_chunk: string) => {
            /* 第 7 章 bash 会流式上报 stdout */
          },
        }),
      });

      for await (const ev of events) {
        switch (ev.kind) {
          case "message_delta":
            process.stdout.write(ev.text);
            break;
          case "tool_call_start":
            process.stdout.write(
              `\n[tool] ${ev.call.function.name}(${ev.call.function.arguments})...`,
            );
            break;
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
