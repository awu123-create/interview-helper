import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { openWorkspace } from "../src/app/workspace.js";
import { AppError } from "../src/errors.js";
import type { ModelEvent, ModelRunner, ModelRunnerDependencies } from "../src/runtime/pi.js";

class ControlledRunner implements ModelRunner {
  calls = 0;
  disposed = false;
  private finish?: () => void;

  activeTools() {
    return ["workspace_status"];
  }

  prompt(_text: string, onEvent: (event: ModelEvent) => void): Promise<void> {
    this.calls += 1;
    onEvent({ type: "text_delta", delta: "回答" });
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  complete() {
    this.finish?.();
  }

  async dispose() {
    this.disposed = true;
    this.complete();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function tempDir() {
  return mkdtempSync(resolve(tmpdir(), "interview-app-workspace-"));
}

test("启动与状态快照不会创建模型适配器", async () => {
  let factories = 0;
  const runner = new ControlledRunner();
  const workspace = openWorkspace(tempDir(), { provider: "openai", modelId: "gpt-5.2" }, {
    env: {},
    runnerFactory: () => {
      factories += 1;
      return runner;
    },
  });
  const snapshot = workspace.getSnapshot();
  assert.equal(snapshot.status.provider, "openai");
  assert.equal(snapshot.status.credentialConfigured, false);
  assert.deepEqual(snapshot.activeTools, ["workspace_status"]);
  assert.equal(factories, 0);
  await workspace.close();
  assert.equal(runner.disposed, false);
});

test("应用层创建活动任务并在成功后收尾", async () => {
  const runner = new ControlledRunner();
  const workspace = openWorkspace(tempDir(), {}, { runnerFactory: () => runner });
  const request = workspace.prompt("问题", () => {});
  assert.equal(workspace.getSnapshot().status.activeTasks, 1);
  runner.complete();
  await request;
  const snapshot = workspace.getSnapshot();
  assert.equal(snapshot.status.activeTasks, 0);
  assert.equal(snapshot.status.totalTasks, 1);
  assert.equal(runner.calls, 1);
  await workspace.close();
});

test("并发提交由应用层拒绝且不重复创建任务", async () => {
  const runner = new ControlledRunner();
  const workspace = openWorkspace(tempDir(), {}, { runnerFactory: () => runner });
  const first = workspace.prompt("第一个请求", () => {});
  await assert.rejects(workspace.prompt("第二个请求", () => {}), (error: unknown) => {
    return error instanceof AppError && error.code === "REQUEST_IN_PROGRESS";
  });
  runner.complete();
  await first;
  assert.equal(workspace.getSnapshot().status.totalTasks, 1);
  assert.equal(runner.calls, 1);
  await workspace.close();
});

test("模型失败由应用层附加 taskId 并写入失败状态", async () => {
  const dir = tempDir();
  const workspace = openWorkspace(dir, { provider: "openai", modelId: "gpt-4o-mini" }, { env: {} });
  await assert.rejects(workspace.prompt("测试", () => {}), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "MISSING_CREDENTIALS");
    assert.ok(error.taskId);
    return true;
  });
  const db = new Database(resolve(dir, "state.sqlite"), { readonly: true });
  const row = db.prepare("SELECT status, error_code FROM tasks").get();
  assert.deepEqual(row, { status: "failed", error_code: "MISSING_CREDENTIALS" });
  db.close();
  await workspace.close();
});

test("关闭时先停止模型，再关闭存储", async () => {
  const runner = new ControlledRunner();
  const workspace = openWorkspace(tempDir(), {}, { runnerFactory: () => runner });
  const request = workspace.prompt("进行中的请求", () => {});
  const closing = workspace.close();
  await closing;
  await request;
  assert.equal(runner.disposed, true);
  assert.throws(() => workspace.getSnapshot(), /database connection is not open/);
});

test("模型适配器通过只读回调获取应用状态", async () => {
  let dependencies: ModelRunnerDependencies | undefined;
  const workspace = openWorkspace(tempDir(), {}, {
    runnerFactory: (value) => {
      dependencies = value;
      return new ControlledRunner();
    },
  });
  const request = workspace.prompt("问题", () => {});
  assert.ok(dependencies);
  assert.equal(dependencies.readStatus().activeTasks, 1);
  await workspace.close();
  await request;
});
