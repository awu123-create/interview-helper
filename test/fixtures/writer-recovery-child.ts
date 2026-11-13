import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { openWorkspace } from "../../src/workspace.js";

const [dir, role, control] = process.argv.slice(2) as [string, string, string];
let takeoverRead = false;
let mainRead = false;
const readFileSync: (path: fs.PathOrFileDescriptor, options?: any) => any = fs.readFileSync;
const wait = (name: string) => {
  const started = Date.now();
  while (!fs.existsSync(resolve(control, name))) {
    if (Date.now() - started > 8000) throw new Error(`同步点超时: ${role}/${name}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
};

fs.readFileSync = ((path: fs.PathOrFileDescriptor, options?: any) => {
  const result = readFileSync(path, options);
  if (String(path) === resolve(dir, "runtime", "writer.lock.takeover") && !takeoverRead) {
    takeoverRead = true;
    fs.writeFileSync(resolve(control, `${role}-stale-read`), "");
    wait(`${role}-release-stale`);
  }
  if (role === "B" && String(path) === resolve(dir, "runtime", "writer.lock") && !mainRead) {
    mainRead = true;
    fs.writeFileSync(resolve(control, "B-main-read"), "");
    wait("B-release-main");
  }
  return result;
}) as typeof fs.readFileSync;
syncBuiltinESMExports();

try {
  const workspace = openWorkspace(dir);
  workspace.store.createTask("model_prompt");
  console.log(JSON.stringify({ role, event: "opened", generation: workspace.status.writerGeneration }));
  process.stdin.on("data", () => {
    workspace.close();
    process.exit(0);
  });
} catch (error) {
  const appError = error as { code?: string; message: string };
  console.log(JSON.stringify({ role, event: "error", code: appError.code, message: appError.message }));
  process.exitCode = 1;
}
