# Phase 2 约束执行机制

## 核心原则

**Phase 2 使用 freeze skill 主动锁定测试目录，而非事后检测。**

---

## freeze skill 集成

### Pre-Phase 2: 锁定测试目录

```yaml
step: "pre_phase2_freeze"
action: "INVOKE freeze skill"
timing: "Phase 1 完成，Alignment Score >= 80% 之后"

parameters:
  freeze_boundary:
    # 测试目录
    - "tests/"
    - "test/"
    - "__tests__/"
    - "spec/"
    - "cypress/"
    - "playwright/"
    
    # 测试文件模式
    - "*.test.ts"
    - "*.test.tsx"
    - "*.test.js"
    - "*.test.jsx"
    - "*.spec.ts"
    - "*.spec.tsx"
    - "*.spec.js"
    - "*.spec.jsx"
    - "*_test.py"
    - "*_test.go"
    - "test_*.py"
    - "*_test.rb"
    
    # Mock/fixture 文件 (可选)
    - "**/__mocks__/**"
    - "**/__fixtures__/**"
    - "**/fixtures/**"
  
  mode: "strict"
  error_message: |
    ❌ TEST FILE MODIFICATION BLOCKED
    
    Phase 2 禁止修改测试文件。
    测试目录已被 freeze skill 锁定。
    
    允许的操作:
    - 修改业务代码
    - 修改配置文件
    
    如果需要修改测试，请:
    1. 先完成 Phase 2
    2. 或者请求用户授权退出 Phase 2
```

### OpenCode 调用方式

```typescript
// 在 OpenCode 环境中调用 freeze skill
async function prePhase2Freeze(): Promise<void> {
  const freezeBoundary = [
    "tests/",
    "test/",
    "__tests__/",
    "*.test.ts",
    "*.test.js",
    "*.spec.ts",
    "*.spec.js",
    "*_test.py",
    "*_test.go"
  ].join(",");
  
  // 调用 freeze skill
  await skill({
    name: "freeze",
    user_message: freezeBoundary
  });
  
  // 记录状态
  state = "PRE_PHASE2_FREEZE";
  log("✅ 测试目录已冻结，Phase 2 约束生效");
}
```

---

## Phase 2 执行期间的约束

### 约束规则

```yaml
phase2_constraints:
  # 禁止的操作
  forbidden:
    - operation: "EDIT"
      target_pattern: "test/**, *.test.*, *.spec.*, *_test.*"
      response: "BLOCK"
      error_code: "TEST_EDIT_BLOCKED"
      
    - operation: "WRITE"
      target_pattern: "test/**, *.test.*, *.spec.*, *_test.*"
      response: "BLOCK"
      error_code: "TEST_WRITE_BLOCKED"
      
    - operation: "DELETE"
      target_pattern: "test/**, *.test.*, *.spec.*, *_test.*"
      response: "BLOCK"
      error_code: "TEST_DELETE_BLOCKED"
    
    - operation: "EDIT"
      detection_pattern: "test\\.skip|\\.skip\\(|xit\\(|@skip"
      response: "BLOCK"
      error_code: "TEST_SKIP_BLOCKED"
  
  # 允许的操作
  allowed:
    - operation: "EDIT"
      target_pattern: "src/**, app/**, lib/**"
      response: "ALLOW"
      
    - operation: "WRITE"
      target_pattern: "src/**, app/**, lib/**"
      response: "ALLOW"
      
    - operation: "EDIT"
      target_pattern: "*.config.*, *.json, *.yaml"
      response: "ALLOW"
```

### 违规检测

```typescript
interface ViolationAttempt {
  timestamp: Date;
  operation: 'EDIT' | 'WRITE' | 'DELETE';
  target: string;
  blocked: boolean;
  agentId: string;
}

const violationLog: ViolationAttempt[] = [];

// freeze skill 会自动拦截，但我们也记录日志
function logViolation(attempt: ViolationAttempt): void {
  violationLog.push(attempt);
  
  // 如果有多次违规尝试，升级警告
  const recentViolations = violationLog.filter(
    v => Date.now() - v.timestamp.getTime() < 60000
  );
  
  if (recentViolations.length >= 3) {
    escalateToHuman({
      severity: "CRITICAL",
      message: "Agent 多次尝试修改测试文件",
      violations: recentViolations
    });
  }
}
```

---

## Post-Phase 2: 解锁测试目录

```yaml
step: "post_phase2_unfreeze"
action: "INVOKE unfreeze skill"
timing: "Phase 2 完成，所有测试通过之后"
```

```typescript
async function postPhase2Unfreeze(): Promise<void> {
  // 调用 unfreeze skill
  await skill({
    name: "unfreeze",
    user_message: ""
  });
  
  state = "POST_PHASE2_UNFREEZE";
  log("✅ 测试目录已解冻，恢复正常编辑");
}
```

---

## 异常情况处理

### 测试失败需要修改测试数据

```yaml
scenario: "test_data_error"
condition: "测试失败原因是测试数据问题，而非业务代码"

flow:
  - step: 1
    action: "分析失败原因"
    output: "TEST_DATA_ERROR"
  
  - step: 2
    action: "BLOCK Phase 2"
    message: "测试数据问题需要回到 Phase 1 修复"
  
  - step: 3
    action: "调用 unfreeze skill"
    reason: "需要修改测试数据"
  
  - step: 4
    action: "状态回退到 PHASE1_FIXING_TESTS"
  
  - step: 5
    action: "修复测试数据"
  
  - step: 6
    action: "重新执行 Phase 1 → Phase 2 流程"
```

### Specification 问题需要用户确认

```yaml
scenario: "specification_error"
condition: "测试失败揭示 Specification 问题"

flow:
  - step: 1
    action: "分析失败原因"
    output: "SPECIFICATION_ERROR"
  
  - step: 2
    action: "生成 Specification Issue Report"
    content:
      - 失败的测试名称
      - 测试期望行为
      - 业务代码实际行为
      - 可能的 Specification 问题
  
  - step: 3
    action: "BLOCK Phase 2"
    state: "BLOCKED_SPECIFICATION_ISSUE"
  
  - step: 4
    action: "通知用户并提供选项"
    options:
      A: "修正 Specification → 重新 Phase 1"
      B: "确认 Specification 正确 → 修改业务代码"
      C: "补充 Specification 澄清"
  
  - step: 5
    action: "等待用户决策"
    # 用户选择 A 或 C: unfreeze → Phase 1
    # 用户选择 B: 继续 Phase 2 修改业务代码
```

### 最大重试次数超出

```yaml
scenario: "max_retries_exceeded"
condition: "Phase 2 重试次数超过 5 次"

flow:
  - step: 1
    action: "BLOCK"
    state: "BLOCKED_MAX_RETRIES_EXCEEDED"
  
  - step: 2
    action: "调用 unfreeze skill"
  
  - step: 3
    action: "通知用户"
    message: |
      ⚠️ Phase 2 已重试 5 次仍未通过所有测试
      
      最后失败的测试: [test_names]
      
      可能的原因:
      1. 业务代码存在难以修复的问题
      2. 测试环境配置问题
      3. Specification 与实际需求不符
      
      用户选项:
      A. 手动排查问题
      B. 暂时跳过失败的测试 (需要确认风险)
      C. 重新设计实现方案
```

---

## 状态转换图

```
┌─────────────────────────────────────────────────────────────┐
│              Phase 2 Constraint State Machine                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  PHASE1_COMPLETE                                             │
│  ├─ Alignment Score >= 80%                                   │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│                          ▼                                   │
│  PRE_PHASE2_FREEZE                                           │
│  ├─ 调用 freeze skill                                        │
│  ├─ 记录冻结边界                                             │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│                          ▼                                   │
│  PHASE2_EXECUTING_TESTS                                      │
│  ├─ 运行测试                                                 │
│  ├─ IF 违规 → freeze 拦截 → 记录日志                         │
│  └────────────────────────────────────────────────┘          │
│                          │                                   │
│              ┌───────────┴───────────┐                       │
│              │                       │                       │
│          全部通过              测试失败                       │
│              │                       │                       │
│              ▼                       ▼                       │
│  PHASE2_COMPLETE         PHASE2_FAILURE_ANALYSIS             │
│  ├─ 调用 unfreeze        ├─ 分析失败原因                    │
│  └────────────────────────────────────────────────┘          │
│                                      │                       │
│                          ┌───────────┼───────────┐           │
│                          │           │           │           │
│                     业务代码    测试数据    Specification     │
│                      错误       错误          问题           │
│                          │           │           │           │
│                          ▼           ▼           ▼           │
│                    修复代码    ROLLBACK    BLOCKED           │
│                    重试测试    到 Phase1   SPEC_ISSUE        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 违规日志格式

```yaml
violation_log:
  session_id: "session-xxx"
  phase: "PHASE2_EXECUTING_TESTS"
  
  violations:
    - timestamp: "2026-04-06T10:30:00Z"
      operation: "EDIT"
      target: "tests/auth/login.test.ts"
      blocked: true
      agent_action: "尝试修改测试断言"
      response: "BLOCKED: 测试文件已冻结"
    
    - timestamp: "2026-04-06T10:31:00Z"
      operation: "WRITE"
      target: "tests/auth/new-test.test.ts"
      blocked: true
      agent_action: "尝试创建新测试文件"
      response: "BLOCKED: 测试目录已冻结"
  
  summary:
    total_attempts: 2
    all_blocked: true
    escalated_to_human: false
```

---

## 与 freeze skill 的契约

### freeze skill 职责

1. 接收冻结边界参数
2. 拦截所有匹配边界的 Edit/Write/Delete 操作
3. 返回明确的错误信息
4. 记录所有拦截尝试

### test-specification-alignment skill 职责

1. 在正确时机调用 freeze/unfreeze
2. 提供完整的冻结边界列表
3. 处理 freeze 返回的错误
4. 记录违规日志
5. 在异常情况下正确解除冻结

---

## 测试验证

```typescript
// 验证 freeze 集成是否正确
async function testFreezeIntegration(): Promise<void> {
  // 1. 调用 freeze
  await prePhase2Freeze();
  
  // 2. 尝试编辑测试文件 (应该被拦截)
  try {
    await edit({
      filePath: "tests/auth/login.test.ts",
      oldString: "test content",
      newString: "modified content"
    });
    throw new Error("freeze 未正确拦截编辑操作");
  } catch (error) {
    if (!error.message.includes("BLOCKED")) {
      throw new Error("freeze 返回的错误信息不正确");
    }
  }
  
  // 3. 尝试编辑业务代码 (应该成功)
  await edit({
    filePath: "src/auth/service.ts",
    oldString: "old code",
    newString: "new code"
  });
  
  // 4. 调用 unfreeze
  await postPhase2Unfreeze();
  
  // 5. 再次尝试编辑测试文件 (应该成功)
  await edit({
    filePath: "tests/auth/login.test.ts",
    oldString: "test content",
    newString: "modified content"
  });
  
  console.log("✅ freeze 集成验证通过");
}
```