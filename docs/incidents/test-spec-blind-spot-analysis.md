# Test-Specification-Alignment 为何未捕获"能力未激活" — 根因分析

**Date**: 2026-05-06
**Sprint**: activate-security-checks
**Related**: `docs/incidents/capability-not-activated-root-cause.md`

## 问题重述

遵循 sprint-flow 开发完成的质量门禁能力（ESLint、lizard、vitest coverage），在 `specification.yaml` 中都有定义为 mandatory gate，`test-specification-alignment` 也已执行，但 commit 时这些 gate 全部输出 SKIP。**为什么测试对齐验证没有发现这个问题？**

## 根因：5 层盲区体系

```
Level 1: Gate 代码是否存在？          ← specification.yaml 定义了 REQUIREMENT  ✅
Level 2: 单元测试是否存在？            ← bats tests 覆盖了 bash 函数          ✅
Level 3: 单元测试是否通过？            ← 277 tests, all passing               ✅
Level 4: Gate 在生产环境是否真正执行？  ← ESLint/lizard/vitest 未安装 ← ❌ 盲区
Level 5: Gate 输出是否有效？            ← SKIP 状态，无真实数据      ← ❌ 盲区
```

**sprint-flow 和 test-specification-alignment 只覆盖到 Level 3。Level 4 和 Level 5 是盲区。**

## 原因一：Specification 的设计缺陷

### 问题：Gate 定义为结构而非独立 REQ

`specification.yaml` 中 6 道门禁被定义为 REQ-QG-001 内部的**子结构**，而非独立的 `REQ-GATE-1`, `REQ-GATE-2` 等。这导致：

- REQ 粒度太粗：2 个 QG REQ 覆盖了全部 6 道门禁 + 多语言适配器
- 11 个 REQ 对应 39 个测试文件，表面上看是 355% 的覆盖率
- 但没有任何一个 AC 验证 "Gate 输出必须是 PASSED（不是 SKIP）"

### 问题：AC 关注代码正确性，不关注运维正确性

规格中的 Acceptance Criteria 典型形式：

```yaml
# ✅ 抽查代码的逻辑正确性
- id: AC-QG-001-07
  given: Changed files include C++ or Objective-C files
  when: Gate 7 Cyclomatic Complexity check runs
  then: lizard correctly analyzes complexity for all supported languages

# ❌ 缺失：不抽查生产执行状态
# 需要类似:
- id: AC-GATE-ACTIVATION-01
  given: Required tools are installed in the environment
  when: git commit is executed
  then: All mandatory gates output PASSED (not SKIP)
```

## 原因二：test-specification-alignment 的设计边界

### 它做什么：

| 维度 | 检查内容 |
|------|---------|
| Requirement Coverage (30%) | 每个 REQ-* 是否有对应测试 |
| Acceptance Criteria Coverage (25%) | 每个 AC-* 是否被断言覆盖 |
| Test Intent Correctness (20%) | 测试意图是否声明 |
| Edge Case Coverage (15%) | 边界条件是否覆盖 |
| Test Data Validity (10%) | 测试数据是否合理 |

### 它不做什么：

| 检查内容 | 是否覆盖 | 说明 |
|---------|---------|------|
| 测试代码是否正确（用户预期行为） | ✅ | 阶段 1：对齐验证 |
| 测试是否真正通过 | ✅ | 阶段 2：执行测试 |
| **基础设施工具是否已安装和配置** | ❌ | 不在验证范围内 |
| **Gate 在生产环境是否产生 PASSED（非 SKIP）** | ❌ | 不在验证范围内 |
| **SKIP 状态的合理性** | ❌ | 不存在"SKIP 分析"概念 |

**test-specification-alignment 验证的是"测试代码与需求的映射关系"，而非"生产环境的工具链完整性"。**

## 原因三：测试框架自身的盲区

### bats 测试为什么 pass？

bats 测试（`githooks/__tests__/`）有以下特征：

1. **测试 bash 函数逻辑，不测试端到端行为**
   ```bash
   # 测试 check_if_tool_available 函数，不测试 commit 流程
   @test "check_if_tool_available returns 0 when tool exists" {
     run check_if_tool_available "bash"
     [ "$status" -eq 0 ]
   }
   ```

2. **测试框架本身使用 `skip` 跳过不可用工具**
   ```bash
   @test "C++ project blocked without skip marker" {
     skip "Maven not installed"   # ← 测试框架在 SKIP！
   }
   ```
   测试框架教会了开发者"工具不可用 = 正常跳过"，这成为一种文化习惯。

3. **测试覆盖率是 SHALLOW（浅层）而非 DEEP（深层）**
   - Shallow：代码被测试执行到 → 计入覆盖率
   - Deep：测试验证了生产环境的正确行为

## 原因四：Vitest 覆盖率统计的缺陷

从 pre-commit hook 输出：

```
Coverage check completed (may have failed threshold)
✅ PASSED - Coverage check completed.
```

Gate 5 的覆盖率检查即使 vitest 报告 0% 覆盖率（`All files | 0 | 0 | 0 | 0`），也会被标记为 PASSED。原因是：

```bash
# githooks/pre-commit line 706 (修复前):
npx jest --coverage --coverageThreshold='{...}' 2>/dev/null || echo "Coverage check completed (may have failed threshold)"
#                                      ^^^^^^^^^^
#                                       静默吞噬错误 → 永远不 BLOCK
```

## 结论

| 层面 | 问题 | 严重性 |
|------|------|--------|
| **specification.yaml** | Gate 定义为子结构而非独立 REQ；缺少"激活状态"验证的 AC | 高 |
| **test-specification-alignment** | 设计边界：验证测试与需求的映射，不验证基础设施工具链 | 中 |
| **bats 测试** | 测试 bash 函数逻辑，不是端到端 commit 流程；使用 `skip` 模式 | 高 |
| **Gate 5 覆盖率检查** | `2>/dev/null` 静默吞噬错误，永远不 BLOCK | 中 |
| **sprint-flow** | Phase 3 REVIEW 依赖 test-specification-alignment，继承了其盲区 | 低 |

### 核心结论

**test-specification-alignment 不是为了捕获此类问题而设计的。** 它验证"测试与需求的对齐关系"，但"能力已开发但未激活"是**基础设施运维**问题，不在其验证范围内。这是一个**范畴错误（category error）**——用代码对齐工具去验证基础设施就绪性。

## 修复建议

1. **在 specification.yaml 中增加"激活状态"AC**
   ```yaml
   - id: AC-GATE-ACTIVATION-01
     given: The project has all required gate tools installed
     when: git commit is executed
     then: All mandatory gates output PASSED (not SKIP)
   ```

2. **增加端到端集成测试**（非单元测试）
   ```bash
   @test "pre-commit: Gate 1 ESLint runs and passes on TypeScript project" {
     # 创建带 ESLint 配置的项目
     # 执行 git commit
     # 验证输出包含 "✅ PASSED - ESLint linting"
     # 验证输出不包含 "No ESLint configuration found - Skipping"
   }
   ```

3. **Gate 5 覆盖率检查改为 BLOCK on failure**
   ```bash
   npx vitest run --coverage 2>&1
   if [ $? -ne 0 ]; then exit 1; fi  # 不要静默吞噬错误
   ```

4. **增加 SKIP 状态审计脚本**
   ```bash
   # 在 pre-commit hook 末尾增加
   if echo "$ALL_GATE_OUTPUT" | grep -q "SKIP"; then
     echo "⚠️ WARNING: Some gates were SKIPPED. Verify tool installation."
   fi
   ```

5. **sprint-flow Phase 3 增加"激活验证"步骤**
   - 在 `test-specification-alignment` 之后增加
   - 运行 `git commit --dry-run` 并解析输出
   - 确认无 SKIP 状态
