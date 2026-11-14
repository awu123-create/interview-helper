import { AppError } from "../errors.js";
import type { ModelConfig } from "../schemas.js";

export const PROVIDER_ENVIRONMENT = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  kimi: "KIMI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  zai: "ZAI_API_KEY",
} as const;

export interface ResolvedCredentials extends ModelConfig {
  apiKey: string;
  environmentVariable: string;
}

export function resolveCredentials(config: ModelConfig | undefined, env: NodeJS.ProcessEnv): ResolvedCredentials {
  if (!config) throw new AppError("MODEL_NOT_CONFIGURED", "请配置 provider 和 modelId");
  const environmentVariable = PROVIDER_ENVIRONMENT[config.provider as keyof typeof PROVIDER_ENVIRONMENT];
  if (!environmentVariable) throw new AppError("INVALID_CONFIG", `不支持的内置提供方: ${config.provider}`);
  const apiKey = env[environmentVariable];
  if (!apiKey) throw new AppError("MISSING_CREDENTIALS", `缺少 ${environmentVariable}，不会切换提供方或读取其他凭据`);
  return { ...config, apiKey, environmentVariable };
}

export function hasCredentials(config: ModelConfig | undefined, env: NodeJS.ProcessEnv): boolean {
  if (!config) return false;
  const variable = PROVIDER_ENVIRONMENT[config.provider as keyof typeof PROVIDER_ENVIRONMENT];
  return Boolean(variable && env[variable]);
}
