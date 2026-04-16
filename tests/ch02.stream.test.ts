import { expect, test } from "bun:test";
import { ArkClient, type FetchImpl } from "../src/provider/ark-client";
import { parseSse } from "../src/provider/stream";

/** 将多段字符串分别作为独立 chunk 推送（模拟网络分包），不走真实连接。 */
function streamOfStringParts(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < parts.length) controller.enqueue(enc.encode(parts[i++]));
      else controller.close();
    },
  });
}

async function collectParseSse(stream: ReadableStream<Uint8Array>) {
  const out: { data: string }[] = [];
  for await (const f of parseSse(stream)) out.push(f);
  return out;
}

test("parseSse: 单行单 data 正常 yield", async () => {
  const frames = await collectParseSse(streamOfStringParts(['data: hello world\n']));
  expect(frames).toEqual([{ data: "hello world" }]);
});

test("parseSse: 跨 chunk 切分（一条 data 拆成两个 Uint8Array）", async () => {
  const frames = await collectParseSse(streamOfStringParts(['data: {"k":', '1}\n']));
  expect(frames).toEqual([{ data: '{"k":1}' }]);
});

test("parseSse: 注释行 : heartbeat 忽略", async () => {
  const frames = await collectParseSse(
    streamOfStringParts([": heartbeat\n", "data: payload\n"]),
  );
  expect(frames).toEqual([{ data: "payload" }]);
});

test("parseSse: CRLF 与 LF 均可分帧", async () => {
  const frames = await collectParseSse(
    streamOfStringParts(["data: first\r\n", "data: second\n"]),
  );
  expect(frames).toEqual([{ data: "first" }, { data: "second" }]);
});

test("parseSse: 流结束尾部无换行的 data 仍被 flush", async () => {
  const frames = await collectParseSse(streamOfStringParts(["data: tail-only"]));
  expect(frames).toEqual([{ data: "tail-only" }]);
});

test("chatStream: 遇到 data: [DONE] 正确终止", async () => {
  const sse =
    'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' + "data: [DONE]\n";
  const fetchImpl: FetchImpl = async () =>
    new Response(streamOfStringParts([sse]), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

  const client = new ArkClient({ api_key: "k", fetch: fetchImpl });
  const deltas: { content?: string | null }[] = [];
  for await (const d of client.chatStream({
    model: "m",
    messages: [{ role: "user", content: "u" }],
  })) {
    deltas.push(d);
  }
  expect(deltas).toEqual([{ content: "a" }]);
});

test("chatStream: 非 JSON 的 data 帧跳过且不抛错", async () => {
  const sse =
    "data: NOT_JSON_AT_ALL\n\n" +
    'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
    "data: [DONE]\n";
  const fetchImpl: FetchImpl = async () =>
    new Response(streamOfStringParts([sse]), { status: 200 });

  const client = new ArkClient({ api_key: "k", fetch: fetchImpl });
  const contents: string[] = [];
  for await (const d of client.chatStream({
    model: "m",
    messages: [{ role: "user", content: "x" }],
  })) {
    if (d.content) contents.push(d.content);
  }
  expect(contents).toEqual(["ok"]);
});

test("chatStream: 请求体含 stream:true，且带 accept 与 authorization", async () => {
  let captured: RequestInit | undefined;
  const fetchImpl: FetchImpl = async (_input, init) => {
    captured = init;
    return new Response(streamOfStringParts([]), { status: 200 });
  };

  const client = new ArkClient({ api_key: "my-secret-key", fetch: fetchImpl });
  for await (const _ of client.chatStream({
    model: "mod-1",
    messages: [{ role: "user", content: "hi" }],
  })) {
    /* 空 body 不产生 delta */
  }

  const headers = new Headers(captured?.headers);
  expect(headers.get("accept")).toBe("text/event-stream");
  expect(headers.get("authorization")).toBe("Bearer my-secret-key");

  const body = JSON.parse(String(captured?.body)) as {
    stream: boolean;
    model: string;
    messages: unknown;
  };
  expect(body.stream).toBe(true);
  expect(body.model).toBe("mod-1");
  expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
});
