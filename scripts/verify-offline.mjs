import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const steps = [
  ["layer-boundaries", "node", ["scripts/verify-layers.mjs"]],
  ["typecheck", "npm", ["run", "typecheck"]],
  ["build", "npm", ["run", "build"]],
  ["test", "npm", ["test"]],
  ["diff-check", "git", ["diff", "--check"]],
];
const results = [];
for (const [name, command, args] of steps) {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  results.push({ name, status: result.status ?? 1 });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
mkdirSync(".artifacts", { recursive: true });
writeFileSync(".artifacts/offline-results.json", `${JSON.stringify({ results }, null, 2)}\n`);
process.stdout.write("离线验证通过，结果写入 .artifacts/offline-results.json\n");
