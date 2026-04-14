# Specification Generator UPDATE 模式设计 (v2)

**Issue**: #6 - Auto-trigger specification-generator after delphi-review APPROVED
**日期**: 2026-04-14
**状态**: Revised after Delphi Review Round 2
**版本**: v2.0

---

## Delphi Review 修复摘要

### Round 1-2 共识 Critical Issues (已修复)

| Issue | 原方案 | 修复方案 |
|-------|--------|---------|
| ID管理策略 | 连续追加 (REQ-003→REQ-004) | **模块前缀+序号** (REQ-AUTH-001) |
| 冲突解决机制 | 未定义 | **CONFLICT状态+人工介入** |
| deprecated退出 | 仅标记无清理 | **自动归档机制** |
| Phase原子性 | 未定义 | **临时文件+原子替换** |
| version规则 | z+1 | **semver规范** |

---

## 问题背景

### 当前问题

`test-specification-alignment` skill 经常进入 **legacy mode**，因为 `specification.yaml` 不存在。

**根本原因**：
1. `specification-generator` skill 存在但只在 CREATE 模式
2. 用户在 `delphi-review APPROVED` 后忘记手动调用
3. 后续需求增补时，specification.yaml 不会自动更新

---

## 设计方案 v2

### 核心变更：双模式支持

**CREATE 模式**（现有）：
- 触发条件：`specification.yaml` 不存在
- 行为：从设计文档生成完整 specification

**UPDATE 模式**（新增 v2）：
- 触发条件：`specification.yaml` 已存在 + 有新 APPROVED 文档
- 行为：对比分析 → 冲突检测 → 合并更新 → 变更确认

---

## v2 新增设计

### 1. ID 管理策略：模块前缀 + 序号

```yaml
ID 格式规范:
  pattern: "REQ-{MODULE}-{SEQ}"
  examples:
    - REQ-AUTH-001  # 认证模块第1个需求
    - REQ-AUTH-002  # 认证模块第2个需求
    - REQ-USER-001  # 用户模块第1个需求
    - REQ-API-001   # API模块第1个需求

模块映射表:
  modules:
    AUTH:   ["authentication", "auth", "login", "token"]
    USER:   ["user", "profile", "account"]
    DATA:   ["data", "storage", "database", "cache"]
    API:    ["api", "endpoint", "route", "handler"]
    CORE:   ["core", "base", "foundation", "util"]

模块推断规则:
  - 从文档路径推断: docs/plans/auth-design.md → AUTH
  - 从关键词匹配: 包含"authentication" → AUTH
  - 用户手动指定: /specification-generator --module AUTH
  - 无法推断时: BLOCK 并提示用户指定
```

### 2. 冲突解决机制：CONFLICT 状态

```yaml
Phase 1.5: 冲突检测 (新增)
  规则:
    CONFLICT:
      trigger: "同一 requirement ID 在不同来源文档中出现不同描述"
      action: "标记为 CONFLICT 状态，中断自动合并"
      severity: CRITICAL

  冲突检测算法:
    1. 计算每个 requirement 描述的 hash (SHA-256)
    2. 同 ID 不同 hash → CONFLICT
    3. 收集所有来源文档的描述版本
    4. 展示给用户选择保留哪个版本

  冲突处理流程:
    CONFLICT 检测 → 中断合并 → 展示冲突列表
    → 用户选择保留版本 → 解除 CONFLICT → 继续 Phase 2
```

**示例输出**:
```
⚠️ CONFLICT DETECTED: REQ-AUTH-001

Sources:
  [1] docs/requirements-v2.md: "用户登录需支持OAuth2.0"
  [2] docs/plans/auth-redesign.md: "用户登录需支持OAuth2.0和SAML"

Choose which version to keep (1/2/manual):
```

### 3. deprecated 退出机制：自动归档

```yaml
deprecated 管理:
  标记: status: deprecated
  时间戳: deprecated_at: "2026-04-14"
  
  自动归档规则:
    - deprecated 超过 3 个 minor 版本 (如 1.2.x → 1.5.x)
    - 自动移动到 specification-archived.yaml
    - 原文件保留 ID 占位: { id: REQ-AUTH-001, status: archived_ref, ref: "archived.yaml#REQ-AUTH-001" }
  
  手动清理:
    /specification-generator --cleanup-deprecated
    - 检查 deprecated 超过阈值的 requirements
    - 生成归档报告
    - 用户确认后执行归档
```

### 4. Phase 原子性：临时文件 + 原子替换

```yaml
Phase 2.5: 原子合并 (新增)
  流程:
    1. 复制现有 specification.yaml → specification.temp.yaml
    2. 在 temp 文件执行所有合并操作
    3. 计算变更 hash 并记录
    4. 用户确认变更摘要
    5. atomic rename: specification.temp.yaml → specification.yaml
    
  回滚机制:
    - 中断/取消: 删除 temp 文件，原文件保持不变
    - 故障恢复: 检查 temp 文件是否存在，存在则提示用户手动清理
    - 备份: rename 前备份原文件为 specification.backup.yaml (保留1个版本)
```

### 5. Version 规则：semver 规范

```yaml
version 更新规则 (semver):
  MAJOR (x): 
    trigger: "删除 requirement 或 breaking change"
    example: "删除 REQ-AUTH-001 → 1.0.0 → 2.0.0"
    
  MINOR (y):
    trigger: "新增 requirement 或新增模块"
    example: "新增 REQ-PAYMENT-001 → 1.0.0 → 1.1.0"
    
  PATCH (z):
    trigger: "修改 AC、修改描述、新增 AC"
    example: "修改 AC-AUTH-001-01 → 1.0.0 → 1.0.1"
    
  z 进位规则:
    - z ≥ 99 时: z=0, y=y+1 (minor bump)
    - 避免 z 无限增长
```

---

## 完整 UPDATE 流程 (v2)

```
Phase 1: 对比分析
  ├─ NEW_REQ: 新需求 → 分配模块前缀ID
  ├─ MODIFIED_REQ: 描述变更 → 保持原ID
  ├─ NEW_AC: 新验收条件 → 追加AC
  └─ DEPRECATED: 旧需求未提及 → 标记deprecated

Phase 1.5: 冲突检测 (新增)
  ├─ hash比对: 同ID不同描述 → CONFLICT
  ├─ 中断合并: 展示冲突列表
  └─ 用户选择: 解除CONFLICT后继续

Phase 2: 合并更新
  ├─ 复制现有文件 → temp文件
  ├─ 在temp文件执行合并
  └─ 计算变更hash

Phase 2.5: 原子保证 (新增)
  ├─ 用户确认变更摘要
  ├─ 备份原文件
  └─ atomic rename temp → final

Phase 3: 验证 (新增)
  ├─ 检查ID连续性 (模块内)
  ├─ 检查deprecated归档阈值
  └─ 检查version semver合规

Phase 4: 变更确认
  └─ 展示变更摘要 (表格格式)
```

---

## 变更摘要格式 (标准化)

```markdown
## Specification Update Summary

| Type | ID | Change | Module |
|------|----|--------|--------|
| NEW_REQ | REQ-AUTH-005 | 新增OAuth2.1支持 | AUTH |
| MODIFIED | REQ-USER-002 | 更新密码长度要求 | USER |
| NEW_AC | AC-AUTH-001-03 | 新增Token刷新AC | AUTH |
| DEPRECATED | REQ-DATA-003 | 标记deprecated (v1.2.0) | DATA |

**Version**: 1.2.0 → 1.3.0 (MINOR: 新增AUTH需求)
**Conflicts**: None
**Archived**: REQ-DATA-001, REQ-DATA-002 (exceeded 3 minor versions)

Confirm update? [Y/n/detailed]
```

---

## 集成变更

### delphi-review Terminal State 提示 (优化)

```yaml
提示策略:
  条件触发:
    - 检测到 specification.yaml 需要更新时
    - 或 specification.yaml 不存在时
    - 无变更时不提示
  
  提示内容:
    ✅ DELPHI REVIEW APPROVED
    
    ⚠️ specification.yaml 需要更新
    - 新需求: 3 个
    - 修改: 1 个
    
    请调用: /specification-generator
```

### xp-consensus Round 1 Pre-check

```yaml
Round 1 BLOCK:
  检查项:
    - specification.yaml 是否存在
    - 存在 → ✅ 继续
    - 不存在 → ❌ BLOCK
      提示: "先完成需求流程: delphi-review → specification-generator"
```

---

## 多文档来源优先级 (明确)

```yaml
优先级规则:
  1. requirements-*.md (最高)
  2. plans/*-design.md
  3. architecture*.md
  4. tasks/*.md 或 .sisyphus/plans/*.md (最低)
  
  冲突时:
    - 高优先级覆盖低优先级
    - 同优先级: 时间戳最新优先
    - 均无法解决: CONFLICT状态
```

---

## 无实质变更检测

```yaml
SKIP 条件:
  - 内容hash一致 (SHA-256)
  - 仅格式变化 (空格、换行)
  - 仅注释变化
  - 仅metadata变化 (非核心字段)
  
  检测流程:
    1. 扫描所有输入文档
    2. 计算hash与上次对比
    3. 所有hash一致 → SKIP
    4. 输出: "No substantial changes detected. SKIP update."
```

---

## 风险评估 (v2)

| 风险 | 影响 | v2 缓解措施 |
|------|------|-----------|
| ID模块推断失败 | 高 | BLOCK并提示用户手动指定 |
| 冲突未解决 | 高 | CONFLICT状态强制人工介入 |
| 部分更新失败 | 高 | 原子替换+备份机制 |
| deprecated累积 | 中 | 自动归档机制 (3版本阈值) |
| version膨胀 | 低 | semver规则+z进位 |

---

## 测试场景 (v2)

1. **首次 CREATE**: specification.yaml不存在 → CREATE模式
2. **增量 UPDATE**: specification.yaml存在 + 新需求 → UPDATE模式
3. **无变更 SKIP**: hash一致 → SKIP
4. **跨模块更新**: REQ-AUTH-* 和 REQ-USER-* 同时新增 → 模块ID独立分配
5. **冲突检测**: 同ID不同描述 → CONFLICT → 用户选择
6. **deprecated归档**: 超过3版本 → 自动归档
7. **原子性测试**: 中断更新 → 原文件保持不变
8. **semver验证**: 新增REQ → MINOR bump

---

## 变更文件清单 (v2)

| 文件 | 变更类型 | v2 说明 |
|------|---------|---------|
| `skills/specification-generator/SKILL.md` | Major | 双模式 + 模块ID + 冲突检测 + 原子性 |
| `skills/delphi-review/SKILL.md` | Minor | 条件触发提示 |
| `skills/xp-consensus/SKILL.md` | Minor | Round 1 BLOCK检查 |
| `skills/test-specification-alignment/SKILL.md` | Minor | Legacy Mode文档完善 |

---

## 附录：模块映射表完整版

```yaml
module_mappings:
  AUTH:
    keywords: ["authentication", "auth", "login", "token", "oauth", "saml", "jwt", "session"]
    paths: ["auth/", "authentication/", "login/"]
    
  USER:
    keywords: ["user", "profile", "account", "registration", "password"]
    paths: ["user/", "users/", "profile/"]
    
  DATA:
    keywords: ["data", "storage", "database", "cache", "persistence", "model", "entity"]
    paths: ["data/", "db/", "models/", "entities/"]
    
  API:
    keywords: ["api", "endpoint", "route", "handler", "controller", "rest", "graphql"]
    paths: ["api/", "routes/", "handlers/", "controllers/"]
    
  CORE:
    keywords: ["core", "base", "foundation", "util", "common", "shared", "helper"]
    paths: ["core/", "utils/", "common/", "shared/"]
    
  UI:
    keywords: ["ui", "frontend", "component", "page", "view", "style", "css"]
    paths: ["ui/", "components/", "pages/", "views/"]
    
  TEST:
    keywords: ["test", "spec", "mock", "fixture", "coverage"]
    paths: ["test/", "tests/", "__tests__/", "spec/"]
    
  CONFIG:
    keywords: ["config", "settings", "env", "option", "preference"]
    paths: ["config/", "settings/"]
```

---

## v2 Review Request

请专家确认修复是否解决了所有 Critical Issues：

1. ✅ ID管理策略 - 模块前缀+序号方案是否正确？
2. ✅ 冲突解决机制 - CONFLICT状态+人工介入是否完整？
3. ✅ deprecated退出 - 自动归档机制是否合理？
4. ✅ 原子性保证 - 临时文件+原子替换是否足够？
5. ✅ version规则 - semver规范是否清晰？