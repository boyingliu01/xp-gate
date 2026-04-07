# Test-Specification Alignment Skill - 设计方案 V2.0

## 版本: V2.0
## 日期: 2026-04-06
## 变更: 修复 Delphi Review V1 的 3 个 Critical Issues

---

## V1.0 → V2.0 变更说明

| # | Critical Issue | V2.0 修复 |
|---|----------------|-----------|
| **C1** | Phase 2 约束是检测不是阻断 | **集成 freeze skill，主动锁定测试目录** |
| **C2** | Specification 错误场景缺失 | **添加 Specification 修正分支 + ESCALATE_TO_HUMAN 状态** |
| **C3** | 对齐依赖 LLM 语义理解 | **定义结构化 Specification 格式 + 强制映射规则** |

---

## 1. 核心修复：Phase 2 约束执行机制

### 1.1 问题 (V1.0)

> Skill 是指导性文档，无法拦截 Agent 的 Edit/Write 工具调用。
> "检测后 BLOCK" 是被动响应，修改已经发生。

### 1.2 解决方案：freeze skill 集成

```yaml
phase2_constraint_enforcement:
  # Phase 2 开始前的主动冻结
  before_phase2:
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
      mode: "strict"  # 任何测试文件修改都阻断
    
    result:
      - "测试目录被 freeze skill 锁定"
      - "Agent 的 Edit/Write 调用被预拦截"
      - "无需事后检测哈希变化"
  
  # Phase 2 执行中的约束
  during_phase2:
    freeze_active: true
    violation_response:
      - "freeze skill 返回 BLOCKED_ERROR"
      - "Agent 收到明确错误: '测试文件被锁定，Phase 2 禁止修改'"
      - "记录违规日志"
      - "通知用户（如果 Agent 尝试绕过）"
  
  # Phase 2 结束后的解冻
  after_phase2:
    action: "INVOKE unfreeze skill"
    result: "测试目录解除冻结，允许后续修改"
```

### 1.3 流程图更新

```
┌─────────────────────────────────────────────────────────────┐
│           Phase 2 with freeze skill Integration             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1 Complete                                            │
│  ├─ Alignment Score >= 80%                                   │
│  └─ Tests aligned to specification                           │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ⭐ Pre-Phase 2: Activate Freeze                      │    │
│  │                                                      │    │
│  │ CALL: /freeze                                        │    │
│  │ ARGS: tests/, *.test.*, *_test.*                    │    │
│  │                                                      │    │
│  │ Result:                                              │    │
│  │ ├─ 测试目录被锁定                                    │    │
│  │ ├─ Edit/Write 调用被预拦截                          │    │
│  │ └─ 返回: "✅ 测试文件已冻结"                          │    │
│  └────────────────────────────────────────────────┘         │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Phase 2: Execute Tests                               │    │
│  │                                                      │    │
│  │ IF Agent 尝试 Edit/Write 测试文件:                  │    │
│  │   ├─ freeze skill 预拦截                            │    │
│  │   ├─ 返回错误: "BLOCKED: 测试文件已冻结"            │    │
│  │   ├─ Agent 只能修改业务代码                         │    │
│  │   └─ 无需事后检测                                   │    │
│  │                                                      │    │
│  │ Tests Pass?                                          │    │
│  │ ├─ YES → CALL: /unfreeze → DONE                     │    │
│  │ └─ NO → 分析失败原因                                │    │
│  └────────────────────────────────────────────────┘         │
│                          │                                   │
│                          ▼                                   │
│  失败分析分支 (见 1.4)                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 核心修复：Specification 错误场景处理

### 2.1 问题 (V1.0)

> 设计假设 Specification 正确，测试失败 = 业务代码问题。
> 如果测试失败揭示的是 Specification 错误，形成死锁。

### 2.2 解决方案：失败原因分类 + 分支处理

```yaml
phase2_failure_analysis:
  # 失败原因分类
  failure_categories:
    - category: "BUSINESS_CODE_ERROR"
      indicators:
        - "测试意图正确"
        - "业务代码逻辑有 bug"
        - "业务代码未实现功能"
      action: "修改业务代码"
      allowed: true
    
    - category: "TEST_DATA_ERROR"
      indicators:
        - "测试数据不符合业务逻辑"
        - "mock 数据与实际不一致"
      action: "需要回到 Phase 1 修正测试数据"
      allowed: false  # Phase 2 不允许，需要重启
      next_state: "ROLLBACK_TO_PHASE1"
    
    - category: "SPECIFICATION_ERROR"
      indicators:
        - "测试正确反映 specification"
        - "但 specification 本身有错误/遗漏"
        - "业务代码实际是正确的"
      action: "需要修正 specification"
      allowed: false
      next_state: "ESCALATE_SPECIFICATION_ISSUE"
    
    - category: "ENVIRONMENT_ERROR"
      indicators:
        - "测试环境配置问题"
        - "依赖服务不可用"
        - "网络/数据库连接问题"
      action: "修复环境配置，不修改代码"
      allowed: true

  # Specification 问题处理流程
  specification_issue_flow:
    state: "ESCALATE_SPECIFICATION_ISSUE"
    
    steps:
      - step: 1
        action: "生成 Specification Issue Report"
        content:
          - "失败的测试"
          - "测试期望行为"
          - "业务代码实际行为"
          - "Specification 可能的问题"
      
      - step: 2
        action: "BLOCK Phase 2"
        reason: "Specification 可能有问题，需要人工确认"
      
      - step: 3
        action: "通知用户"
        message: |
          ⚠️ 检测到可能的 Specification 问题
          
          测试: [test_name]
          期望: [expected behavior from specification]
          实际: [actual behavior from business code]
          
          可能原因:
          1. Specification 描述有误
          2. 需求已变更但 Specification 未更新
          3. 业务场景理解偏差
          
          用户选项:
          A. 修正 Specification → 重新 Phase 1
          B. 确认 Specification 正确 → 修改业务代码
          C. 补充 Specification → 阐明歧义
      
      - step: 4
        action: "等待用户决策"
        options:
          - user_choice: "A"
            next_state: "PHASE0_SPECIFICATION_UPDATE"
            unfreeze_tests: true
          
          - user_choice: "B"
            next_state: "PHASE2_FIX_BUSINESS_CODE"
            note: "用户确认 Specification 正确"
          
          - user_choice: "C"
            next_state: "PHASE0_SPECIFICATION_CLARIFY"
            unfreeze_tests: true
```

### 2.3 状态机扩展

```
State 0: IDLE
State 1: PHASE0_PREPARING
State 2: PHASE0_COMPLETE
State 3: PHASE1_ALIGNING
State 4: PHASE1_ALIGNMENT_ISSUES_FOUND
State 5: PHASE1_FIXING_TESTS
State 6: PHASE1_COMPLETE
State 7: PRE_PHASE2_FREEZE          # ⭐ 新增
State 8: CHECKPOINT_ALIGNMENT_VERIFIED
State 9: PHASE2_EXECUTING_TESTS
State 10: PHASE2_TEST_FAILURE
State 11: PHASE2_FAILURE_ANALYSIS    # ⭐ 新增
State 12: PHASE2_FIXING_BUSINESS_CODE
State 13: PHASE2_SPECIFICATION_ISSUE  # ⭐ 新增
State 14: PHASE2_COMPLETE
State 15: POST_PHASE2_UNFREEZE       # ⭐ 新增
State 16: ALL_TESTS_PASS

# 阻塞状态
State 90: BLOCKED_MISSING_SPECIFICATION
State 91: BLOCKED_ALIGNMENT_TOO_LOW
State 92: BLOCKED_TEST_MODIFICATION_VIOLATION
State 93: BLOCKED_SPECIFICATION_ISSUE    # ⭐ 新增
State 94: BLOCKED_MAX_RETRIES_EXCEEDED
```

---

## 3. 核心修复：结构化 Specification 格式

### 3.1 问题 (V1.0)

> 对齐验证依赖 LLM 语义理解，结果不确定。
> "提取 requirements" 是 mental construct，不是实际数据结构。

### 3.2 解决方案：强制结构化 Specification 格式

```yaml
structured_specification:
  # Specification 文件格式要求
  format: "YAML 或 Markdown with structured frontmatter"
  
  # 示例: specification.yaml
  example: |
    specification:
      id: "SPEC-AUTH-001"
      name: "User Authentication Module"
      version: "1.0.0"
      
      requirements:
        - id: "REQ-AUTH-001"
          description: "用户使用正确的用户名和密码可以成功登录"
          priority: "MUST"
          acceptance_criteria:
            - id: "AC-AUTH-001-01"
              given: "用户存在且密码正确"
              when: "用户提交登录表单"
              then: "系统返回 200 状态码和有效 JWT token"
            - id: "AC-AUTH-001-02"
              given: "用户存在且密码正确"
              when: "用户提交登录表单"
              then: "token 过期时间 >= 1小时"
          
          edge_cases:
            - "密码包含特殊字符"
            - "用户名包含空格"
            - "并发登录请求"
          
          security_considerations:
            - "密码不能明文传输"
            - "登录失败不暴露用户是否存在"
        
        - id: "REQ-AUTH-002"
          description: "用户使用错误的密码登录失败"
          priority: "MUST"
          acceptance_criteria:
            - id: "AC-AUTH-002-01"
              given: "用户存在但密码错误"
              when: "用户提交登录表单"
              then: "系统返回 401 状态码"
            - id: "AC-AUTH-002-02"
              given: "密码错误次数 >= 3"
              when: "用户尝试登录"
              then: "账户被锁定 15 分钟"
      
      design_decisions:
        - id: "DD-AUTH-001"
          description: "使用 JWT 进行身份认证"
          rationale: "无状态，支持分布式部署"
        - id: "DD-AUTH-002"
          description: "密码使用 bcrypt 哈希存储"
          rationale: "安全性高，计算成本可调"
      
      api_contracts:
        - endpoint: "POST /api/auth/login"
          request:
            body:
              username: "string"
              password: "string"
          response:
            success:
              status: 200
              body:
                token: "string"
                expiresIn: "number"
            failure:
              status: 401
              body:
                error: "string"
```

### 3.3 强制映射规则

```yaml
mandatory_mapping:
  # 每个 requirement 必须有测试
  requirement_to_test:
    rule: "每个 REQ-* 必须对应至少一个 test case"
    format: "test name 包含 REQ ID 或注释标注"
    example: |
      // TEST: REQ-AUTH-001 - 用户成功登录
      test('REQ-AUTH-001: user can login with correct credentials', () => {
        // test body
      });
  
  # 每个 acceptance criteria 必须有断言
  ac_to_assertion:
    rule: "每个 AC-* 必须有对应断言"
    format: "断言注释标注 AC ID"
    example: |
      // AC-AUTH-001-01: 返回 200 和 token
      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
  
  # 测试意图必须明确声明
  test_intent_declaration:
    rule: "每个 test case 必须有意图声明"
    format: "JSDoc 注释"
    example: |
      /**
       * @test REQ-AUTH-001
       * @intent 验证用户使用正确凭据可以成功登录
       * @covers AC-AUTH-001-01, AC-AUTH-001-02
       * @edge_cases password_with_special_chars, username_with_spaces
       */
      test('REQ-AUTH-001: login success', () => { ... });
```

### 3.4 对齐验证算法

```typescript
interface AlignmentVerifier {
  // Step 1: 解析 Specification (确定性)
  parseSpecification(specPath: string): SpecificationMap {
    // 使用 YAML parser，不依赖 LLM
    const spec = yaml.parse(fs.readFileSync(specPath));
    
    return {
      requirements: spec.requirements.map(r => ({
        id: r.id,
        acceptanceCriteria: r.acceptance_criteria.map(ac => ac.id),
        edgeCases: r.edge_cases || []
      })),
      designDecisions: spec.design_decisions.map(d => d.id),
      apiContracts: spec.api_contracts.map(a => a.endpoint)
    };
  }
  
  // Step 2: 解析测试文件 (确定性)
  parseTestFiles(testPaths: string[]): TestMap {
    // 使用 AST parser，提取注释中的 @test, @covers 标注
    const tests = [];
    
    for (const path of testPaths) {
      const ast = parseTypeScript(fs.readFileSync(path));
      const testNodes = findTestNodes(ast);
      
      for (const node of testNodes) {
        const jsdoc = extractJSDoc(node);
        tests.push({
          name: node.name,
          requirementId: extractTag(jsdoc, '@test'),
          intent: extractTag(jsdoc, '@intent'),
          covers: extractTags(jsdoc, '@covers'),
          edgeCases: extractTags(jsdoc, '@edge_cases')
        });
      }
    }
    
    return { tests };
  }
  
  // Step 3: 对齐验证 (确定性规则)
  verifyAlignment(specMap: SpecificationMap, testMap: TestMap): AlignmentReport {
    const issues: Issue[] = [];
    
    // 规则 1: 每个 requirement 必须有测试
    for (const req of specMap.requirements) {
      const hasTest = testMap.tests.some(t => t.requirementId === req.id);
      if (!hasTest) {
        issues.push({ type: 'MISSING_TEST', requirementId: req.id, severity: 'Critical' });
      }
    }
    
    // 规则 2: 每个 AC 必须有断言覆盖
    for (const req of specMap.requirements) {
      for (const acId of req.acceptanceCriteria) {
        const hasCoverage = testMap.tests.some(t => t.covers.includes(acId));
        if (!hasCoverage) {
          issues.push({ type: 'MISSING_AC_COVERAGE', acId, severity: 'Major' });
        }
      }
    }
    
    // 规则 3: 每个 edge case 必须有测试
    for (const req of specMap.requirements) {
      for (const edgeCase of req.edgeCases) {
        const hasTest = testMap.tests.some(t => t.edgeCases.includes(edgeCase));
        if (!hasTest) {
          issues.push({ type: 'MISSING_EDGE_CASE', edgeCase, severity: 'Minor' });
        }
      }
    }
    
    return { issues, score: calculateScore(issues) };
  }
}
```

---

## 4. 测试类型差异化处理

### 4.1 测试类型定义

```yaml
test_types:
  unit_test:
    description: "验证单个函数/方法的行为"
    alignment_target: "函数签名 + 行为规范"
    file_pattern: "*.test.ts, *.spec.ts"
    
  integration_test:
    description: "验证组件/模块间的交互"
    alignment_target: "API 契约 + 组件接口"
    file_pattern: "*.integration.test.ts"
    
  e2e_test:
    description: "验证完整的用户场景"
    alignment_target: "User Journey + Business Workflow"
    file_pattern: "*.e2e.test.ts, cypress/**"
```

### 4.2 差异化验证规则

```yaml
type_specific_rules:
  unit_test:
    # 单元测试必须对应函数
    mapping: "test → function name"
    required:
      - "函数名在测试文件名或描述中"
    not_required:
      - "API endpoint 覆盖"
      - "数据库集成"
  
  integration_test:
    # 集成测试必须对应 API 或组件接口
    mapping: "test → API endpoint 或 component interface"
    required:
      - "API endpoint 在测试中明确"
      - "请求/响应结构验证"
    not_required:
      - "UI 渲染"
  
  e2e_test:
    # E2E 测试必须对应 User Journey
    mapping: "test → user story"
    required:
      - "用户操作步骤"
      - "最终状态验证"
    not_required:
      - "内部实现细节"
```

---

## 5. 完整流程图 (V2.0)

```
┌─────────────────────────────────────────────────────────────┐
│           Test-Specification Alignment Flow V2.0             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 0: 准备                                               │
│  ├─ 验证 specification.yaml 存在                             │
│  ├─ 验证 tests/ 目录存在                                     │
│  ├─ ❌ 缺失 → BLOCK + 通知用户                               │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│                          ▼                                   │
│  Phase 1: 对齐验证 (可修改测试)                               │
│  ├─ Step 1: 解析 specification.yaml (YAML parser)           │
│  ├─ Step 2: 解析测试文件 (AST parser)                        │
│  ├─ Step 3: 运行对齐验证规则                                 │
│  ├─ Step 4: 生成 Alignment Report                           │
│  ├─ Step 5: (可选) 修复测试                                  │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│                          ▼                                   │
│  Checkpoint: Alignment Score >= 80%?                         │
│  ├─ NO → BLOCK + 用户决定                                    │
│  └─ YES → 继续                                               │
│                          │                                   │
│                          ▼                                   │
│  ⭐ Pre-Phase 2: 调用 /freeze 锁定测试目录                    │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│                          ▼                                   │
│  Phase 2: 执行测试 (禁止修改测试)                             │
│  ├─ 执行所有测试                                             │
│  ├─ IF Agent 尝试修改测试 → freeze 拦截 → 错误               │
│  │                                                          │
│  │  失败分析:                                                │
│  │  ├─ BUSINESS_CODE_ERROR → 修改业务代码                   │
│  │  ├─ TEST_DATA_ERROR → 回滚到 Phase 1                     │
│  │  ├─ SPECIFICATION_ERROR → ESCALATE_TO_HUMAN              │
│  │  └─ ENVIRONMENT_ERROR → 修复环境                         │
│  │                                                          │
│  └─ 全部通过 → 继续                                          │
│                          │                                   │
│                          ▼                                   │
│  ⭐ Post-Phase 2: 调用 /unfreeze 解锁测试目录                 │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│                          ▼                                   │
│  Terminal State: ✅ ALL_TESTS_PASS                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 与 xp-consensus 集成 (TDD 兼容)

### 6.1 问题澄清

V1.0 被质疑"与 TDD 流程冲突"，实际是两个不同场景：

| 场景 | xp-consensus (TDD) | test-specification-alignment |
|------|-------------------|------------------------------|
| **时机** | 实现前 (先写测试) | 实现后 (验证对齐) |
| **目的** | 驱动实现 | 验证测试正确性 |
| **测试来源** | Driver AI 生成 | 已有测试 |
| **关系** | 前置 | 后置验证 |

### 6.2 正确集成流程

```
┌─────────────────────────────────────────────────────────────┐
│           xp-consensus + test-specification-alignment        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  xp-consensus Round 1: Driver                                │
│  ├─ 输入: Requirements                                       │
│  ├─ 输出: sealed{code, decisions} + public{tests}           │
│  │   (TDD: tests 先于 code 或同时)                          │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│                          ▼                                   │
│  test-specification-alignment (新增)                         │
│  ├─ Phase 1: 验证 Driver 生成的 tests 与 requirements 对齐   │
│  │   (TDD 场景下，这是验证 Driver 的测试质量)               │
│  ├─ Phase 2: 执行测试                                        │
│  │   (TDD 场景下，这是执行 Driver 的测试来验证实现)         │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│                          ▼                                   │
│  Gate 1 (verification-loop)                                  │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│                          ▼                                   │
│  xp-consensus Round 3: Arbiter                               │
│  ├─ 收到: test-specification-alignment 结果                 │
│  │   (Arbiter 知道测试已对齐且通过)                          │
│  └────────────────────────────────────────────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Legacy 代码处理策略

### 7.1 缺失 Specification 的场景

```yaml
legacy_fallback:
  # 如果没有 specification.yaml
  missing_specification:
    option_1: "从测试逆向生成 specification"
      steps:
        - 解析现有测试
        - 提取测试意图和断言
        - 生成 draft specification
        - 用户确认后保存
    
    option_2: "放宽对齐验证"
      rules:
        - 只验证测试覆盖率 (line/branch/function)
        - 不验证测试意图对齐
        - 标记为 "LEGACY_MODE"
    
    option_3: "用户提供 specification"
      action: "BLOCK until specification provided"
```

### 7.2 Legacy 模式状态

```yaml
legacy_mode:
  state: "LEGACY_ALIGNMENT"
  
  validation:
    - "测试覆盖率 >= 80%"
    - "无跳过的测试"
    - "无重复的测试"
  
  not_validated:
    - "测试意图对齐"
    - "AC 覆盖"
    - "Edge case 覆盖"
  
  report:
    warning: "⚠️ Legacy 模式运行，缺少 Specification 对齐验证"
```

---

## 8. 已解决的设计决策

| # | 问题 | V1.0 状态 | V2.0 决策 |
|---|------|----------|----------|
| Q1 | 对齐分数阈值 | 待定 | **80%** |
| Q2 | Phase 1 自动修复 | 待定 | **用户确认后修复** |
| Q3 | 最大重试次数 | 待定 | **5 次** |
| Q4 | 测试意图表达 | 待定 | **JSDoc 注释 + @test/@covers/@intent 标签** |
| Q5 | Legacy 测试处理 | 待定 | **Legacy 模式 + 放宽验证** |

---

## 9. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-06 | 初始设计方案 |
| **V2.0** | 2026-04-06 | **修复 Delphi Review V1 Critical Issues** |
| | | - C1: 集成 freeze skill 实现主动约束 |
| | | - C2: 添加 Specification 错误处理分支 |
| | | - C3: 定义结构化 Specification 格式 |
| | | - 新增: 测试类型差异化处理 |
| | | - 新增: TDD 集成说明 |
| | | - 新增: Legacy 代码处理策略 |