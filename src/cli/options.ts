import { homedir } from "node:os";
import { resolve } from "node:path";

import { Command, CommanderError } from "commander";

import { AppError } from "../errors.js";
import { parseCliOptions, type CliOptions } from "../schemas.js";

interface ParsedCliOptions {
  dataDir?: string;
  provider?: string;
  model?: string;
  status?: boolean;
}

export function parseCliArguments(
  args: string[],
  cwd: string,
  home = homedir(),
): CliOptions {
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

  const defaults = (help: boolean): CliOptions =>
    parseCliOptions({
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
    throw new AppError("INVALID_ARGUMENT", error.message, undefined, {
      cause: error,
    });
  }

  return parseCliOptions({
    dataDir: resolve(
      cwd,
      options.dataDir ?? resolve(home, ".interview-helper"),
    ),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { modelId: options.model } : {}),
    status: options.status ?? false,
    help: false,
  });
}

export type { CliOptions } from "../schemas.js";
