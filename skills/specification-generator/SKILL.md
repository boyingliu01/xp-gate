---
name: specification-generator
description: "从已评审的设计文档生成 specification.yaml。MANDATORY after delphi-review APPROVED, before xp-consensus. TRIGGER: when delphi-review completes with APPROVED verdict, or when user requests specification generation from an approved design."
---

# Specification Generator

## 核心原则

**Specification = Requirements + Acceptance Criteria + Design Decisions + API Contracts**

**关键时机：必须在 delphi-review APPROVED 后生成，避免返工成本。**

如果设计文档未通过评审就生成 specification.yaml，后续评审发现问题需要修改设计文档，specification.yaml 也需要重新生成，造成返工。遵循"问题发现越早修复成本越低"原则，在评审通过后再生成。

---

## 触发条件

### 自动触发

- **delphi-review APPROVED 后**（设计文档已稳定，推荐时机）
- xp-consensus Round 1 开始前（检查 specification.yaml 是否存在，如缺失则 BLOCK）

### 手动触发

- `/specification-generator` 命令
- `/generate-spec` 命令

---

## ⚠️ 重要：生成时机选择

### 为什么必须在 delphi-review APPROVED 后生成？

```
❌ WRONG: brainstorming → specification-generator → delphi-review
   问题：如果 delphi-review 发现设计文档问题
        → 修改设计文档
        → specification.yaml 也需要重新生成
        → 返工成本 = 修改文档 + 重新生成 spec

✅ CORRECT: brainstorming → delphi-review APPROVED → specification-generator → xp-consensus
   优点：设计文档已经稳定（APPROVED）
        → 一次生成 specification.yaml
        → 无返工成本
```

### 流程对比

| 流程 | 返工风险 | 推荐度 |
|------|---------|--------|
| brainstorming → spec-gen → delphi-review | **高** — 设计文档修改时 spec 也需重新生成 | ❌ 不推荐 |
| delphi-review APPROVED → spec-gen → xp-consensus | **低** — 设计文档已稳定，一次生成即可 | ✅ 推荐 |

---

## 输入输出

### 输入

| 来源 | 文件 | 格式 |
|------|------|------|
| 设计文档 | `docs/plans/YYYY-MM-DD-<topic>-design.md` | Markdown |
| 用户需求 | 原始用户输入 | 自然语言 |

### 输出

| 输出 | 文件 | 格式 |
|------|------|------|
| Specification | `specification.yaml` | YAML |
| Validation Report | `specification-validation.md` | Markdown |

---

## 核心流程

```
┌─────────────────────────────────────────────────────────────┐
│           Specification Generator Flow                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 0: 输入验证                                           │
│  ├─ 检查设计文档是否存在                                      │
│  ├─ 检查用户需求是否明确                                      │
│  └─ ❌ 缺失 → BLOCK + 提示用户                               │
│                                                              │
│  Phase 1: 解析设计文档                                        │
│  ├─ 提取 Requirements                                        │
│  ├─ 提取 Acceptance Criteria                                 │
│  ├─ 提取 Design Decisions                                    │
│  ├─ 提取 API Contracts                                       │
│  └─ 提取 Edge Cases                                          │
│                                                              │
│  Phase 2: 生成 Specification                                  │
│  ├─ 转换成 YAML 格式                                         │
│  ├─ 生成 REQ-XXX-XXX ID                                      │
│  ├─ 生成 AC-XXX-XXX-XX ID                                    │
│  ├─ 添加 Gherkin 格式 (Given/When/Then)                      │
│  └─ 添加 Edge Cases 和 Security Considerations               │
│                                                              │
│  Phase 3: 验证 Specification                                  │
│  ├─ 检查必需字段完整性                                        │
│  ├─ 检查 ID 格式正确性                                        │
│  ├─ 检查 Gherkin 格式                                        │
│  ├─ ❌ 验证失败 → 返回 Phase 2 修复                          │
│  └─ ✅ 验证通过 → 继续                                       │
│                                                              │
│  Phase 4: 用户确认                                            │
│  ├─ 展示生成的 specification.yaml                            │
│  ├─ 用户确认或修改                                            │
│  ├─ 用户修改 → 返回 Phase 2                                  │
│  └─ ✅ 用户确认 → 保存                                       │
│                                                              │
│  Terminal State: ✅ SPECIFICATION_GENERATED                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Specification 必需字段

### Specification 层级

```yaml
specification:
  id: "SPEC-XXX-XXX"      # 必需，唯一标识符
  name: "模块名称"         # 必需
  version: "1.0.0"        # 必需
  
  requirements:           # 必需，至少 1 个
    - id: "REQ-XXX-001"
      description: "需求描述"
      priority: "MUST"    # 必需，MUST/SHOULD/MAY
      acceptance_criteria: # 必需，至少 1 个
        - id: "AC-XXX-001-01"
          given: "前置条件"
          when: "触发动作"
          then: "期望结果"
```

### 可选但推荐字段

```yaml
      edge_cases:           # 推荐
        - "边界条件1"
      
      security_considerations: # 推荐
        - "安全要点1"
      
      test_coverage_requirements: # 推荐
        unit: true
        integration: true
  
  design_decisions:       # 推荐
    - id: "DD-XXX-001"
      description: "设计决策"
      rationale: "决策理由"
      alternatives_considered:
        - "备选方案"
  
  api_contracts:          # 推荐（如涉及 API）
    - endpoint: "POST /api/xxx"
      request: {...}
      response: {...}
```

---

## ID 生成规则

### REQ ID 格式

```
REQ-{MODULE}-{NUMBER}
示例: REQ-AUTH-001, REQ-USER-002
```

### AC ID 格式

```
AC-{MODULE}-{REQ_NUMBER}-{AC_NUMBER}
示例: AC-AUTH-001-01, AC-AUTH-001-02
```

### DD ID 格式

```
DD-{MODULE}-{NUMBER}
示例: DD-AUTH-001, DD-AUTH-002
```

---

## 验证规则

### 必需字段验证

| 字段 | 规则 | 失败处理 |
|------|------|----------|
| `specification.id` | 必须存在，格式 SPEC-XXX-XXX | BLOCK |
| `specification.name` | 必须存在，长度 >= 3 | BLOCK |
| `specification.version` | 必须存在，格式 x.y.z | BLOCK |
| `requirements[]` | 至少 1 个 | BLOCK |
| `requirements[].id` | 格式 REQ-XXX-XXX | BLOCK |
| `requirements[].description` | 长度 >= 10 | BLOCK |
| `requirements[].priority` | MUST/SHOULD/MAY | BLOCK |
| `acceptance_criteria[]` | 至少 1 个 | BLOCK |
| `acceptance_criteria[].id` | 格式 AC-XXX-XXX-XX | BLOCK |
| `acceptance_criteria[].given` | 长度 >= 5 | BLOCK |
| `acceptance_criteria[].when` | 长度 >= 5 | BLOCK |
| `acceptance_criteria[].then` | 长度 >= 5 | BLOCK |

### 格式验证

```yaml
validation_rules:
  id_format:
    specification: "^SPEC-[A-Z]+-[0-9]+$"
    requirement: "^REQ-[A-Z]+-[0-9]+$"
    acceptance_criteria: "^AC-[A-Z]+-[0-9]+-[0-9]+$"
    design_decision: "^DD-[A-Z]+-[0-9]+$"
  
  gherkin_format:
    given: "必须描述前置条件"
    when: "必须描述触发动作"
    then: "必须描述期望结果"
```

---

## 与现有 Skills 集成

### ⭐ 正确流程：delphi-review APPROVED 后生成

```
┌─────────────────────────────────────────────────────────────┐
│           XP Workflow - Correct Specification Timing          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1: 需求探索                                           │
│  brainstorming                                               │
│  ├─ 输出: docs/plans/YYYY-MM-DD-<topic>-design.md           │
│  └────────────────────────────────────────────┘              │
│                          │                                   │
│                          ▼                                   │
│  Phase 2: 需求评审                                           │
│  delphi-review                                               │
│  ├─ 评审设计文档                                             │
│  ├─ Round 1 → Round 2 → ... → APPROVED                      │
│  │      └─ REQUEST_CHANGES → 修改 → 重新评审                │
│  └────────────────────────────────────────────┘              │
│                          │                                   │
│                          ▼                                   │
│  ⭐ Phase 3: Specification 生成 (本 skill)                   │
│  specification-generator                                     │
│  ├─ 输入: APPROVED 的设计文档                                │
│  ├─ 生成: specification.yaml                                │
│  ├─ 用户确认                                                 │
│  └────────────────────────────────────────────┘              │
│                          │                                   │
│                          ▼                                   │
│  Phase 4: 实现                                               │
│  xp-consensus                                                │
│  ├─ Driver 使用 specification.yaml 作为 requirements 输入   │
│  ├─ 输出: sealed{code} + public{tests}                       │
│  └────────────────────────────────────────────┘              │
│                          │                                   │
│                          ▼                                   │
│  Phase 5: 测试验证                                           │
│  test-specification-alignment                                │
│  ├─ Phase 1: 验证测试与 specification.yaml 对齐 ✅          │
│  ├─ Phase 2: 执行测试                                        │
│  └────────────────────────────────────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 与 delphi-review 集成 (关键集成点)

```
delphi-review Terminal State: APPROVED
    │
    ├─ 前置条件: 设计文档已通过评审
    │      ├─ APPROVED → 自动触发 specification-generator
    │      └─ REQUEST_CHANGES → 修改设计文档 → 重新评审
    │
    ▼
specification-generator (本 skill)
    ├─ 输入: docs/plans/YYYY-MM-DD-<topic>-design.md (APPROVED 版本)
    ├─ 输出: specification.yaml
    │
    ▼
用户确认 specification.yaml
    │
    ▼
xp-consensus (使用 specification.yaml 作为 requirements 输入)
```

### 与 xp-consensus 集成

```
xp-consensus Round 1 开始前 (Driver Phase)
    │
    ├─ 检查 specification.yaml 是否存在
    │      ├─ 存在 → 使用作为 requirements 输入 ✅
    │      └─ 不存在 → BLOCK + 提示先完成 delphi-review → specification-generator
    │
    ▼
Driver AI 输入:
    ├─ requirements: specification.yaml 的 requirements 部分
    ├─ acceptance_criteria: specification.yaml 的 AC 部分
    ├─ design_decisions: specification.yaml 的 DD 部分
    │
    ▼
Driver 输出:
    ├─ sealed{code, decisions}
    └─ public{tests, results}
```

### 与 test-specification-alignment 集成

```
test-specification-alignment Phase 0
    │
    ├─ 检查 specification.yaml 是否存在
    │      ├─ 存在 → 继续 Phase 1 (验证测试对齐) ✅
    │      └─ 不存在 → BLOCK + 提示先完成 delphi-review → specification-generator
    │
    ▼
Phase 1: 验证测试与 specification.yaml 对齐
    ├─ 解析 specification.yaml 的 REQ-* 和 AC-* 
    ├─ 解析测试文件的 @test 和 @covers 标签
    ├─ 验证每个 REQ-* 是否有对应测试
    ├─ 验证每个 AC-* 是否被断言覆盖
    │
    ▼
Phase 2: 执行测试 (freeze 锁定测试目录)
```

---

## Agent 配置

```yaml
agent:
  type: oracle
  model: Qwen3.5-Plus
  skills:
    - brainstorming
  
  constraints:
    must_generate_yaml: true
    must_include_all_requirements: true
    must_use_gherkin_format: true
```

---

## 输出示例

### specification.yaml

```yaml
specification:
  id: SPEC-AUTH-001
  name: User Authentication Module
  version: "1.0.0"
  
  requirements:
    - id: REQ-AUTH-001
      description: 用户使用正确的用户名和密码可以成功登录
      priority: MUST
      
      acceptance_criteria:
        - id: AC-AUTH-001-01
          given: 用户存在且密码正确
          when: 用户提交登录表单
          then: 系统返回 200 状态码和有效 JWT token
        
        - id: AC-AUTH-001-02
          given: 用户存在且密码正确
          when: 用户提交登录表单
          then: 返回的 token 过期时间 >= 1小时
      
      edge_cases:
        - 密码包含特殊字符 (@#$%^&*)
        - 并发登录请求
      
      security_considerations:
        - 密码不能明文传输
        - 使用 HTTPS
  
  design_decisions:
    - id: DD-AUTH-001
      description: 使用 JWT 进行身份认证
      rationale: 无状态，支持分布式部署
```

### specification-validation.md

```markdown
## Specification Validation Report

### Summary
- Total Requirements: 3
- Total Acceptance Criteria: 12
- Total Design Decisions: 2
- Validation Status: ✅ PASSED

### Field Validation
| Field | Status | Notes |
|-------|--------|-------|
| specification.id | ✅ | SPEC-AUTH-001 |
| specification.name | ✅ | User Authentication Module |
| requirements count | ✅ | 3 requirements |
| AC count per REQ | ✅ | REQ-AUTH-001: 4 ACs |

### ID Format Validation
| ID | Format | Status |
|----|--------|--------|
| SPEC-AUTH-001 | SPEC-[A-Z]+-[0-9]+ | ✅ |
| REQ-AUTH-001 | REQ-[A-Z]+-[0-9]+ | ✅ |
| AC-AUTH-001-01 | AC-[A-Z]+-[0-9]+-[0-9]+ | ✅ |

### Gherkin Validation
| AC ID | Given | When | Then | Status |
|-------|-------|------|------|--------|
| AC-AUTH-001-01 | ✅ | ✅ | ✅ | ✅ |
| AC-AUTH-001-02 | ✅ | ✅ | ✅ | ✅ |

### Recommendations
- 建议添加更多 edge_cases
- 建议添加 test_coverage_requirements
```

---

## 状态机

| State | 名称 | 说明 |
|-------|------|------|
| 0 | IDLE | 初始状态 |
| 1 | PHASE0_VALIDATING | 输入验证中 |
| 2 | PHASE0_COMPLETE | 输入验证通过 |
| 3 | PHASE1_PARSING | 解析设计文档中 |
| 4 | PHASE1_COMPLETE | 解析完成 |
| 5 | PHASE2_GENERATING | 生成 Specification 中 |
| 6 | PHASE2_COMPLETE | 生成完成 |
| 7 | PHASE3_VALIDATING | 验证 Specification 中 |
| 8 | PHASE3_VALIDATION_ISSUES | 验证发现问题 |
| 9 | PHASE3_COMPLETE | 验证通过 |
| 10 | PHASE4_USER_CONFIRMATION | 等待用户确认 |
| 11 | PHASE4_USER_MODIFIED | 用户修改了 Specification |
| 12 | SPECIFICATION_GENERATED | 生成完成 |
| 90 | BLOCKED_MISSING_INPUT | 缺少输入 |
| 91 | BLOCKED_VALIDATION_FAILED | 验证失败 |

---

## Terminal State Checklist

<MANDATORY-CHECKLIST>

### 只能在以下条件全部满足后声明 "specification-generator complete":

**Pre-requisites:**
- [ ] Phase 0 完成：输入验证通过
- [ ] Phase 1 完成：设计文档解析完成
- [ ] Phase 2 完成：Specification 生成完成
- [ ] Phase 3 完成：Specification 验证通过

**CRITICAL - Field Validation:**
- [ ] specification.id 存在且格式正确
- [ ] requirements 至少 1 个
- [ ] 每个 requirement 有至少 1 个 acceptance_criteria
- [ ] 每个 acceptance_criteria 有 given/when/then

**CRITICAL - User Confirmation:**
- [ ] 用户已确认 specification.yaml 内容
- [ ] specification.yaml 已保存到项目根目录

**IF 验证失败:**
- **CANNOT claim complete**
- **MUST 返回 Phase 2 修复问题**

**IF 用户修改:**
- **CANNOT claim complete**
- **MUST 返回 Phase 2 重新生成**

</MANDATORY-CHECKLIST>

---

## Anti-Patterns

| 错误 | 正确 |
|------|------|
| 生成不完整的 Specification | ❌ 必须包含所有必需字段 |
| 跳过用户确认 | ❌ 必须用户确认后才能保存 |
| ID 格式不标准 | ❌ 必须使用 REQ-XXX-XXX 格式 |
| 缺少 Gherkin 格式 | ❌ 必须使用 Given/When/Then |
| 验证失败直接保存 | ❌ 必须修复后重新验证 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-12 | 初始设计，解决 specification.yaml 缺失问题 |
| V2.0 | 2026-04-12 | **触发时机调整**：从 brainstorming 后改为 delphi-review APPROVED 后，避免返工成本 |