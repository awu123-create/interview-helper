#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { openWorkspace } from "../app/workspace.js";
import { asCliError } from "../errors.js";
import { createTerminalTui } from "../tui/app.js";
import { parseCliArguments } from "./options.js";

const help = `Interview Helper

用法:
  interview-helper [--data-dir PATH] [--provider ID] [--model ID]
  interview-helper --status [--data-dir PATH]

模型配置保存在 DATA_DIR/runtime/config.json，也可用参数覆盖。
API key 只从所选 provider 对应的环境变量读取。

按键:
  Tab / Shift+Tab  切换区域
  Enter            提交
  Shift+Enter      换行
  Ctrl+C           退出
`;

export async function main(args = process.argv.slice(2)) {
  const options = parseCliArguments(args, process.cwd());
  if (options.help) {
    process.stdout.write(help);
    return;
  }
  const workspace = openWorkspace(options.dataDir, options);
  if (options.status) {
    process.stdout.write(
      `${JSON.stringify(workspace.getSnapshot().status, null, 2)}\n`,
    );
    await workspace.close();
    return;
  }
  const app = createTerminalTui(workspace);
  const stop = () => app.stop();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise<void>((resolve) => {
    app.onExit = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve();
    };
    app.start();
  });
}

function isDirectExecution(moduleUrl: string): boolean {
  return (
    process.argv[1] !== undefined &&
    realpathSync(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {
    const appError = asCliError(error);
    process.stderr.write(`${JSON.stringify(appError.toJSON())}\n`);
    process.exitCode = 1;
  });
}
