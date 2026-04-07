# Arbitration Logic

## 概述

仲裁器负责在两个专家评审后做出最终决策。决策基于：
- 专家的 verdict（APPROVED/REQUEST_CHANGES）
- 专家的 confidence（0-10）
- 发现问题的严重程度分布
- 预定义的共识规则

## 决策树

```
                          ┌─────────────────────┐
                          │  开始仲裁           │
                          └──────────┬──────────┘
                                     │
                                     ▼
                    ┌──────────────────────────────┐
                    │ 检查 Critical Issues        │
                    └──────────┬───────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ▼                             ▼
        critical > 0                   critical = 0
                │                             │
                ▼                             ▼
    ┌───────────────────┐      ┌─────────────────────────┐
    │ REQUEST_CHANGES   │      │ 检查 Major Issues       │
    │ (Critical 阻塞)   │      └──────────┬──────────────┘
    └───────────────────┘                 │
                                        ┌────┴────┐
                                        │         │
                                        ▼         ▼
                                major > 3    major ≤ 3
                                        │         │
                                        ▼         ▼
                            ┌─────────────────┐  ┌─────────────────┐
                            │ 检查专家共识   │  │ 检查专家共识   │
                            └────────┬────────┘  └────────┬────────┘
                                     │                    │
               ┌─────────────────────┼────────────────────┼────────────┐
               │                     │                    │            │
               ▼                     ▼                    ▼            ▼
    全部 APPROVED        部分 APPROVED      全部 REQUEST_CHANGES  置信度低
               │                     │                    │            │
               ▼                     ▼                    ▼            ▼
    ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
    │ 计算综合置信度  │  │ 检查置信度差距 │  │ REQUEST_CHANGES │  │ ESCALATE_TO_    │
    └────────┬────────┘  └────────┬────────┘  │ (全员拒绝)       │  │ HUMAN           │
             │                    │           └─────────────────┘  └─────────────────┘
             │                    │
       ┌─────┴─────┐        ┌─────┴─────┐
       │           │        │           │
       ▼           ▼        ▼           ▼
   conf ≥ 7    conf < 7   gap > 3    gap ≤ 3
       │           │        │           │
       ▼           ▼        ▼           ▼
┌──────────┐  ┌──────────┐ ┌──────────┐ ┌──────────┐
│ APPROVED │  │ ESCALATE ││ ESCALATE ││ APPROVED │
└──────────┘  │ TO_      ││ TO_      │└──────────┘
             │ HUMAN    ││ HUMAN    │
             └──────────┘└──────────┘
```

## 决策路径

### P1: Critical Issues 阻塞

```typescript
if (criticalIssuesCount > 0) {
  return {
    decision: 'REQUEST_CHANGES',
    reason: '存在 Critical 级别问题，必须修复后重新评审',
    issues: allCriticalIssues
  };
}
```

**说明**: 任何 Critical 问题都会导致 REQUEST_CHANGES，无需继续检查其他条件。

### P2: Major Issues 过多

```typescript
if (majorIssuesCount > MAJOR_ISSUES_THRESHOLD) {
  // 检查是否全部专家都拒绝
  if (expertA.verdict === 'REQUEST_CHANGES' &&
      expertB.verdict === 'REQUEST_CHANGES') {
    return {
      decision: 'REQUEST_CHANGES',
      reason: `发现 ${majorIssuesCount} 个 Major 问题，全部专家拒绝`,
      issues: allMajorIssues
    };
  }

  // 否则检查专家共识
  return checkExpertConsensus();
}
```

**说明**: 如果 Major 问题超过阈值（默认 3），且两个专家都拒绝，直接 REQUEST_CHANGES。否则继续检查专家共识。

### P3: 专家全员通过

```typescript
if (expertA.verdict === 'APPROVED' &&
    expertB.verdict === 'APPROVED') {

  // 计算综合置信度
  const aggregateConfidence = calculateAggregateConfidence(
    expertA.confidence,
    expertB.confidence,
    consensusStats
  );

  if (aggregateConfidence >= MIN_CONFIDENCE) {
    return {
      decision: 'APPROVED',
      reason: '两个专家都通过，综合置信度满足要求',
      confidence: aggregateConfidence
    };
  }

  return {
    decision: 'ESCALATE_TO_HUMAN',
    reason: '两个专家都通过，但综合置信度不足',
    confidence: aggregateConfidence
  };
}
```

**说明**: 两个专家都通过时，需要检查综合置信度是否达到阈值（默认 7）。

### P4: 专家部分通过

```typescript
if (expertA.verdict !== expertB.verdict) {
  // 检查置信度差距
  const confidenceGap = Math.abs(
    expertA.confidence - expertB.confidence
  );

  if (confidenceGap > CONFIDENCE_GAP_THRESHOLD) {
    return {
      decision: 'ESCALATE_TO_HUMAN',
      reason: `专家意见分歧，置信度差距 ${confidenceGap}`,
      confidenceGap
    };
  }

  // 置信度差距小，检查通过专家的置信度
  const approvingExpert = expertA.verdict === 'APPROVED'
    ? expertA
    : expertB;

  if (approvingExpert.confidence >= MIN_CONFIDENCE) {
    return {
      decision: 'APPROVED',
      reason: '专家意见分歧，但通过方置信度足够高',
      confidence: approvingExpert.confidence
    };
  }

  return {
    decision: 'ESCALATE_TO_HUMAN',
    reason: '专家意见分歧，且通过方置信度不足',
    confidence: approvingExpert.confidence
  };
}
```

**说明**: 当一个专家通过、一个专家拒绝时：
- 如果置信度差距大（> 3），ESCALATE_TO_HUMAN
- 如果置信度差距小，检查通过专家的置信度是否足够

### P5: 专家全员拒绝

```typescript
if (expertA.verdict === 'REQUEST_CHANGES' &&
    expertB.verdict === 'REQUEST_CHANGES') {

  return {
    decision: 'REQUEST_CHANGES',
    reason: '两个专家都拒绝',
    issues: [...expertA.issues, ...expertB.issues]
  };
}
```

**说明**: 两个专家都拒绝时，直接 REQUEST_CHANGES。

## 置信度计算

### 综合置信度

```typescript
function calculateAggregateConfidence(
  confidenceA: number,
  confidenceB: number,
  stats: ConsensusStats
): number {
  // 基础平均
  let aggregate = (confidenceA + confidenceB) / 2;

  // 置信度差距惩罚
  const gap = Math.abs(confidenceA - confidenceB);
  if (gap > 3) {
    aggregate -= 1;
  }

  // 问题惩罚
  if (stats.criticalIssues > 0) {
    aggregate -= 3;  // Critical 已经在 P1 处理，这里只是防御
  }
  if (stats.majorIssues > 3) {
    aggregate -= 1;
  }
  if (stats.majorIssues > 0) {
    aggregate -= 0.5;
  }

  // 确保在合理范围
  return Math.max(0, Math.min(10, aggregate));
}
```

### 置信度等级

| 置信度范围 | 等级 | 说明 |
|----------|------|------|
| 9-10 | 非常确信 | 没有任何疑虑 |
| 7-8 | 确信 | 有少量疑虑但不影响决策 |
| 5-6 | 中等 | 有一些疑虑，建议人工复核 |
| 3-4 | 低 | 有较多疑虑，需要更多上下文 |
| 1-2 | 很低 | 严重不确定，必须人工决策 |

## 共识规则配置

```typescript
interface ConsensusRules {
  // 最小置信度阈值
  minConfidence: number;  // 默认 7

  // Critical 问题阈值
  criticalIssuesThreshold: number;  // 默认 0

  // Major 问题阈值
  majorIssuesThreshold: number;  // 默认 3

  // 是否要求两个专家都通过
  requireBothApproval: boolean;  // 默认 true

  // 置信度差距阈值
  confidenceGapThreshold: number;  // 默认 3

  // 是否允许部分通过
  allowPartialApproval: boolean;  // 默认 true
}
```

## 特殊场景处理

### 场景 1: 一个专家通过但置信度低

```
Expert A: APPROVED (confidence: 5)
Expert B: REQUEST_CHANGES (confidence: 8)
```

**决策**: ESCALATE_TO_HUMAN

**理由**: 虽然通过专家置信度不足，但拒绝专家置信度高，建议人工决策。

### 场景 2: 两个专家都通过但置信度差距大

```
Expert A: APPROVED (confidence: 9)
Expert B: APPROVED (confidence: 5)
```

**决策**: ESCALATE_TO_HUMAN

**理由**: 虽然都通过，但置信度差距大（4），说明判断不一致。

### 场景 3: 部分通过但置信度差距小

```
Expert A: APPROVED (confidence: 8)
Expert B: REQUEST_CHANGES (confidence: 7)
```

**决策**: APPROVED

**理由**: 置信度差距小（1），通过方置信度足够高。

### 场景 4: 无问题但置信度中等

```
Issues: 0 Critical, 0 Major, 0 Minor
Expert A: APPROVED (confidence: 6)
Expert B: APPROVED (confidence: 6)
```

**决策**: ESCALATE_TO_HUMAN

**理由**: 没有问题但置信度中等，建议人工复核。

## 下一步行动

### APPROVED

```typescript
nextAction = `
代码 walkthrough 已完成并 APPROVED。

下一步：
1. 审查发现的问题（如有）
2. 根据优先级修复 Major/Minor 问题
3. 更新相关文档
4. 考虑进行集成测试
`;
```

### REQUEST_CHANGES

```typescript
nextAction = `
代码 walkthrough 未通过，需要修复以下问题：

Critical Issues:
${criticalIssues.map(i => `- ${i.description} (${i.location})`).join('\n')}

Major Issues:
${majorIssues.map(i => `- ${i.description} (${i.location})`).join('\n')}

下一步：
1. 修复所有 Critical 和 Major 问题
2. 更新测试用例（如需要）
3. 重新提交代码进行 walkthrough
`;
```

### ESCALATE_TO_HUMAN

```typescript
nextAction = `
代码 walkthrough 无法自动决策，需要人工介入。

原因：${reasoning}

专家意见：
- Expert A: ${expertA.verdict} (confidence: ${expertA.confidence}/10)
- Expert B: ${expertB.verdict} (confidence: ${expertB.confidence}/10)

发现的问题：
${issues.map(i => `- [${i.severity}] ${i.description}`).join('\n')}

请人工审查后做出最终决策。
`;
```

## 实现示例

```typescript
async function arbitrate(
  expertAOutput: ExpertAOutput,
  expertBOutput: ExpertBOutput,
  rules: ConsensusRules
): Promise<ArbiterOutput> {
  // 合并问题
  const allIssues = [...expertAOutput.issues, ...expertBOutput.issues];

  // 统计问题
  const criticalCount = allIssues.filter(i => i.severity === 'Critical').length;
  const majorCount = allIssues.filter(i => i.severity === 'Major').length;

  // P1: Critical 阻塞
  if (criticalCount > 0) {
    return {
      decision: 'REQUEST_CHANGES',
      confidence: 10,
      reasoning: `存在 ${criticalCount} 个 Critical 问题`,
      decisionPath: 'P1',
      issues: allIssues.filter(i => i.severity === 'Critical'),
      nextAction: generateNextAction('REQUEST_CHANGES', allIssues),
    };
  }

  // P2: Major 过多
  if (majorCount > rules.majorIssuesThreshold) {
    if (expertAOutput.verdict === 'REQUEST_CHANGES' &&
        expertBOutput.verdict === 'REQUEST_CHANGES') {
      return {
        decision: 'REQUEST_CHANGES',
        confidence: 10,
        reasoning: `发现 ${majorCount} 个 Major 问题，全员拒绝`,
        decisionPath: 'P2',
        issues: allIssues.filter(i => i.severity === 'Major'),
        nextAction: generateNextAction('REQUEST_CHANGES', allIssues),
      };
    }
  }

  // P3: 全员通过
  if (expertAOutput.verdict === 'APPROVED' &&
      expertBOutput.verdict === 'APPROVED') {
    const aggregate = calculateAggregateConfidence(
      expertAOutput.confidence,
      expertBOutput.confidence,
      { criticalCount, majorCount }
    );

    if (aggregate >= rules.minConfidence) {
      return {
        decision: 'APPROVED',
        confidence: aggregate,
        reasoning: '全员通过，综合置信度满足要求',
        decisionPath: 'P3',
        nextAction: generateNextAction('APPROVED', allIssues),
      };
    }

    return {
      decision: 'ESCALATE_TO_HUMAN',
      confidence: aggregate,
      reasoning: '全员通过但综合置信度不足',
      decisionPath: 'P3',
      nextAction: generateNextAction('ESCALATE_TO_HUMAN', allIssues),
    };
  }

  // P4: 部分通过
  const gap = Math.abs(expertAOutput.confidence - expertBOutput.confidence);
  const approvingExpert = expertAOutput.verdict === 'APPROVED'
    ? expertAOutput
    : expertBOutput;

  if (gap > rules.confidenceGapThreshold) {
    return {
      decision: 'ESCALATE_TO_HUMAN',
      confidence: Math.max(expertAOutput.confidence, expertBOutput.confidence),
      reasoning: `专家分歧，置信度差距 ${gap}`,
      decisionPath: 'P4',
      nextAction: generateNextAction('ESCALATE_TO_HUMAN', allIssues),
    };
  }

  if (approvingExpert.confidence >= rules.minConfidence) {
    return {
      decision: 'APPROVED',
      confidence: approvingExpert.confidence,
      reasoning: '部分通过，通过方置信度足够',
      decisionPath: 'P4',
      nextAction: generateNextAction('APPROVED', allIssues),
    };
  }

  return {
    decision: 'ESCALATE_TO_HUMAN',
    confidence: approvingExpert.confidence,
    reasoning: '部分通过但通过方置信度不足',
    decisionPath: 'P4',
    nextAction: generateNextAction('ESCALATE_TO_HUMAN', allIssues),
  };

  // P5: 全员拒绝（理论上不会到达这里，前面已处理）
  return {
    decision: 'REQUEST_CHANGES',
    confidence: 10,
    reasoning: '全员拒绝',
    decisionPath: 'P5',
    issues: allIssues,
    nextAction: generateNextAction('REQUEST_CHANGES', allIssues),
  };
}
```