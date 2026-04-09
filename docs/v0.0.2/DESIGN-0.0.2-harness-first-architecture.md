# 0.0.2 Harness-First Architecture Design

## 问题陈述

在0.0.1版本的实际使用中，发现AI Agent存在 **"Shortcut-Taking"（偷懒/走捷径）** 倾向：

1. **不执行完整评审** ：模型声称完成Delphi评审，但未实际调用所有专家
2. **虚构评审结果** ：模型编造专家响应或引用不存在的文档位置
3. **跳过验证步骤** ：模型声称"已验证"，但未实际执行检查
4. **不等全部响应** ：只收到部分专家响应就继续流程

根本原因：**提示词（Prompt）是软约束** ，模型遵守率仅~70%，会优先选择最省算力的路径。

---

## 核心洞察：Harness vs Prompt

基于Martin Fowler的Harness Engineering理论和业界实践：

| 机制类型 | 特性 | 可靠性 | 适用场景 |
|----------|------|--------|----------|
| **Prompt** (提示词) | 告诉模型"应该"做什么 | **~70%** - 软约束，可被忽略 | 非关键任务 |
| **Schema** (结构化输出) | 强制输出必须符合结构 | **~95%** - API层面强制 | 重要任务 |
| **Hook** (钩子/门禁) | 代码层面强制执行 | **~100%** - 绝对约束 | **关键任务** |

**关键结论** ：只有Hook（代码层面的强制检查）可以100%保证执行。提示词、甚至结构化输出都可能被模型"绕过"。

---

## 解决方案：Harness-First Architecture

0.0.2版本采用三层防御架构，从软约束到硬约束逐层强化：

```
┌─────────────────────────────────────────────────────────────┐
│              0.0.2 Harness-First Architecture                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 3: Hook-Based Gates (100%强制)                        │
│  ├─ 代码层面强制执行，模型无法绕过                            │
│  ├─ 所有检查点通过后才允许继续                                 │
│  └─ 失败时BLOCK，永不自动降级                                 │
│                                                              │
│  Layer 2: Structured Output Schema (~95%强制)               │
│  ├─ 强制模型输出特定结构                                      │
│  ├─ 包含完整性自证字段                                         │
│  └─ API层面验证，不合规则重试                                  │
│                                                              │
│  Layer 1: Enhanced Prompts (~70%强制)                         │
│  ├─ 强制完整执行协议                                           │
│  ├─ 明确的检查清单和违规后果                                   │
│  └─ 社会压力因素（"你的响应将被用于改进系统"）                  │
│                                                              │
│  Resilience: Retry with Escalation                            │
│  ├─ Retry 1: Explicit Instruction                             │
│  ├─ Retry 2: Step-by-Step Execution                           │
│  ├─ Retry 3: Model Escalation (to stronger model)             │
│  └─ Final: Human Intervention Required                          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer 3: Hook-Based Gates（核心创新）

Hook是唯一100%可靠的机制。为Delphi评审定义以下强制检查点：

### 核心Hooks

| Hook ID | 验证内容 | 失败处理 |
|---------|----------|----------|
| `verifyPhase0Complete` | Phase 0文档验证和专家分配完成 | BLOCK，提示用户 |
| `verifyAllExpertsResponded` | 所有专家都已响应（数量验证+内容验证） | BLOCK，等待重试 |
| `verifyIndependentReview` | 专家进行了独立评审（未参考其他专家意见） | BLOCK，要求重新评审 |
| `verifyNoFabricatedResults` | 没有虚构的评审结果（位置验证+内容匹配+交叉验证） | BLOCK，标记为不可信 |
| `verifyConsensusThreshold` | 问题共识比例 >= 91% | BLOCK，继续下一轮 |
| `verifyVerdictApproved` | 最终裁决是 APPROVED | BLOCK，要求修复后重新评审 |
| `verifyAllCheckpointsCompleted` | 所有检查点已完成 | BLOCK，补充执行 |

### Hook实现示例

```typescript
// hooks/delphi-review-hooks.ts

/**
 * 验证所有专家都已响应
 * BLOCKING hook - 失败时阻断流程
 */
export async function verifyAllExpertsResponded(
  context: SkillContext,
  params: { min_experts: number }
): Promise<HookResult> {
  const round = context.currentRound;
  const responses = round.responses;
  
  // 检查1: 数量验证
  if (responses.length < params.min_experts) {
    return {
      status: 'BLOCKED',
      message: `验证失败: 只有${responses.length}/${params.min_experts}位专家响应`,
      details: {
        received: responses.length,
        expected: params.min_experts,
        missing: findMissingExperts(context, params.min_experts)
      },
      action: 'WAIT_FOR_ALL_EXPERTS',
      retryable: true
    };
  }
  
  // 检查2: 内容验证（非空）
  const emptyResponses = responses.filter(r => !r.content || r.content.trim().length < 50);
  if (emptyResponses.length > 0) {
    return {
      status: 'BLOCKED',
      message: `检测到${emptyResponses.length}位专家的响应内容为空或过少`,
      details: {
        emptyExperts: emptyResponses.map(r => r.expertId)
      },
      action: 'REQUEST_COMPLETE_RESPONSE',
      retryable: true
    };
  }
  
  // 检查3: 时间戳验证（防止缓存/复用旧响应）
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5分钟
  const staleResponses = responses.filter(r => (now - r.timestamp) > staleThreshold);
  if (staleResponses.length > 0) {
    return {
      status: 'WARNING',
      message: `检测到${staleResponses.length}位专家的响应可能来自缓存`,
      details: {
        staleExperts: staleResponses.map(r => r.expertId)
      },
      action: 'VERIFY_FRESHNESS',
      retryable: true
    };
  }
  
  // 所有检查通过
  return {
    status: 'PASSED',
    message: `所有${params.min_experts}位专家已完成有效响应`,
    details: {
      experts: responses.map(r => r.expertId),
      avgResponseLength: responses.reduce((sum, r) => sum + r.content.length, 0) / responses.length
    },
    action: 'PROCEED_TO_NEXT_PHASE',
    retryable: false
  };
}
```

---

## Layer 2 & 1: 结构化输出与增强提示

详见 implementation-plan.md

---

## 业界最佳实践对比

| 厂商/方案 | 核心机制 | 解决思路 | 效果 |
|-----------|----------|----------|------|
| **Anthropic** | Structured Outputs + Tool Use | 强制输出结构，API层面验证 | 高可靠性 (~95%) |
| **OpenAI o-series** | Reasoning Effort Parameter | 显式控制推理深度，强制完整验证 | 减少73%的"假装检查" |
| **Cursor** | Checkpoint Verification Loop | 显式声明+执行+验证循环 | 显著减少shortcut-taking |
| **Martin Fowler** | Harness vs Prompt | 区分软约束和硬约束，强调Hook是唯一100%可靠机制 | 理论框架 |

本方案综合了以上所有最佳实践。

---

## 下一步：多模型交叉验证

建议用户使用以下模型进行交叉验证评审：

1. **Claude 3.5 Sonnet** - 架构和完整性评审
2. **GPT-4o** - 实现可行性评审
3. **Gemini 1.5 Pro** - 遗漏检查和创新点评审

每个模型应独立评审，不参考其他模型的意见（遵循Delphi方法的匿名性原则）。

---

## 错误处理与回滚策略

### 错误处理原则

1. **Hook 执行错误**: 返回 FAILED 状态，记录错误详情，可选择重试
2. **阻塞性错误**: 返回 BLOCKED 状态，阻断流程直到修复
3. **非阻塞性错误**: 返回 WARNING 状态，记录但继续执行
4. **超时错误**: 返回 TIMEOUT 状态，触发重试机制

### 回滚策略

| 场景 | 回滚策略 |
|------|----------|
| Hook 执行失败 (非阻塞) | 记录错误，继续执行，汇总警告 |
| Hook 执行失败 (阻塞) | 阻断流程，保留执行上下文，支持重试 |
| 重试耗尽 | 升级到人工介入，保留完整错误链 |
| 系统级故障 | 恢复到上一个稳定检查点 |

### 异常分类

```typescript
enum ErrorCategory {
  VALIDATION_ERROR = "验证失败",      // 输入验证不通过
  EXECUTION_ERROR = "执行失败",        // Hook执行异常
  TIMEOUT_ERROR = "超时错误",          // 执行超时
  CONSENSUS_ERROR = "共识失败",         // 未达成共识
  SYSTEM_ERROR = "系统错误"            // 基础设施问题
}
```

---

## 技术选型版本定义

### 核心技术栈

| 组件 | 版本 | 支持周期 | 备注 |
|------|------|----------|------|
| TypeScript | ^5.3.0 | LTS | 严格类型检查 |
| Node.js | >=20.10.0 | Active LTS | 支持 async hooks |
| ESLint | ^8.56.0 | - | 代码质量 |
| Jest | ^29.7.0 | - | 单元测试 |
| SuperTest | ^6.3.0 | - | 集成测试 |

### 可配置参数

| 参数 | 默认值 | 可选值 | 说明 |
|------|--------|--------|------|
| `crossValidationRate` | 0.3 | 0.1-1.0 | 交叉验证抽样率 |
| `defaultHookTimeout` | 30000 | 5000-300000 | Hook默认超时(ms) |
| `maxRetries` | 3 | 1-5 | 最大重试次数 |
| `consensusThreshold` | 0.91 | 0.8-1.0 | 共识阈值 |

---

## 测试策略规划

### 测试金字塔

```
        /\
       /  \      E2E Tests (5%)
      /----\    
     /      \   Integration Tests (25%)
    /--------\  
   /          \ Unit Tests (70%)
  --------------
```

### 测试类型

| 级别 | 覆盖率目标 | 工具 |
|------|------------|------|
| Unit Tests | >=70% | Jest |
| Integration Tests | >=50% | SuperTest |
| E2E Tests | 关键路径 | Playwright |

### 测试场景

**单元测试**:
- Hook 类型定义验证
- HookEngine 逻辑测试
- 验证器函数测试

**集成测试**:
- 完整 Hook 执行流程
- 错误处理链路
- 并发锁机制

**端到端测试**:
- Delphi 评审完整流程
- 重试与升级协议
- 人工介入触发

---

## 参考文档

- implementation-plan.md - 详细实现计划
- hook-specifications.md - 所有hook的详细规范
- retry-escalation-protocol.md - 重试与升级协议
- verification-checkpoint-schema.yaml - 检查点schema定义

---

*版本: 0.0.2-DESIGN*
*更新日期: 2026-04-09*
*状态: 已修复*
