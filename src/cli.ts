import { createInterface } from "node:readline";
import { z } from "zod";
import { parseRuntimeEnv, resolvedModel } from "./config/schema";
import { aggregateStream } from "./provider/aggregate";
import { ArkClient, ArkError } from "./provider/ark-client";
import type { LlmMessage, LlmToolSpec } from "./provider/types";
import { zodToJsonSchema } from "./tool/schema";
import type { ToolCall } from "./types";
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

const TOOL_SPECS: LlmToolSpec[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "查询指定城市的当前天气（温度、天气状况）。",
      parameters: zodToJsonSchema(GetWeatherArgs) as Record<string, unknown>,
    },
  },
];

function executeFakeTool(call: ToolCall): string {
  if (call.function.name !== "get_weather") {
    return `工具 ${call.function.name} 不存在，可用工具：get_weather`;
  }
  let args: unknown;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return "参数不是合法 JSON，无法执行 get_weather";
  }
  const parsed = GetWeatherArgs.safeParse(args);
  if (!parsed.success) {
    return `参数校验失败：${parsed.error.message}`;
  }
  return `${parsed.data.city} 晴 22°C`;
}

async function runTurn(client: ArkClient, model: string, messages: LlmMessage[]): Promise<void> {
  for (let step = 0; step < 5; step++) {
    const stream = client.chatStream({
      model,
      messages,
      tools: TOOL_SPECS,
    });
    const req = {
        model,
        messages,
        tools: TOOL_SPECS,
      };
      console.log("[chatStream req]");
      console.log(JSON.stringify(req, null, 2));
      
    const { content, tool_calls } = await aggregateStream(stream, (c) => process.stdout.write(c));

    if (!tool_calls) {
      process.stdout.write("\n");
      messages.push({ role: "assistant", content });
      return;
    }

    messages.push({ role: "assistant", content, tool_calls });

    for (const call of tool_calls) {
      const result = executeFakeTool(call);
      console.log(`\n[tool] ${call.function.name} -> ${result}`);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: result,
      });
    }
  }
  process.stdout.write("\n");
  messages.push({
    role: "assistant",
    content: "（工具调用轮次过多，已中止。）",
  });
}

console.log(`mini-agent ${VERSION}`);
console.log(`model: ${model}`);
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
      const messages: LlmMessage[] = [{ role: "user", content: text }];
      await runTurn(client, model, messages);
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
