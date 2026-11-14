import {
  getTerminalColorMode,
  parseColor,
  styleText,
} from "@earendil-works/pi-tui";

const accent = parseColor("oklch(72% 0.12 155)");
const muted = parseColor("oklch(62% 0.015 220)");
const error = parseColor("oklch(65% 0.18 25)");

export const colors = {
  accent: (text: string) =>
    styleText(text, { fg: accent, bold: true }, getTerminalColorMode()),
  muted: (text: string) =>
    styleText(text, { fg: muted }, getTerminalColorMode()),
  error: (text: string) =>
    styleText(text, { fg: error }, getTerminalColorMode()),
};

export const editorTheme = {
  borderColor: colors.muted,
  selectList: {
    selectedPrefix: colors.accent,
    selectedText: colors.accent,
    description: colors.muted,
    scrollInfo: colors.muted,
    noMatch: colors.muted,
  },
};
