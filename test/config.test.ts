import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { parseCliArguments } from "../src/cli/options.js";
import { loadModelConfig } from "../src/config/load-model-config.js";
import { AppError, asCliError } from "../src/errors.js";
import { PROVIDER_ENVIRONMENT, resolveCredentials } from "../src/runtime/credentials.js";
import { createProductResourceLoader } from "../src/runtime/resources.js";

test("数据目录与启动目录无关", () => {
  const options = parseCliArguments(["--data-dir", ".data"], "/tmp/project-a", "/home/test");
  assert.equal(options.dataDir, "/tmp/project-a/.data");
  assert.equal(parseCliArguments([], "/tmp/project-b", "/home/test").dataDir, "/home/test/.interview-helper");
});

test("Commander 解析现有参数和 --flag=value 形式", () => {
  const options = parseCliArguments(
    ["--data-dir=.data", "--provider=deepseek", "--model=deepseek-flash", "--status"],
    "/tmp/project-a",
    "/home/test",
  );
  assert.deepEqual(options, {
    dataDir: "/tmp/project-a/.data",
    provider: "deepseek",
    modelId: "deepseek-flash",
    status: true,
    help: false,
  });
});

test("Commander 输入错误保持 INVALID_ARGUMENT", () => {
  for (const args of [["--unknown"], ["--model"], ["unexpected"]]) {
    assert.throws(
      () => parseCliArguments(args, "/tmp/project-a", "/home/test"),
      (error: unknown) => error instanceof AppError && error.code === "INVALID_ARGUMENT",
    );
  }
});

test("帮助分支不创建工作区", () => {
  const options = parseCliArguments(["--help"], "/tmp/project-a", "/home/test");
  assert.equal(options.help, true);
  assert.equal(options.status, false);
});

test("入口保留已有错误并只把未知异常归为 INTERNAL_ERROR", () => {
  const configError = new AppError("INVALID_CONFIG", "配置损坏");
  assert.equal(asCliError(configError), configError);
  const internalError = asCliError(new Error("unexpected bug"));
  assert.equal(internalError.code, "INTERNAL_ERROR");
  assert.equal(internalError.message, "unexpected bug");
});

test("通过符号链接执行 CLI 仍进入 main", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "interview-cli-link-"));
  const link = resolve(dir, "interview-helper.ts");
  symlinkSync(resolve("src/cli/main.ts"), link);
  const result = spawnSync(process.execPath, ["--import", "tsx", link, "--help"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Interview Helper/);
});

test("模型配置经过 schema 校验", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "interview-config-"));
  mkdirSync(resolve(dir, "runtime"));
  writeFileSync(resolve(dir, "runtime", "config.json"), JSON.stringify({ provider: "openai", modelId: "gpt-5.2" }));
  assert.deepEqual(loadModelConfig(dir), { provider: "openai", modelId: "gpt-5.2" });
  writeFileSync(resolve(dir, "runtime", "config.json"), JSON.stringify({ provider: "openai", modelId: "gpt-5.2", key: "secret" }));
  assert.throws(() => loadModelConfig(dir), (error: unknown) => error instanceof AppError && error.code === "INVALID_CONFIG");
});

test("只读取所选 provider 的环境变量", () => {
  const credentials = resolveCredentials(
    { provider: "anthropic", modelId: "claude-sonnet-4-5" },
    { ANTHROPIC_API_KEY: "selected", OPENAI_API_KEY: "other" },
  );
  assert.equal(credentials.apiKey, "selected");
  assert.equal(credentials.environmentVariable, "ANTHROPIC_API_KEY");
  assert.throws(
    () => resolveCredentials({ provider: "openai", modelId: "gpt-5.2" }, { ANTHROPIC_API_KEY: "other" }),
    (error: unknown) => error instanceof AppError && error.code === "MISSING_CREDENTIALS",
  );
});

test("每个支持的 provider 都只解析自己的环境变量", () => {
  for (const [provider, variable] of Object.entries(PROVIDER_ENVIRONMENT)) {
    const credentials = resolveCredentials({ provider, modelId: "test-model" }, { [variable]: `${provider}-key` });
    assert.equal(credentials.apiKey, `${provider}-key`);
    assert.equal(credentials.environmentVariable, variable);
  }
});

test("资源加载器不发现全局或项目资源", async () => {
  const loader = createProductResourceLoader();
  assert.deepEqual(loader.getAgentsFiles(), { agentsFiles: [] });
  assert.deepEqual(loader.getSkills(), { skills: [], diagnostics: [] });
  assert.deepEqual(loader.getPrompts(), { prompts: [], diagnostics: [] });
  assert.equal(loader.getExtensions().extensions.length, 0);
  assert.match(loader.getSystemPrompt()!, /Interview Helper/);
});
