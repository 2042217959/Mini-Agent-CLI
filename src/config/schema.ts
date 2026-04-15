import { z } from "zod";

/** 小册默认模型（可用环境变量 MINI_AGENT_MODEL 覆盖）。 */
export const defaultModel = "doubao-seed-1-6-250615";

/** 启动时可解析的环境变量（第 1 章起会真正使用 Ark）。 */
export const RuntimeEnvSchema = z.object({
  ARK_API_KEY: z.string().min(1).optional(),
  MINI_AGENT_MODEL: z.string().min(1).optional(),
});

export type RuntimeEnv = z.infer<typeof RuntimeEnvSchema>;

export function parseRuntimeEnv(env: Record<string, string | undefined>): RuntimeEnv {
  return RuntimeEnvSchema.parse({
    ARK_API_KEY: env.ARK_API_KEY,
    MINI_AGENT_MODEL: env.MINI_AGENT_MODEL,
  });
}

export function resolvedModel(env: RuntimeEnv): string {
  return env.MINI_AGENT_MODEL ?? defaultModel;
}
