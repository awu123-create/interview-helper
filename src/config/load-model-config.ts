import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AppError } from "../errors.js";
import { parseModelConfig, type ModelConfig } from "../schemas.js";

export function loadModelConfig(
  dataDir: string,
  overrides: Partial<ModelConfig> = {},
): ModelConfig | undefined {
  const path = resolve(dataDir, "runtime", "config.json");
  let stored: ModelConfig | undefined;
  if (existsSync(path)) {
    try {
      stored = parseModelConfig(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "INVALID_CONFIG",
        "runtime/config.json 不是有效 JSON",
        undefined,
        { cause: error },
      );
    }
  }
  const provider = overrides.provider ?? stored?.provider;
  const modelId = overrides.modelId ?? stored?.modelId;
  if (!provider && !modelId) return undefined;
  return parseModelConfig({ provider, modelId });
}
