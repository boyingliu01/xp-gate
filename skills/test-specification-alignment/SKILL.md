---
name: test-specification-alignment
description: "测试与 Specification 对齐验证引擎。确保测试准确反映需求和设计。两阶段执行：Phase 1 验证对齐（可修改测试），Phase 2 执行测试（禁止修改测试）。MANDATORY before any release. TRIGGER: 'run tests', 'verify tests', before BUILD (TDD + review) Arbiter, before gstack-ship."
---

# Test-Specification Alignment Engine

## 核心原则

**测试是系统的防护网，也是系统的使用手册。测试必须准确反映原始需求和设计方案。**

### 五大特性

1. **两阶段分离** — Phase 1 可修改测试对齐，Phase 2 禁止修改测试执行
2. **结构化验证** — YAML specification + AST 解析，确定性验证
3. **freeze 约束** — Phase 2 调用 freeze skill 锁定测试目录
4. **失败分类** — 业务代码/测试数据/Specification/环境 四类错误分流
5. **零容忍** — Phase 2 绝对禁止修改/删除/跳过测试

---

## 触发条件

### 自动触发

- BUILD (TDD + review) Round 1 后（Driver 输出 tests）
- Gate 1 验证前
- gstack-ship 发布前

### 手动触发

- `/test-specification-alignment` 命令
- `/verify-tests` 命令

---

## Specification 定义

**Specification = Requirements + Design Decisions + API Contracts**

| 组成部分 | 文件 | 格式 |
|----------|------|------|
| Requirements | `specification.yaml` | YAML |
| User Stories | `specification.yaml` | YAML |
| Acceptance Criteria | `specification.yaml` | YAML |
| Design Decisions | `specification.yaml` | YAML |
| API Contracts | `specification.yaml` | YAML |

---

## 核心流程

```
┌─────────────────────────────────────────────────────────────┐
│           Test-Specification Alignment Flow                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 0: 准备                                               │
│  ├─ 验证 specification.yaml 存在                             │
│  ├─ 验证 tests/ 目录存在                                     │
│  └─ ❌ 缺失 → BLOCK + 提示用户                               │
│      └─ 提示: "先完成需求流程:                                │
│              brainstorming → delphi-review → specification-generator" │
│                                                              │
│  Phase 1: 对齐验证 (可修改测试)                               │
│  ├─ 解析 specification.yaml (YAML parser)                    │
│  ├─ 解析测试文件 (AST parser)                                │
│  ├─ 验证对齐规则                                             │
│  ├─ 生成 Alignment Report                                    │
│  └─ (可选) 修复测试                                          │
│                                                              │
│  Checkpoint: Alignment Score >= 80%?                         │
│  ├─ NO → BLOCK                                               │
│  └─ YES → 继续                                               │
│                                                              │
│  ⭐ Pre-Phase 2: 调用 freeze skill 锁定测试目录               │
│                                                              │
│  Phase 2: 执行测试 (禁止修改测试)                             │
│  ├─ 运行所有测试                                             │
│  ├─ IF Agent 尝试修改测试 → freeze 拦截                      │
│  ├─ 失败分析: 业务代码/测试数据/Specification/环境           │
│  │   └─ Specification 错误 → ESCALATE_TO_HUMAN               │
│  └─ 全部通过 → 继续                                          │
│                                                              │
│  ⭐ Post-Phase 2: 调用 unfreeze skill 解锁测试目录            │
│                                                              │
│  Terminal State: ✅ ALL_TESTS_PASS                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚠️ Phase 0 缺失 Specification 处理

### 错误提示格式

如果 `specification.yaml` 不存在，必须 BLOCK 并提供清晰的流程指引：

```
❌ BLOCKED: specification.yaml 不存在

要生成 specification.yaml，请先完成需求流程：

流程步骤:
1. brainstorming      → 需求探索，生成设计文档
2. delphi-review      → 需求评审（多轮直到 APPROVED）
3. specification-generator → 从 APPROVED 的设计文档生成 specification.yaml

为什么必须这样？
- 在 delphi-review APPROVED 后生成，避免设计文档修改时 spec 也需重新生成
- 遵循"问题发现越早修复成本越低"原则

请先完成上述流程，然后再运行 test-specification-alignment。
```

---

## 强制对齐规则

### 规则 1: 每个 Requirement 必须有测试

```yaml
requirement_to_test:
  rule: "每个 REQ-* 必须对应至少一个 test case"
  format: "test name 包含 REQ ID 或 JSDoc @test 标签"
  
  # TypeScript 示例
  example_ts: |
    /**
     * @test REQ-AUTH-001
     * @intent 验证用户使用正确凭据可以成功登录
     * @covers AC-AUTH-001-01, AC-AUTH-001-02
     */
    test('REQ-AUTH-001: login success', () => { ... });
  
  # Python 示例
  example_py: |
    # @test REQ-AUTH-001
    # @intent 验证用户使用正确凭据可以成功登录
    # @covers AC-AUTH-001-01, AC-AUTH-001-02
    def test_req_auth_001_login_success():
        ...
  
  # Go 示例
  example_go: |
    // @test REQ-AUTH-001
    // @intent 验证用户使用正确凭据可以成功登录
    // @covers AC-AUTH-001-01, AC-AUTH-001-02
    func Test_REQ_AUTH_001_LoginSuccess(t *testing.T) { ... }
```

### 规则 2: 每个 Acceptance Criteria 必须有断言

```yaml
ac_to_assertion:
  rule: "每个 AC-* 必须有对应断言覆盖"
  format: "断言注释标注 AC ID"
  example: |
    // AC-AUTH-001-01: 返回 200 和 token
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
```

### 规则 3: 测试意图必须明确声明

```yaml
test_intent_declaration:
  rule: "每个 test case 必须有意图声明"
  format: "@test, @intent, @covers JSDoc 标签"
  required_tags:
    - "@test REQ-XXX-XXX"      # 关联的 requirement ID
    - "@intent 描述测试意图"    # 测试目的
    - "@covers AC-XXX-XX"       # 覆盖的 acceptance criteria (可选)
```

---

## 对齐验证维度

| 维度 | 权重 | 验证内容 |
|------|------|----------|
| Requirement Coverage | 30% | 每个 REQ-* 是否有对应测试 |
| Acceptance Criteria Coverage | 25% | 每个 AC-* 是否被断言覆盖 |
| Test Intent Correctness | 20% | 测试意图是否正确声明 |
| Edge Case Coverage | 15% | 边界条件是否覆盖 |
| Test Data Validity | 10% | 测试数据是否合理 |

**Pass Threshold: 80%**

---

## Phase 2: freeze 约束机制

### Pre-Phase 2: 锁定测试目录

```yaml
pre_phase2:
  action: "INVOKE freeze skill"
  parameters:
    freeze_boundary:
      - "tests/"
      - "test/"
      - "__tests__/"
      - "*.test.ts"
      - "*.test.js"
      - "*.spec.ts"
      - "*.spec.js"
      - "*_test.py"
      - "*_test.go"
      - "cypress/"
      - "playwright/"
    mode: "strict"
  
  result:
    - "测试目录被 freeze skill 锁定"
    - "Agent 的 Edit/Write 调用被预拦截"
    - "返回: ✅ 测试文件已冻结"
```

### Phase 2 约束

```yaml
phase2_constraints:
  forbidden_actions:
    - action: "修改测试文件"
      severity: "CRITICAL"
      response: "freeze skill 返回 BLOCKED_ERROR"
    
    - action: "删除测试文件"
      severity: "CRITICAL"
      response: "freeze skill 返回 BLOCKED_ERROR"
    
    - action: "跳过测试 (test.skip, @skip, xit)"
      severity: "CRITICAL"
      response: "检测并拒绝"
    
    - action: "修改断言使其永远通过"
      severity: "CRITICAL"
      response: "检测并拒绝"

  allowed_actions:
    - "修改业务代码"
    - "修改配置文件"
    - "修改环境变量"
```

### Post-Phase 2: 解锁测试目录

```yaml
post_phase2:
  action: "INVOKE unfreeze skill"
  result: "测试目录解除冻结，允许后续修改"
```

---

## 失败分析分类

| 失败类型 | 判断依据 | 处理方式 |
|----------|----------|----------|
| **BUSINESS_CODE_ERROR** | 测试正确，业务代码有 bug | 修改业务代码 |
| **TEST_DATA_ERROR** | 测试数据不符合业务逻辑 | 回滚到 Phase 1 |
| **SPECIFICATION_ERROR** | 测试正确，但 specification 有误 | ESCALATE_TO_HUMAN |
| **ENVIRONMENT_ERROR** | 环境/依赖问题 | 修复环境配置 |

### Specification 错误处理

```yaml
specification_issue_flow:
  state: "ESCALATE_SPECIFICATION_ISSUE"
  
  user_options:
    - option: "A"
      action: "修正 Specification → 重新 Phase 1"
      unfreeze_tests: true
    
    - option: "B"
      action: "确认 Specification 正确 → 修改业务代码"
      note: "用户明确授权"
    
    - option: "C"
      action: "补充 Specification 澄清歧义"
      unfreeze_tests: true
```

---

## 状态机

| State | 名称 | 说明 |
|-------|------|------|
| 0 | IDLE | 初始状态 |
| 1 | PHASE0_PREPARING | 准备阶段 |
| 2 | PHASE0_COMPLETE | 准备完成 |
| 3 | PHASE1_ALIGNING | 对齐验证中 |
| 4 | PHASE1_ALIGNMENT_ISSUES | 发现对齐问题 |
| 5 | PHASE1_FIXING_TESTS | 修复测试中 |
| 6 | PHASE1_COMPLETE | 对齐完成 |
| 7 | PRE_PHASE2_FREEZE | 冻结测试目录 |
| 8 | CHECKPOINT_VERIFIED | 检查点通过 |
| 9 | PHASE2_EXECUTING | 执行测试中 |
| 10 | PHASE2_TEST_FAILURE | 测试失败 |
| 11 | PHASE2_FAILURE_ANALYSIS | 失败分析中 |
| 12 | PHASE2_FIXING_CODE | 修复业务代码中 |
| 13 | PHASE2_SPECIFICATION_ISSUE | Specification 问题 |
| 14 | PHASE2_COMPLETE | 测试通过 |
| 15 | POST_PHASE2_UNFREEZE | 解冻测试目录 |
| 16 | ALL_TESTS_PASS | 全部通过 |

### 阻塞状态

| State | 名称 | 说明 |
|-------|------|------|
| 90 | BLOCKED_MISSING_SPECIFICATION | 缺少 specification |
| 91 | BLOCKED_ALIGNMENT_TOO_LOW | 对齐分数过低 |
| 92 | BLOCKED_TEST_MODIFICATION_VIOLATION | 测试修改违规 |
| 93 | BLOCKED_SPECIFICATION_ISSUE | Specification 问题需用户决策 |
| 94 | BLOCKED_MAX_RETRIES_EXCEEDED | 超过最大重试次数 |

---

## 与现有 Skills 集成

### 与 BUILD (TDD + review) 集成

```
BUILD (TDD + review) Round 1: Driver
├─ 输出: sealed{code, decisions} + public{tests}
└────────────────────────────────────────────┘
                    │
                    ▼
test-specification-alignment (本 skill)
├─ Phase 1: 验证 Driver 生成的 tests 与 requirements 对齐
├─ Phase 2: 执行测试验证实现
└────────────────────────────────────────────┘
                    │
                    ▼
Gate 1 (verification-loop)
├─ Static Analysis
└────────────────────────────────────────────┘
                    │
                    ▼
BUILD (TDD + review) Round 3: Arbiter
└─ 收到 test-specification-alignment 结果
```

### 与 freeze skill 集成

- Phase 2 开始前: 调用 `/freeze` 锁定测试目录
- Phase 2 执行中: freeze 拦截所有测试文件修改
- Phase 2 结束后: 调用 `/unfreeze` 解锁

---

## Agent 配置

### Phase 1 Agent

```yaml
phase1_agent:
  type: oracle
  model: Qwen3.5-Plus
  skills:
    - test-driven-development
    - coding-standards
  
  constraints:
    can_modify_tests: true
    must_preserve_test_intent: true
```

### Phase 2 Agent

```yaml
phase2_agent:
  type: build
  model: GLM-5
  skills:
    - test-driven-development
    - coding-standards
  
  constraints:
    can_modify_tests: false        # ❌ 禁止
    can_delete_tests: false        # ❌ 禁止
    can_skip_tests: false          # ❌ 禁止
    can_modify_business_code: true # ✅ 允许
```

---

## 输出报告格式

### Alignment Report (Phase 1)

```markdown
## Test-Specification Alignment Report

### Summary
- Alignment Score: 85/100
- Total Requirements: 15
- Covered Requirements: 14/15 (93%)
- Total Acceptance Criteria: 42
- Covered AC: 38/42 (90%)

### Coverage by Dimension
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Requirement Coverage | 93% | 30% | 27.9 |
| Acceptance Criteria Coverage | 90% | 25% | 22.5 |
| Test Intent Correctness | 88% | 20% | 17.6 |
| Edge Case Coverage | 80% | 15% | 12.0 |
| Test Data Validity | 90% | 10% | 9.0 |
| **Total** | | | **89.0** |

### Misaligned Tests
| Test ID | Issue | Specification Ref | Recommendation |
|---------|-------|-------------------|----------------|
| TEST-012 | Incorrect intent | REQ-AUTH-003 | 修改断言验证 |

### Missing Tests
| Requirement ID | Description | Priority |
|----------------|-------------|----------|
| REQ-AUTH-006 | Token 刷新机制 | Critical |

### Status
✅ Alignment Score >= 80%, 可以进入 Phase 2
```

### Test Execution Report (Phase 2)

```markdown
## Test Execution Report

### Summary
- Total Tests: 67
- Passed: 65
- Failed: 2
- Skipped: 0

### Failed Tests
| Test ID | Error | Root Cause | Fix Applied |
|---------|-------|------------|-------------|
| TEST-034 | AssertionError | 业务代码逻辑错误 | 已修复 |

### Freeze Status
- Pre-Phase 2: ✅ 测试目录已冻结
- Phase 2: ✅ 无违规尝试
- Post-Phase 2: ✅ 测试目录已解冻

### Status
✅ All tests pass. Ready for next stage.
```

---

## Legacy 模式

### 缺失 Specification 的 fallback

```yaml
legacy_mode:
  trigger: "specification.yaml 不存在"
  
  options:
    - option: "从测试逆向生成 specification"
      steps:
        - 解析现有测试
        - 提取测试意图和断言
        - 生成 draft specification
        - 用户确认后保存
    
    - option: "放宽对齐验证"
      rules:
        - 只验证测试覆盖率 >= 80%
        - 不验证测试意图对齐
        - 标记为 "LEGACY_MODE"
    
    - option: "用户提供 specification"
      action: "BLOCK until specification provided"
```

---

## 成本控制

| 指标 | 阈值 |
|------|------|
| 单次对齐验证 | ~$0.02 |
| 单次测试执行 | ~$0.01 |
| 最大重试次数 | 5 |
| 单次总成本上限 | $0.10 |

---

## Terminal State Checklist

<MANDATORY-CHECKLIST>

### 只能在以下条件全部满足后声明 "test-specification-alignment complete":

**Pre-requisites:**
- [ ] specification.yaml 存在且可解析
- [ ] tests/ 目录存在且有测试文件
- [ ] Phase 1 对齐验证完成

**CRITICAL - Alignment Verification:**
- [ ] Alignment Score >= 80%
- [ ] 所有 Critical 对齐问题已修复
- [ ] 所有 Major 对齐问题已处理

**CRITICAL - Phase 2 Execution:**
- [ ] freeze skill 已调用，测试目录已锁定
- [ ] 所有测试已执行
- [ ] 无测试修改违规
- [ ] unfreeze skill 已调用

**Final Requirements:**
- [ ] 所有测试通过
- [ ] 报告已生成

**IF 有 Specification 问题:**
- **CANNOT claim complete**
- **MUST ESCALATE_TO_HUMAN**

**IF Phase 2 测试修改违规:**
- **CANNOT claim complete**
- **MUST BLOCK 并记录违规**

</MANDATORY-CHECKLIST>

---

## Anti-Patterns

| 错误 | 正确 |
|------|------|
| Phase 2 修改测试文件 | ❌ 禁止 — 只能修改业务代码 |
| Phase 2 删除测试文件 | ❌ 禁止 — freeze 会拦截 |
| Phase 2 跳过测试 | ❌ 禁止 — 检测并拒绝 |
| 测试失败时修改断言 | ❌ 禁止 — 必须修改业务代码 |
| 缺少 @test 标签 | ❌ 必须 — 强制标注 |
| Specification 错误时强行通过 | ❌ 禁止 — 必须 ESCALATE |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-06 | 初始设计 |
| V2.0 | 2026-04-06 | Delphi Review 共识版本 |