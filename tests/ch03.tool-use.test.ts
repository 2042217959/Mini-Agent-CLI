import { expect, test } from "bun:test";
import { aggregateStream } from "../src/provider/aggregate";
import type { ChatStreamDelta } from "../src/provider/stream";
import { zodToJsonSchema } from "../src/tool/schema";
import { z } from "zod";

async function* iter(deltas: ChatStreamDelta[]): AsyncIterable<ChatStreamDelta> {
  for (const d of deltas) yield d;
}

// —— zodToJsonSchema（4） ——

test("zodToJsonSchema: 纯 string", () => {
  const schema = z.string().describe("名称");
  expect(zodToJsonSchema(schema)).toEqual({
    type: "string",
    description: "名称",
  });
});

test("zodToJsonSchema: enum", () => {
  const schema = z.enum(["celsius", "fahrenheit"]);
  expect(zodToJsonSchema(schema)).toEqual({
    type: "string",
    enum: ["celsius", "fahrenheit"],
  });
});

test("zodToJsonSchema: object 内 optional 字段不出现在 required", () => {
  const schema = z.object({
    city: z.string().optional(),
  });
  expect(zodToJsonSchema(schema)).toEqual({
    type: "object",
    properties: {
      city: { type: "string" },
    },
    additionalProperties: false,
  });
});

test("zodToJsonSchema: 嵌套 object", () => {
  const schema = z.object({
    user: z.object({
      name: z.string().describe("用户名"),
    }),
  });
  expect(zodToJsonSchema(schema)).toEqual({
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: {
          name: { type: "string", description: "用户名" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    required: ["user"],
    additionalProperties: false,
  });
});

// —— aggregateStream（4） ——

test("aggregateStream: 单 tool_call 字符级切片可还原 arguments", async () => {
  const deltas: ChatStreamDelta[] = [
    {
      tool_calls: [
        {
          index: 0,
          id: "call_abc",
          type: "function",
          function: { name: "get_weather", arguments: '{"ci' },
        },
      ],
    },
    { tool_calls: [{ index: 0, function: { arguments: 'ty":' } }] },
    { tool_calls: [{ index: 0, function: { arguments: ' "北京"}' } }] },
  ];
  const out = await aggregateStream(iter(deltas));
  expect(out.content).toBeNull();
  expect(out.tool_calls).toEqual([
    {
      id: "call_abc",
      type: "function",
      function: {
        name: "get_weather",
        arguments: '{"city": "北京"}',
      },
    },
  ]);
});

test("aggregateStream: 并行两个 tool_call 按 index 各自攒回", async () => {
  const deltas: ChatStreamDelta[] = [
    {
      tool_calls: [
        {
          index: 1,
          id: "call_b",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"上海"}' },
        },
      ],
    },
    {
      tool_calls: [
        {
          index: 0,
          id: "call_a",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"北京"}' },
        },
      ],
    },
  ];
  const out = await aggregateStream(iter(deltas));
  expect(out.tool_calls).toEqual([
    {
      id: "call_a",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"北京"}' },
    },
    {
      id: "call_b",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"上海"}' },
    },
  ]);
});

test("aggregateStream: 纯 content 流无 tool_calls", async () => {
  const deltas: ChatStreamDelta[] = [{ content: "你" }, { content: "好" }];
  const out = await aggregateStream(iter(deltas));
  expect(out.content).toBe("你好");
  expect(out.tool_calls).toBeUndefined();
});

test("aggregateStream: 空流 → content null 且 tool_calls undefined", async () => {
  async function* empty(): AsyncIterable<ChatStreamDelta> {
    /* no yield */
  }
  const out = await aggregateStream(empty());
  expect(out.content).toBeNull();
  expect(out.tool_calls).toBeUndefined();
});
