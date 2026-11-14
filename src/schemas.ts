import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { AppError } from "./errors.js";

export const CliOptionsSchema = Type.Object({
  dataDir: Type.String({ minLength: 1 }),
  provider: Type.Optional(Type.String({ minLength: 1 })),
  modelId: Type.Optional(Type.String({ minLength: 1 })),
  status: Type.Boolean(),
  help: Type.Boolean(),
}, { additionalProperties: false });

export const ModelConfigSchema = Type.Object({
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

export const LockRecordSchema = Type.Object({
  writerId: Type.String({ minLength: 1 }),
  generation: Type.Integer({ minimum: 1 }),
  pid: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const WriterGenerationRowSchema = Type.Object({
  generation: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const WriterOwnerRowSchema = Type.Object({
  owner_id: Type.String({ minLength: 1 }),
  generation: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const TaskCountsRowSchema = Type.Object({
  total: Type.Integer({ minimum: 0 }),
  active: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
}, { additionalProperties: false });

export type CliOptions = Static<typeof CliOptionsSchema>;
export type ModelConfig = Static<typeof ModelConfigSchema>;
export type WorkspaceStatus = Static<typeof WorkspaceStatusSchema>;
export type LockRecord = Static<typeof LockRecordSchema>;

export function parseCliOptions(value: unknown): CliOptions {
  try {
    return Value.Parse(CliOptionsSchema, value);
  } catch (error) {
    throw new AppError("INVALID_ARGUMENT", "命令参数结构不符合约定", undefined, { cause: error });
  }
}

export function parseModelConfig(value: unknown): ModelConfig {
  try {
    return Value.Parse(ModelConfigSchema, value);
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

export function parseLockRecord(value: unknown): LockRecord | undefined {
  try {
    return Value.Parse(LockRecordSchema, value);
  } catch {
    return undefined;
  }
}

export function parseDatabaseRow<T extends TSchema>(schema: T, value: unknown): Static<T> {
  try {
    return Value.Parse(schema, value);
  } catch (error) {
    throw new AppError("DATA_VERSION_UNSUPPORTED", "SQLite 记录结构与当前版本不兼容", undefined, { cause: error });
  }
}
