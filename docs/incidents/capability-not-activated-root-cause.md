# 能力已开发但未激活 — 根因分析

**Date**: 2026-05-06
**Sprint**: activate-security-checks
**Commit**: 65e0808

## 问题

项目存在多个安全检查机制代码（ESLint、lizard、vitest coverage 等），但 commit 时全部被 SKIP，原因不是代码逻辑错误，而是**配置未就绪、工具未安装**。

## 根因总结

| 编号 | 根因 | 典型案例 |
|------|------|---------|
| 1 | **代码先写，配置后补** | ESLint 检查逻辑在 `pre-commit:327-341` 已存在，但触发条件要求 `eslint.config.js` 存在，该文件直到激活 commit 才创建 |
| 2 | **工具依赖未安装** | lizard 复杂度检测代码完整，但 `pip install lizard` 未执行 |
| 3 | **适配器有但未被路由** | Gate 路由依赖 `detect_project_lang()`，若未覆盖新文件类型则能力不会被调用 |
| 4 | **缺少激活验证清单** | 渐进式开发中，"激活"作为最后一步被遗漏，无自动化检测 `coded but not activated` |

## 提炼规律

```
Phase A: 能力开发 (写 Gate 逻辑 + 适配器)
    ↓
Phase B: 能力集成 (加路由 + 写测试)
    ↓
Phase C: 激活能力 (创建配置 + 安装依赖) ← 最容易遗漏！
    ↓
Phase D: 验证激活 (确认输出从 SKIP → PASSED)
```

## 典型案例拆解

### ESLint (Gate 1)

- 代码位置：`githooks/pre-commit:327-341`
- 触发条件：`if [ -f "eslint.config.js" ] || [ -f ".eslintrc.*" ]`
- 未激活原因：没有任何 ESLint 配置文件 → 输出 `No ESLint configuration found - Skipping`
- 激活方式：创建 `eslint.config.js` + 安装 `@typescript-eslint/*`

### lizard 圈复杂度 (Gate 3)

- 代码位置：`githooks/pre-commit:539-599`
- 触发条件：`command -v lizard > /dev/null`
- 未激活原因：lizard 安装在 `~/.local/bin/`，不在 PATH 中，且 `if/else` 逻辑分支 bug 导致 fallback 路径的复杂度检查代码不会执行
- 激活方式：修复 `if/else` 逻辑 + 确保 lizard 路径正确

### vitest 覆盖率 (Gate 5)

- 代码位置：`githooks/pre-commit:703-770`
- 触发条件：`package.json` 中存在 `test:coverage` 脚本
- 未激活原因：hook 调用 `npx jest --coverage` 但项目使用 vitest
- 激活方式：改为 `npx vitest run --coverage`

## 经验教训

| # | 教训 | 建议 |
|--|------|------|
| 1 | 能力代码和激活配置应在同一个 commit | 避免中间态"有代码无效果" |
| 2 | 配置检测太宽松 | 当前 ESLint 仅在配置存在时运行，缺少"静默跳过"告警 |
| 3 | 新增能力必须有激活验证清单 | 每次新增能力后验证输出从 SKIP → PASSED |
