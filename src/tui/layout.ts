import { HStack, ScrollView, Text, VStack, type Component, type ScrollViewOptions, type StackEntry } from "@earendil-works/pi-tui";
import { colors } from "./theme.js";

export interface Panel {
  root: VStack;
  header: Text;
  scroll: ScrollView;
  title: string;
}

export function createPanel(title: string, content: Component, options: ScrollViewOptions = {}): Panel {
  const header = new Text(colors.accent(`● ${title}`), 0, 0);
  const scroll = new ScrollView(content, { scrollbar: "auto", overscroll: "contain", ...options });
  const root = new VStack([
    { component: header, basis: 1, minSize: 1 },
    { component: new Text(colors.muted("─".repeat(120)), 0, 0), basis: 1, minSize: 1 },
    { component: scroll, basis: 0, grow: 1, minSize: 1 },
  ]);
  return { root, header, scroll, title };
}

export function setPanelFocus(panel: Panel, focused: boolean) {
  panel.header.setText(focused ? colors.accent(`● ${panel.title}`) : colors.muted(`○ ${panel.title}`));
}

export function createColumns(navigation: Panel, conversation: Panel, status: Panel): HStack {
  const children: StackEntry[] = [
    { component: navigation.root, basis: 24, shrink: 1, minSize: 12 },
    { component: conversation.root, basis: 0, grow: 1, minSize: 20 },
    { component: status.root, basis: 28, shrink: 1, minSize: 16 },
  ];
  return new HStack(children);
}
