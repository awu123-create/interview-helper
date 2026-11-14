import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

import { AppError } from "../src/errors.js";
import {
  createModelSettings,
  PiModelRunner,
  type ModelEvent,
} from "../src/runtime/pi.js";
import { createWorkspaceStatusTool } from "../src/runtime/tools.js";
import type { WorkspaceStatus } from "../src/schemas.js";

const config = { provider: "openai", modelId: "gpt-5.2" };
const status: WorkspaceStatus = {
  dataDir: "/tmp/interview-runtime",
  schemaVersion: 1,
  writerGeneration: 1,
  activeTasks: 0,
  totalTasks: 0,
  provider: "openai",
  modelId: "gpt-5.2",
  credentialConfigured: true,
};

class FakeSession {
  private listeners: Array<(event: AgentSessionEvent) => void> = [];
  calls = 0;
  activeTools = ["workspace_status"];

  getActiveToolNames() {
    return this.activeTools;
  }

  subscribe(listener: (event: AgentSessionEvent) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  async prompt() {
    this.calls += 1;
    this.emit({ type: "auto_retry_start", attempt: 1 } as AgentSessionEvent);
    this.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "流式" },
    } as AgentSessionEvent);
    this.emit({
      type: "tool_execution_start",
      toolName: "workspace_status",
    } as AgentSessionEvent);
    this.emit({
      type: "tool_execution_end",
      toolName: "workspace_status",
    } as AgentSessionEvent);
    this.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "输出" },
    } as AgentSessionEvent);
  }

  dispose() {}

  protected emit(event: AgentSessionEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

class EventSession extends FakeSession {
  constructor(private readonly events: AgentSessionEvent[]) {
    super();
  }

  override async prompt() {
    this.calls += 1;
    for (const event of this.events) this.emit(event);
  }
}

function createRunner(session: FakeSession) {
  return new PiModelRunner({
    dataDir: status.dataDir,
    config,
    env: {},
    readStatus: () => status,
    sessionFactory: async () => session as unknown as AgentSession,
  });
}

test("模拟流式和工具事件复用同一会话", async () => {
  const session = new FakeSession();
  const runner = createRunner(session);
  assert.equal(session.calls, 0);
  assert.deepEqual(runner.activeTools(), ["workspace_status"]);
  const events: ModelEvent[] = [];
  await runner.prompt("你好", (event) => events.push(event));
  await runner.prompt("继续", () => {});
  assert.equal(session.calls, 2);
  assert.deepEqual(
    events
      .filter((event) => event.type === "text_delta")
      .map((event) => event.delta),
    ["流式", "输出"],
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === "tool")
      .map((event) => event.status),
    ["started", "completed"],
  );
  assert.deepEqual(
    events
      .filter((event) => event.type === "retry")
      .map((event) => event.attempt),
    [1],
  );
  await runner.dispose();
});

test("模型异常转换为稳定错误", async () => {
  const session = new FakeSession();
  session.prompt = async () => {
    throw new Error("network unavailable");
  };
  const runner = createRunner(session);
  await assert.rejects(
    runner.prompt("测试", () => {}),
    (error: unknown) => {
      return error instanceof AppError && error.code === "MODEL_REQUEST_FAILED";
    },
  );
});

test("Pi 正常返回但助手失败时仍抛错", async () => {
  for (const event of [
    {
      type: "message_end",
      message: { role: "assistant", stopReason: "error", errorMessage: "401" },
    },
    { type: "agent_settled", aborted: true },
  ] as AgentSessionEvent[]) {
    const runner = createRunner(new EventSession([event]));
    await assert.rejects(
      runner.prompt("测试", () => {}),
      (error: unknown) =>
        error instanceof AppError && error.code === "MODEL_REQUEST_FAILED",
    );
  }
});

test("瞬时失败后重试成功不会保留首次失败", async () => {
  const runner = createRunner(
    new EventSession([
      {
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "503",
        },
      },
      { type: "auto_retry_start", attempt: 1 },
      {
        type: "message_end",
        message: { role: "assistant", stopReason: "stop" },
      },
    ] as AgentSessionEvent[]),
  );
  await runner.prompt("测试", () => {});
});

test("工具失败后模型重试成功仍保持失败", async () => {
  const runner = createRunner(
    new EventSession([
      {
        type: "tool_execution_end",
        toolName: "workspace_status",
        isError: true,
        result: { content: [] },
      },
      {
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "503",
        },
      },
      { type: "auto_retry_start", attempt: 1 },
      {
        type: "message_end",
        message: { role: "assistant", stopReason: "stop" },
      },
    ] as AgentSessionEvent[]),
  );
  await assert.rejects(
    runner.prompt("测试", () => {}),
    /workspace_status/,
  );
});

test("工具执行失败显示失败", async () => {
  const runner = createRunner(
    new EventSession([
      {
        type: "tool_execution_end",
        toolName: "workspace_status",
        isError: true,
        result: { content: [] },
      },
    ] as AgentSessionEvent[]),
  );
  const events: ModelEvent[] = [];
  await assert.rejects(
    runner.prompt("测试", (event) => events.push(event)),
    /workspace_status/,
  );
  assert.deepEqual(events, [
    { type: "tool", name: "workspace_status", status: "failed" },
  ]);
});

test("缺少凭据时不创建 Pi 会话", async () => {
  const runner = new PiModelRunner({
    dataDir: status.dataDir,
    config,
    env: {},
    readStatus: () => status,
  });
  await assert.rejects(
    runner.prompt("测试", () => {}),
    (error: unknown) => {
      return error instanceof AppError && error.code === "MISSING_CREDENTIALS";
    },
  );
});

test("Pi 实际会话只激活产品工具并忽略诱饵资源", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "interview-active-tools-"));
  const runtimeDir = resolve(dir, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(resolve(runtimeDir, "AGENTS.md"), "加载诱饵规则");
  writeFileSync(
    resolve(runtimeDir, "settings.json"),
    JSON.stringify({ defaultTools: ["bash", "read", "write"] }),
  );
  writeFileSync(
    resolve(runtimeDir, "models.json"),
    JSON.stringify({ providers: { other: { models: [] } } }),
  );
  const runner = new PiModelRunner({
    dataDir: dir,
    config: { provider: "openai", modelId: "gpt-4o-mini" },
    env: { OPENAI_API_KEY: "offline-test-key" },
    readStatus: () => ({ ...status, dataDir: dir, modelId: "gpt-4o-mini" }),
  });
  const session = await runner["createSession"]();
  assert.deepEqual(session.getActiveToolNames(), ["workspace_status"]);
  assert.doesNotMatch(session.systemPrompt, /诱饵规则/);
  session.dispose();
});

test("重试配置最多一次，provider 层不重复重试", () => {
  const settings = createModelSettings("openai", "gpt-4o-mini");
  assert.equal(settings.getRetrySettings().maxRetries, 1);
  assert.equal(settings.getProviderRetrySettings().maxRetries, 0);
  assert.deepEqual(settings.getDefaultTools(), ["workspace_status"]);
});

test("空输入返回稳定错误码", async () => {
  const runner = new PiModelRunner({
    dataDir: status.dataDir,
    config: undefined,
    env: {},
    readStatus: () => status,
  });
  await assert.rejects(
    runner.prompt("  ", () => {}),
    (error: unknown) => {
      return error instanceof AppError && error.code === "INVALID_ARGUMENT";
    },
  );
});

test("状态工具返回经过 schema 校验的应用层状态", async () => {
  const tool = createWorkspaceStatusTool(() => status);
  const result = await tool.execute(
    "call-1",
    {},
    undefined,
    undefined,
    {} as never,
  );
  const text = result.content[0];
  assert.ok(text?.type === "text");
  const output = JSON.parse(text.text);
  assert.equal(output.provider, "openai");
  assert.equal(output.schemaVersion, 1);
  assert.equal(output.credentialConfigured, true);
});
