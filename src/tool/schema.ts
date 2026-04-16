import { z } from "zod";

export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
};

export function zodToJsonSchema(schema: z.ZodType<unknown>): JsonSchema {
  return convert(schema);
}

function convert(schema: z.ZodType<unknown>): JsonSchema {
  const def = (schema as unknown as { _def: { description?: string } })._def;
  const description = def.description;
  const out = buildType(schema);
  if (description) out.description = description;
  return out;
}

function buildType(schema: z.ZodType<unknown>): JsonSchema {
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) {
    const options = (schema as unknown as { options: unknown[] }).options;
    return { type: "string", enum: options };
  }
  if (schema instanceof z.ZodOptional) {
    return convert((schema as unknown as { unwrap: () => z.ZodType<unknown> }).unwrap());
  }
  if (schema instanceof z.ZodArray) {
    const element = (schema as unknown as { element: z.ZodType<unknown> }).element;
    return { type: "array", items: convert(element) };
  }
  if (schema instanceof z.ZodObject) {
    const shape = (schema as unknown as { shape: Record<string, z.ZodType<unknown>> }).shape;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = convert(value);
      if (!(value instanceof z.ZodOptional || value instanceof z.ZodDefault)) {
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      required: required.length ? required : undefined,
      additionalProperties: false,
    };
  }
  return { type: "object" };
}
