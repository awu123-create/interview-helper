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

离线验证还需要 Gitleaks 8.30.1。它不是 npm 依赖，可将官方 release 二进制安装到已忽略的 `.artifacts/tools` 目录。

macOS Apple Silicon：

```sh
mkdir -p .artifacts/tools/gitleaks
curl --fail --location \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_darwin_arm64.tar.gz \
  --output .artifacts/tools/gitleaks.tar.gz
echo "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5  .artifacts/tools/gitleaks.tar.gz" | shasum -a 256 --check
tar -xzf .artifacts/tools/gitleaks.tar.gz -C .artifacts/tools/gitleaks gitleaks
export PATH="$PWD/.artifacts/tools/gitleaks:$PATH"
gitleaks version
```

Linux x86_64：

```sh
mkdir -p .artifacts/tools/gitleaks
curl --fail --location \
  https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz \
  --output .artifacts/tools/gitleaks.tar.gz
echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  .artifacts/tools/gitleaks.tar.gz" | sha256sum --check
tar -xzf .artifacts/tools/gitleaks.tar.gz -C .artifacts/tools/gitleaks gitleaks
export PATH="$PWD/.artifacts/tools/gitleaks:$PATH"
gitleaks version
```

然后运行单项检查或完整离线验证：

```sh
make format-check
make typecheck
make lint
make test
make secrets
make layers
make verify
```

`make` 默认执行 `make verify`。这些目标复用 `package.json` 中的命令；`make verify` 依次执行上述六项检查和 `git diff --check`，不执行构建，不调用真实模型。结果写入 `.artifacts/offline-results.json`。需要自动修复格式时单独运行 `make format`。

### Pre-commit hooks

提交前检查使用 Python pre-commit 3.2.0 或更高版本。先完成 `npm ci` 和上述 Gitleaks 安装。macOS 可用 Homebrew 安装框架；`pre-commit --version` 已能正常显示版本时无需重复安装：

```sh
brew install pre-commit
```

在该 clone 的任意工作目录运行一次以下命令，将官方 hook 安装到共享 Git hooks 目录：

```sh
make setup-hooks
pre-commit validate-config
```

共享 hook 对现有及以后创建的 linked worktree 都生效，并在各自工作目录读取配置。每个 worktree 都需要安装自己的 npm 依赖，并确保 pre-commit 和 Gitleaks 可从 `PATH` 调用。

旧分支如果没有 `.pre-commit-config.yaml` 和 `Makefile`，提交会明确失败；先合入这套配置再提交。

正常 `git commit` 会执行以下检查：

- Oxfmt 和 Oxlint 只接收匹配的暂存文件，分别执行 `--write` 和 `--fix`。
- TypeScript、离线测试和分层检查复用 Makefile 与 `package.json` 中的完整项目命令，不接收文件名参数，每次提交都会运行，包括纯删除提交。
- Gitleaks 使用 `gitleaks git --pre-commit --redact --staged` 扫描暂存内容；CI 中的 `npm run secrets` 仍扫描 `HEAD` 可达历史。

部分暂存时，pre-commit 会暂时收起已跟踪文件的未暂存改动，并在结束后恢复。未跟踪文件不会自动隔离；完整项目命令也会按各自配置读取工作目录，不能把它们理解为只看到暂存快照。格式或 lint 自动修复只留在工作区，hook 会失败；检查修复结果后需要手动暂存再提交。hook 不会自动执行 `git add` 或创建提交，日常开发不要使用 `git commit --no-verify`。

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
