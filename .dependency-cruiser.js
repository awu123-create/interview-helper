/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: "CLI/TUI/runtime 禁止直接依赖 store",
      severity: "error",
      comment: "CLI、TUI 和 runtime 应通过 app 层使用 Store。",
      from: { path: "(^|/)src/(cli|runtime|tui)/" },
      to: { path: "(^|/)src/store/" },
    },
    {
      name: "TUI 禁止直接依赖 runtime",
      severity: "error",
      comment: "TUI 只能依赖 app 暴露的 Workbench 契约。",
      from: { path: "(^|/)src/tui/" },
      to: { path: "(^|/)src/runtime/" },
    },
    {
      name: "src 内部禁止反向引用总入口 index.ts",
      severity: "error",
      comment:
        "src 内部模块不得通过 src/index.ts 绕过分层约束；总入口自身可以对外导出。",
      from: {
        path: "(^|/)src/",
        pathNot: "(^|/)src/index\\.ts$",
      },
      to: { path: "(^|/)src/index\\.ts$" },
    },
    {
      name: "app 禁止依赖 CLI/TUI",
      severity: "error",
      comment: "app 层不得依赖 CLI 或 TUI 适配器。",
      from: { path: "(^|/)src/app/" },
      to: { path: "(^|/)src/(cli|tui)/" },
    },
    {
      name: "runtime/store 禁止依赖 app/CLI/TUI",
      severity: "error",
      comment: "runtime 和 Store 不得依赖 app 或接口层。",
      from: { path: "(^|/)src/(runtime|store)/" },
      to: { path: "(^|/)src/(app|cli|tui)/" },
    },
    {
      name: "schemas/errors 禁止依赖业务模块",
      severity: "error",
      comment:
        "schemas 和 errors 不得依赖 app、CLI、config、runtime、Store 或 TUI。",
      from: { path: "(^|/)src/(schemas|errors)\\.ts$" },
      to: { path: "(^|/)src/(app|cli|config|runtime|store|tui)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
      extensions: [".js", ".ts"],
    },
  },
};
