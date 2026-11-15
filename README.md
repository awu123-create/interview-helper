# Interview Prep

围绕真实经历开展面试准备、复盘或演练的 Agent Skill，并维护一份跨会话准备档案。

## 使用

让支持文件读写的 Agent 加载 [interview-prep](skills/interview-prep/SKILL.md)，再明确指定任务：

- **准备**：根据简历、项目经历和目标岗位，整理准备重点、表达要点与可能追问。
- **复盘**：对照真实面试问题和原回答，分析具体问题，给出改进建议。
- **演练**：连续模拟面试，根据回答追问，结束后集中反馈。

例如：

> 使用 interview-prep 做演练。围绕订单重试项目问一个主问题，再追问两次，回答完后集中反馈。档案使用我指定的 Markdown 文件。

首次使用时指定档案位置，后续沿用。档案放在 skill 目录之外；事实、用户补充、模型推断和未知项分开保存。准备或复盘完成后更新档案，演练结束并集中反馈后再更新。

## 验证

使用 [.nvmrc](.nvmrc) 指定的 Node.js 版本，在仓库根目录运行，无需安装 npm 依赖：

```sh
node --check scripts/verify-interview-skill.mjs
node scripts/verify-interview-skill.mjs
git diff --check
```

[验证脚本](scripts/verify-interview-skill.mjs)检查包结构、frontmatter、文档格式和本地引用，不判断模型行为。多轮问答、事实纠正、档案续接和失败处理按[行为验收场景](test/skills/interview-prep.md)执行。

GitHub CI 运行语法和结构检查，并检查提交中的空白错误。已安装 pre-commit 的开发环境可运行 `pre-commit install`，提交前使用同一份 skill 结构检查。
