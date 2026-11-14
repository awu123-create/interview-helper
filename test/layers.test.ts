import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runLayerCheck(
  t: TestContext,
  files: Record<string, string>,
  options: { copySource?: boolean } = {},
): { status: number | null; output: string } {
  const parent = options.copySource ? join(root, ".artifacts") : tmpdir();
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "interview-helper-layers-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  if (options.copySource) {
    cpSync(join(root, "src"), join(directory, "src"), { recursive: true });
  }
  for (const [name, source] of Object.entries(files)) {
    const path = join(directory, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }

  const result = spawnSync(
    "npm",
    ["run", "layers", "--", join(directory, "src")],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.equal(result.error, undefined);
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
  };
}

test("layer rules allow the current dependency direction and ignore comments", (t) => {
  const result = runLayerCheck(t, {
    "src/cli/main.ts": `
      import { openWorkspace } from "../app/workspace.js";
      import { createTui } from "../tui/app.js";
      export { openWorkspace, createTui };
    `,
    "src/app/workspace.ts": `
      import { WorkspaceStore } from "../store/workspace-store.js";
      export { loadModelConfig } from "../config/load-model-config.js";
      export { PiModelRunner } from "../runtime/pi.js";
      export interface Workbench { store: WorkspaceStore }
      export function openWorkspace(): void {}
    `,
    "src/tui/app.ts": `
      import type { Workbench } from "../app/workspace.js";
      // import { WorkspaceStore } from "../store/workspace-store.js";
      /* export { WriterLease } from "../store/writer.js"; */
      export type { Workbench };
      export function createTui(): void {}
    `,
    "src/runtime/pi.ts": `
      export { AppError } from "../errors.js";
      export type { WorkspaceStatus } from "../schemas.js";
      export class PiModelRunner {}
    `,
    "src/store/workspace-store.ts": `
      export { AppError } from "../errors.js";
      export type { WorkspaceStatus } from "../schemas.js";
      export class WorkspaceStore {}
    `,
    "src/config/load-model-config.ts": `
      export type { ModelConfig } from "../schemas.js";
      export function loadModelConfig(): void {}
    `,
    "src/schemas.ts": `
      export { AppError } from "./errors.js";
      export interface ModelConfig {}
      export interface WorkspaceStatus {}
    `,
    "src/errors.ts": "export class AppError extends Error {}\n",
    "src/index.ts": `
      export * from "./app/workspace.js";
      export * from "./store/workspace-store.js";
    `,
  });

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /no dependency violations found/);
});

test("source modules cannot bypass layers through the public entrypoint", (t) => {
  const result = runLayerCheck(
    t,
    {
      "src/tui/barrel-probe.ts": `
        import { PiModelRunner } from "../index.js";
        export function bypass(deps: ConstructorParameters<typeof PiModelRunner>[0]) {
          return new PiModelRunner(deps);
        }
      `,
    },
    { copySource: true },
  );

  assert.notEqual(result.status, 0, result.output);
  assert.ok(
    result.output.includes("src 内部禁止反向引用总入口 index.ts"),
    result.output,
  );
  assert.ok(result.output.includes("src/tui/barrel-probe.ts"), result.output);
  assert.ok(result.output.includes("src/index.ts"), result.output);
});

const forbiddenCases = [
  {
    name: "named Store import",
    rule: "CLI/TUI/runtime 禁止直接依赖 store",
    source: "src/cli/named.ts",
    target: "src/store/workspace-store.ts",
    files: {
      "src/cli/named.ts": `
        import { WorkspaceStore } from "../store/workspace-store.js";
        export { WorkspaceStore };
      `,
      "src/store/workspace-store.ts": "export class WorkspaceStore {}\n",
    },
  },
  {
    name: "namespace Store import",
    rule: "CLI/TUI/runtime 禁止直接依赖 store",
    source: "src/runtime/namespace.ts",
    target: "src/store/database.ts",
    files: {
      "src/runtime/namespace.ts": `
        import * as database from "../store/database.js";
        export { database };
      `,
      "src/store/database.ts": "export class WorkspaceDatabase {}\n",
    },
  },
  {
    name: "Store re-export",
    rule: "CLI/TUI/runtime 禁止直接依赖 store",
    source: "src/tui/re-export.ts",
    target: "src/store/writer.ts",
    files: {
      "src/tui/re-export.ts":
        'export { WriterLease } from "../store/writer.js";\n',
      "src/store/writer.ts": "export class WriterLease {}\n",
    },
  },
  {
    name: "equivalent relative Store path",
    rule: "CLI/TUI/runtime 禁止直接依赖 store",
    source: "src/cli/equivalent.ts",
    target: "src/store/writer.ts",
    files: {
      "src/cli/equivalent.ts": 'import "../store/../store/writer.js";\n',
      "src/store/writer.ts": "export class WriterLease {}\n",
    },
  },
  {
    name: "direct runtime type import from TUI",
    rule: "TUI 禁止直接依赖 runtime",
    source: "src/tui/runtime-type.ts",
    target: "src/runtime/pi.ts",
    files: {
      "src/tui/runtime-type.ts": `
        import type { ModelRunner } from "../runtime/pi.js";
        export type { ModelRunner };
      `,
      "src/runtime/pi.ts": "export interface ModelRunner {}\n",
    },
  },
  {
    name: "app import from CLI",
    rule: "app 禁止依赖 CLI/TUI",
    source: "src/app/cli.ts",
    target: "src/cli/options.ts",
    files: {
      "src/app/cli.ts":
        'export { parseCliArguments } from "../cli/options.js";\n',
      "src/cli/options.ts": "export function parseCliArguments(): void {}\n",
    },
  },
  {
    name: "runtime import from app",
    rule: "runtime/store 禁止依赖 app/CLI/TUI",
    source: "src/runtime/app.ts",
    target: "src/app/workspace.ts",
    files: {
      "src/runtime/app.ts":
        'export { openWorkspace } from "../app/workspace.js";\n',
      "src/app/workspace.ts": "export function openWorkspace(): void {}\n",
    },
  },
  {
    name: "business import from schemas",
    rule: "schemas/errors 禁止依赖业务模块",
    source: "src/schemas.ts",
    target: "src/store/workspace-store.ts",
    files: {
      "src/schemas.ts":
        'export type { WorkspaceStore } from "./store/workspace-store.js";\n',
      "src/store/workspace-store.ts": "export class WorkspaceStore {}\n",
    },
  },
];

for (const fixture of forbiddenCases) {
  test(`layer rules reject ${fixture.name} with actionable output`, (t) => {
    const result = runLayerCheck(t, fixture.files);

    assert.notEqual(result.status, 0, result.output);
    assert.ok(result.output.includes(fixture.rule), result.output);
    assert.ok(result.output.includes(fixture.source), result.output);
    assert.ok(result.output.includes(fixture.target), result.output);
  });
}

test("layer parser failures do not pass", (t) => {
  const result = runLayerCheck(t, {
    "src/cli/broken.ts": 'import { from "../store/workspace-store.js";\n',
    "src/store/workspace-store.ts": "export class WorkspaceStore {}\n",
  });

  assert.notEqual(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /no dependency violations found/);
});
