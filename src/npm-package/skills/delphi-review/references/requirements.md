# Requirements Mode Reference

> Extracted from `SKILL.md`. This file contains ALL content specific to the `requirements` mode of Delphi Review.

---

## Overview

需求评审模式，用于 grill-with-docs 完成共享理解后、设计文档生成前，对需求完整性进行轻量级多专家 Delphi 评审。

**触发命令**: `/delphi-review --mode requirements`

**设计背景**: Issue #368 识别出原始意图中"需求评审一次 + 设计评审一次"的第一次评审被完全丢弃。本模式恢复该评审点，在需求探索（grill-with-docs）与设计文档生成之间插入一道轻量质量门禁。

**定位**:
- **固定三专家**: architecture + technical + feasibility，最多 5 轮
- **需求焦点**: 评审对象是需求陈述 + CONTEXT.md，不是设计文档或代码
- **程序化阻塞**: 输出 `requirements-reviewed.json`，由 `phase-transition 2 completed` 校验
- **防陈旧绑定**: `requirements_hash`（SHA-256）绑定需求内容，防止旧证据复用

---

## Five Core Properties

1. **匿名性** — Expert A/B/C 互不知道对方意见（Round 1）
2. **迭代共识** — GAPS_FOUND 时回到 grill-with-docs 补充，最多 5 轮循环
3. **关键缺口零容忍** — Critical requirement gaps 必须在进入设计前解决
4. **防陈旧绑定** — requirements_hash 绑定需求内容 + CONTEXT.md，旧证据不可复用
5. **执行可验证** — 三个专家都必须成功返回结构化结果，且 requested_model 三个 distinct

---

## 触发条件

- **自动触发**: sprint-flow Phase 2 THINK 链中，grill-with-docs 完成后、设计文档生成前（参见 `skills/sprint-flow/references/phase-2-design.md` Step 2）
- **手动触发**: `/delphi-review --mode requirements`

**⚠️ 重要调用方式说明**:

- ✅ **正确**: sprint-flow 编排层在 Phase 2 Step 2 自动调用
- ✅ **正确**: 在 Agent session 中执行 `/delphi-review --mode requirements`
- ❌ **错误**: 在设计文档已生成后调用（应在设计前）
- ❌ **错误**: 用 requirements 模式评审设计文档或代码（那是 design / code-walkthrough 模式的职责）

**与 sprint-flow 的集成**:

```
sprint-flow Phase 2 THINK:
  Step 0: CONTEXT.md 预检
  Step 1: grill-with-docs（需求访谈）
  Step 2: delphi-review --mode requirements  ← 本模式
  Step 3: 原生设计文档生成
  Step 4: HARD-GATE（用户审批设计文档）
```

所有 Sprint 路径都执行 R1。Force level 只调整上下文深度和后续迭代预算，不跳过需求评审，也不减少三位专家执行。

---

## 流程概览

```
grill-with-docs (completed)
    │
    ▼
delphi-review --mode requirements
    │
    ├─→ Context gather: CONTEXT.md + grill session summary + user requirements statement
    │
    ├─→ Expert A (architecture) anonymous review — focus: requirements completeness,
    │                                              requirement→AC coverage, scenario coverage
    │
   ├─→ Expert B (technical) anonymous review — focus: technical clarity and edge cases
   │
   ├─→ Expert C (feasibility) anonymous review — focus: testability of acceptance criteria,
    │                                              user persona clarity, scope boundaries
    │
    ├─→ Consensus check
    │      │
    │      ├─→ All three APPROVED → write requirements-reviewed.json verdict=APPROVED
    │      │
    │      └─→ Any GAPS_FOUND → record gaps, set verdict=GAPS_FOUND
    │
    └─→ Return to sprint-flow orchestrator
         │
         ├─→ APPROVED → proceed to design doc generation
         └─→ GAPS_FOUND → loop back to grill-with-docs (up to 5 total rounds)
```

---

## 专家角色

| 专家 | 视角 | 配置 |
|------|------|------|
| Expert A (architecture) | 需求完整性 + 需求→AC 映射 + 场景覆盖 | `.delphi-config.json` → `experts.architecture` |
| Expert B (technical) | 技术清晰度 + 边界条件 + 实现约束 | `.delphi-config.json` → `experts.technical` |
| Expert C (feasibility) | AC 可测试性 + 用户画像 + 范围边界 | `.delphi-config.json` → `experts.feasibility` |

> 三个角色必须使用三个 distinct trimmed executable model IDs。Provider、vendor、gateway 和模型国籍均不受限制；一个 provider 和 token plan 可以服务全部三个角色。

**专家选择理由**:
- **architecture 专家**: 天然映射范围/覆盖到需求层面——需求完整性、需求→AC 映射、场景覆盖、领域术语一致性
- **feasibility 专家**: 天然映射可测试性/假设到验收标准——AC 可测试性、用户画像清晰度、范围边界、隐含假设
- **technical 专家**: 检查需求中的技术清晰度、边界条件和实现约束

---

## 评审焦点（模式切换指令）

### Expert A (architecture) — 需求模式焦点

| 维度 | 检查内容 |
|------|---------|
| **需求完整性** | 所有用户场景是否已覆盖，是否有遗漏的用例路径 |
| **需求→AC 映射** | 每个需求是否有对应的验收标准，映射是否完整 |
| **场景覆盖** | 正常流、异常流、边界场景是否均已识别 |
| **领域术语一致性** | 需求陈述中的术语是否与 CONTEXT.md 领域模型一致（交叉引用） |
| **AC 精确度** | 验收标准是否具体、可度量、无歧义 |

### Expert C (feasibility) — 需求模式焦点

| 维度 | 检查内容 |
|------|---------|
| **AC 可测试性** | 每个验收标准是否可被自动化或手动测试验证 |
| **用户画像清晰度** | 目标用户/角色是否明确定义，场景是否贴合真实使用 |
| **范围边界清晰度** | 需求边界（in-scope vs out-of-scope）是否明确划定 |
| **需求间依赖** | 需求之间是否存在隐含依赖或冲突 |
| **隐含假设** | 是否存在未明确声明的假设（技术、业务、环境） |

---

## 共识标准

| 条件 | 结果 |
|------|------|
| 3/3 successful APPROVED + 无 Critical gaps | ✅ verdict=APPROVED，进入设计文档生成 |
| 3/3 successful APPROVED + 有 Minor gaps | ✅ verdict=APPROVED（记录 gaps 供参考） |
| 任一专家失败或缺失 | ❌ BLOCK，不能聚合或降级 |
| 任一专家 GAPS_FOUND | ❌ verdict=GAPS_FOUND，记录 gaps |
| 有 Critical requirement gaps | ❌ verdict=GAPS_FOUND |

**共识要求**: 三个成功结果全部参与聚合，达到 >=90% 且最终 APPROVED。单个专家结果不能代表全局批准。

---

## 循环控制（Loop Semantics）

```
Round 1: delphi-review --mode requirements
    │
    ├─→ APPROVED → 完成，进入设计文档生成
    │
    └─→ GAPS_FOUND
          │
          ├─→ gaps 记录到 requirements-reviewed.json
          ├─→ 返回 sprint-flow → grill-with-docs 补充访谈
          │
          ▼
Round 2: delphi-review --mode requirements（带 Round 1 gaps 上下文）
    │
    ├─→ APPROVED → 完成，进入设计文档生成
    │
    └─→ GAPS_FOUND
          │
          └─→ escalation_needed: true
              → sprint-flow Phase 2 处理升级 UX（交用户决策）
```

**硬性限制**:
- **最多 5 轮**（Round 1 + 可选后续轮次）
- **禁止无界循环** — Round 5 后仍 GAPS_FOUND 必须升级
- **Round 2 上下文**: 专家看到 Round 1 的 gaps 列表，评估是否已修复
- **升级语义**: `escalation_needed: true` 写入 requirements-reviewed.json，sprint-flow 负责 UX

---

## 输出格式

### 证据文件: `.sprint-state/phase-outputs/requirements-reviewed.json`

```json
{
  "mode": "requirements",
  "verdict": "APPROVED",
  "timestamp": "2026-07-25T10:30:00Z",
  "consensus_ratio": 1.0,
  "requirements_hash": "7f650ddf715ebe75ca0317efa1e8618ae39d2c0bafea7a6f85aacfdbf3735a5f",
  "head_commit": "abc123def456789...",
  "context_file_used": null,
  "round": 1,
   "expert_verdicts": [
     { "role": "architecture", "verdict": "APPROVED", "confidence": 9, "result_type": "delphi_expert_result", "requested_model": "bailian-tp/qwen-plus" },
     { "role": "technical", "verdict": "APPROVED", "confidence": 8, "result_type": "delphi_expert_result", "requested_model": "bailian-tp/deepseek-v3" },
     { "role": "feasibility", "verdict": "APPROVED", "confidence": 8, "result_type": "delphi_expert_result", "requested_model": "bailian-tp/glm-4.5" }
   ],
  "requirements_statement": "实现用户注册流程，支持邮箱验证和密码重置",
  "gaps_found": [],
  "rounds_used": 1,
  "escalation_needed": false
}
```

### GAPS_FOUND 示例

```json
{
  "mode": "requirements",
  "verdict": "GAPS_FOUND",
  "timestamp": "2026-07-25T10:30:00Z",
  "consensus_ratio": 0.67,
  "requirements_hash": "7f650ddf715ebe75ca0317efa1e8618ae39d2c0bafea7a6f85aacfdbf3735a5f",
  "head_commit": "abc123def456789...",
  "context_file_used": null,
  "round": 1,
  "expert_verdicts": [
    { "role": "architecture", "verdict": "APPROVED", "confidence": 8, "result_type": "delphi_expert_result", "requested_model": "provider/model-a" },
    { "role": "technical", "verdict": "GAPS_FOUND", "confidence": 7, "result_type": "delphi_expert_result", "requested_model": "provider/model-b" },
    { "role": "feasibility", "verdict": "APPROVED", "confidence": 8, "result_type": "delphi_expert_result", "requested_model": "provider/model-c" }
  ],
  "requirements_statement": "实现用户注册流程，支持邮箱验证和密码重置",
  "gaps_found": [
    "密码重置的过期时间未定义",
    "邮箱验证失败的重试策略缺失",
    "AC-003 不可测试：'系统应快速响应' 无量化指标"
  ],
  "rounds_used": 1,
  "escalation_needed": false
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | string | 固定值 `"requirements"` |
| `verdict` | string | `APPROVED` 或 `GAPS_FOUND` |
| `timestamp` | string | 评审完成时间 (ISO 8601 UTC) |
| `consensus_ratio` | number | 三位专家的共识比例；APPROVED 必须为 `0.90` 至 `1.0` |
| `requirements_hash` | string | SHA-256 hex digest（防陈旧绑定，见下文） |
| `head_commit` | string | 当前 `git rev-parse HEAD` |
| `context_file_used` | string \| null | 项目根目录内引用的 context 文件相对路径；未使用时为 `null` 或空字符串 |
| `round` | number | 当前轮次（1 至 5） |
| `expert_verdicts` | array | 三位专家的成功结构化结果，包含 `result_type` 和 `requested_model` |
| `requirements_statement` | string | 被评审需求的简短摘要 |
| `gaps_found` | array | GAPS_FOUND 时的缺口列表（APPROVED 时为空数组） |
| `rounds_used` | number | 实际使用的轮次数 |
| `escalation_needed` | boolean | Round 5 后仍 GAPS_FOUND 时为 `true` |

### 状态文件: `.sprint-state/delphi-reviewed.json`

APPROVED 时同步写入状态文件（与 design / code-walkthrough 模式一致）:

```json
{
  "mode": "requirements",
  "timestamp": "2026-07-25T10:30:00Z",
  "verdict": "APPROVED",
  "consensus_ratio": 1.0
}
```

> 此文件供 `verify-consensus.sh` 校验。GAPS_FOUND 时**不写入**此文件（评审未完成）。

---

## Hash 绑定（防陈旧绑定 — §8.4）

`requirements_hash` = SHA-256 of:

```
requirements_statement + CONTEXT.md content + ISO timestamp prefix (YYYY-MM-DD)
```

**计算规则**:
1. 从 evidence `timestamp` 解析严格有效的 ISO 8601 UTC 时间，并取其 `YYYY-MM-DD` 前缀
2. 若 `context_file_used` 非空，只允许项目根目录内的相对路径；拒绝绝对路径、`..` 穿越、缺失/非普通文件，以及 realpath 逃出项目根目录的符号链接
3. 按 UTF-8 原样读取 context 文件，不添加分隔符或换行；拼接精确字符串 `requirements_statement + context content + YYYY-MM-DD`
4. 对拼接结果计算 SHA-256；生成值使用 64 位小写 hex，校验时大小写不敏感
5. 未使用 context 时，精确拼接 `requirements_statement + YYYY-MM-DD`

**目的**: 防止旧证据复用。`phase-transition 2 completed` 校验时：
- 文件必须存在
- `verdict` 必须为 `APPROVED`
- `requirements_hash` 必须为 64 位 hex，并与运行时重新计算值匹配
- 若 hash 与当前需求内容不匹配 → BLOCK（防陈旧绑定）

**与 phase-transition.js 的集成**:

```javascript
// EVIDENCE_FILES[2] — 已存在于 phase-transition.js
{
  path: '.sprint-state/phase-outputs/requirements-reviewed.json',
  requiredFields: [
    'verdict', 'requirements_statement', 'timestamp', 'consensus_ratio',
    'expert_verdicts', 'head_commit', 'requirements_hash'
  ],
  blockingCheck: (data) => data.verdict === 'APPROVED',
  blockingMessage: 'Requirements review verdict is not APPROVED',
}
```

---

## 证据文件路径

| 文件 | 路径 | 校验时机 | 校验方 |
|------|------|----------|--------|
| requirements-reviewed.json | `.sprint-state/phase-outputs/` | `phase-transition 2 completed` | phase-transition.js Layer 2 |
| delphi-reviewed.json | `.sprint-state/` | verify-consensus.sh | verify-consensus.sh |

---

## Anti-Patterns

**只在 `--mode requirements` 时适用：**

| ❌ Don't | ✅ Do | Why |
|----------|------|-----|
| 使用少于 3 个专家 | 必须使用 architecture + technical + feasibility | 三个角色共同构成全局证据 |
| 无界循环评审 | 最多 5 轮，之后升级 | 防止无限循环 |
| 跳过 CONTEXT.md 交叉引用 | 始终交叉引用领域术语 | 需求应使用 CONTEXT.md 中的规范术语 |
| 输出泛化批准 | 输出 hash 绑定的需求陈述 | 防陈旧绑定（§8.4，Round 1 设计反馈 #14） |
| 接受单个专家批准 | 要求三份成功结果参与聚合，并达到 >=90% 共识 | 单个结果不能代表全局批准 |
| Round 2 中复用 Round 1 gaps 作为新发现 | Round 2 专家获得 Round 1 gaps 上下文 | 迭代改进，避免重复劳动 |
| 评审设计文档或代码 | 仅评审需求陈述 + CONTEXT.md | 设计/代码评审是 design / code-walkthrough 模式的职责 |
| GAPS_FOUND 时写入 delphi-reviewed.json | 仅 APPROVED 时写入状态文件 | GAPS_FOUND 表示评审未完成 |
| 在 lightweight sprint 中减少或跳过 R1 | 所有路径都执行三专家 R1，仅缩短上下文 | Force level 不改变专家数或批准证据 |

---

## Security Notes

- **只读评审**: requirements 模式不修改任何源文件，仅写入证据文件到 `.sprint-state/`
- **Hash 完整性**: `requirements_hash` 使用 SHA-256，防止需求内容被篡改后复用旧证据
- **Commit 绑定**: `head_commit` 记录评审时的 git HEAD，提供时间线追溯
- **调用边界**: 评审内容只传递给用户配置的 callable provider；provider、vendor、gateway 和模型国籍不作额外限制
- **证据不可伪造**: phase-transition.js 程序化校验证据文件，LLM 无法绕过

---

## Triggers / Negative Triggers

**触发（requirements 模式特有）**:
- `/delphi-review --mode requirements`
- "review the requirements"
- "评审需求"
- "requirements review"
- "/requirements-review"

**不触发**:
- "review my requirements document"（教育性讨论，非执行评审）
- "requirements template"（询问模板格式）
- "how to write requirements"（教育性）
- "check my requirements"（模糊，可能是 Casual 检查）

---

## Terminal State Checklist (requirements mode)

**Pre-requisites (MANDATORY - BLOCK if missing):**
- [ ] grill-with-docs 已完成（或 CONTEXT.md 快速路径）
- [ ] 需求陈述可用（非空）
- [ ] Expert A (architecture)、Expert B (technical)、Expert C (feasibility) 均成功执行
- [ ] 三个 `requested_model` trimmed 后 distinct
- [ ] 三份结果均为 `result_type=delphi_expert_result`

**CRITICAL - 共识验证 (requirements):**
- [ ] 聚合共识 >=90%，且所有 Critical gaps 已处理
- [ ] 无 Critical requirement gaps 未解决
- [ ] requirements_hash 已计算并写入

**Final Requirements (requirements):**
- [ ] `.sprint-state/phase-outputs/requirements-reviewed.json` 已写入
- [ ] JSON 格式有效，包含所有必需字段
- [ ] verdict 为 APPROVED 或 GAPS_FOUND
- [ ] IF APPROVED: `.sprint-state/delphi-reviewed.json` 已写入（mode=requirements）
- [ ] IF GAPS_FOUND: gaps_found 数组非空，escalation_needed 正确设置
- [ ] IF Round 5 后仍 GAPS_FOUND: escalation_needed = true

**IF 任何 Pre-requisite 缺失:**
- **CANNOT 完成评审**
- **MUST BLOCK 并通知用户**

**IF GAPS_FOUND (Round 1):**
- 返回 sprint-flow → grill-with-docs 补充
- 重新执行 requirements 评审（Round 2）

**IF GAPS_FOUND (Round 5):**
- **escalation_needed = true**
- **MUST 升级给用户决策**
- **CANNOT 自动继续**

**⭐ APPROVED 后必做 (requirements mode)：写入证据文件**

IF mode == `requirements` AND 最终裁决是 APPROVED，评审完成后必须：

1. 写入 `.sprint-state/phase-outputs/requirements-reviewed.json`
2. 写入 `.sprint-state/delphi-reviewed.json`（状态文件）
3. 验证 JSON 格式有效
4. 验证 requirements_hash 为 64 位 hex 且运行时重新计算匹配
5. 验证 head_commit 匹配当前 HEAD
