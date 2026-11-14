import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

type Step = {
  name: string;
  command: string;
  args: string[];
};

const steps: Step[] = [
  { name: "format", command: "npm", args: ["run", "format:check"] },
  { name: "typecheck", command: "npm", args: ["run", "typecheck"] },
  { name: "lint", command: "npm", args: ["run", "lint"] },
  { name: "test", command: "npm", args: ["test"] },
  { name: "secrets", command: "npm", args: ["run", "secrets"] },
  { name: "layers", command: "npm", args: ["run", "layers"] },
  { name: "diff-check", command: "git", args: ["diff", "--check"] },
];
const results: { name: string; status: number }[] = [];

for (const step of steps) {
  const result = spawnSync(step.command, step.args, {
    stdio: "inherit",
    env: process.env,
  });
  results.push({ name: step.name, status: result.status ?? 1 });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync(".artifacts", { recursive: true });
writeFileSync(
  ".artifacts/offline-results.json",
  `${JSON.stringify({ results }, null, 2)}\n`,
);
process.stdout.write(
  "离线验证通过，结果写入 .artifacts/offline-results.json\n",
);
