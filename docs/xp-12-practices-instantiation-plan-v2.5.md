# XP 12 Practices OpenCode Instantiation Plan (V2.5)

> **版本**: V2.5 - OpenCode 集成 + Gate 时序修复
> **更新日期**: 2026-04-05
> **变更**: 修复 Expert A 发现的 Critical + Major 阻塞问题

---

## V2.5 修复说明

### Expert A 评审问题 (V2.4)

| # | 严重程度 | 问题 | V2.5 修复 |
|---|----------|------|----------|
| **A1** | Critical | OpenCode 集成路径缺失 | **Skill 文件模板 + Agent 配置** |
| **A3** | Major | Gate 1 时序问题 | **Gate 时序重构 + 状态回退定义** |
| A2 | Major | Arbiter 共识阈值未定义 | **置信度阈值定义** |
| A4 | Major | Navigator Phase 1 输出质量未验证 | **Phase 1 自检机制** |
| A5 | Minor | 熔断机制触发条件模糊 | **熔断判定明确化** |

---

## A1 修复：OpenCode 集成路径

### 问题

V2.4 提供了 TypeScript 实现示例，但未定义如何封装为 OpenCode Skill/Workflow，无 skill 文件结构、无 agent 定义。

### V2.5 解决方案：完整 Skill 文件模板

#### Skill 文件结构

```
/home/boyingliu01/.config/opencode/skills/
├── xp-consensus/
│   ├── SKILL.md                    # 主 skill 文件
│   ├── references/
│   │   ├── driver-prompt.md        # Driver AI prompt template
│   │   ├── navigator-phase1-prompt.md
│   │   ├── navigator-phase2-prompt.md
│   │   ├── arbiter-prompt.md       # Arbiter decision tree
│   │   └── state-schema.md         # TypeScript interfaces
│   └── examples/
│       └── consensus-session.md    # 示例工作流
```

#### SKILL.md 模板

```yaml
---
name: xp-consensus
description: "XP Pair Programming AI 共识引擎。Driver + Navigator 双阶段评审 + Arbiter 决策树。MANDATORY before any code implementation. 自动触发：用户提出需求后，自动启动共识流程。"
---

# XP Consensus Engine

## 触发条件

自动触发：
- 用户提出新需求
- 用户请求实现功能
- 用户请求重构代码

手动触发：
- `/xp-consensus` 命令

## 核心流程

1. Round 1: Driver AI 生成代码 + sealed decisions
2. Round 2 Phase 1: Navigator AI 盲评生成 checkList
3. Round 2 Phase 2: Navigator AI 验证实现
4. Round 3: Arbiter AI 决策冲突

## Agent 配置

| 角色 | Agent | 模型 |
|------|-------|------|
| Driver | `build` | GLM-5 |
| Navigator Phase 1 | `oracle` | MiniMax M2.5 |
| Navigator Phase 2 | `oracle` | MiniMax M2.5 |
| Arbiter | `oracle` | GLM-5 |

## 与现有 Skills 集成

- 共识完成 → `/verification-loop` (Gate 1-2)
- 发布前 → `/gstack-ship` (Gate 2 集成)
- 成本超阈值 → 降级到单 `build` agent

## 状态机

CREATED → PHASE1_COMPLETE → UNLOCKED → APPROVED → GATE1_RUNNING → GATE1_COMPLETE → READY_FOR_RELEASE

## 成本控制

单次共识 ~$0.04 | 单任务阈值 $0.15 | 日阈值 $1.00

## 详细 Prompt Templates

见 `references/` 目录下的各角色 prompt 文件。
```

#### Agent 配置详情

```yaml
# Agent 配置 (OpenCode 环境)

agents:
  driver:
    type: build
    model: bailian-coding-plan/glm-5
    skills: [coding-standards, tdd-workflow]
    prompt_file: references/driver-prompt.md
    
  navigator_phase1:
    type: oracle
    model: moonshot-mini-005  # MiniMax M2.5 equivalent
    skills: [review]
    prompt_file: references/navigator-phase1-prompt.md
    
  navigator_phase2:
    type: oracle
    model: moonshot-mini-005
    skills: [review, security-review]
    prompt_file: references/navigator-phase2-prompt.md
    
  arbiter:
    type: oracle
    model: bailian-coding-plan/glm-5
    skills: []
    prompt_file: references/arbiter-prompt.md
```

#### 与现有 Skills 集成点

```
┌─────────────────────────────────────────────────────────────┐
│               OpenCode Skill Integration                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  xp-consensus (核心)                                         │
│  ├─ Round 1 → Driver (build agent)                          │
│  ├─ Round 2 → Navigator (oracle agent)                      │
│  └─ Round 3 → Arbiter (oracle agent)                        │
│                                                              │
│  集成点 1: 共识完成                                          │
│  ├─ 自动触发 /verification-loop                              │
│  ├─ Phase 1-4: Build, Type, Lint, Test                      │
│  └─ 结果: Gate 1 通过/失败                                   │
│                                                              │
│  集成点 2: Gate 1 失败                                       │
│  ├─ 自动修复可修复问题                                       │
│  ├─ 重新运行 verification-loop                              │
│  └─ 最多 3 次，超过 → 报告给人                               │
│                                                              │
│  集成点 3: Gate 1 通过                                       │
│  ├─ 触发 /gstack-ship                                        │
│  ├─ 包含 Gate 2: Security Scan                               │
│  └─ 结果: 发布成功/阻塞                                       │
│                                                              │
│  集成点 4: 成本超阈值                                        │
│  ├─ 熔断 → 降级到单 build agent                              │
│  ├─ 跳过共识流程                                             │
│  └─ 直接执行 + 单次 verification-loop                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## A3 修复：Gate 1 时序 + 状态回退

### 问题

Gate 1 在 "Post-Consensus" 执行，意味着共识流程结束后才做静态分析。若发现 Critical 问题，需重新进入共识流程，形成状态循环但未定义。

### V2.5 解决方案：Gate 时序重构 + 状态回退定义

#### Gate 时序重构

**核心变更**: Gate 1 (Static Analysis) 在 Navigator Phase 2 后、Arbiter 前执行

```
┌─────────────────────────────────────────────────────────────┐
│              Gate 1 Integration Flow (V2.5)                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Round 1: Driver                                             │
│  ├─ 输出: sealed{code, decisions} + public{tests}           │
│  └────────────────────────────────┘                          │
│                          │                                   │
│                          ▼                                   │
│  Round 2 Phase 1: Navigator 盲评                             │
│  ├─ 输出: checkList (不知道 code)                           │
│  └────────────────────────────────┘                          │
│                          │                                   │
│                          ▼                                   │
│  Round 2 Phase 2: Navigator 验证                             │
│  ├─ 输入: code (解锁) + checkList                            │
│  ├─ 输出: verdict + confidence                               │
│  └────────────────────────────────┘                          │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ⭐ Gate 1: Pre-Arbiter Static Analysis (V2.5)        │    │
│  │                                                      │    │
│  │ 触发时机: Phase 2 完成，Arbiter 前                   │    │
│  │                                                      │    │
│  │ 执行:                                                │    │
│  │ • TypeScript strict mode (类型错误)                 │    │
│  │ • ESLint (代码规范)                                  │    │
│  │ • Test execution (测试通过)                         │    │
│  │                                                      │    │
│  │ 失败处理:                                            │    │
│  │ • 自动修复可修复问题                                 │    │
│  │ • 重新运行 Gate 1 (最多 3 次)                       │    │
│  │ • 超过 → 状态回退 → 重新 Round 1                    │    │
│  │                                                      │    │
│  │ 通过:                                                │    │
│  │ • 进入 Arbiter                                       │    │
│  │ • Arbiter 收到 Gate 1 结果作为额外输入              │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  Round 3: Arbiter                                            │
│  ├─ 输入: Driver output + Navigator verdict + Gate 1 result │
│  ├─ 输出: APPROVED / REQUEST_CHANGES                         │
│  └────────────────────────────────┘                          │
│                          │                                   │
│                          ▼                                   │
│  APPROVED → Gate 2 (Pre-Release Security Scan)              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 状态机扩展

```
┌─────────────────────────────────────────────────────────────┐
│           Extended State Machine (V2.5)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  State 0: IDLE                                               │
│  State 1: ROUND1_RUNNING                                     │
│  State 2: ROUND1_COMPLETE (sealed created)                   │
│  State 3: ROUND2_PHASE1_RUNNING                              │
│  State 4: ROUND2_PHASE1_COMPLETE                             │
│  State 5: ROUND2_PHASE2_RUNNING                              │
│  State 6: ROUND2_PHASE2_COMPLETE                             │
│                                                              │
│  ⭐ NEW: Gate 1 States                                       │
│  State 7: GATE1_RUNNING                                      │
│  State 8: GATE1_COMPLETE                                     │
│  State 9: GATE1_FAILED                                       │
│                                                              │
│  State 10: ARBITER_RUNNING                                   │
│  State 11: APPROVED                                          │
│  State 12: REQUEST_CHANGES                                   │
│                                                              │
│  ⭐ NEW: Gate 2 States                                       │
│  State 13: GATE2_RUNNING                                     │
│  State 14: GATE2_COMPLETE                                    │
│  State 15: READY_FOR_RELEASE                                 │
│                                                              │
│  ⭐ NEW: Rollback States                                     │
│  State 16: ROLLBACK_TO_ROUND1                                │
│  State 17: ROLLBACK_TO_DRIVER                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 状态回退定义

```typescript
// 状态回退逻辑 (V2.5)

class ConsensusEngineV2_5 {
  private gate1Attempts: number = 0;
  private maxGate1Attempts: number = 3;
  
  async handleGate1Failure(gate1Result: Gate1Result): Promise<void> {
    this.gate1Attempts++;
    
    if (this.gate1Attempts <= this.maxGate1Attempts) {
      // 自动修复
      const fixableIssues = gate1Result.errors.filter(e => e.autoFixable);
      
      if (fixableIssues.length > 0) {
        // 调用 Driver 修复
        await this.driver.fix(fixableIssues);
        
        // 重新运行 Gate 1
        this.state = 'GATE1_RUNNING';
        return this.runGate1();
      }
      
      // 无可自动修复 → 回退
      this.state = 'ROLLBACK_TO_ROUND1';
      return this.rollbackToRound1();
    }
    
    // 超过最大次数 → 报告给人
    this.state = 'GATE1_FAILED';
    throw new Error('Gate 1 failed after max attempts. Human intervention required.');
  }
  
  async rollbackToRound1(): Promise<void> {
    // 清空 sealed 数据
    this.round1Output = null;
    this.navigatorPhase1Output = null;
    
    // 回退到 State 1
    this.state = 'ROUND1_RUNNING';
    
    // 重新执行 Round 1
    // 注意: requirements 保持不变，但 Driver 需要知道 Gate 1 失败的原因
    const retryContext = {
      requirements: this.originalRequirements,
      previousGate1Failure: this.lastGate1Result,
      instruction: 'Fix Gate 1 issues in new implementation'
    };
    
    await this.executeRound1(retryContext);
  }
}
```

---

## A2 修复：Arbiter 共识阈值

### 问题

决策树定义 P1-P5 优先级，但未定义"共识达成"的量化标准。

### V2.5 解决方案：置信度阈值定义

```yaml
# Arbiter 决策标准 (V2.5)

arbiter_decision_criteria:
  # APPROVE 条件
  approve_threshold:
    min_confidence: 8          # 最低置信度 8/10
    max_critical_issues: 0     # 无 Critical Issues
    gate1_passed: true         # Gate 1 必须通过
    
  # REQUEST_CHANGES 条件
  request_changes_trigger:
    - confidence < 6           # 置信度过低
    - critical_issues > 0      # 存在 Critical Issues
    - gate1_failed: true       # Gate 1 失败
    - navigator_verdict != driver_verdict  # 重大分歧
    
  # ESCALATE_TO_HUMAN 条件
  escalate_trigger:
    - confidence >= 6 and confidence < 8  # 中等置信度
    - max_rounds_reached: true            # 达到最大轮数
    - cost_threshold_exceeded: true       # 成本超阈值
```

---

## A4 修复：Navigator Phase 1 输出质量自检

### 问题

盲评生成的 checkList 可能本身有质量问题（遗漏需求、边界条件不完整）。

### V2.5 解决方案：Phase 1 自检机制

```yaml
# Navigator Phase 1 自检 (V2.5)

phase1_self_check:
  # 强制检查项
  required_checklist_coverage:
    - requirements_coverage: 100%    # 必须覆盖所有需求点
    - edge_cases: min 3              # 至少 3 个边界条件
    - security_considerations: min 1 # 至少 1 个安全考虑
    
  # 自检失败处理
  self_check_failure:
    - regenerate: true               # 重新生成
    - max_regenerate: 2              # 最多 2 次
    - fallback: "report to human"    # 超过 → 报告给人
    
  # 自检输出格式
  self_check_report:
    - coverage_score: X/10
    - missing_requirements: [...]
    - suggestion: "Regenerate checklist with focus on [missing items]"
```

---

## A5 修复：熔断机制触发条件

### 问题

"连续2轮无进展"未定义"无进展"的判定标准。

### V2.5 解决方案：熔断判定明确化

```yaml
# 熔断判定标准 (V2.5)

circuit_breaker_criteria:
  # 无进展判定
  no_progress_definition:
    - issue_severity_distribution_same: true  # Critical/Major/Minor 分布连续2轮相同
    - confidence_change: "< 0.5"              # 置信度变化小于 0.5
    - new_issues_found: 0                     # 无新发现问题
    
  # 熔断触发
  circuit_breaker_trigger:
    - consecutive_no_progress_rounds: 2       # 连续 2 轮无进展
    - total_cost_exceeded: "$0.15"            # 总成本超阈值
    
  # 熔断处理
  circuit_breaker_action:
    - state: "CIRCUIT_BREAKER_TRIGGERED"
    - action: "降级到单模型执行"
    - report: "生成熔断报告"
    - fallback_agent: "build"
```

---

## 完整架构图 (V2.5)

```
┌─────────────────────────────────────────────────────────────┐
│                   Human Role (最小化)                        │
│   提出原始需求 → 确认原始方案 → 处理 escalations              │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                  AI Autonomous Layer (V2.5)                  │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │     Sequential Consensus Engine + Gate 1 Integration   │  │
│  │                                                        │  │
│  │  Round 1: Driver AI (build agent)                     │  │
│  │  ├─ 输入: 需求 + 上下文                               │  │
│  │  └─ 输出: sealed{code, decisions} + public{tests}     │  │
│  │                                                        │  │
│  │  Round 2: Navigator AI [双阶段 + Phase 1 自检]        │  │
│  │  ├─ Phase 1: 盲评生成 checkList + 自检覆盖            │  │
│  │  └─ Phase 2: 验证实现 (🔓 sealed 解锁)               │  │
│  │                                                        │  │
│  │  ⭐ Gate 1: Pre-Arbiter Static Analysis               │  │
│  │  ├─ TypeScript strict + ESLint + Test execution       │  │
│  │  ├─ 失败: 自动修复(3次) → 回退 Round 1                │  │
│  │  └─ 通过: 进入 Arbiter                                │  │
│  │                                                        │  │
│  │  Round 3: Arbiter AI [置信度阈值 ≥8]                  │  │
│  │  ├─ 输入: Driver + Navigator + Gate 1 result          │  │
│  │  └─ 输出: APPROVED / REQUEST_CHANGES                  │  │
│  │                                                        │  │
│  │  状态机: 17 states 含回退路径                         │  │
│  │  熔断: 连续2轮无进展 → 降级单模型                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         External Validation Anchors (Gate 2-4)         │  │
│  │                                                        │  │
│  │  Gate 2: Security Scan (Pre-Release, gstack-ship)     │  │
│  │  Gate 3: Benchmark Tests (Weekly)                     │  │
│  │  Gate 4: Human Spot-Check (10% sampling)              │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         OpenCode Skill Integration                     │  │
│  │                                                        │  │
│  │  xp-consensus → verification-loop → gstack-ship       │  │
│  │  Agent: build, oracle (GLM-5, MiniMax)                │  │
│  │  Skills: coding-standards, tdd-workflow, review       │  │
│  │  Cost: 单次 $0.04 | 日阈值 $1.00                      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Output to Human                           │
│  完成报告 + 变更清单 + 测试结果 + 成本报告 + 安全扫描结果     │
└─────────────────────────────────────────────────────────────┘
```

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V2.0 | 2026-04-05 | 初始 AI 自主执行设计 |
| V2.1 | 2026-04-05 | 添加评审修订说明 |
| V2.2 | 2026-04-05 | 修复 3 个 Critical Issues |
| V2.3 | 2026-04-05 | 修复 4 个 Critical Issues |
| V2.4 | 2026-04-05 | 修复 5 个 Major Concerns |
| **V2.5** | 2026-04-05 | **修复 Expert A 阻塞问题** |
| | | - A1: OpenCode 集成路径 (Skill 模板 + Agent 配置) |
| | | - A3: Gate 1 时序重构 + 状态回退定义 |
| | | - A2: Arbiter 置信度阈值 ≥8 |
| | | - A4: Navigator Phase 1 自检机制 |
| | | - A5: 熔断判定明确化 |