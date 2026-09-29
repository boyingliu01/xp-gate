---
name: test-specification-alignment
description: "Use when asked to run tests, verify tests, align tests with specification.yaml, before BUILD verification, or before release/ship."
---

# Test-Specification Alignment Engine

## Workflow Steps

1. **Load Phase 0** — Verify `specification.yaml` and `tests/` directory exist; BLOCK if missing with guidance to complete brainstorming → delphi-review → specification-generator flow first
2. **Phase 1 Alignment (Modify Allowed)** — Parse specification.yaml + test files (AST); validate alignment rules; generate alignment report; optionally fix tests to align with requirements; require score ≥80% to proceed
3. **Coverage Mapping** — Map each REQ-* to at least one test with `@test` annotation; map each AC-* to at least one assertion; verify `@test`, `@intent`, `@covers` tags
4. **Pre-Phase 2 Freeze** — Lock test directories via read-only subagent convention (reviewer tools restricted to `[Read, Grep, Glob]`, no Write/Edit/Bash); return confirmation before proceeding
5. **Phase 2 Execution (Frozen)** — Run all tests; Agent BLOCKED from modifying/deleting/skipping tests; analyze failures into 4 categories
6. **Failure Classification** — For each failing test, output with Type, Test, Root Cause, Action fields; SPECIFICATION_ERROR requires ESCALATE_TO_HUMAN with user options (A: fix spec → re-Phase 1, B: confirm spec → modify code, C: clarify ambiguity)
7. **JSON Report Output** — Generate alignment report as valid JSON

## 核心原则

**测试是系统的防护网，也是系统的使用手册。测试必须准确反映原始需求和设计方案。**

| 特性 | 说明 |
|------|------|
| **两阶段分离** | Phase 1 可修改测试对齐，Phase 2 禁止修改测试执行 |
| **结构化验证** | YAML specification + AST 解析，确定性验证 |
| **freeze 约束** | Phase 2 调用 freeze skill 锁定测试目录 |
| **失败分类** | 业务代码/测试数据/Specification/环境 四类错误分流 |
| **零容忍** | Phase 2 绝对禁止修改/删除/跳过测试 |

---

## Output Format (MANDATORY)

> **MANDATORY FILE OUTPUT**: When invoked, you MUST write this report as valid JSON to the file `.sprint-state/phase-outputs/test-alignment-report.json` in the project root. Stdout output alone is not sufficient — `xp-gate phase-transition 4 completed` validates the file, not the stdout.

```json
{
  "alignment_status": "PASS|FAIL|BLOCKED",
  "phase": "1|2",
  "score": 85.5,
  "head_commit": "<git rev-parse HEAD output>",
  "spec_hash": "<SHA-256 of specification.yaml if exists, else null>",
  "timestamp": "<ISO 8601>",
  "misaligned_tests": [
    {"test_name": "test_checkout", "spec_requirement": "REQ-003", "gap": "Missing @test annotation"}
  ],
  "anti_pattern_detected": false,
  "errors": []
}
```

**Eval assertions check for:** `alignment_status`, `phase`, `score`, `head_commit`, `spec_hash`, `anti_pattern_detected`.

---

## Triggers

### Automatic
- BUILD (TDD + review) Round 1 after Driver outputs tests
- Gate 1 verification before proceeding
- Phase 5 SHIP release before deployment (native phase-5 steps)

### Manual
- `/test-specification-alignment`, `/verify-tests`, "run tests", "verify tests"

---

## Scope

### IN Scope
- Validation of test alignment against `specification.yaml`
- Phase 1: Test modification to improve alignment
- Phase 2: Test execution with frozen test files
- Failure classification (BUSINESS_CODE_ERROR, TEST_DATA_ERROR, SPECIFICATION_ERROR, ENVIRONMENT_ERROR)
- JSON report generation

### OUT Scope
- Modifying `specification.yaml` during Phase 2 (requires ESCALATE_TO_HUMAN)
- Skipping/deleting/skipping tests
- Modifying test assertions to force passes
- Business logic implementation (BUILD phase)
- Environment configuration

### Boundaries
- **Start**: After BUILD (TDD + review) Round 1 outputs tests
- **End**: Terminal State ✅ ALL_TESTS_PASS or ESCALATE_TO_HUMAN
- **Inputs**: `specification.yaml`, `tests/` directory
- **Outputs**: Alignment report (JSON), test execution report, failure classification

---

## 核心流程

```
Phase 0: 准备
  ├─ 验证 specification.yaml 存在
  ├─ 验证 tests/ 目录存在
  └─ ❌ 缺失 → BLOCK + 提示用户

Phase 1: 对齐验证 (可修改测试)
  ├─ 解析 specification.yaml (YAML parser)
  ├─ 解析测试文件 (AST parser)
  ├─ 验证对齐规则
  └─ (可选) 修复测试

Checkpoint: Alignment Score >= 80%?
  ├─ NO → BLOCK
  └─ YES → 继续

⭐ Pre-Phase 2: 调用 freeze skill 锁定测试目录

Phase 2: 执行测试 (禁止修改测试)
  ├─ 运行所有测试
  ├─ IF Agent 尝试修改测试 → freeze 拦截
  ├─ 失败分析: 业务代码/测试数据/Specification/环境
  │   └─ Specification 错误 → ESCALATE_TO_HUMAN
  └─ 全部通过 → 继续

⭐ Post-Phase 2: 调用 unfreeze skill

Terminal State: ✅ ALL_TESTS_PASS
```

---

## 强制对齐规则

| 规则 | 说明 | 语言示例 |
|------|------|----------|
| **每个 REQ 必须有测试** | 每个 REQ-* 对应至少一个 test case | TS: `@test REQ-AUTH-001` / Py: `# @test REQ-AUTH-001` / Go: `// @test REQ-AUTH-001` |
| **每个 AC 必须有断言** | 每个 AC-* 必须有对应断言覆盖 | `// AC-AUTH-001-01: 返回 200` → `expect(response.status).toBe(200)` |
| **测试意图声明** | 每个 test case 必须有 `@test`, `@intent`, `@covers` 标签 | 详见 `references/specification-format.md` |

---

## Failure Classification

| 类型 | 判断依据 | 处理方式 |
|------|----------|----------|
| **BUSINESS_CODE_ERROR** | 测试正确，业务代码有 bug | 修改业务代码 |
| **TEST_DATA_ERROR** | 测试数据不符合业务逻辑 | 回滚到 Phase 1 |
| **SPECIFICATION_ERROR** | 测试正确，但 specification 有误 | ESCALATE_TO_HUMAN |
| **ENVIRONMENT_ERROR** | 环境/依赖问题 | 修复环境配置 |

### Specification 错误处理选项

- **A**: 修正 Specification → 重新 Phase 1 (unfreeze tests)
- **B**: 确认 Specification 正确 → 修改业务代码 (用户明确授权)
- **C**: 补充 Specification 澄清歧义 (unfreeze tests)

---

## State Machine

| State | Description |
|-------|------------|
| 0 IDLE | Initial |
| 1 PHASE0_PREPARING | Preparing |
| 3 PHASE1_ALIGNING | Aligning |
| 6 PHASE1_COMPLETE | Alignment done |
| 7 PRE_PHASE2_FREEZE | Freeze test dirs |
| 9 PHASE2_EXECUTING | Running tests |
| 12 PHASE2_FIXING_CODE | Fixing business code |
| 14 PHASE2_COMPLETE | Tests passed |
| 15 POST_PHASE2_UNFREEZE | Unfreeze test dirs |
| 16 ALL_TESTS_PASS | ✅ Done |
| 90 BLOCKED_MISSING_SPECIFICATION | Missing specification |
| 93 BLOCKED_SPECIFICATION_ISSUE | Spec issue needs user |
| 94 BLOCKED_MAX_RETRIES_EXCEEDED | Max retries hit |

---

## Anti-Patterns

| ❌ Error | ✅ Correct |
|---------|-----------|
| Phase 2 修改/删除测试文件 | 只能修改业务代码 |
| Phase 2 跳过测试 (skip/xit) | 检测并拒绝 |
| 测试失败时修改断言 | 必须修改业务代码 |
| 缺少 @test 标签 | 强制标注 |
| Specification 错误时强行通过 | 必须 ESCALATE |

---

## Terminal State Checklist

- [ ] specification.yaml 存在且可解析
- [ ] tests/ 目录存在且有测试文件
- [ ] Phase 1 对齐验证完成, score ≥ 80%
- [ ] Pre-Phase 2: freeze skill 已调用
- [ ] Phase 2: 所有测试已执行, 无修改违规
- [ ] Post-Phase 2: unfreeze skill 已调用
- [ ] 所有测试通过, 报告已生成

**IF Specification 问题 → CANNOT claim complete → MUST ESCALATE_TO_HUMAN**

---

## Details → see `references/`

| Topic | File |
|-------|------|
| 对齐验证算法 (AST parsing, score calc, legacy mode) | `references/alignment-verification-algorithm.md` |
| Specification YAML 格式规范 (完整示例) | `references/specification-format.md` |
| Phase 2 freeze 约束执行机制 (违规日志, 异常处理, 状态转换) | `references/phase2-constraint-enforcement.md` |
