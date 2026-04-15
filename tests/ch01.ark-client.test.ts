import { expect, test } from "bun:test";
import { ArkClient, ArkError, type FetchImpl } from "../src/provider/ark-client";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("成功 parse choices[0] 并拍平为 ChatResponse", async () => {
  const fetchImpl: FetchImpl = async () =>
    jsonResponse({
      model: "doubao-seed-1-6-250615",
      choices: [
        {
          message: { role: "assistant", content: "你好" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });

  const client = new ArkClient({ api_key: "k", fetch: fetchImpl });
  const res = await client.chat({
    model: "m",
    messages: [{ role: "user", content: "hi" }],
  });
  expect(res.content).toBe("你好");
  expect(res.finish_reason).toBe("stop");
  expect(res.usage?.total_tokens).toBe(3);
});

test("HTTP 非 2xx 抛 ArkError 并带上响应体", async () => {
  const fetchImpl: FetchImpl = async () => new Response("invalid api key", { status: 401 });
  const client = new ArkClient({ api_key: "k", fetch: fetchImpl });
  await expect(
    client.chat({ model: "m", messages: [{ role: "user", content: "x" }] }),
  ).rejects.toBeInstanceOf(ArkError);
});

test("可注入 fetch，单测不走真实网络", async () => {
  let calledUrl = "";
  const fetchImpl: FetchImpl = async (input) => {
    calledUrl = String(input);
    return jsonResponse({
      model: "x",
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    });
  };
  const client = new ArkClient({ api_key: "key", fetch: fetchImpl });
  await client.chat({ model: "mod", messages: [{ role: "user", content: "u" }] });
  expect(calledUrl.endsWith("/chat/completions")).toBe(true);
});

test("content 为 null 时经 ?? 归一为 null", async () => {
  const fetchImpl: FetchImpl = async () =>
    jsonResponse({
      model: "m",
      choices: [{ message: { content: null }, finish_reason: "stop" }],
    });
  const client = new ArkClient({ api_key: "k", fetch: fetchImpl });
  const res = await client.chat({ model: "m", messages: [{ role: "user", content: "x" }] });
  expect(res.content).toBeNull();
});
