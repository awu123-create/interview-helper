import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { AppError } from "../src/errors.js";
import { WorkspaceStore } from "../src/store/workspace-store.js";

function openWorkspace(
  dataDir: string,
  _overrides = {},
  options: { readOnly?: boolean } = {},
) {
  const store = new WorkspaceStore(dataDir, options.readOnly ?? false);
  return {
    store,
    status: store.getStatus(dataDir),
    close: () => store.close(),
  };
}

function tempDir() {
  return mkdtempSync(resolve(tmpdir(), "interview-store-"));
}

test("工作区打开与状态读取只初始化本地数据", () => {
  const dir = tempDir();
  const workspace = openWorkspace(dir);
  assert.equal(workspace.status.schemaVersion, 1);
  assert.equal(workspace.status.totalTasks, 0);
  assert.equal(workspace.status.writerGeneration, 1);
  workspace.close();
  const status = openWorkspace(dir, {}, { readOnly: true });
  assert.equal(status.status.writerGeneration, 1);
  status.close();
});

test("第二个写入进程被拒绝", () => {
  const dir = tempDir();
  const first = openWorkspace(dir);
  assert.throws(
    () => openWorkspace(dir),
    (error: unknown) =>
      error instanceof AppError && error.code === "WORKSPACE_LOCKED",
  );
  first.close();
});

test("真实第二进程竞争同一工作区时被拒绝", () => {
  const dir = tempDir();
  const first = openWorkspace(dir);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/cli/main.ts", "--status", "--data-dir", dir],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /WORKSPACE_LOCKED/);
  first.close();
});

test("锁接管后旧写入者不能提交", () => {
  const dir = tempDir();
  const oldWriter = openWorkspace(dir);
  const lockPath = resolve(dir, "runtime", "writer.lock");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  writeFileSync(lockPath, JSON.stringify({ ...lock, pid: 999_999_999 }));
  const currentWriter = openWorkspace(dir);
  assert.equal(currentWriter.status.writerGeneration, 2);
  assert.throws(
    () => oldWriter.store.createTask("model_prompt"),
    (error: unknown) =>
      error instanceof AppError && error.code === "STALE_WRITER",
  );
  const taskId = currentWriter.store.createTask("model_prompt");
  currentWriter.store.finishTask(taskId);
  assert.equal(currentWriter.store.getStatus(dir).totalTasks, 1);
  oldWriter.close();
  currentWriter.close();
});

test("主锁创建后进程崩溃仍可重开", () => {
  const dir = tempDir();
  const script = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    const open = fs.openSync; fs.openSync = (path, ...args) => { const fd = open(path, ...args); if (String(path).endsWith('/writer.lock')) process.kill(process.pid, 'SIGKILL'); return fd; };
    const link = fs.linkSync; fs.linkSync = (oldPath, newPath) => { const result = link(oldPath, newPath); if (String(newPath).endsWith('/writer.lock')) process.kill(process.pid, 'SIGKILL'); return result; };
    syncBuiltinESMExports(); const { WorkspaceStore } = await import('./src/store/workspace-store.ts'); new WorkspaceStore(process.argv[1]);`;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script, dir],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.signal, "SIGKILL");
  const workspace = openWorkspace(dir);
  workspace.close();
});

test("双进程同时恢复时只有存活写入者可以创建任务", async () => {
  const dir = tempDir();
  const control = tempDir();
  const initialize = `import { WorkspaceStore } from './src/store/workspace-store.ts'; new WorkspaceStore(process.argv[1]); process.exit(0);`;
  spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", initialize, dir],
    { cwd: process.cwd() },
  );
  writeFileSync(
    resolve(dir, "runtime", "writer.lock.takeover"),
    JSON.stringify({ writerId: "crashed", pid: 999_999_999 }),
  );

  type Event = {
    role: string;
    event: string;
    code?: string;
    generation?: number;
  };
  const events: Event[] = [];
  const launch = (role: string) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "test/fixtures/writer-recovery-child.ts",
        dir,
        role,
        control,
      ],
      { cwd: process.cwd() },
    );
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        events.push(JSON.parse(line));
      }
    });
    return child;
  };
  const waitFor = async (condition: () => boolean) => {
    const started = Date.now();
    while (!condition()) {
      if (Date.now() - started > 8000)
        throw new Error(`等待同步点失败: ${JSON.stringify(events)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const marker = (name: string) => existsSync(resolve(control, name));
  const release = (name: string) => writeFileSync(resolve(control, name), "");
  const b = launch("B");
  let c: ReturnType<typeof launch> | undefined;

  try {
    await waitFor(
      () =>
        marker("B-stale-read") ||
        marker("B-main-read") ||
        events.some((event) => event.role === "B"),
    );
    if (marker("B-main-read") && !marker("B-stale-read"))
      release("B-release-main");
    c = launch("C");
    await waitFor(
      () =>
        (marker("B-stale-read") && marker("C-stale-read")) ||
        events.length === 2,
    );
    if (marker("B-stale-read") && marker("C-stale-read")) {
      release("B-release-stale");
      await waitFor(() => marker("B-main-read"));
      release("C-release-stale");
      await waitFor(() =>
        events.some((event) => event.role === "C" && event.event === "opened"),
      );
      release("B-release-main");
      await waitFor(() =>
        events.some((event) => event.role === "B" && event.event === "opened"),
      );
    }

    const opened = events.filter((event) => event.event === "opened");
    const rejected = events.filter((event) => event.event === "error");
    assert.equal(
      opened.length,
      1,
      `出现了多个存活写入者: ${JSON.stringify(events)}`,
    );
    assert.equal(opened[0]?.generation, 2);
    assert.deepEqual(
      rejected.map((event) => event.code),
      ["WORKSPACE_LOCKED"],
    );
  } finally {
    if (b.exitCode === null) b.kill("SIGTERM");
    if (c && c.exitCode === null) c.kill("SIGTERM");
  }
});

test("结构无效的锁记录按失效锁恢复", () => {
  const dir = tempDir();
  const first = openWorkspace(dir);
  first.close();
  writeFileSync(
    resolve(dir, "runtime", "writer.lock"),
    JSON.stringify({ writerId: 42, generation: "bad", pid: "unknown" }),
  );
  const workspace = openWorkspace(dir);
  assert.equal(workspace.status.writerGeneration, 2);
  workspace.close();
});

test("重启将崩溃遗留的运行中任务标为中断", () => {
  const dir = tempDir();
  const script = `import { WorkspaceStore } from './src/store/workspace-store.ts'; const workspace = new WorkspaceStore(process.argv[1]); console.log(workspace.createTask('model_prompt')); process.kill(process.pid, 'SIGKILL');`;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script, dir],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.signal, "SIGKILL");
  const taskId = result.stdout.trim();
  const workspace = openWorkspace(dir);
  assert.equal(workspace.status.activeTasks, 0);
  assert.deepEqual(
    workspace.store.database.db
      .prepare("SELECT status, error_code FROM tasks WHERE id = ?")
      .get(taskId),
    { status: "failed", error_code: "TASK_INTERRUPTED" },
  );
  workspace.close();
});

test("全新工作区并发首开只产生写入锁结果", async () => {
  const dir = tempDir();
  const barrier = resolve(dir, "migration-barrier");
  const script = `import Database from 'better-sqlite3'; import fs from 'node:fs';
    const pragma = Database.prototype.pragma;
    Database.prototype.pragma = function (source, options) {
      const result = pragma.call(this, source, options);
      if (source === 'user_version' && options?.simple) {
        fs.writeFileSync(process.argv[2] + '-' + process.pid, '');
        const wait = new Int32Array(new SharedArrayBuffer(4));
        while (fs.readdirSync(process.argv[1]).filter((name) => name.startsWith('migration-barrier-')).length < 2) Atomics.wait(wait, 0, 0, 50);
      }
      return result;
    };
    const { WorkspaceStore } = await import('./src/store/workspace-store.ts');
    try { const workspace = new WorkspaceStore(process.argv[1]); console.log(JSON.stringify({ code: 'OK' })); setTimeout(() => workspace.close(), 150); }
    catch (error) { console.log(JSON.stringify({ code: error.code ?? 'INTERNAL_ERROR' })); process.exitCode = 1; }`;
  const launch = () =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script, dir, barrier],
        { cwd: process.cwd() },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", () => {
        const line = stdout.trim().split("\n").at(-1);
        if (!line) reject(new Error(`子进程没有结果: ${stderr}`));
        else resolve(JSON.parse(line).code as string);
      });
    });
  const codes = await Promise.all([launch(), launch()]);
  for (const code of codes)
    assert.ok(
      code === "OK" || code === "WORKSPACE_LOCKED",
      `首轮迁移返回了 ${code}`,
    );
});

test("SQLite 写入代次结构不匹配时明确失败", () => {
  const dir = tempDir();
  const first = openWorkspace(dir);
  first.close();
  const db = new Database(resolve(dir, "state.sqlite"));
  db.prepare("UPDATE writer_state SET generation = 'invalid'").run();
  db.close();
  assert.throws(
    () => openWorkspace(dir, {}, { readOnly: true }),
    (error: unknown) =>
      error instanceof AppError && error.code === "DATA_VERSION_UNSUPPORTED",
  );
});

test("不兼容数据版本拒绝写入", () => {
  const dir = tempDir();
  const db = new Database(resolve(dir, "state.sqlite"));
  db.pragma("user_version = 99");
  db.close();
  assert.throws(
    () => openWorkspace(dir),
    (error: unknown) =>
      error instanceof AppError && error.code === "DATA_VERSION_UNSUPPORTED",
  );
});
