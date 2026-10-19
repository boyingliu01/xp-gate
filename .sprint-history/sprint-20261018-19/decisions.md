# Sprint E (sprint-20261015-96) 决策记录

## Decision DR-001
- **Phase**: 1/6 PREP
- **Question**: Sprint E 有 6 个 issue（#534 新 Python 提速 + #522/#420 删 skill + #505 抽原语 + #404 RFC + #392 走查缺陷），主题差异大，如何编排？
- **Options**:
  a. #534 打头，一个 flow 全包（一个 specification.yaml，一次发布 v0.26.0）
  b. #534 单独一个 flow 先发（见效快，避免与厚重走查 bug 捆绑）
  c. 由我推荐编排
- **Choice**: **b. #534 单独一个 flow 先发**
- **Rationale**: 老牛明确「主题差异大的话先做提效 issue，剩下后面再做，优先级调一下」。6 个 issue 跨 5 个领域（清理/重构/RFC/走查 bug/效能），塞单一 specification.yaml 会臃肿。backlog 已更新：#534 = Sprint E (v0.26.0)，清算收尾（#522/#420/#505/#404/#392）= Sprint F (v0.27.0)。
- **Timestamp**: 2026-10-16 00:09

## Decision DR-002
- **Phase**: 1/6 PREP
- **Question**: 开发在 worktree 隔离还是 main 直接开发？
- **Options**:
  a. sprint-flow 默认 worktree 隔离
  b. 沿用 Sprint D 成熟路径，main 直接开发（12 道门禁已保护 main）
- **Choice**: **b. main 直接开发**
- **Rationale**: Sprint D 成功路径即 main 直接 TDD + Delphi 走查 + push。worktree base 落后 main 3 个提交（#481/backlog/归档），同步成本高。本机 pre-commit 慢（5min/次），worktree 无优势。xp-gate 12 门禁本身保护 main。已清理 worktree，phase-1-summary 迁回 main。
- **Timestamp**: 2026-10-16 00:46

## Decision DR-003 (调研结论，供 DESIGN 参考)
- **Phase**: 1/6 PREP
- **Question**: #534 诉求 1「mypy 换 Rust 实现（ty 优先）」的现实可行性？
- **Finding**:
  - ty（Astral Rust）是 2025-12 public alpha（0.0.x），规格一致 ~70%（mypy 75%），配置 `[tool.ty]` 不兼容 `[tool.mypy]`，无官方 pre-commit 支持。
  - 本机无 ty、有 pyright。python.sh 的 mypy 调用已高度精炼（.xp-gate-mypy-scope 三级解析 + 反裸 mypy . BATS 锁 + CI 口径对齐）。
  - pyright 配置体系（[tool.pyright]）与 mypy 完全不同，直接替换会破坏现有作用域/CI/BATS。
- **倾向**: 增量检查（诉求 2）为主菜，直接解决 CPU 痛点（git diff --cached 只查 staged 文件）；引擎替换保留 mypy 默认，ty 作可选探测 fallback（避免 alpha 风险）。最终由 Phase 2 Delphi 三模型评审定夺。
- **Timestamp**: 2026-10-16
