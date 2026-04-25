---
name: delphi-review
description: "Delphi共识评审：多轮匿名评审直到专家达成一致意见。支持design/code-walkthrough双模式。支持2位或3位专家。MANDATORY before any implementation, design, or architecture decisions. Invoke when user submits requirements, design docs, code PRs, or requests review."
---

# Delphi Consensus Review

## 核心原则

**Delphi 方法只有一个目的：得到所有专家一致认可的可行方案。**

### Five Core Properties (for Code Walkthrough Mode)

1. **匿名性** — Expert A/B 互不知道对方意见
2. **迭代共识** — 多轮直到 APPROVED 
3. **零容忍** — Critical Issues 必须修复
4. **零降级** — 环境/资源问题必须阻断，通知用户解决
5. **强制覆盖** — 超过阈值必须 BLOCK，不能跳过

### 四大核心特性（来自 RAND 方法论）（Design Mode）

1. **匿名性 (Anonymity)** - Round 1 专家互不知道对方意见
2. **迭代数据收集 (Iterative)** - 多轮直到共识，不是固定轮数
3. **参与者反馈 (Controlled Feedback)** - 每轮看到其他专家意见
4. **统计共识 (Statistical Group Response)** - >=91% 一致才算共识

### 与其他评审方法的区别

| 方法 | 目的 | 流程 |
|------|------|------|
| Code Review | 发现问题 | 一次评审，发现问题即可 |
| **Delphi** | **达成共识** | **多轮迭代，直到所有专家 APPROVED** |

# Delphi Consensus Review

## 核心原则

**Delphi 方法只有一个目的：得到所有专家一致认可的可行方案。**

### 四大核心特性（来自 RAND 方法论）

1. **匿名性 (Anonymity)** - Round 1 专家互不知道对方意见
2. **迭代数据收集 (Iterative)** - 多轮直到共识，不是固定轮数
3. **参与者反馈 (Controlled Feedback)** - 每轮看到其他专家意见
4. **统计共识 (Statistical Group Response)** - >=91% 一致才算共识

### 与其他评审方法的区别

| 方法 | 目的 | 流程 |
|------|------|------|
| Code Review | 发现问题 | 一次评审，发现问题即可 |
| **Delphi** | **达成共识** | **多轮迭代，直到所有专家 APPROVED** |

---

## ⚠️ 最重要：评审未完成直到 APPROVED

### 核心原则

**问题发现越早，修复成本越低。** 

评审的目的是得到**可行方案**，不是"完成评审"。如果方案不可行，评审就失败了。

```
❌ WRONG: Round 1 → Round 2 → Round 3 → 生成报告 → "评审完成"
   问题：如果结果是 REQUEST_CHANGES，方案不可行
   成本：问题泄露到后续阶段，修复成本指数增长

✅ CORRECT: Round 1 → Round 2 → Round 3 → REQUEST_CHANGES
            → 修复方案 → 重新评审 → ... → APPROVED → "评审完成"
   结果：得到可行方案
   成本：前期投入确保后期顺利
```

**Delphi 的终点不是"完成评审"，而是"得到可行方案"。**

### 质量优先原则

| 原则 | 说明 |
|------|------|
| **Token 消耗是投资** | 相比后期修复成本，评审的 token 消耗微不足道 |
| **多轮迭代不是浪费** | 确保方案可行，避免返工 |
| **发现问题要立即修复** | 不要记录问题然后继续，要修复后重新评审 |
| **APPROVED 才是终点** | 任何其他状态都需要继续工作 |

### 门禁固化

这些原则已固化到 Terminal State Checklist 中，**不可跳过**：

- 最终裁决必须是 APPROVED
- 所有 Critical Issues 必须已修复验证
- 所有 Major Concerns 必须已处理
- 问题共识必须 >= 91%

**如果任何条件未满足，评审不可声明完成。**

---

## 评审模式 (Modes)

Delphi Review 支持两种模式，通过 `--mode` 参数选择：

| 模式 | 触发方式 | 用途 | 输出 |
|------|---------|------|------|
| `design` (默认) | `/delphi-review` | 设计文档、需求文档、架构决策评审 | 共识报告 |
| `code-walkthrough` | `/delphi-review --mode code-walkthrough` 或 `/code-walkthrough` | git push 前代码走查 | `.code-walkthrough-result.json` |

### Mode: `design` (默认)

当前文档描述的所有行为即为 `design` 模式。无需额外参数，直接调用 `/delphi-review` 即可。

**适用场景**：需求文档评审、设计文档评审、架构决策评审、PR 评审。

### Mode: `code-walkthrough`

代码走查模式，用于 git push 前对代码变更进行多专家 Delphi 评审。

#### Five Core Properties of Code Walkthrough Mode
1. **匿名性** — Expert A/B 互不知道对方意见
2. **迭代共识** — 多轮直到 APPROVED 
3. **零容忍** — Critical Issues 必须修复
4. **零降级** — 环境/资源问题必须阻断，通知用户解决
5. **强制覆盖** — 超过阈值必须 BLOCK，不能跳过

#### 触发条件

- **自动触发**：`git push` 前（通过 pre-push hook 验证结果文件）
- **手动触发**：`/code-walkthrough` 命令（等价于 `/delphi-review --mode code-walkthrough`）

**⚠️ 重要调用方式说明**：

- ✅ **正确**: 在 Agent session 中执行 `/code-walkthrough`
- ❌ **错误**: Shell 脚本调用 `opencode code-walkthrough` (OpenCode CLI 不支持 skill 子命令)
- ❌ **错误**: CLI 子命令 `opencode run --skill code-walkthrough --diff` (不支持)

**设计决策**: code-walkthrough 是 **强制但手动触发** 的质量门禁：
- **强制**: push 必须有有效的 `.code-walkthrough-result.json` 文件
- **手动**: Skill 执行由用户在 Agent session 内触发
- **理由**: 避免 OpenCode CLI 架构限制，保持正常工作模式

**⚠️ 门禁零容忍声明**:

code-walkthrough 是强制性质控门禁，以下行为严格禁止：
- ❌ 使用 `git push --no-verify` 绕过 pre-push hook 验证
- ❌ 伪造 `.code-walkthrough-result.json` 文件
- ❌ 因为"时间紧急"或"变更很小"而跳过评审
- ❌ 修改门禁阈值让告警消失

**门禁工具检测出的问题 = 必须修复，不允许绕过。**

详见: [质量门禁行为准则](../../githooks/QUALITY-GATES-CODE-OF-CONDUCT.md)

#### 流程概览

```
git push
    │
    ▼
pre-push hook
    │
    ├─→ 获取 git diff main...HEAD
    │
    ├─→ 提取变更摘要
    │
    ├─→ 运行 Principles Checker (Clean Code + SOLID)
    │
    ├─→ 触发 Delphi 评审 (code-walkthrough mode)
    │         │
    │         ├─→ Expert A (架构 + 设计) 匿名评审 (含 principles_findings)
    │         │
    │         ├─→ Expert B (实现 + 代码质量) 匿名评审 (含 principles_findings)
    │         │
    │         ├─→ 共识检查
    │         │      │
    │         │      ├─→ 2/2 APPROVED → 允许推送
    │         │      │
    │         │      ├─→ 分歧 → Expert C 仲裁
    │         │      │
    │         │      └─→ REQUEST_CHANGES → 阻塞推送
    │         │
    │         └─→ 写入 .code-walkthrough-result.json
    │
    └─→ 允许/阻塞推送
```

#### 专家角色 (code-walkthrough mode)

| 专家 | 视角 | 配置 |
|------|------|------|
| Expert A | 架构 + 设计评审 | `.delphi-config.json` → `experts.architecture` |
| Expert B | 实现 + 代码质量 | `.delphi-config.json` → `experts.technical` |
| Expert C (仲裁) | 冲突裁决 | `.delphi-config.json` → `experts.feasibility` |

> ⚠️ **注意**: 至少配置 **两个不同 provider** 的模型。详见 [INSTALL.md](./INSTALL.md)。

#### 评审维度

**必检项**：

| 维度 | 检查内容 |
|------|---------|
| **正确性** | 逻辑是否正确，边界条件是否处理 |
| **安全性** | 是否有注入、泄露、越权风险 |
| **可维护性** | 命名、结构、注释是否清晰 |
| **测试覆盖** | 是否有足够的测试 |

**选检项**（根据变更类型）：

| 变更类型 | 额外检查 |
|---------|---------|
| API 变更 | 接口兼容性、文档更新 |
| 数据库变更 | 迁移脚本、回滚方案 |
| 性能敏感 | 性能测试、基准对比 |

#### Principles Module Integration

作为代码走查的一部分，自动运行 principles checker 分析：

```yaml
principles_module:
  enabled: true
  trigger: pre-push
  rules:
    - clean-code.all      # 9 rules
    - solid.all           # 5 rules
  integration_point: expert_prompt
  output_format: principles_findings section
```

**Principles 检查流程**：

```
git push
    │
    ▼
pre-push hook
    │
    ├─→ Step 1: Principles Checker
    │         │
    │         ├─→ 检测变更文件语言
    │         ├─→ 选择对应 Adapter
    │         ├─→ 运行 14 个规则
    │         │      │
    │         │      ├─→ Clean Code (9 rules)
    │         │      │   - long-function (>50 lines)
    │         │      │   - large-file (>500 lines)
    │         │      │   - magic-numbers (非语义数字)
    │         │      │   - god-class (>15 methods)
    │         │      │   - deep-nesting (>4 levels)
    │         │      │   - too-many-params (>7)
    │         │      │   - missing-error-handling (IO 无 try-catch)
    │         │      │   - unused-imports (未使用的导入)
    │         │      │   - code-duplication (>15% 相似度)
    │         │      │
    │         │      ├─→ SOLID (5 rules)
    │         │      │   - srp (单一职责)
    │         │      │   - ocp (开闭原则)
    │         │      │   - lsp (里氏替换)
    │         │      │   - isp (接口隔离)
    │         │      │   - dip (依赖倒置)
    │         │      │
    │         │      └─→ 输出 violations
    │         │
    │         └─→ Step 2: Delphi Code Walkthrough
    │                  │
    │                  ├─→ Expert A 评审 (含 principles_findings)
    │                  ├─→ Expert B 评审 (含 principles_findings)
    │                  └─→ 共识检查
    │
    └─→ 允许/阻塞推送
```

**Principles Findings 输出格式**（在 Expert 评审报告中添加）：

```markdown
## Principles Findings

### Clean Code Violations

| Rule | Severity | File | Line | Description |
|------|----------|------|------|-------------|
| clean-code.long-function | warning | src/api.ts | 45 | Function "processData" exceeds 50 lines |
| clean-code.deep-nesting | warning | src/utils.ts | 12 | Nesting depth 5 > threshold 4 |

### SOLID Violations

| Rule | Severity | File | Line | Description |
|------|----------|------|------|-------------|
| solid.srp | warning | src/user.ts | 1 | Class has 18 methods (>15 threshold) |
| solid.dip | warning | src/service.ts | 23 | Direct instantiation of UserRepository |

### Summary
- Total violations: [N]
- Errors: [N]
- Warnings: [N]
- Infos: [N]
```

**Principles 检查与 Delphi 评审的关系**：

| Principles 结果 | Delphi 评审行为 |
|-----------------|-----------------|
| 无 violations | Expert 正常评审，无额外关注点 |
| 有 info 级别 | Expert 评审时参考，不阻塞 |
| 有 warning 级别 | Expert 必须在评审中提及并给出意见 |
| 有 error 级别 | **自动阻塞推送**，无需 Delphi 评审 |

**阈值配置**：项目级配置文件 `.principlesrc` 可覆盖默认阈值：

```json
{
  "rules": {
    "clean-code": {
      "long-function": { "threshold": 50 },
      "god-class": { "threshold": 15 },
      "deep-nesting": { "threshold": 4 }
    },
    "solid": {
      "srp": { "methodThreshold": 15 },
      "isp": { "methodThreshold": 10 }
    }
  }
}
```

#### 共识标准 (code-walkthrough mode)

| 条件 | 结果 |
|------|------|
| 2/2 APPROVED + 无 Critical Issues | ✅ 允许推送 |
| 2/2 APPROVED + 有 Minor Issues | ✅ 允许推送（记录问题） |
| 1/2 APPROVED | ⚠️ 需要 Expert C 仲裁 |
| 0/2 APPROVED | ❌ 阻塞推送 |
| 有 Critical Issues | ❌ 阻塞推送 |
| 有 Major Issues 且未处理 | ❌ 阻塞推送 |

#### 成本控制 (零降级原则)

| 指标 | 阈值 | 处理 |
|------|------|------|
| 单次走查成本 | ~$0.03 | 正常执行 |
| 最大评审文件数 | 20 个文件 | 超过 → **BLOCK** |
| 最大 diff 行数 | 500 行 | 超过 → **BLOCK** |

**超过阈值处理 (零降级)**：

```
IF 超过阈值:
  → BLOCK 推送
  → 通知用户：变更过大，无法有效评审
  → 用户选项：
     A. 拆分变更（推荐）
     B. 用户明确授权跳过走查（需书面确认风险）
  
  ❌ 禁止自动跳过走查
  ❌ 禁止自动分批并批准
```

**设计原则**：
- 大变更跳过评审 = 质量风险泄露到生产环境
- 用户有权决定是否接受风险，AI 不能自动跳过

#### Agent 可用性检查 (MANDATORY)

**启动前检查**：

```
BEFORE code walkthrough:
  ├─ 检查 Expert A 模型可用性
  ├─ 检查 Expert B 模型可用性
  ├─ 检查 Expert C 模型可用性（仲裁时需要）
  └─ 检查 OpenCode CLI 可用性

IF 任何检查失败:
  → BLOCK 推送
  → 通知用户具体缺失项
  → 提供修复指引
  → ❌ 禁止跳过走查直接推送
```

**模型不可用处理**：

| 情况 | 处理 |
|------|------|
| Expert A API 错误 | BLOCK + 提示用户检查 API key |
| Expert B API 错误 | BLOCK + 提示用户检查 API key |
| OpenCode CLI 缺失 | BLOCK + 提示用户安装 OpenCode |

#### Expert 评审输出格式 (code-walkthrough mode)

```markdown
## Code Walkthrough - Expert [A/B]

### 变更摘要
[变更的主要内容]

### 发现问题

| ID | 严重程度 | 问题描述 | 代码位置 | 修复建议 |
|----|----------|----------|---------|---------|
| ... | ... | ... | ... | ... |

### 裁决
[APPROVED / REQUEST_CHANGES]

### 置信度
[X/10]
```

#### 共识报告格式 (code-walkthrough mode)

```markdown
## Code Walkthrough 共识报告

### 变更信息
- 分支: [branch name]
- 提交数: [N]
- 文件数: [N]
- 新增行数: +[N]
- 删除行数: -[N]

### 专家意见汇总
- Expert A: [APPROVED / REQUEST_CHANGES]
- Expert B: [APPROVED / REQUEST_CHANGES]

### 共识结果
[CONSENSUS / DISAGREEMENT]

### 最终裁决
[APPROVED / REQUEST_CHANGES / NEED_ARBITRATION]

### 问题清单（如有）
[需要修复的问题]
```

#### 结果输出文件 (MANDATORY)

完成评审后，Skill 必须写入结果文件以供 Hook 验证：

**输出文件位置**：`.code-walkthrough-result.json`

**输出文件格式**：

```json
{
  "commit": "abc123def456",
  "branch": "feature/xp-rewrite",
  "timestamp": "2026-04-14T10:30:00Z",
  "expires": "2026-04-14T11:30:00Z",
  "verdict": "APPROVED",
  "confidence": 9,
  "experts": [
    { "id": "Expert A", "verdict": "APPROVED", "confidence": 9 },
    { "id": "Expert B", "verdict": "APPROVED", "confidence": 8 }
  ],
  "issues": [],
  "consensus_ratio": 1.0,
  "files_reviewed": 5,
  "lines_added": 120,
  "lines_deleted": 45
}
```

**字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `commit` | string | 当前 HEAD commit hash (git rev-parse HEAD) |
| `branch` | string | 当前分支名 |
| `timestamp` | string | 评审完成时间 (ISO 8601 UTC) |
| `expires` | string | 过期时间 (timestamp + 1小时) |
| `verdict` | string | 最终裁决: APPROVED / REQUEST_CHANGES |
| `confidence` | number | 整体置信度 (1-10) |
| `experts` | array | 专家评审结果 |
| `issues` | array | 未解决的问题（如有） |
| `consensus_ratio` | number | 问题共识比例 (≥0.91 为共识) |

**有效期机制**：

- **有效期**: 1小时
- **过期后**: Hook 将提示重新执行 `/code-walkthrough`
- **commit 必须匹配**: 文件中的 commit 必须等于当前 HEAD

**Hook 验证逻辑**：

Hook 验证以下条件（全部满足才允许 push）：

1. 文件存在
2. JSON 格式有效
3. commit hash 匹配当前 HEAD
4. verdict = APPROVED
5. timestamp 未过期 (< 1小时)

#### 与现有系统集成

| 集成点 | 说明 |
|--------|------|
| `pre-push` hook | 验证 `.code-walkthrough-result.json` 文件（不调用 Skill） |
| `gstack-ship` | 推送后进入发布流程 |
| `verification-loop` | 走查通过后运行验证 |

---

## 参数配置

### 专家数量

| 配置 | 专家数 | 适用场景 |
|------|--------|---------|
| `experts: 2` | 2位 (默认) | 代码变更、小型设计 |
| `experts: 3` | 3位 | 架构决策、需求文档、关键设计 |

### 专家角色

Delphi 评审需要 **2-3 位不同模型的 AI 专家**，避免同源偏见（同一厂商的模型可能有一致的盲区）。每个专家角色关注不同的评审视角：

| 角色 | 视角 | 推荐特征 |
|------|------|----------|
| **Expert A (Lead)** | 架构 + 需求对齐 + 系统设计 | 推理能力强，适合高层分析 |
| **Expert B (Technical)** | 实现细节 + 代码正确性 + 边界情况 | 代码理解能力强，适合技术审查 |
| **Expert C (Feasibility)** *(3专家模式)* | 可行性 + 风险评估 + 执行复杂度 | 综合分析能力强，能发现实践风险 |

> **⚠️ 重要**：至少选择 **两家不同厂商** 的模型。同一厂商的同源模型可能导致一致的盲点。

### 模型映射配置

Skill 本身不绑定具体模型。安装者需要在自己的 OpenCode 配置中声明模型映射：

**步骤 1**：复制 `.delphi-config.json.example` 为 `.delphi-config.json`

**步骤 2**：在 `opencode.json` 的 `agent` 区块添加 `delphi-reviewer-*` 子 agent

**步骤 3**：将 `YOUR_PROVIDER/YOUR_MODEL` 替换为自己可用的模型

详见 [INSTALL.md](./INSTALL.md) 完整安装指南。

### 推荐配置示例

以下为作者自用配置，仅作参考。安装者应根据自身 provider 替换：

| 专家角色 | 作者配置 | 替代建议 |
|---------|---------|---------|
| Expert A (Lead) | Qwen3.5-Plus | 任意强推理模型（Claude、GPT-4、Gemini 等） |
| Expert B (Technical) | Kimi K2.5 | 任意代码理解强的模型 |
| Expert C (Feasibility) | MiniMax M2.5 | 任意综合分析强的模型 |

### 共识阈值

| 阈值 | 说明 |
|------|------|
| **>=91%** | 问题共识比例（推荐） |
| 100% | 完全一致（更严格） |

---

## 完整流程

```
┌─────────────────────────────────────────────────────────────┐
│                   Delphi Review Flow                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Phase 0: 准备                                       │    │
│  │ • 验证文档可读                                      │    │
│  │ • 确定专家数量 (2 或 3)                             │    │
│  │ • 分配模型角色                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Round 1: 匿名独立评审 (Anonymous)                    │    │
│  │                                                      │    │
│  │ Expert A ──→ 评审 A (不知道 B/C 意见)               │    │
│  │ Expert B ──→ 评审 B (不知道 A/C 意见)               │    │
│  │ Expert C ──→ 评审 C (不知道 A/B 意见) [如3专家]     │    │
│  │                                                      │    │
│  │ 输出: 优点 + 问题清单(Critical/Major/Minor) + 裁决   │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 共识检查                                             │    │
│  │ • 裁决是否一致？                                     │    │
│  │ • 问题共识比例 >=91%？                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│              ┌───────────┴───────────┐                       │
│              │                       │                       │
│          一致 + >=91%          不一致 或 <91%               │
│              │                       │                       │
│              │                       ▼                       │
│              │            ┌─────────────────────┐            │
│              │            │ Round 2: 交换意见    │            │
│              │            │                      │            │
│              │            │ 每位专家看到其他专家 │            │
│              │            │ 的评审，响应关切    │            │
│              │            └──────────┬──────────┘            │
│              │                       │                       │
│              │                       ▼                       │
│              │            ┌─────────────────────┐            │
│              │            │ 共识检查             │            │
│              │            └──────────┬──────────┘            │
│              │                       │                       │
│              │           ┌───────────┴───────────┐           │
│              │           │                       │           │
│              │       一致 + >=91%          仍分歧             │
│              │           │                       │           │
│              │           │                       ▼           │
│              │           │            ┌─────────────────────┐ │
│              │           │            │ Round 3: 最终立场    │ │
│              │           │            │ (3专家时多数投票)    │ │
│              │           │            └──────────┬──────────┘ │
│              │           │                       │           │
│              │           │                       ▼           │
│              │           │            ┌─────────────────────┐ │
│              │           │            │ 共识检查             │ │
│              │           │            └──────────┬──────────┘ │
│              │           │                       │           │
│              ▼           ▼                       ▼           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 裁决检查                                             │    │
│  │ 最终裁决是 APPROVED 吗？                             │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│              ┌───────────┴───────────┐                       │
│              │                       │                       │
│          APPROVED           REQUEST_CHANGES / REJECTED       │
│              │                       │                       │
│              ▼                       ▼                       │
│         ┌────────┐           ┌─────────────────┐            │
│         │ ✅完成 │           │ 修复方案        │            │
│         └────────┘           └────────┬────────┘            │
│                                        │                     │
│                                        ▼                     │
│                              ┌─────────────────┐              │
│                              │ 重新评审        │              │
│                              │ (回到 Round 2) │              │
│                              └────────┬────────┘              │
│                                        │                     │
│                                        ▼                     │
│                              ┌─────────────────┐              │
│                              │ 继续迭代        │              │
│                              │ 直到 APPROVED   │              │
│                              └─────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

---

## Round 1: 匿名独立评审

### 为什么必须匿名？

```
如果 Expert A 知道 Expert B 的意见：
  • 可能产生 anchoring bias（锚定偏差）
  • 倾向于同意"权威"专家
  • 不敢提出相反观点
  • 独立思考被削弱
```

### 执行方式

**Expert A** 收到：
- 原始文档
- 评审模板
- 指令："独立评审，不知道其他专家意见"

**Expert B** 收到：
- 原始文档（相同）
- 评审模板（相同）
- 指令："独立评审，不知道其他专家意见"

**Expert C** (如果是3专家模式) 收到：
- 原始文档（相同）
- 评审模板（相同）
- 指令："独立评审，不知道其他专家意见"

### 输出格式

```markdown
## 独立评审 - Expert [A/B/C]

### 优点
1. [具体优点 + 文档位置]
2. [具体优点 + 文档位置]

### 问题清单

#### Critical Issues (必须修复才能批准)
1. [问题] - 位置: [行号/章节] - 修复建议: [...]
2. ...

#### Major Concerns (必须处理)
1. [问题] - 位置: [...] - 建议: [...]
2. ...

#### Minor Concerns (需要说明)
1. [问题] - 位置: [...]
2. ...

### 裁决
[APPROVED / REQUEST_CHANGES / REJECTED]

### 置信度
[X/10]

### 关键理由
1. [裁决的主要理由]
2. [次要理由]
```

---

## Round 2: 交换意见

### 执行方式

**Expert A** 收到：
- 原始文档
- Expert B 的评审（匿名，显示为"Expert B"）
- Expert C 的评审（如果是3专家模式）
- 指令："响应其他专家的关切，是否调整你的立场？"

**Expert B** 收到：
- 原始文档
- Expert A 的评审
- Expert C 的评审（如果是3专家模式）
- 指令："响应其他专家的关切，是否调整你的立场？"

**Expert C** (如果是3专家模式) 收到：
- 原始文档
- Expert A 的评审
- Expert B 的评审
- 指令："响应其他专家的关切，是否调整你的立场？"

### 输出格式

```markdown
## Round 2 Response - Expert [A/B/C]

### 响应其他专家关切

**Expert [X] 提到: [问题]**
- 我的立场: [同意/部分同意/不同意]
- 理由: [...]
- 如果同意: 我会将此问题加入我的问题清单

**Expert [Y] 提到: [问题]**
- 我的立场: [...]
- 理由: [...]

### 更新后问题清单

#### Critical Issues
[保留原有 + 新增同意的问题]

#### Major Concerns
[保留原有 + 新增同意的问题]

#### Minor Concerns
[保留原有 + 新增同意的问题]

### 更新后裁决
[APPROVED / REQUEST_CHANGES / REJECTED]

### 更新后置信度
[X/10]

### 立场变化说明
[是否变化，为什么]
```

---

## Round 3: 最终立场 (如需要)

### 触发条件

- Round 2 后仍无共识
- 2专家模式：裁决不一致
- 3专家模式：无 >=2/3 多数

### 执行方式

所有专家提交最终绑定立场：

```markdown
## Round 3 Final Position - Expert [A/B/C]

### 最终裁决
[APPROVED / REQUEST_CHANGES / REJECTED]

### 最终置信度
[X/10]

### 关键理由
1. [主要理由]
2. [次要理由]

### 与其他专家的差异
[我与其他专家的主要分歧点]
```

### 3专家模式的多数投票

如果 Round 3 后仍无完全一致：
- 2/3 或 3/3 同意 → 多数裁决生效
- 记录少数派意见
- 继续后续流程

---

## 修复与重新评审

### 如果最终裁决是 REQUEST_CHANGES 或 REJECTED

**必须执行**:

1. **修复方案**
   - 针对所有 Critical Issues 修复
   - 针对所有 Major Concerns 处理
   - 记录修复决策

2. **重新评审**
   - 回到 Round 2 (不是 Round 1)
   - 所有专家参与
   - 验证修复是否正确

3. **迭代**
   - 如果仍 REQUEST_CHANGES → 继续修复 → 重新评审
   - 直到 APPROVED

### 修复报告格式

```markdown
## 修复报告

### Critical Issues 修复

| Issue | 修复方案 | 文档位置 |
|-------|---------|---------|
| [问题1] | [修复内容] | [行号/章节] |
| [问题2] | [修复内容] | [行号/章节] |

### Major Concerns 处理

| Concern | 处理方案 | 位置 |
|---------|---------|------|
| [关切1] | [处理内容] | [...] |

### Minor Concerns 说明

| Concern | 说明 |
|---------|------|
| [关切1] | [为什么这样处理] |

### 请求重新评审
请各位专家验证修复是否正确。
```

---

## 终止条件

### 评审循环限制

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_review_rounds` | 5 | 最大评审轮数 |
| `timeout` | 60min | 单次评审超时 |
| `consensus_threshold` | 91% | 问题共识阈值 |

### 超过限制

如果超过 `max_review_rounds` 仍未 APPROVED:
1. 生成"未达成共识报告"
2. 列出剩余分歧点
3. **报告给人，由人决策**

---

## Terminal State Checklist

<MANDATORY-CHECKLIST>

### ⚠️ 门禁强制执行说明

**以下检查项是强制的门禁，不是"建议"或"提示"。**

**系统实现要求**：
- 在声明"评审完成"前，必须自动验证所有检查项
- 如果任何检查项失败，必须 BLOCK 并提示用户
- 不能跳过检查项，不能"信任"人工确认

---

### 你只能在以下条件全部满足后声明"Delphi review complete":

**Pre-requisites:**
- [ ] Phase 0 完成：文档验证，专家分配
- [ ] Round 1 完成：所有专家匿名独立评审
- [ ] Round 2 完成：所有专家交换意见
- [ ] Round 3+ (如需)：最终立场/多数投票

**CRITICAL - 共识验证:**
- [ ] 问题共识比例 >=91%
- [ ] 所有 Critical Issues 已解决
- [ ] 所有 Major Concerns 已处理

**CRITICAL - 裁决检查:**
- [ ] 最终裁决是 **APPROVED** 或 **APPROVED_WITH_MINOR**
- [ ] 如果 REQUEST_CHANGES → 已修复 → 已重新评审 → APPROVED

**Final Requirements:**
- [ ] 共识报告生成并保存
- [ ] 用户已确认报告

**IF 裁决是 REQUEST_CHANGES 或 REJECTED:**
- **CANNOT claim complete**
- **MUST 修复并重新评审**
- **CANNOT 记录问题然后继续**

**IF 任何条件未满足:**
- **CANNOT claim complete**
- **MUST BLOCK 并通知用户**

**⭐ APPROVED 后必做 (design mode)：调用 specification-generator**

IF mode == `design` AND 最终裁决是 APPROVED，评审完成后必须提示用户下一步：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ✅ DELPHI REVIEW APPROVED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

设计文档已通过评审，现在可以进入下一阶段。

⭐ Next Step: 生成或更新 specification.yaml

设计文档已稳定，请调用 specification-generator 生成/更新规范文件：

  /specification-generator

或直接回答 "generate spec"，我将自动调用 specification-generator。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**为什么必须调用 specification-generator？**

1. specification.yaml 是 test-specification-alignment 的输入
2. 没有 specification.yaml → test-specification-alignment 进入 legacy mode（不推荐）
3. 每次 APPROVED 后都应该检查并更新 specification.yaml

**门禁代码示例**:
```typescript
function validateTerminalState(reviewResult: DelphiResult): TerminalState {
  const checks = {
    phase0Complete: reviewResult.phase0 !== null,
    round1Complete: reviewResult.round1.verdicts.length > 0,
    round2Complete: reviewResult.round2.verdicts.length > 0,
    consensusThreshold: reviewResult.consensusRatio >= 0.91,
    criticalIssuesResolved: reviewResult.criticalIssues.every(i => i.resolved),
    majorConcernsHandled: reviewResult.majorConcerns.every(c => c.handled),
    verdictApproved: reviewResult.finalVerdict === 'APPROVED',
    reportSaved: reviewResult.reportPath !== null,
    userConfirmed: reviewResult.userConfirmation === true,
  };

  const allPassed = Object.values(checks).every(v => v);

  if (!allPassed) {
    return {
      status: 'BLOCKED',
      failedChecks: Object.entries(checks)
        .filter(([_, v]) => !v)
        .map(([k]) => k),
      message: '评审未完成，必须满足所有条件才能继续',
    };
  }

  return { status: 'APPROVED', message: '评审完成' };
}
```

---

### code-walkthrough mode 额外检查项

**只在 `--mode code-walkthrough` 时适用：**

**Pre-requisites (MANDATORY - BLOCK if missing):**
- [ ] OpenCode CLI 已安装且可用
- [ ] Expert A 模型 API 可用
- [ ] Expert B 模型 API 可用
- [ ] 变更大小在阈值内（文件 ≤20，行数 ≤500）
- [ ] Expert A 完成匿名评审
- [ ] Expert B 完成匿名评审
- [ ] 共识检查完成

**CRITICAL - 共识验证 (code-walkthrough):**
- [ ] 至少 2/2 或 2/3 专家 APPROVED
- [ ] 无 Critical Issues 未解决
- [ ] 无 Major Issues 未处理（或有处理计划）

**Final Requirements (code-walkthrough):**
- [ ] 共识报告已生成
- [ ] 问题已记录（如有）
- [ ] `.code-walkthrough-result.json` 已写入项目根目录
- [ ] 结果文件 commit hash 匹配当前 HEAD
- [ ] 结果文件未过期 (< 1小时)

**IF 任何 Pre-requisite 缺失:**
- **CANNOT 允许推送**
- **MUST BLOCK 并通知用户**
- **用户必须修复环境问题后重试**

**IF 有 Critical Issues:**
- **CANNOT 允许推送**
- **MUST 修复后重新走查**

**IF 超过大小阈值:**
- **CANNOT 允许推送**
- **MUST BLOCK 并提示拆分变更**
- **用户可明确授权跳过（需确认风险）**

**⭐ APPROVED 后必做 (code-walkthrough mode)：写入结果文件**

IF mode == `code-walkthrough` AND 最终裁决是 APPROVED，评审完成后必须：

1. 写入 `.code-walkthrough-result.json` 到项目根目录
2. 验证 JSON 格式有效
3. 验证 commit hash 匹配当前 HEAD
4. 验证 expires 字段 = timestamp + 1小时

</MANDATORY-CHECKLIST>

---

## Anti-Patterns

### ❌ 错误：声称完成但未 APPROVED

```
Round 1 → Round 2 → Round 3
→ 专家说 REQUEST_CHANGES
→ 生成报告说"评审完成"
→ 没有修复
→ 没有重新评审

❌ 这是错的！
```

### ✅ 正确：迭代直到 APPROVED

```
Round 1 → Round 2 → Round 3
→ 专家说 REQUEST_CHANGES
→ 修复方案
→ 重新评审 (Round 2)
→ 如果仍 REQUEST_CHANGES → 继续修复 → 重新评审
→ 直到 APPROVED
→ 生成最终共识报告
```

### ❌ 错误：只处理"关键"问题

```
Expert A: "Critical 1, Major 2, Minor 3"
Expert B: "Critical 1, Major 4"
→ 只处理 Critical 1

❌ 这是错的！零容忍原则要求处理所有问题。
```

### ✅ 正确：零容忍

```
→ 处理 Critical 1
→ 处理 Major 2, 4
→ 说明 Minor 3
→ 所有问题都有对应处理
```

### code-walkthrough mode Anti-Patterns

**只在 `--mode code-walkthrough` 时适用：**

| 错误 | 正确 |
|------|------|
| Expert 不可用时跳过走查 | BLOCK + 提示用户修复环境 |
| 超过阈值自动跳过走查 | BLOCK + 提示用户拆分变更 |
| 超过阈值自动分批评审 | BLOCK + 用户决定是否拆分或授权跳过 |
| OpenCode CLI 缺失时允许推送 | BLOCK + 提示用户安装 OpenCode |
| 模型 API 错误时降级单模型 | BLOCK + 提示用户检查 API 配置 |
| 未写入 `.code-walkthrough-result.json` 就声明完成 | MUST 写入结果文件后才能完成 |
| 结果文件 commit hash 不匹配 | MUST 重新执行走查 |

---

## 示例工作流

### 场景：需求文档评审

```
User: "评审这个需求文档: [文档]"

→ 配置: experts=3 (需求文档重要)

→ Round 1: Expert A/B/C 独立评审（使用各自配置的模型）
   - Expert A: REQUEST_CHANGES (2 Critical, 3 Major)
   - Expert B: REQUEST_CHANGES (1 Critical, 2 Major)
   - Expert C: APPROVED (0 Critical, 1 Major)

→ 共识检查: 1/3 APPROVED, 问题共识 60%
→ 状态: 需要继续

→ Round 2: 交换意见
   - Expert A 看到 Expert B 和 C 的评审
   - Expert B 看到 Expert A 和 C 的评审
   - Expert C 看到 Expert A 和 B 的评审

→ Round 2 结果:
   - Expert A: REQUEST_CHANGES (维持)
   - Expert B: REQUEST_CHANGES (维持)
   - Expert C: REQUEST_CHANGES (调整为同意 Critical 1)

→ 共识检查: 0/3 APPROVED, 问题共识 85%
→ 状态: 仍未 APPROVED

→ Round 3: 最终立场
   - 所有专家维持 REQUEST_CHANGES

→ 裁决: REQUEST_CHANGES

→ 修复方案: 针对所有 Critical Issues 修复

→ 重新评审 (Round 2 起步)
   - Expert A: APPROVED
   - Expert B: APPROVED
   - Expert C: APPROVED

→ 共识: 100% APPROVED

→ ✅ Delphi Complete
```

---

## Red Flags

| 借口 | 现实 |
|------|------|
| "这只是小变更" | 所有变更都需要评审 |
| "用户很急" | 跳过评审会导致更多返工 |
| "我可以自己评审" | 自我评审违背独立原则 |
| "一个专家够了" | 一个专家会错过问题 |
| "评审是官僚主义" | 评审是投资，不是开销 |
| "Round 1 就够了" | 不够，必须多轮直到共识 |
| "专家几乎一致" | "几乎" = 不一致，继续 |
| "生成报告就完成了" | APPROVED 才算完成 |
| "只处理关键问题" | 零容忍，处理所有问题 |
| "2/3 同意就是共识" | 还要检查问题是否一致 |
| "流程太长" | 得到可行方案比快更重要 |

---

## 成功标准

**Delphi 评审完成的唯一标准：**

1. ✅ 所有专家裁决 APPROVED
2. ✅ 问题共识 >=91%
3. ✅ 所有 Critical Issues 已修复验证
4. ✅ 所有 Major Concerns 已处理
5. ✅ 共识报告已生成
6. ✅ 用户已确认

**缺少任何一项 = 未完成**