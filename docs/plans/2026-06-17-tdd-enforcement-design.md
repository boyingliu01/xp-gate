# TDD 强制执行设计文档

## 问题

当前 Gate 5 的 "Test-Source File Pairing Check" 和 Mock Density Advisory Scan 均仅为 **WARNING/ADVISORY**，不阻断提交/推送。TDD 铁律（"NO PRODUCTION CODE WITHOUT A FAILING TEST"）写在 `skills/test-driven-development/SKILL.md` 中，但没有任何 gate 级强制执行。

## 设计

3 层结构，增量推进：

### Layer 1: Gate 11 — Test-First BLOCK (pre-commit)

- 对每个 staged 的新增 `.ts` 源文件（`git diff --cached --name-status` 中标记为 `A`），检查对应 `.test.ts` 是否也在 staged 中
- 豁免文件：`index.ts`, `types.ts`, `interfaces.ts`, `constants.ts`, `__init__` 类文件, `.d.ts`, `.pyi`
- 豁免注解：`// @no-test-required`
- 修改已有文件 → WARNING（不阻断，兼容存量项目）
- 当前 Gate 5a 已有此逻辑雏形，需升级为 BLOCK

### Layer 2: Gate M4 — Mock 密度 BLOCK (pre-push)

- 当前 Gate 5b 的 mock 密度扫描是 ADVISORY，改为在 pre-push 中 BLOCK
- 阈值：mock 关键字密度 >30% 且无 `@mock-justified` 注解（理由 ≥10 字符）
- 保留现有检测逻辑（jest.mock, vi.mock, spyOn, fn(), MagicMock 等）

### Layer 3: ralph-loop TDD 强化

- sprint-flow Phase 2 BUILD 模板增加 Gate 前置检查
- `test-driven-development/SKILL.md` 引用更新

## 不做

- spec-to-test alignment（已有 `test-specification-alignment` skill）
- coverage 阈值修改（已有 Gate 5 的 80%）
- CI workflow 修改

## 实现顺序

1. Gate 11: pre-commit test-first block
2. Gate M4: pre-push mock density block
3. sprint-flow Phase 2 ralph-loop TDD 强化
