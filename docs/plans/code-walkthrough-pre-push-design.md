# Code Walkthrough Pre-push Hook 设计

**日期**: 2026-04-14
**状态**: Draft - Pending Delphi Review (补做)
**Issue**: #7 - Bug: CLI invocation error

---

## 问题背景

### Issue #7 描述

执行 `git push` 时，pre-push hook 输出 OpenCode CLI help 信息而非评审结果：

```
opencode code-walkthrough --diff "$DIFF_FILE" --output "$OUTPUT_FILE"
```

这个命令格式错误，OpenCode CLI 不支持子命令调用。

### 根因分析

**为什么之前没发现？**

1. **没有实际测试**: 设计时没有运行 `git push` 验证
2. **假设 CLI 能调用 skill**: SKILL.md 假设可以通过 `opencode code-walkthrough` 调用
3. **Delphi Review 缺失**: code-walkthrough 从未经过正式的 Delphi 评审
4. **SKILL vs 实现**: SKILL.md 描述流程，但 pre-push hook 实现与 skill 预期不匹配

---

## 设计文档

### SKILL.md 核心设计

**文件**: `skills/code-walkthrough/SKILL.md`

**核心流程**:
```
git push → pre-push hook → 获取 git diff → Delphi 评审 → 共识 → 允许/阻塞
```

**关键设计点**:
- Expert A/B 匿名评审 (Delphi method)
- Principles checker 集成 (14 rules)
- 零降级原则: 环境/资源问题 BLOCK
- 大小阈值: ≤20 files, ≤500 lines

### Pre-push Hook 实现

**文件**: `githooks/pre-push`

**当前实现 (有问题)**:
```bash
# Line 187 - WRONG
timeout $TIMEOUT_SECONDS opencode code-walkthrough --diff "$DIFF_FILE" --output "$OUTPUT_FILE" 2>&1
```

**OpenCode CLI 实际能力**:
```bash
$ opencode --help
Commands:
  opencode completion          generate shell completion script
  opencode acp                 start ACP server
  opencode mcp                 manage MCP servers
  opencode [project]           start opencode tui (default)
  opencode run [message..]     run opencode with a message
  opencode serve               start headless server
  ...

# NO SUPPORT FOR:
# opencode code-walkthrough --diff --output
```

---

## Critical Issue 待评审

### Issue #1: CLI 调用方式根本错误

**问题**: pre-push hook 使用了 OpenCode CLI 不支持的命令格式

**现状**:
- SKILL.md 假设: "触发 Delphi 评审"
- pre-push hook 实现: `opencode code-walkthrough --diff --output`
- OpenCode CLI 实际: 不支持 skill 子命令

**问题类型**: **实现与设计不匹配**

### Issue #2: Skill 与 Hook 的职责边界不清

**SKILL.md 定义的职责**:
- Expert A/B 评审流程
- Principles checker 集成
- 共识判断逻辑

**pre-push hook 实际做的**:
- 检查 OpenCode CLI 可用性
- 检查 skill 可用性
- 获取 git diff
- 调用 skill (但方式错误)
- 解析输出决定是否允许推送

**边界不清**: skill 是"评审逻辑"，hook 是"触发+结果处理"，但如何桥接？

---

## 备选方案

### Alternative A: 使用 OpenCode CLI 正确方式

```bash
# OpenCode 支持的方式
opencode run "/code-walkthrough" --prompt "Review this diff: $(cat $DIFF_FILE)"
```

**优点**: 使用 CLI 支持的命令
**缺点**: 需要启动 TUI 或 server，可能不适合 hook 场景

### Alternative B: Skills 在 Agent Session 内触发

```bash
# Hook 只做环境检查和准备工作
# 实际评审由 Agent 在 session 内执行 skill

# Hook 简化为:
1. 检查 OpenCode CLI 可用
2. 检查 skill 存在
3. 检查大小阈值
4. 创建一个标记文件告知 Agent 需要执行 code-walkthrough
5. Agent session 内: 用户执行 /code-walkthrough 或自动触发
```

**优点**: Skills 正常使用，不需要 CLI 子命令
**缺点**: Hook 无法阻塞推送（需要手动评审）

### Alternative C: 完全移除 pre-push Hook

**理由**:
- code-walkthrough 是"评审流程"，适合手动触发
- pre-push hook 强制评审可能阻碍工作流
- 用户应在推送前**主动**调用 `/code-walkthrough`

**优点**: 避免自动化带来的复杂性
**缺点**: 失去"强制评审"质量门禁

### Alternative D (推荐): Hook 仅检查，Skill 手动执行

```bash
# pre-push hook:
1. 检查环境 (OpenCode CLI, skill 存在)
2. 检查大小阈值
3. 提示用户: "请先执行 /code-walkthrough 进行评审"
4. 如果用户确认已评审 → 允许推送
5. 如果用户未评审 → BLOCK 并提示

# 用户流程:
git push → hook 提示 → 用户运行 /code-walkthrough → APPROVED → git push
```

**优点**: 
- Hook 只做检查，不尝试调用 skill
- 用户控制评审时机
- 避免 CLI 调用问题

**缺点**:
- 需要用户手动步骤
- 但这符合"评审应由人工决策"原则

---

## 关键问题待评审

### Critical Issues:

1. **pre-push hook 调用方式根本错误** - 如何修复？
2. **Skill 与 Hook 的职责边界** - Hook 应该做什么？
3. **强制评审 vs 手动评审** - pre-push 自动触发合理吗？
4. **OpenCode CLI 能力假设** - 是否假设了不存在的能力？

### Major Concerns:

1. **SKILL.md 描述的是 Agent 流程，不是 CLI 流程** - 需要澄清
2. **从未实际测试** - 设计与实现分离
3. **Terminal State Checklist 在 Hook 无法验证** - skill 内部状态如何传递给 hook？

---

## 评审请求

请专家评审：

1. pre-push hook 的设计是否可行？
2. Skill 与 Hook 的正确集成方式是什么？
3. 是否应该强制评审还是改为手动触发？
4. Alternative D (Hook 检查 + Skill 手动执行) 是否是更好的方案？

---

## 相关文件

| 文件 | 类型 | 行数 |
|------|------|------|
| `skills/code-walkthrough/SKILL.md` | Skill 定义 | 396 |
| `githooks/pre-push` | Shell hook | 288 |
| `skills/delphi-review/SKILL.md` | Delphi 评审流程 | 参考 |

---

## 备注

此设计从未经过 Delphi Review，是项目初始提交的一部分 (`67c6673`)。

Issue #7 是第一次实际使用时发现的 Bug。