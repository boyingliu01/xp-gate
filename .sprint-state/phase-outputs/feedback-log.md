# Sprint-2 反馈日志

## Sprint 概览
- **Sprint ID**: sprint-2026-05-30-02
- **目标**: xp-gate uninstall 体验优化（Sprint-1 deferred items）
- **父 Sprint**: sprint-2026-05-30-01 (v0.5.0)
- **结果**: SHIPPED (571/571 tests, UAT PASSED)

## Phase 时间线
| Phase | 内容 | 耗时 |
|-------|------|------|
| Phase -1 | Worktree 隔离 (main → sprint/2026-05-30-02) | ~2min |
| Phase 0 | Brainstorming 需求探索 + 设计 | ~20min (3 轮用户澄清) |
| Phase 1 | Delphi Round 1 → fixes → Round 2 APPROVED | ~15min |
| Phase 2 | BUILD (ralph-loop: REQ-1→2/3(parallel)→4) | ~15min |
| Phase 3 | Test-spec alignment | ~2min |
| Phase 4 | UAT 用户验证 | ~5min |
| Phase 5 | FEEDBACK (本文件) | ~5min |

## 关键决策
1. **Manifest 机制** — Delphi Round 1 两位专家独立指出缺少 manifest，导致 uninstall 和 doctor 盲视。通过 init.js 增加 sha256 manifest 解决。
2. **状态机** — xp-gate.json mode: active→uninstalling→uninstalled。doctor 只在 active 时执行 --fix。
3. **三分类清理** — 必须清理/询问清理/保留，AGENTS.md 归入"询问清理"。
4. **core.hooksPath 恢复** — 仅值匹配时 unset，不尝试恢复旧值（旧值未保存）。
5. **回滚机制** — pre-delete backup snapshot + 操作重排序（非破坏在先）。

## 经验教训
1. **Delphi 交叉验证价值高**：两位专家同时指出 manifest 缺失 → 如果只用一位专家可能漏掉。
2. **init.js 无事务性**：uninstall 继承了这个弱点。未来可考虑 init 写入 manifest 伴随每一个文件操作。
3. **vitest Vite transform 陷阱**：migrate.test.js 中 `os.homedir()` 在 Vite SSR 下不跟随 `process.env.HOME` 动态变化。必须用 `process.env.HOME || os.homedir()` 模式（与所有现有模块一致）。

## Emergent Issues
- 无。本 Sprint 严格按照设计执行，未发现新问题。

## Sprint-3 候选
- download-skill 多源降级（离线 → 镜像 → npm → GitHub）— Sprint-1 遗留的最后一项
- init 事务性改进（init 失败时 rollback）
- core.hooksPath 旧值保存与恢复
