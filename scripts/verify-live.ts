import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCliArguments } from "../src/config.js";
import { sanitizeTerminalText } from "../src/terminal-output.js";
import { PiModelRunner, type ModelEvent } from "../src/runtime/pi.js";
import { openWorkspace } from "../src/workspace.js";

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const options = parseCliArguments(args.filter((arg) => arg !== "--yes"), process.cwd());
if (!confirmed) {
  throw new Error("真实模型会产生 API 调用。确认提供方、模型与费用授权后追加 --yes");
}
const workspace = openWorkspace(options.dataDir, options);
const runner = new PiModelRunner(workspace.store, workspace.config, process.env);
const events: ModelEvent[] = [];
let output = "";
try {
  await runner.prompt("请先调用 workspace_status 查询当前工作区，然后用一句中文说明查询结果。", (event) => {
    events.push(event);
    if (event.type === "text_delta") {
      output += event.delta;
    }
  });
  const toolCalled = events.some((event) => event.type === "tool" && event.name === "workspace_status" && event.status === "completed");
  const streamed = events.some((event) => event.type === "text_delta");
  const result = {
    provider: workspace.config?.provider,
    modelId: workspace.config?.modelId,
    streamed,
    toolCalled,
    activeTools: runner.activeTools(),
    output,
  };
  mkdirSync(".artifacts", { recursive: true });
  writeFileSync(resolve(".artifacts", "live-results.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(sanitizeTerminalText(output));
  process.stdout.write(`\n${JSON.stringify({ streamed, toolCalled, activeTools: result.activeTools })}\n`);
  if (!streamed || !toolCalled) process.exitCode = 1;
} finally {
  await runner.dispose();
  workspace.close();
}
