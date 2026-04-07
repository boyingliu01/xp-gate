---
name: code-walkthrough
description: "Post-commit 多模型代码走查。使用 Delphi 方法对 git 变更进行多专家评审。自动触发：git push 前。确保代码质量零遗漏。零降级原则：环境/资源问题必须阻断并通知用户。"
---

# Code Walkthrough - Post-commit 多模型代码走查

## 核心原则

**只有一个目的：确保所有代码变更经过多专家独立评审且达成共识。**

### 五大特性

1. **匿名性** — Expert A/B 互不知道对方意见
2. **迭代共识** — 多轮直到 APPROVED
3. **零容忍** — Critical Issues 必须修复
4. **零降级** — 环境/资源问题必须阻断，通知用户解决
5. **强制覆盖** — 超过阈值必须 BLOCK，不能跳过

---

## 触发条件

### 自动触发
- `git push` 前（通过 pre-push hook）

### 手动触发
- `/code-walkthrough` 命令
- `/review` 命令（变更评审）

---

## 流程概览

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
    ├─→ 触发 Delphi 评审
    │         │
    │         ├─→ Expert A (Qwen3.5-Plus) 匿名评审
    │         │
    │         ├─→ Expert B (MiniMax M2.5) 匿名评审
    │         │
    │         ├─→ 共识检查
    │         │      │
    │         │      ├─→ 2/2 APPROVED → 允许推送
    │         │      │
    │         │      ├─→ 分歧 → Expert C 仲裁
    │         │      │
    │         │      └─→ REQUEST_CHANGES → 阻塞推送
    │         │
    │         └─→ 返回结果
    │
    └─→ 允许/阻塞推送
```

---

## Agent 配置

| 专家 | 模型 | 角色 |
|------|------|------|
| Expert A | Qwen3.5-Plus | 架构 + 设计评审 |
| Expert B | MiniMax M2.5 | 实现 + 代码质量评审 |
| Expert C (仲裁) | Qwen3.5-Plus | 冲突裁决 |

---

## 评审维度

### 必检项

| 维度 | 检查内容 |
|------|---------|
| **正确性** | 逻辑是否正确，边界条件是否处理 |
| **安全性** | 是否有注入、泄露、越权风险 |
| **可维护性** | 命名、结构、注释是否清晰 |
| **测试覆盖** | 是否有足够的测试 |

### 选检项（根据变更类型）

| 变更类型 | 额外检查 |
|---------|---------|
| API 变更 | 接口兼容性、文档更新 |
| 数据库变更 | 迁移脚本、回滚方案 |
| 性能敏感 | 性能测试、基准对比 |

---

## 输出格式

### Expert 评审输出

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

### 共识报告

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

---

## 共识标准

| 条件 | 结果 |
|------|------|
| 2/2 APPROVED + 无 Critical Issues | ✅ 允许推送 |
| 2/2 APPROVED + 有 Minor Issues | ✅ 允许推送（记录问题） |
| 1/2 APPROVED | ⚠️ 需要 Expert C 仲裁 |
| 0/2 APPROVED | ❌ 阻塞推送 |
| 有 Critical Issues | ❌ 阻塞推送 |
| 有 Major Issues 且未处理 | ❌ 阻塞推送 |

---

## 与现有系统集成

| 集成点 | 说明 |
|--------|------|
| `pre-push` hook | 自动触发代码走查 |
| `delphi-review` skill | 复用 Delphi 评审逻辑 |
| `gstack-ship` | 推送后进入发布流程 |
| `verification-loop` | 走查通过后运行验证 |

---

## 成本控制 (零降级原则)

| 指标 | 阈值 | 处理 |
|------|------|------|
| 单次走查成本 | ~$0.03 | 正常执行 |
| 最大评审文件数 | 20 个文件 | 超过 → **BLOCK** |
| 最大 diff 行数 | 500 行 | 超过 → **BLOCK** |

**超过阈值处理 (零降级)**:
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

**设计原则**:
- 大变更跳过评审 = 质量风险泄露到生产环境
- 用户有权决定是否接受风险，AI 不能自动跳过

---

## Agent 可用性检查 (MANDATORY)

### 启动前检查

```
BEFORE code walkthrough:
  ├─ 检查 Expert A 模型可用性 (Qwen3.5-Plus)
  ├─ 检查 Expert B 模型可用性 (MiniMax M2.5)
  ├─ 检查 Expert C 模型可用性（仲裁时需要）
  └─ 检查 OpenCode CLI 可用性

IF 任何检查失败:
  → BLOCK 推送
  → 通知用户具体缺失项
  → 提供修复指引
  → ❌ 禁止跳过走查直接推送
```

### 模型不可用处理

| 情况 | 处理 |
|------|------|
| Expert A API 错误 | BLOCK + 提示用户检查 Qwen API key |
| Expert B API 错误 | BLOCK + 提示用户检查 MiniMax API key |
| OpenCode CLI 缺失 | BLOCK + 提示用户安装 OpenCode |

---

## Terminal State Checklist

<MANDATORY-CHECKLIST>

### 只能在以下条件全部满足后允许推送：

**Pre-requisites (MANDATORY - BLOCK if missing):**
- [ ] OpenCode CLI 已安装且可用
- [ ] Expert A 模型 (Qwen3.5-Plus) API 可用
- [ ] Expert B 模型 (MiniMax M2.5) API 可用
- [ ] 变更大小在阈值内（文件 ≤20，行数 ≤500）
- [ ] Expert A 完成匿名评审
- [ ] Expert B 完成匿名评审
- [ ] 共识检查完成

**CRITICAL - 共识验证:**
- [ ] 至少 2/2 或 2/3 专家 APPROVED
- [ ] 无 Critical Issues 未解决
- [ ] 无 Major Issues 未处理（或有处理计划）

**Final Requirements:**
- [ ] 共识报告已生成
- [ ] 问题已记录（如有）

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

</MANDATORY-CHECKLIST>

---

## Anti-Patterns

| 错误 | 正确 |
|------|------|
| Expert 不可用时跳过走查 | BLOCK + 提示用户修复环境 |
| 超过阈值自动跳过走查 | BLOCK + 提示用户拆分变更 |
| 超过阈值自动分批评审 | BLOCK + 用户决定是否拆分或授权跳过 |
| OpenCode CLI 缺失时允许推送 | BLOCK + 提示用户安装 OpenCode |
| 模型 API 错误时降级单模型 | BLOCK + 提示用户检查 API 配置 |