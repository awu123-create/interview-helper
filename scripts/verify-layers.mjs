import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const roots = ["src/tui", "src/runtime", "src/cli"];
const violations = [];
for (const root of roots) {
  for (const name of readdirSync(root, { recursive: true })) {
    const path = resolve(root, String(name));
    if (!path.endsWith(".ts")) continue;
    const source = readFileSync(path, "utf8");
    if (source.includes("WorkspaceStore") || source.includes("workspace.store")) {
      violations.push(`${path}: 禁止直接依赖 Store`);
    }
  }
}
if (violations.length) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("分层依赖检查通过：CLI、runtime、TUI 不直接访问 Store\n");
