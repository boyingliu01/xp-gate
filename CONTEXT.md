# CONTEXT.md — dsh-plugin 特性上下文

## 项目背景

XP-Gate 是确定性 git 质量门禁 + AI 多专家评审（Delphi）+ Sprint Flow 流水线的工具集，核心是 `xp-gate` CLI + 12 道确定性门禁（纯 shell/CLI，零 AI 耦合）。

## 本次特性

把 XP-Gate 移植为 **DeepSeek Harness (DSH) 原生插件（bundle）**（Issue #393）。

DSH（`@deepseek-ai/dsh@0.1.1-rc.2`）是 Cordis 插件平台，提供：
- `ctx.tools.register(defineTool(...))` — 注册可被 agent 调用的工具
- `cordis.patch.yml` insert — 把插件包挂进 bundle 层栈
- `dsh plugin add <pkg>` — 安装声明了 `dsh.bundle.patch` 的第三方 npm 包
- `ctx.skills` / `dsh-skill-filesystem` — SKILL.md 技能发现

## 领域术语

- **bundle**：DSH profile 的补丁层，每个 bundle 的 `cordis.patch.yml` 用 `insert` 挂插件
- **gate-check / gate-principles / gate-arch**：XP-Gate 现有 opencode 插件的三工具，shell 调 `xp-gate check/principles/arch`
- **优雅降级**：`command -v xp-gate` 命中走全局 CLI，否则回退随包源码 `node .../xp-gate.js`

## 关键决策（详见设计文档 / ADR）

1. 走「薄桥」：在 `ctx.tools` 注册三工具，非 MCP、非技能-only
2. 复刻 opencode 插件 fallback
3. execute 用 `ctx.shell.run`（取消/超时/沙箱），不用 node child_process
4. 12 个 SKILL.md 随包分发，README 指导 `customSkillDirs` 或 `cp` 到 `.dsh/skills`

## 关键证据源

- DSH 安装包：`/home/boyingliu01/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh/`（0.1.1-rc.2）
- 待移植参考：`plugins/opencode/index.ts`
- 设计文档：`docs/plans/2026-08-23-dsh-plugin-design.md`