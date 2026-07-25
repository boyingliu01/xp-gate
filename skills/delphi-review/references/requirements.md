# Requirements Mode Reference

> Extracted from `SKILL.md`. This file contains ALL content specific to the `requirements` mode of Delphi Review.

---

## Overview

需求评审模式，用于 grill-with-docs 完成共享理解后、设计文档生成前，对需求完整性进行轻量级多专家 Delphi 评审。

**触发命令**: `/delphi-review --mode requirements`

**设计背景**: Issue #368 识别出原始意图中"需求评审一次 + 设计评审一次"的第一次评审被完全丢弃。本模式恢复该评审点，在需求探索（grill-with-docs）与设计文档生成之间插入一道轻量质量门禁。

**定位**:
- **轻量**: 2 专家（architecture + feasibility）、最多 1 轮（循环语义下最多 2 轮）
- **需求焦点**: 评审对象是需求陈述 + CONTEXT.md，不是设计文档或代码
- **程序化阻塞**: 输出 `requirements-reviewed.json`，由 `phase-transition 2 completed` 校验
- **防陈旧绑定**: `requirements_hash`（SHA-256）绑定需求内容，防止旧证据复用

---

## Five Core Properties

1. **匿名性** — Expert A/B 互不知道对方意见（Round 1）
2. **迭代共识** — GAPS_FOUND 时回到 grill-with-docs 补充，最多 2 轮循环
3. **关键缺口零容忍** — Critical requirement gaps 必须在进入设计前解决
4. **防陈旧绑定** — requirements_hash 绑定需求内容 + CONTEXT.md，旧证据不可复用
5. **轻量但严格** — 2 专家配置，但共识要求 2/2（100%），不因轻量而降标

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

**lightweight sprint 例外**: 当 `change_type == "修改已存在代码"` 时，sprint-flow 跳过 R1 需求评审，需求维度合并入 R2 设计评审。

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
    ├─→ Expert B (feasibility) anonymous review — focus: testability of acceptance criteria,
    │                                              user persona clarity, scope boundaries
    │
    ├─→ Consensus check
    │      │
    │      ├─→ Both APPROVED → write requirements-reviewed.json verdict=APPROVED
    │      │
    │      └─→ Either GAPS_FOUND → record gaps, set verdict=GAPS_FOUND
    │
    └─→ Return to sprint-flow orchestrator
         │
         ├─→ APPROVED → proceed to design doc generation
         └─→ GAPS_FOUND → loop back to grill-with-docs (1 more round, max 2 total)
```

---

## 专家角色

| 专家 | 视角 | 配置 |
|------|------|------|
| Expert A (architecture) | 需求完整性 + 需求→AC 映射 + 场景覆盖 | `.delphi-config.json` → `experts.architecture` |
| Expert B (feasibility) | AC 可测试性 + 用户画像 + 范围边界 | `.delphi-config.json` → `experts.feasibility` |

> ⚠️ **注意**: requirements 模式**不使用** technical 专家。技术实现细节属于设计/实现阶段（design / code-walkthrough 模式），不属于需求评审范畴。

> ⚠️ **注意**: 至少配置 **两个不同 provider** 的模型。详见 [INSTALL.md](./INSTALL.md)。

**专家选择理由**（设计决策 §16.4 C3）:
- **architecture 专家**: 天然映射范围/覆盖到需求层面——需求完整性、需求→AC 映射、场景覆盖、领域术语一致性
- **feasibility 专家**: 天然映射可测试性/假设到验收标准——AC 可测试性、用户画像清晰度、范围边界、隐含假设
- **technical 专家**: 排除——技术实现细节在需求阶段尚未确定，评审无意义

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

### Expert B (feasibility) — 需求模式焦点

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
| 2/2 APPROVED + 无 Critical gaps | ✅ verdict=APPROVED，进入设计文档生成 |
| 2/2 APPROVED + 有 Minor gaps | ✅ verdict=APPROVED（记录 gaps 供参考） |
| 1/2 APPROVED, 1/2 GAPS_FOUND | ❌ verdict=GAPS_FOUND，记录 gaps |
| 0/2 APPROVED | ❌ verdict=GAPS_FOUND，记录 gaps |
| 有 Critical requirement gaps | ❌ verdict=GAPS_FOUND |

**共识要求**: 2/2 一致 APPROVED（100%）。轻量配置不降低共识标准。

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
- **最多 2 轮**（Round 1 + 可选 Round 2）
- **禁止无界循环** — Round 2 后仍 GAPS_FOUND 必须升级
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
  "requirements_hash": "a1b2c3d4e5f6...（SHA-256 hex digest）",
  "head_commit": "abc123def456789...",
  "context_file_used": "CONTEXT.md",
  "round": 1,
  "expert_verdicts": [
    { "role": "architecture", "verdict": "APPROVED", "confidence": 9 },
    { "role": "feasibility", "verdict": "APPROVED", "confidence": 8 }
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
  "requirements_hash": "a1b2c3d4e5f6...",
  "head_commit": "abc123def456789...",
  "context_file_used": "CONTEXT.md",
  "round": 1,
  "expert_verdicts": [
    { "role": "architecture", "verdict": "APPROVED", "confidence": 8 },
    { "role": "feasibility", "verdict": "GAPS_FOUND", "confidence": 7 }
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
| `requirements_hash` | string | SHA-256 hex digest（防陈旧绑定，见下文） |
| `head_commit` | string | 当前 `git rev-parse HEAD` |
| `context_file_used` | string | 引用的 CONTEXT.md 路径 |
| `round` | number | 当前轮次（1 或 2） |
| `expert_verdicts` | array | 各专家裁决（2 项：architecture + feasibility） |
| `requirements_statement` | string | 被评审需求的简短摘要 |
| `gaps_found` | array | GAPS_FOUND 时的缺口列表（APPROVED 时为空数组） |
| `rounds_used` | number | 实际使用的轮次数 |
| `escalation_needed` | boolean | Round 2 后仍 GAPS_FOUND 时为 `true` |

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
1. 拼接: `requirements_statement` 字符串 + `CONTEXT.md` 文件完整内容（若存在）+ 当日日期前缀 `YYYY-MM-DD`
2. 对拼接结果计算 SHA-256 hex digest
3. 若 CONTEXT.md 不存在，仅拼接 `requirements_statement` + 日期前缀

**目的**: 防止旧证据复用。`phase-transition 2 completed` 校验时：
- 文件必须存在
- `verdict` 必须为 `APPROVED`
- `requirements_hash` 必须为非空字符串
- 若 hash 与当前需求内容不匹配 → BLOCK（防陈旧绑定）

**与 phase-transition.js 的集成**（v0.17.1 已实现）:

```javascript
// EVIDENCE_FILES[2] — 已存在于 phase-transition.js
{
  path: '.sprint-state/phase-outputs/requirements-reviewed.json',
  requiredFields: ['verdict', 'requirements_hash'],
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
| 使用全部 3 个专家 | 仅使用 architecture + feasibility | 轻量配置（设计决策 §16.4 C3），technical 属设计阶段 |
| 无界循环评审 | 最多 2 轮，之后升级 | 防止无限循环（设计 §5.3 step 3） |
| 跳过 CONTEXT.md 交叉引用 | 始终交叉引用领域术语 | 需求应使用 CONTEXT.md 中的规范术语 |
| 输出泛化批准 | 输出 hash 绑定的需求陈述 | 防陈旧绑定（§8.4，Round 1 设计反馈 #14） |
| 接受 1/2 APPROVED | 要求 2/2 共识（100%） | 轻量配置仍需严格共识 |
| Round 2 中复用 Round 1 gaps 作为新发现 | Round 2 专家获得 Round 1 gaps 上下文 | 迭代改进，避免重复劳动 |
| 评审设计文档或代码 | 仅评审需求陈述 + CONTEXT.md | 设计/代码评审是 design / code-walkthrough 模式的职责 |
| GAPS_FOUND 时写入 delphi-reviewed.json | 仅 APPROVED 时写入状态文件 | GAPS_FOUND 表示评审未完成 |
| 在 lightweight sprint 中执行 R1 | `change_type == "修改已存在代码"` 时跳过 R1 | 需求维度合并入 R2 设计评审 |

---

## Security Notes

- **只读评审**: requirements 模式不修改任何源文件，仅写入证据文件到 `.sprint-state/`
- **Hash 完整性**: `requirements_hash` 使用 SHA-256，防止需求内容被篡改后复用旧证据
- **Commit 绑定**: `head_commit` 记录评审时的 git HEAD，提供时间线追溯
- **无外部 API 泄露**: 评审内容仅传递给配置的国产模型 provider，不经过第三方服务
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
- [ ] Expert A (architecture) 模型 API 可用
- [ ] Expert B (feasibility) 模型 API 可用

**CRITICAL - 共识验证 (requirements):**
- [ ] 2/2 专家 APPROVED
- [ ] 无 Critical requirement gaps 未解决
- [ ] requirements_hash 已计算并写入

**Final Requirements (requirements):**
- [ ] `.sprint-state/phase-outputs/requirements-reviewed.json` 已写入
- [ ] JSON 格式有效，包含所有必需字段
- [ ] verdict 为 APPROVED 或 GAPS_FOUND
- [ ] IF APPROVED: `.sprint-state/delphi-reviewed.json` 已写入（mode=requirements）
- [ ] IF GAPS_FOUND: gaps_found 数组非空，escalation_needed 正确设置
- [ ] IF Round 2 后仍 GAPS_FOUND: escalation_needed = true

**IF 任何 Pre-requisite 缺失:**
- **CANNOT 完成评审**
- **MUST BLOCK 并通知用户**

**IF GAPS_FOUND (Round 1):**
- 返回 sprint-flow → grill-with-docs 补充
- 重新执行 requirements 评审（Round 2）

**IF GAPS_FOUND (Round 2):**
- **escalation_needed = true**
- **MUST 升级给用户决策**
- **CANNOT 自动继续**

**⭐ APPROVED 后必做 (requirements mode)：写入证据文件**

IF mode == `requirements` AND 最终裁决是 APPROVED，评审完成后必须：

1. 写入 `.sprint-state/phase-outputs/requirements-reviewed.json`
2. 写入 `.sprint-state/delphi-reviewed.json`（状态文件）
3. 验证 JSON 格式有效
4. 验证 requirements_hash 非空
5. 验证 head_commit 匹配当前 HEAD
