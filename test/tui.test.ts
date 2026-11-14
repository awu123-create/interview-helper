import assert from "node:assert/strict";
import test from "node:test";

import {
  TuiAltScreen,
  type ProgramStatus,
  type Terminal,
} from "@earendil-works/pi-tui";

import type { Workbench, WorkspaceSnapshot } from "../src/app/workspace.js";
import type { ModelEvent } from "../src/runtime/pi.js";
import { InterviewTui } from "../src/tui/app.js";

class TestTerminal implements Terminal {
  columns = 100;
  rows = 30;
  output = "";
  stopped = false;
  input?: (data: string) => void;
  resize?: () => void;
  kittyProtocolActive = true;

  start(onInput: (data: string) => void, onResize: () => void) {
    this.input = onInput;
    this.resize = onResize;
  }
  stop() {
    this.stopped = true;
  }
  async drainInput() {}
  write(data: string) {
    this.output += data;
  }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
  setProgramStatus(_status: ProgramStatus) {}
}

class ControlledWorkbench implements Workbench {
  readonly config = undefined;
  calls = 0;
  activeTasks = 0;
  totalTasks = 0;
  eventHandler?: (event: ModelEvent) => void;
  private complete?: () => void;

  getSnapshot(): WorkspaceSnapshot {
    return {
      status: {
        dataDir: "/virtual",
        schemaVersion: 1,
        writerGeneration: 1,
        activeTasks: this.activeTasks,
        totalTasks: this.totalTasks,
        provider: "",
        modelId: "",
        credentialConfigured: false,
      },
      activeTools: ["workspace_status"],
    };
  }

  prompt(_text: string, onEvent: (event: ModelEvent) => void) {
    this.calls += 1;
    this.activeTasks += 1;
    this.totalTasks += 1;
    this.eventHandler = onEvent;
    return new Promise<void>((resolve) => {
      this.complete = () => {
        this.activeTasks -= 1;
        resolve();
      };
    });
  }

  emit(event: ModelEvent) {
    this.eventHandler?.(event);
  }
  finish() {
    this.complete?.();
  }
  async close() {
    this.finish();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function setup() {
  const terminal = new TestTerminal();
  const runner = new ControlledWorkbench();
  const app = new InterviewTui(new TuiAltScreen(terminal), runner);
  return { terminal, runner, app };
}

test("真实多区域组件支持焦点、中文多行粘贴和 resize", async () => {
  const { terminal, runner, app } = setup();
  app.start();
  app.tui.renderNow();
  assert.match(terminal.output, /资料 \/ 知识/);
  assert.match(terminal.output, /训练状态/);
  app.editor.handleInput("\x1b[200~第一行\nconst 答案 = 1;\x1b[201~");
  assert.equal(runner.calls, 0);
  assert.match(app.editor.getExpandedText(), /第一行\nconst 答案 = 1;/);
  terminal.input?.("\t");
  assert.equal(app.focusArea, "navigation");
  terminal.input?.("\x1b[Z");
  assert.equal(app.focusArea, "editor");
  const before = app.editor.getExpandedText();
  terminal.columns = 64;
  terminal.rows = 24;
  terminal.resize?.();
  app.setFocus("status");
  app.tui.renderNow();
  assert.equal(app.editor.getExpandedText(), before);
  assert.equal(app.focusArea, "status");
  assert.match(terminal.output, /Ctrl\+C 退出/);
  await app.stop();
  assert.equal(terminal.stopped, true);
});

test("Kitty 松开事件不会重复切焦点或滚动", async () => {
  const { terminal, app } = setup();
  app.start();
  terminal.input?.("\x1b[9;1u");
  assert.equal(app.focusArea, "navigation");
  terminal.input?.("\x1b[9;1:3u");
  assert.equal(app.focusArea, "navigation");
  app.setFocus("conversation");
  for (let index = 0; index < 80; index += 1)
    app.conversation.add("system", `历史 ${index}`);
  app.tui.renderNow();
  app.conversationScroll.scrollTo(20);
  terminal.input?.("\x1b[1;1A");
  assert.equal(app.conversationScroll.scrollTop, 19);
  terminal.input?.("\x1b[1;1:3A");
  assert.equal(app.conversationScroll.scrollTop, 19);
  await app.stop();
});

test("自动重试会清除失败尝试的文本残片", async () => {
  const { runner, app } = setup();
  app.start();
  app.editor.setText("测试重试");
  app.editor.handleInput("\r");
  runner.emit({ type: "text_delta", delta: "Hel" });
  runner.emit({ type: "retry", attempt: 1 });
  runner.emit({ type: "text_delta", delta: "Hello" });
  const assistants = app.conversation
    .getEntries()
    .filter((entry) => entry.role === "assistant");
  assert.equal(assistants.at(-1)?.text, "Hello");
  runner.finish();
  await new Promise((resolve) => setImmediate(resolve));
  await app.stop();
});

test("模型控制序列不会进入终端输出", async () => {
  const { terminal, runner, app } = setup();
  app.start();
  app.editor.setText("测试输出");
  app.editor.handleInput("\r");
  runner.emit({
    type: "text_delta",
    delta: "safe \x1b]52;c;cG93bmVk\x07 text",
  });
  app.tui.renderNow();
  assert.equal(terminal.output.includes("\x1b]52;c"), false);
  assert.match(terminal.output, /safe/);
  assert.match(terminal.output, /text/);
  runner.emit({ type: "text_delta", delta: "\nA\x1b[31AB\x1bPprivate\x1b\\C" });
  app.tui.renderNow();
  assert.match(terminal.output, /ABC/);
  assert.equal(terminal.output.includes("[31A"), false);
  assert.equal(terminal.output.includes("private"), false);
  runner.finish();
  await new Promise((resolve) => setImmediate(resolve));
  await app.stop();
});

test("一次多行粘贴只产生一次提交", async () => {
  const { runner, app } = setup();
  app.start();
  app.editor.handleInput("\x1b[200~中文\n第一行\n第二行\x1b[201~");
  assert.equal(runner.calls, 0);
  app.editor.handleInput("\r");
  assert.equal(runner.calls, 1);
  runner.finish();
  await new Promise((resolve) => setImmediate(resolve));
  await app.stop();
});

test("流式期间可继续编辑，活动状态刷新且历史位置不变", async () => {
  const { terminal, runner, app } = setup();
  app.start();
  app.editor.setText("请解释事务");
  app.editor.handleInput("\r");
  assert.equal(runner.calls, 1);
  assert.equal(app.streaming, true);
  assert.equal(app.editor.disableSubmit, true);
  app.tui.renderNow();
  assert.match(terminal.output, /活动任务: 1/);
  app.editor.insertTextAtCursor("继续编辑");
  assert.equal(app.editor.getExpandedText(), "继续编辑");
  for (let index = 0; index < 80; index += 1)
    app.conversation.add("system", `历史 ${index}`);
  app.tui.renderNow();
  app.conversationScroll.scrollToStart();
  const top = app.conversationScroll.scrollTop;
  runner.emit({ type: "text_delta", delta: "第一部分" });
  runner.emit({ type: "tool", name: "workspace_status", status: "started" });
  runner.emit({ type: "text_delta", delta: "，第二部分" });
  app.tui.renderNow();
  assert.equal(app.conversationScroll.scrollTop, top);
  assert.equal(app.conversationScroll.isFollowingEnd, false);
  assert.match(
    app.conversation
      .getEntries()
      .map((entry) => entry.text)
      .join("\n"),
    /第一部分/,
  );
  runner.finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.streaming, false);
  await app.stop();
});

test("退出等待在途模型任务收尾后再恢复终端", async () => {
  const { terminal, runner, app } = setup();
  app.start();
  app.editor.setText("进行中的请求");
  app.editor.handleInput("\r");
  assert.equal(runner.calls, 1);
  await app.stop();
  assert.equal(terminal.stopped, true);
  assert.equal(runner.getSnapshot().status.activeTasks, 0);
});

test("非输入焦点不会把文字当成提交", async () => {
  const { terminal, runner, app } = setup();
  app.start();
  app.setFocus("navigation");
  terminal.input?.("不是答案");
  assert.equal(runner.calls, 0);
  assert.equal(
    app.conversation.getEntries().filter((entry) => entry.role === "user")
      .length,
    0,
  );
  await app.stop();
});
