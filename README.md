# Interview Helper

基于 Pi SDK 的本地面试学习 Agent。本分支交付 Issue #2：独立终端工作台、固定官方模型接入、资源隔离和 SQLite 写入保护。

资料导入、知识整理和三题训练由后续 Issue 接入，当前界面会明确显示这些能力尚未实现。

## 环境与安装

需要 Node.js 22.23.4 和 npm。

```sh
npm ci
npm run build
npm link
```

之后可以从任意工作目录启动：

```sh
interview-helper
interview-helper --data-dir .artifacts/my-workspace
```

默认数据目录是 `~/.interview-helper`。启动目录不会改变数据归属，也不会向 Pi 加载该目录的规则、技能、设置或工具。

## 配置官方模型

在数据目录写入 `runtime/config.json`：

```json
{
  "provider": "openai",
  "modelId": "gpt-4o-mini"
}
```

也可以在启动时覆盖：

```sh
interview-helper --provider openai --model gpt-4o-mini
```

API key 只读取所选提供方对应的环境变量，例如：

```sh
export OPENAI_API_KEY=...
```

应用不读取其他工具的凭据，不保存 API key，也不会在失败时自动切换提供方或模型。未配置模型或凭据时仍可打开工作区，提交模型请求时会显示稳定错误码和任务 ID。

## 查看状态

```sh
interview-helper --status
interview-helper --status --data-dir .artifacts/my-workspace
```

打开工作区和查看状态不会发起模型生成请求。TUI 中输入 `/status` 也只读取本地状态。

## 终端操作

| 按键 | 行为 |
| --- | --- |
| `Tab` / `Shift+Tab` | 在资料、对话、状态和输入区间切换焦点 |
| `Enter` | 提交输入区的完整内容 |
| `Shift+Enter` | 换行，终端不支持时可用 `Alt+Enter` |
| 方向键 / `PageUp` / `PageDown` | 对话区域聚焦时滚动历史 |
| `Ctrl+C` | 恢复终端并退出 |

输入区使用 Pi `Editor`，支持中文输入法、多行文本和括号粘贴。流式输出不会锁定编辑，也不会把正在回看的历史滚动到底部。调整窗口后保留草稿和焦点。

## 模块结构

- `src/cli`：Commander 参数解析、应用入口和信号处理。
- `src/app/workspace.ts`：唯一的 `Workbench` 接口，负责任务编排、状态快照和关闭顺序。
- `src/runtime`：Pi 会话、模型事件和只读工具回调，不负责任务落库。
- `src/store`：SQLite 持久化、写入互斥与崩溃恢复。
- `src/tui`：界面与输入，只调用 `Workbench`，不接触 Store。

## 工具与数据边界

模型只能调用 `workspace_status`。Bash、PowerShell、任意文件读写、SQL、全局技能和项目规则均未加载。

`state.sqlite` 保存 schema 版本、写入代次和模型任务。每个写入短事务都会核对写入者与代次。第二个写入进程会被锁拒绝；失效锁被接管后，旧写入者无法继续提交。

Pi 会话保存在 `DATA_DIR/runtime/sessions`。配置位于 `DATA_DIR/runtime/config.json`，认证文件不会由本应用写入。

## 验证

```sh
npm run verify:offline
```

该入口依次执行类型检查、构建、Node.js 单元/集成测试和 `git diff --check`，不调用真实模型。结果写入 `.artifacts/offline-results.json`。

真实 API 验证需要操作者明确确认提供方、模型和调用费用：

```sh
npm run verify:live -- \
  --data-dir .artifacts/slice-1-live \
  --provider openai \
  --model gpt-4o-mini \
  --yes
```

该命令要求一次真实流式回答和 `workspace_status` 调用，结果写入 `.artifacts/live-results.json`。未完成真实调用前，不得把它记录为通过。

真实终端中的中文输入法、多行粘贴、滚动、窗口调整和退出恢复仍需人工核对，模拟渲染测试不替代这项验收。
