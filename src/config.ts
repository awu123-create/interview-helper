import { Command, CommanderError } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { AppError } from "./errors.js";
import { parseProductConfig, type ProductConfig } from "./schemas.js";

export interface CliOptions {
  dataDir: string;
  provider?: string;
  modelId?: string;
  status: boolean;
  help: boolean;
}

interface ParsedCliOptions {
  dataDir?: string;
  provider?: string;
  model?: string;
  status?: boolean;
}

export function parseCliArguments(args: string[], cwd: string, home = homedir()): CliOptions {
  const command = new Command()
    .name("interview-helper")
    .option("--data-dir <path>")
    .option("--provider <id>")
    .option("--model <id>")
    .option("--status")
    .helpOption("-h, --help")
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} });

  const defaults = (help: boolean): CliOptions => ({
    dataDir: resolve(home, ".interview-helper"),
    status: false,
    help,
  });

  let options: ParsedCliOptions;
  try {
    command.parse(args, { from: "user" });
    options = command.opts<ParsedCliOptions>();
  } catch (error) {
    if (!(error instanceof CommanderError)) throw error;
    if (error.code === "commander.helpDisplayed") return defaults(true);
    throw new AppError("INVALID_ARGUMENT", error.message, undefined, { cause: error });
  }

  return {
    dataDir: resolve(cwd, options.dataDir ?? resolve(home, ".interview-helper")),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { modelId: options.model } : {}),
    status: options.status ?? false,
    help: false,
  };
}

export function loadProductConfig(dataDir: string, overrides: Pick<CliOptions, "provider" | "modelId"> = {}): ProductConfig | undefined {
  const path = resolve(dataDir, "runtime", "config.json");
  let stored: ProductConfig | undefined;
  if (existsSync(path)) {
    try {
      stored = parseProductConfig(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("INVALID_CONFIG", "runtime/config.json 不是有效 JSON", undefined, { cause: error });
    }
  }
  const provider = overrides.provider ?? stored?.provider;
  const modelId = overrides.modelId ?? stored?.modelId;
  if (!provider && !modelId) return undefined;
  return parseProductConfig({ provider, modelId });
}
