import { createInterface } from "node:readline";
import { parseRuntimeEnv, resolvedModel } from "./config/schema";
import { ArkClient, ArkError } from "./provider/ark-client";
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
      const messages = [{ role: "user" as const, content: text }];
      for await (const delta of client.chatStream({ model, messages })) {
        if (delta.content) {
          process.stdout.write(delta.content);
        }
      }
      process.stdout.write("\n");
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
