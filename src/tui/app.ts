import {
  Editor,
  Key,
  ProcessTerminal,
  ScrollView,
  Text,
  TuiAltScreen,
  TruncatedText,
  VStack,
  isKeyRelease,
  matchesKey,
  type ViewportTUI,
} from "@earendil-works/pi-tui";
import type { AppError } from "../errors.js";
import type { Workbench } from "../app/workspace.js";
import { ConversationLog } from "./conversation.js";
import { createColumns, createPanel, setPanelFocus, type Panel } from "./layout.js";
import { colors, editorTheme } from "./theme.js";

export type FocusArea = "navigation" | "conversation" | "status" | "editor";

export class InterviewTui {
  readonly editor: Editor;
  readonly conversation: ConversationLog;
  readonly conversationScroll: ScrollView;
  readonly navigationPanel: Panel;
  readonly conversationPanel: Panel;
  readonly statusPanel: Panel;
  focusArea: FocusArea = "editor";
  streaming = false;
  onExit?: () => void;
  private stopPromise: Promise<void> | undefined;
  private readonly statusText: Text;
  private readonly footer: Text;

  constructor(
    readonly tui: ViewportTUI,
    private readonly workspace: Workbench,
  ) {
    this.conversation = new ConversationLog();
    this.navigationPanel = createPanel("资料 / 知识", new Text("尚未导入资料\n知识导航将在后续版本接入", 1, 1, colors.muted));
    this.conversationPanel = createPanel("对话", this.conversation, { follow: "end", primary: true });
    this.conversationScroll = this.conversationPanel.scroll;
    this.statusText = new Text("", 1, 1);
    this.statusPanel = createPanel("训练状态", this.statusText);
    this.editor = new Editor(tui, editorTheme, { paddingX: 1 });
    this.footer = new Text("", 0, 0);
    this.conversation.add("system", "工作台已就绪。资料导入与三题训练尚未实现；当前可进行模型对话和状态查询。输入 /status 可直接查看状态。");
    this.editor.onSubmit = (text) => void this.submit(text);
    tui.addInputListener((data) => this.routeInput(data));
    tui.setLayoutRoot(new VStack([
      { component: new TruncatedText(colors.accent(" INTERVIEW HELPER "), 0, 0), basis: 1, minSize: 1 },
      { component: createColumns(this.navigationPanel, this.conversationPanel, this.statusPanel), basis: 0, grow: 1, minSize: 3 },
      { component: this.editor, basis: "auto", shrink: 1, minSize: 3 },
      { component: this.footer, basis: 1, minSize: 1 },
    ]));
    this.setFocus("editor");
    this.refreshStatus();
  }

  private routeInput(data: string) {
    if (isKeyRelease(data)) return { consume: true };
    if (matchesKey(data, Key.ctrl("c"))) {
      void this.stop();
      return { consume: true };
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
      const areas: FocusArea[] = ["navigation", "conversation", "status", "editor"];
      const current = areas.indexOf(this.focusArea);
      const offset = matchesKey(data, Key.tab) ? 1 : -1;
      this.setFocus(areas[(current + offset + areas.length) % areas.length]!);
      return { consume: true };
    }
    if (this.focusArea === "conversation") {
      if (matchesKey(data, Key.up)) this.conversationScroll.scrollBy(-1);
      else if (matchesKey(data, Key.down)) this.conversationScroll.scrollBy(1);
      else if (matchesKey(data, Key.pageUp)) this.conversationScroll.scrollBy(-this.conversationScroll.viewportHeight);
      else if (matchesKey(data, Key.pageDown)) this.conversationScroll.scrollBy(this.conversationScroll.viewportHeight);
      else if (matchesKey(data, Key.home)) this.conversationScroll.scrollToStart();
      else if (matchesKey(data, Key.end)) this.conversationScroll.scrollToEnd();
      else return undefined;
      this.tui.requestRender();
      return { consume: true };
    }
    return undefined;
  }

  setFocus(area: FocusArea) {
    this.focusArea = area;
    setPanelFocus(this.navigationPanel, area === "navigation");
    setPanelFocus(this.conversationPanel, area === "conversation");
    setPanelFocus(this.statusPanel, area === "status");
    const target = area === "editor" ? this.editor
      : area === "navigation" ? this.navigationPanel.root
        : area === "status" ? this.statusPanel.root : this.conversationPanel.root;
    this.tui.setFocus(target);
    this.updateFooter();
    this.tui.requestRender();
  }

  private async submit(text: string) {
    if (text.trim() === "/status") {
      this.refreshStatus();
      this.conversation.add("system", JSON.stringify(this.workspace.getSnapshot().status));
      this.tui.requestRender();
      return;
    }
    if (this.streaming) return;
    this.conversation.add("user", text);
    this.conversation.add("assistant");
    this.streaming = true;
    this.editor.disableSubmit = true;
    this.updateFooter();
    this.tui.requestRender();
    try {
      const request = this.workspace.prompt(text, (event) => {
        if (event.type === "text_delta") this.conversation.append(event.delta);
        if (event.type === "retry") this.conversation.replaceLast("");
        if (event.type === "tool") {
          const action = event.status === "started" ? "调用" : event.status === "completed" ? "完成" : "失败";
          this.conversation.add("system", `[${action}工具: ${event.name}]`);
        }
        this.tui.requestRender();
      });
      this.refreshStatus();
      await request;
    } catch (error) {
      const appError = error as AppError;
      const task = appError.taskId ? `\n任务 ID: ${appError.taskId}` : "";
      this.conversation.replaceLast(`[${appError.code}] ${appError.message}${task}`);
    } finally {
      this.streaming = false;
      this.editor.disableSubmit = false;
      this.refreshStatus();
      this.updateFooter();
      this.tui.requestRender();
    }
  }

  private refreshStatus() {
    const snapshot = this.workspace.getSnapshot();
    const status = snapshot.status;
    this.statusText.setText([
      "训练尚未开始",
      "",
      `模型: ${status.provider && status.modelId ? `${status.provider}/${status.modelId}` : "未配置"}`,
      `凭据: ${status.credentialConfigured ? "已配置" : "未配置"}`,
      `活动任务: ${status.activeTasks}`,
      `写入代次: ${status.writerGeneration}`,
      `工具: ${snapshot.activeTools.join(", ")}`,
    ].join("\n"));
  }

  private updateFooter() {
    this.footer.setText(colors.muted(` Tab 焦点 · Enter 提交 · Shift+Enter 换行 · Ctrl+C 退出${this.streaming ? " · 输出中" : ""}`));
  }

  start() {
    this.tui.start();
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.shutdown();
    return this.stopPromise;
  }

  private async shutdown() {
    await this.workspace.close();
    this.tui.stop();
    this.onExit?.();
  }
}

export function createTerminalTui(workspace: Workbench): InterviewTui {
  const terminal = new ProcessTerminal();
  return new InterviewTui(new TuiAltScreen(terminal), workspace);
}
