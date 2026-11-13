import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { AppError } from "./errors.js";

export const ProductConfigSchema = Type.Object({
  provider: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const WorkspaceStatusSchema = Type.Object({
  dataDir: Type.String(),
  schemaVersion: Type.Integer(),
  writerGeneration: Type.Integer(),
  activeTasks: Type.Integer(),
  totalTasks: Type.Integer(),
  provider: Type.String(),
  modelId: Type.String(),
  credentialConfigured: Type.Boolean(),
}, { additionalProperties: false });

export const WorkspaceToolInputSchema = Type.Object({}, { additionalProperties: false });
export const WorkspaceToolOutputSchema = WorkspaceStatusSchema;
export const PromptInputSchema = Type.String({ minLength: 1, maxLength: 100_000 });

export type ProductConfig = Static<typeof ProductConfigSchema>;
export type WorkspaceStatus = Static<typeof WorkspaceStatusSchema>;

export function parseProductConfig(value: unknown): ProductConfig {
  try {
    return Value.Parse(ProductConfigSchema, value);
  } catch (error) {
    throw new AppError("INVALID_CONFIG", "runtime/config.json 必须只包含非空 provider 和 modelId", undefined, { cause: error });
  }
}

export function parsePrompt(value: string): string {
  try {
    Value.Parse(PromptInputSchema, value.trim());
    return value;
  } catch (error) {
    throw new AppError("INVALID_ARGUMENT", "输入不能为空，且不能超过 100000 个字符", undefined, { cause: error });
  }
}
