import { z } from "zod";
import type { LlmToolSpec } from "../provider/types";
import { zodToJsonSchema } from "../tool/schema";
import type { ToolContext, ToolResult } from "../types";

export interface ToolDefinition<A = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  needs_permission: boolean;
  execute: (args: A, ctx: ToolContext) => Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown>>();

  register<A>(def: ToolDefinition<A>): void {
    if (this.tools.has(def.name)) {
      throw new Error(`tool "${def.name}" already registered`);
    }
    this.tools.set(def.name, def as ToolDefinition<unknown>);
  }

  get(name: string): ToolDefinition<unknown> | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition<unknown>[] {
    return [...this.tools.values()];
  }

  to_llm_specs(): LlmToolSpec[] {
    return this.list().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.parameters) as Record<string, unknown>,
      },
    }));
  }
}
