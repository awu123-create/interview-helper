import { wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";

import { sanitizeTerminalText } from "../terminal-output.js";
import { colors } from "./theme.js";

export interface ConversationEntry {
  role: "user" | "assistant" | "system";
  text: string;
}

export class ConversationLog implements Component {
  private entries: ConversationEntry[] = [];
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  add(role: ConversationEntry["role"], text = "") {
    this.entries.push({ role, text });
    this.invalidate();
  }

  append(delta: string) {
    const current = this.entries.at(-1);
    if (!current || current.role !== "assistant") {
      this.add("assistant", delta);
      return;
    }
    current.text += delta;
    this.invalidate();
  }

  replaceLast(text: string) {
    const current = this.entries.at(-1);
    if (!current) throw new Error("当前没有可替换的消息");
    current.text = text;
    this.invalidate();
  }

  getEntries(): readonly ConversationEntry[] {
    return this.entries;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const contentWidth = Math.max(1, width - 2);
    const lines: string[] = [];
    for (const entry of this.entries) {
      const label =
        entry.role === "user"
          ? "你"
          : entry.role === "assistant"
            ? "助手"
            : "系统";
      lines.push(colors.accent(label));
      for (const sourceLine of sanitizeTerminalText(entry.text).split("\n")) {
        lines.push(...wrapTextWithAnsi(`  ${sourceLine}`, contentWidth));
      }
      lines.push("");
    }
    if (lines.at(-1) === "") lines.pop();
    this.cachedWidth = width;
    this.cachedLines = lines.length
      ? lines
      : [colors.muted("开始一段对话，或输入 /status 查看工作区。")];
    return this.cachedLines;
  }

  invalidate() {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
