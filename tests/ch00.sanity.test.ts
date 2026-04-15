import { expect, test } from "bun:test";
import {
  defaultModel,
  parseRuntimeEnv,
  resolvedModel,
} from "../src/config/schema";
import { sampleEnv } from "./fixtures/env";

test("RuntimeEnvSchema 接受 fixture", () => {
  expect(() => parseRuntimeEnv(sampleEnv)).not.toThrow();
  const parsed = parseRuntimeEnv(sampleEnv);
  expect(parsed.ARK_API_KEY).toBe("test-key-placeholder");
});

test("resolvedModel 无覆盖时回落到默认模型", () => {
  expect(resolvedModel(parseRuntimeEnv({}))).toBe(defaultModel);
});
