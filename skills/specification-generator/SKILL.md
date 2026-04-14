---
name: specification-generator
description: "从已评审的设计文档生成或更新 specification.yaml。支持 CREATE（初始创建）和 UPDATE（增量更新）两种模式。MANDATORY after delphi-review APPROVED, before xp-consensus. TRIGGER: when delphi-review completes with APPROVED verdict, or when user requests specification generation/update."
---

# Specification Generator

## 核心原则

**Specification = Requirements + Acceptance Criteria + Design Decisions + API Contracts**

**支持两种模式：CREATE（初始创建）和 UPDATE（增量更新）**

### 为什么需要增量更新？

实际项目中，需求往往分阶段演进：
1. 初始需求 → delphi-review APPROVED → specification.yaml（CREATE）
2. 新增需求 → 新设计方案 → delphi-review APPROVED → specification.yaml（UPDATE）
3. 修改需求 → 设计变更 → delphi-review APPROVED → specification.yaml（UPDATE）

**关键时机：每次 delphi-review APPROVED 后，都应该调用 specification-generator 检查并更新。**

---

## ⚠️ 双模式设计

### CREATE 模式（初始创建）

触发条件：`specification.yaml` **不存在**

```
Phase 0: 检测 specification.yaml 不存在 → CREATE 模式
Phase 1: 从 APPROVED 设计文档提取全部内容
Phase 2: 生成完整 specification.yaml
Phase 3: 验证格式
Phase 4: 用户确认
```

### UPDATE 模式（增量更新）

触发条件：`specification.yaml` **已存在**

```
Phase 0: 检测 specification.yaml 存在 → UPDATE 模式
Phase 1: 解析现有 specification.yaml + 解析新 APPROVED 文档
         ├─ 识别新增需求（不存在于现有 spec）
         ├─ 识别修改需求（描述变化）
         ├─ 识别新增 ACs
         └─ 保留现有未被修改的内容
Phase 2: 合并/追加新的 requirements 和 acceptance_criteria
Phase 3: 验证更新后格式
Phase 4: 用户确认变更摘要
```

---

## 触发条件

### 自动触发

- **每次 delphi-review APPROVED 后**（检查 CREATE/UPDATE 模式并执行）
- xp-consensus Round 1 开始前（检查 specification.yaml 是否存在，如缺失则 BLOCK）

### 手动触发

- `/specification-generator` 命令
- `/generate-spec` 命令
- `/update-spec` 命令（等同于 specification-generator）

---

## 输入来源（多文档支持）

### CREATE 模式输入

| 来源 | 文件 | 格式 | 内容 |
|------|------|------|------|
| 设计文档 | `docs/plans/YYYY-MM-DD-<topic>-design.md` | Markdown | Requirements + Design |
| 用户需求 | 原始用户输入 | 自然语言 | 需求描述 |

### UPDATE 模式输入

| 来源 | 文件 | 格式 | 内容 |
|------|------|------|------|
| 现有 Specification | `specification.yaml` | YAML | 已有 REQs/ACs/DDs |
| 新需求文档 | `docs/requirements-*.md` | Markdown | 新增 Requirements |
| 新设计文档 | `docs/plans/YYYY-MM-DD-<topic>-design.md` | Markdown | 设计变更 |
| 架构文档 | `docs/architecture*.md` | Markdown | 架构决策 |
| 任务计划 | `docs/tasks/*.md` 或 `.sisyphus/plans/*.md` | Markdown | 实现任务 |
| Specification | `specification.yaml` | YAML |
| Validation Report | `specification-validation.md` | Markdown |

---

## 核心流程

### Phase 0: 模式检测

```
┌─────────────────────────────────────────────────────────────┐
│           Phase 0: Mode Detection                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Check: specification.yaml 是否存在？                         │
│                                                              │
│  ├─ 不存在 → CREATE 模式                                      │
│  │   ├─ 检查设计文档是否存在                                   │
│  │   ├─ 检查用户需求是否明确                                   │
│  │   └─ ❌ 缺失 → BLOCK + 提示用户提供设计文档                │
│  │                                                           │
│  └─ 存在 → UPDATE 模式                                        │
│      ├─ 解析现有 specification.yaml                           │
│      ├─ 检查新 APPROVED 文档（多来源）                         │
│      │   ├─ docs/requirements-*.md                            │
│      │   ├─ docs/plans/*-design.md                            │
│      │   ├─ docs/architecture*.md                             │
│      │   └─ docs/tasks/*.md 或 .sisyphus/plans/*.md           │
│      └─ ❌ 无新文档 → SKIP（无需更新）                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### CREATE 模式流程

```
┌─────────────────────────────────────────────────────────────┐
│           CREATE Mode Flow (初始创建)                         │
├─────────────────────────────────────────────────────────────┤
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
│  ├─ 生成 REQ-XXX-001, REQ-XXX-002... (sequential)           │
│  ├─ 生成 AC-XXX-001-01, AC-XXX-001-02...                    │
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
│  Terminal State: ✅ SPECIFICATION_CREATED                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

### UPDATE 模式流程（v2 增强版）

```
┌─────────────────────────────────────────────────────────────┐
│           UPDATE Mode Flow v2 (增量更新 + 冲突检测 + 原子性)    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1: 对比分析                                            │
│  ├─ 解析现有 specification.yaml                               │
│  │   ├─ 提取现有 REQ-* IDs                                    │
│  │   ├─ 提取现有 AC-* IDs                                     │
│  │   └─ 提取现有 DD-* IDs                                     │
│  │                                                           │
│  ├─ 解析新 APPROVED 文档                                       │
│  │   ├─ 提取新 Requirements                                   │
│  │   ├─ 推断模块归属（路径/关键词）                              │
│  │   ├─ 提取新 Acceptance Criteria                            │
│  │   └─ 计算内容 hash (SHA-256)                               │
│  │                                                           │
│  ├─ 对比识别变更                                               │
│  │   ├─ **NEW_REQ**: 新文档中的需求不存在于现有 spec           │
│  │   ├─ **MODIFIED_REQ**: 新文档中需求描述与现有不同           │
│  │   ├─ **NEW_AC**: 新增的 Acceptance Criteria                │
│  │   ├─ **UNCHANGED**: 现有未修改的 requirements              │
│  │   ├─ **DEPRECATED**: 现有但新文档未提及                     │
│  │   └─ **CONFLICT**: 同ID不同hash（需人工介入）               │
│  │                                                           │
│  └─ 生成变更摘要                                               │
│                                                              │
│  Phase 1.5: 冲突检测 (v2 新增)                                  │
│  ├─ hash比对: 同ID不同描述 → CONFLICT 状态                     │
│  ├─ ❌ 发现 CONFLICT → 中断合并                               │
│  ├─ 展示冲突列表（所有来源版本）                                 │
│  ├─ 用户选择保留版本                                           │
│  └─ 解除 CONFLICT → 继续 Phase 2                             │
│                                                              │
│  Phase 2: 合并更新                                            │
│  ├─ 复制现有 specification.yaml → specification.temp.yaml    │
│  ├─ 在 temp 文件执行合并                                       │
│  ├─ 追加 NEW_REQ（模块内独立序号）                              │
│  │   └─ 例: REQ-AUTH-003 → REQ-AUTH-004                      │
│  ├─ 更新 MODIFIED_REQ（保持原 ID）                             │
│  ├─ 追加 NEW_AC 到对应 requirement                            │
│  ├─ 标记 DEPRECATED                                           │
│  │   └─ status: deprecated                                   │
│  │   └─ deprecated_at: "YYYY-MM-DD"                           │
│  └─ 计算变更 hash                                             │
│                                                              │
│  Phase 2.5: 原子合并 (v2 新增)                                  │
│  ├─ 用户确认变更摘要                                           │
│  ├─ 备份原文件: specification.yaml → specification.backup.yaml │
│  ├─ atomic rename: specification.temp.yaml → specification.yaml │
│  ├─ ❌ 中断/取消 → 删除 temp，原文件不变                        │
│  └─ 故障恢复: 检查 temp 存在则提示清理                          │
│                                                              │
│  Phase 3: 验证 (v2 新增)                                       │
│  ├─ 检查 ID 模块内连续性                                       │
│  ├─ 检查 deprecated 归档阈值（超过3版本）                       │
│  ├─ 检查 version semver 合规                                  │
│  ├─ ❌ 验证失败 → 返回 Phase 2 修复                          │
│  └─ ✅ 验证通过 → 继续                                       │
│                                                              │
│  Phase 4: 变更确认                                            │
│  ├─ 展示变更摘要（表格格式）                                    │
│  ├─ 用户确认变更                                               │
│  └─ ✅ 用户确认 → 完成                                       │
│                                                              │
│  Terminal State: ✅ SPECIFICATION_UPDATED                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```
┌─────────────────────────────────────────────────────────────┐
│           UPDATE Mode Flow (增量更新)                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 1: 对比分析                                            │
│  ├─ 解析现有 specification.yaml                               │
│  │   ├─ 提取现有 REQ-* IDs                                    │
│  │   ├─ 提取现有 AC-* IDs                                     │
│  │   └─ 提取现有 DD-* IDs                                     │
│  │                                                           │
│  ├─ 解析新 APPROVED 文档                                       │
│  │   ├─ 提取新 Requirements                                   │
│  │   ├─ 提取新 Acceptance Criteria                            │
│  │   ├─ 提取新 Design Decisions                               │
│  │   └─ 提取变更内容                                          │
│  │                                                           │
│  ├─ 对比识别变更                                               │
│  │   ├─ **NEW_REQ**: 新文档中的需求不存在于现有 spec           │
│  │   ├─ **MODIFIED_REQ**: 新文档中需求描述与现有不同           │
│  │   ├─ **NEW_AC**: 新增的 Acceptance Criteria                │
│  │   ├─ **MODIFIED_AC**: AC 内容变更                          │
│  │   ├─ **UNCHANGED**: 现有未修改的 requirements              │
│  │   └─ **DEPRECATED**: 现有但新文档未提及（标记 status）       │
│  │                                                           │
│  └─ 生成变更摘要                                               │
│      ├─ 新增需求: N 个                                         │
│      ├─ 修改需求: M 个                                         │
│      ├─ 新增 ACs: K 个                                         │
│      └─ 过时需求: P 个                                         │
│                                                              │
│  Phase 2: 合并更新                                            │
│  ├─ 保留所有 UNCHANGED requirements                           │
│  ├─ 追加所有 NEW_REQ（继续 ID 序号）                           │
│  │   └─ 例: 现有 REQ-AUTH-003, 新增 → REQ-AUTH-004            │
│  ├─ 更新 MODIFIED_REQ（保持原 ID，更新内容）                   │
│  ├─ 追加 NEW_AC 到对应 requirement                            │
│  │   └─ 例: REQ-AUTH-001 新增 AC → AC-AUTH-001-05            │
│  ├─ 标记 DEPRECATED requirements                              │
│  │   └─ status: deprecated                                   │
│  └─ 更新 version: x.y.z → x.y.(z+1)                          │
│                                                              │
│  Phase 3: 验证更新后 Specification                             │
│  ├─ 检查 ID 连续性（无跳跃）                                   │
│  ├─ 检查新增内容格式正确                                       │
│  ├─ 检查 deprecated 标记正确                                   │
│  ├─ ❌ 验证失败 → 返回 Phase 2 修复                          │
│  └─ ✅ 验证通过 → 继续                                       │
│                                                              │
│  Phase 4: 变更确认                                            │
│  ├─ 展示变更摘要                                               │
│  │   ┌──────────────────────────────────────────────┐        │
│  │   │ Specification Update Summary                  │        │
│  │   ├──────────────────────────────────────────────┤        │
│  │   │ Version: 1.0.0 → 1.0.1                       │        │
│  │   │                                              │        │
│  │   │ New Requirements:                            │        │
│  │   │   + REQ-AUTH-004: Token refresh mechanism    │        │
│  │   │   + REQ-AUTH-005: Session timeout           │        │
│  │   │                                              │        │
│  │   │ Modified Requirements:                       │        │
│  │   │   ~ REQ-AUTH-001: description updated       │        │
│  │   │                                              │        │
│  │   │ New Acceptance Criteria:                     │        │
│  │   │   + AC-AUTH-001-05: ...                     │        │
│  │   │                                              │        │
│  │   │ Deprecated:                                  │        │
│  │   │   - REQ-AUTH-002: legacy login method       │        │
│  │   └──────────────────────────────────────────────┘        │
│  │                                                           │
│  ├─ 用户确认变更                                               │
│  ├─ 用户修改 → 返回 Phase 2                                  │
│  └─ ✅ 用户确认 → 保存                                       │
│                                                              │
│  Terminal State: ✅ SPECIFICATION_UPDATED                    │
│                                                              │
└─────────────────────────────────────────────────────┘
```

---

### 变更检测规则（v2 增强）

```yaml
change_detection_rules:
  NEW_REQ:
    trigger: "新文档中的需求在现有 spec 中找不到匹配 ID"
    action: "追加新 requirement，模块内分配新序号"
    
  MODIFIED_REQ:
    trigger: "需求 ID 相同但描述内容不同（hash 不一致）"
    action: "更新描述，保持原 ID"
    
  NEW_AC:
    trigger: "新 AC 不存在于现有 requirement 的 acceptance_criteria"
    action: "追加到对应 requirement"
    
  MODIFIED_AC:
    trigger: "AC ID 相同但 Given/When/Then 内容不同"
    action: "更新 AC 内容"
    
  DEPRECATED:
    trigger: "现有 requirement 在新文档中未提及"
    action: "标记 status: deprecated + deprecated_at 时间戳"
    
  UNCHANGED:
    trigger: "需求内容 hash 完全一致"
    action: "保留，不做修改"
    
  CONFLICT:  # v2 新增
    trigger: "同 ID 在不同来源文档中出现不同描述"
    action: "标记 CONFLICT 状态，中断自动合并，展示多版本供用户选择"
    severity: CRITICAL
```

---

### Version 规则（v2 semver 规范）

```yaml
version_update_rules:
  MAJOR (x): 
    trigger: "删除 requirement 或 breaking change"
    example: "删除 REQ-AUTH-001 → 1.0.0 → 2.0.0"
    
  MINOR (y):
    trigger: "新增 requirement 或新增模块"
    example: "新增 REQ-PAYMENT-001 → 1.0.0 → 1.1.0"
    
  PATCH (z):
    trigger: "修改 AC、修改描述、新增 AC、deprecated 标记"
    example: "修改 AC-AUTH-001-01 → 1.0.0 → 1.0.1"
    
  z_进位规则:
    - z ≥ 99 时: z=0, y=y+1 (minor bump)
    - 避免 z 无限增长
```

---

### deprecated 自动归档机制（v2 新增）

```yaml
deprecated_management:
  标记: status: deprecated
  时间戳: deprecated_at: "YYYY-MM-DD"
  
  自动归档规则:
    - deprecated 超过 3 个 minor 版本
    - 自动移动到 specification-archived.yaml
    - 原文件保留 ID 占位引用
    
  归档占位格式:
    { 
      id: REQ-AUTH-001, 
      status: archived_ref, 
      ref: "specification-archived.yaml#REQ-AUTH-001" 
    }
  
  手动清理:
    /specification-generator --cleanup-deprecated
```

---

### 多文档来源优先级（v2 明确）

```yaml
document_priority:
  rules:
    1. docs/requirements-*.md       (最高优先级)
    2. docs/plans/*-design.md       (高优先级)
    3. docs/architecture*.md        (中优先级)
    4. docs/tasks/*.md              (低优先级)
    5. .sisyphus/plans/*.md         (最低优先级)
    
  conflict_resolution:
    - 高优先级覆盖低优先级
    - 同优先级: 时间戳最新优先
    - 均无法解决: CONFLICT 状态 + 人工介入
```

---

### 无实质变更检测（v2 新增）

```yaml
skip_conditions:
  rules:
    - 内容 hash 一致 (SHA-256)
    - 仅格式变化 (空格、换行)
    - 仅注释变化
    - 仅 metadata 变化 (非核心字段)
    
  detection_flow:
    1. 扫描所有输入文档
    2. 计算 hash 与上次对比
    3. 所有 hash 一致 → SKIP
    4. 输出: "No substantial changes detected. SKIP update."
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

## ID 生成规则（v2 模块前缀方案）

### REQ ID 格式

```
REQ-{MODULE}-{SEQ}
示例: REQ-AUTH-001, REQ-USER-002, REQ-API-001
```

**模块映射表（自动推断）**:

```yaml
module_mappings:
  AUTH:
    keywords: ["authentication", "auth", "login", "token", "oauth", "jwt"]
    paths: ["auth/", "authentication/", "login/"]
    
  USER:
    keywords: ["user", "profile", "account", "password"]
    paths: ["user/", "users/", "profile/"]
    
  DATA:
    keywords: ["data", "storage", "database", "cache", "model"]
    paths: ["data/", "db/", "models/"]
    
  API:
    keywords: ["api", "endpoint", "route", "handler", "rest"]
    paths: ["api/", "routes/", "handlers/"]
    
  CORE:
    keywords: ["core", "base", "util", "common", "shared"]
    paths: ["core/", "utils/", "common/"]
    
  UI:
    keywords: ["ui", "frontend", "component", "page", "view"]
    paths: ["ui/", "components/", "pages/"]
    
  TEST:
    keywords: ["test", "spec", "mock", "coverage"]
    paths: ["test/", "__tests__/"]
    
  CONFIG:
    keywords: ["config", "settings", "env", "option"]
    paths: ["config/", "settings/"]
```

**模块推断规则**:
- 从文档路径推断: `docs/plans/auth-design.md` → AUTH
- 从关键词匹配: 包含"authentication" → AUTH
- 用户手动指定: `/specification-generator --module AUTH`
- **无法推断时**: ❌ BLOCK 并提示用户指定模块

### AC ID 格式

```
AC-{MODULE}-{REQ_SEQ}-{AC_SEQ}
示例: AC-AUTH-001-01, AC-AUTH-001-02
```

### DD ID 格式

```
DD-{MODULE}-{SEQ}
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
| 1 | PHASE0_DETECTING | 模式检测中 |
| 2 | PHASE0_CREATE_MODE | CREATE 模式确认 |
| 3 | PHASE0_UPDATE_MODE | UPDATE 模式确认 |
| 4 | PHASE0_SKIP | 无新文档，无需更新 |
| 5 | PHASE1_PARSING | 解析文档中 |
| 6 | PHASE1_COMPARE_ANALYSIS | UPDATE: 对比分析中 |
| 7 | PHASE1_COMPLETE | 解析/对比完成 |
| 8 | PHASE2_GENERATING | CREATE: 生成中 |
| 9 | PHASE2_MERGING | UPDATE: 合并更新中 |
| 10 | PHASE2_COMPLETE | 生成/合并完成 |
| 11 | PHASE3_VALIDATING | 验证中 |
| 12 | PHASE3_VALIDATION_ISSUES | 验证发现问题 |
| 13 | PHASE3_COMPLETE | 验证通过 |
| 14 | PHASE4_USER_CONFIRMATION | 等待用户确认 |
| 15 | PHASE4_USER_MODIFIED | 用户修改 |
| 16 | SPECIFICATION_CREATED | CREATE 完成 |
| 17 | SPECIFICATION_UPDATED | UPDATE 完成 |
| 90 | BLOCKED_MISSING_INPUT | 缺少输入 |
| 91 | BLOCKED_VALIDATION_FAILED | 验证失败 |
| 92 | BLOCKED_NO_APPROVED_DOC | 无 APPROVED 文档 |

---

## Terminal State Checklist

<MANDATORY-CHECKLIST>

### CREATE 模式 Checklist

**Pre-requisites:**
- [ ] Phase 0 完成：CREATE 模式确认
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

### UPDATE 模式 Checklist（v2 增强）

**Pre-requisites:**
- [ ] Phase 0 完成：UPDATE 模式确认
- [ ] Phase 1 完成：对比分析完成，变更摘要生成
- [ ] Phase 1.5 完成：冲突检测，所有 CONFLICT 已解决
- [ ] Phase 2 完成：合并更新完成
- [ ] Phase 2.5 完成：原子合并，备份已创建
- [ ] Phase 3 完成：验证通过

**CRITICAL - Change Validation:**
- [ ] 新增 REQ IDs 模块内连续（无跳跃）
- [ ] 修改的 REQ IDs 保持原有值
- [ ] 模块推断正确（或用户已手动指定）
- [ ] 新增 AC IDs 格式正确
- [ ] deprecated 标记正确 + 时间戳

**CRITICAL - Version Validation:**
- [ ] version 更新符合 semver 规范
- [ ] MAJOR/MINOR/PATCH 触发条件正确

**CRITICAL - Atomic Merge:**
- [ ] temp 文件已正确创建
- [ ] backup 文件已正确创建
- [ ] atomic rename 成功完成

**CRITICAL - User Confirmation:**
- [ ] 变更摘要已展示给用户
- [ ] 用户已确认变更内容
- [ ] specification.yaml 已更新保存

**IF 无变更:**
- [ ] Phase 0 返回 SKIP 状态
- [ ] 不修改 specification.yaml

**IF CONFLICT 检测:**
- [ ] CONFLICT 列表已展示
- [ ] 用户已选择保留版本
- [ ] CONFLICT 状态已解除

</MANDATORY-CHECKLIST>

---

## Anti-Patterns

| 错误 | 正确 |
|------|------|
| UPDATE 模式删除现有 REQ | ❌ 禁止删除 — 只能标记 deprecated |
| UPDATE 模式覆盖现有内容 | ❌ 禁止 — 必须合并保留 |
| 跳过用户确认直接保存 | ❌ 必须 — 用户确认后才能保存 |
| ID 序号跳跃（如 REQ-AUTH-001 → REQ-AUTH-005） | ❌ 禁止 — 模块内必须连续 |
| 跳过 CONFLICT 检测 | ❌ 必须 — Phase 1.5 检测并解决 |
| 未创建 temp/backup 文件 | ❌ 必须 — Phase 2.5 原子合并 |
| version 仅 z+1（无语义） | ❌ 必须 — 使用 semver 规范 |
| 缺少 Gherkin 格式 | ❌ 必须 — Given/When/Then |
| 验证失败直接保存 | ❌ 禁止 — 必须修复后重新验证 |
| CREATE 和 UPDATE 混用 | ❌ 禁止 — Phase 0 明确检测模式 |
| 模块推断失败时自动分配 | ❌ 禁止 — 必须 BLOCK 并提示用户 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-12 | 初始设计，解决 specification.yaml 缺失问题 |
| V2.0 | 2026-04-12 | **触发时机调整**：从 brainstorming 后改为 delphi-review APPROVED 后 |
| V3.0 | 2026-04-14 | **双模式支持**：新增 UPDATE 模式（增量更新），多文档来源支持，变更检测规则 |
| V4.0 | 2026-04-14 | **Delphi Review v2 APPROVED**: 模块前缀ID管理、CONFLICT冲突检测、Phase原子性、semver规范、deprecated自动归档 |