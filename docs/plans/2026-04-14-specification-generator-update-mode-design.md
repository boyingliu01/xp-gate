# Specification Generator UPDATE 模式设计

**Issue**: #6 - Auto-trigger specification-generator after delphi-review APPROVED
**日期**: 2026-04-14
**状态**: Draft - Pending Delphi Review

---

## 问题背景

### 当前问题

`test-specification-alignment` skill 经常进入 **legacy mode**，因为 `specification.yaml` 不存在。

**根本原因**：
1. `specification-generator` skill 存在但只在 CREATE 模式
2. 用户在 `delphi-review APPROVED` 后忘记手动调用
3. 后续需求增补时，specification.yaml 不会自动更新

### 实际场景

```
第一次需求:
  需求文档 → delphi-review APPROVED → /specification-generator → specification.yaml (CREATE)
  → xp-consensus → test-specification-alignment ✅ Normal Mode

第二次需求（增补）:
  新需求文档 → delphi-review APPROVED → (没有调用 specification-generator)
  → xp-consensus → test-specification-alignment ❌ Legacy Mode（spec 过时）
```

---

## 设计方案

### 核心变更：双模式支持

**CREATE 模式**（现有）：
- 触发条件：`specification.yaml` 不存在
- 行为：从设计文档生成完整 specification

**UPDATE 模式**（新增）：
- 触发条件：`specification.yaml` 已存在 + 有新 APPROVED 文档
- 行为：对比分析 → 合并更新

---

### UPDATE 模式详细设计

#### Phase 1: 对比分析

```yaml
对比规则:
  NEW_REQ:
    trigger: "新文档需求 ID 不存在于现有 spec"
    action: "追加新 requirement，分配连续 ID"
    
  MODIFIED_REQ:
    trigger: "需求 ID 相同但描述内容不同"
    action: "更新描述，保持原 ID"
    
  NEW_AC:
    trigger: "新 AC 不存在于现有 requirement"
    action: "追加到对应 requirement"
    
  DEPRECATED:
    trigger: "现有 requirement 在新文档未提及"
    action: "标记 status: deprecated（不删除）"
```

#### Phase 2: 合并更新

```
保留：所有 UNCHANGED requirements
追加：所有 NEW_REQ（继续 ID 序号，如 REQ-003 → REQ-004）
更新：所有 MODIFIED_REQ（保持原 ID）
追加：所有 NEW_AC（继续 AC 序号）
标记：所有 DEPRECATED（status: deprecated）
版本：x.y.z → x.y.(z+1)
```

#### Phase 4: 变更确认

展示变更摘要而非完整内容，让用户快速确认。

---

### 集成变更

#### 1. delphi-review Terminal State

新增 APPROVED 后提示：

```
✅ DELPHI REVIEW APPROVED

⭐ Next Step: 生成或更新 specification.yaml

请调用: /specification-generator
```

#### 2. xp-consensus Round 1 Pre-check

新增 BLOCK：

```yaml
Round 1 开始前:
  - 检查 specification.yaml 是否存在
    - 存在 → ✅ 继续
    - 不存在 → ❌ BLOCK
      提示: "先完成需求流程: delphi-review → specification-generator"
```

---

## 多文档来源支持

UPDATE 模式输入来源：

| 来源 | 文件模式 | 内容 |
|------|---------|------|
| 现有 Specification | `specification.yaml` | 已有 REQs/ACs/DDs |
| 新需求文档 | `docs/requirements-*.md` | 新增 Requirements |
| 新设计文档 | `docs/plans/*-design.md` | 设计变更 |
| 架构文档 | `docs/architecture*.md` | 架构决策 |
| 任务计划 | `docs/tasks/*.md` 或 `.sisyphus/plans/*.md` | 实现任务 |

---

## 变更文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `skills/specification-generator/SKILL.md` | Major | 双模式 + 多文档来源 |
| `skills/delphi-review/SKILL.md` | Minor | Terminal State 提示 |
| `skills/xp-consensus/SKILL.md` | Minor | Round 1 BLOCK 检查 |
| `skills/test-specification-alignment/SKILL.md` | Minor | Legacy Mode 文档完善 |

---

## 关键问题待评审

### Critical Issues 需专家确认：

1. **UPDATE 模式 ID 管理策略是否正确？**
   - 现有方案：连续追加（REQ-003 → REQ-004）
   - 备选方案：按模块分组（REQ-AUTH-001 → REQ-AUTH-002）
   - 问题：如果跨模块新增需求如何处理？

2. **deprecated 标记是否足够？**
   - 现有方案：标记 `status: deprecated`
   - 备选方案：完全删除过时 requirements
   - 问题：保留历史是否有价值？

3. **多文档来源优先级如何确定？**
   - 现有方案：全部合并
   - 备选方案：按时间戳优先最新
   - 问题：如果文档内容冲突如何处理？

4. **delphi-review 提示是否会打断用户流程？**
   - 现有方案：每次 APPROVED 后提示
   - 备选方案：只在首次 APPROVED 提示
   - 问题：重复提示是否烦人？

### Major Concerns：

1. **变更摘要格式是否清晰？**
   - 需要确认用户能否快速理解变更内容

2. **version 更新规则是否合理？**
   - 现有方案：每次更新 z+1
   - 问题：大量更新后版本号是否过长？

3. **性能考虑：大 specification 的对比分析**
   - 问题：如果 spec 有 100+ requirements，对比分析成本？

---

## 备选方案

### Alternative A: 全量替换

每次 APPROVED 后重新生成整个 specification.yaml，不保留历史。

**优点**：简单，无合并逻辑
**缺点**：丢失历史 requirements，无 deprecated 标记

### Alternative B: 版本分支

每次更新创建新版本文件（如 `specification-v1.0.1.yaml`）。

**优点**：保留完整历史
**缺点**：文件管理复杂，test-specification-alignment 需识别最新版本

### Alternative C（推荐）：增量更新 + deprecated 标记

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| ID 序号跳跃 | 中 | 验证阶段检查连续性 |
| 合并逻辑错误 | 高 | 多轮测试验证 |
| 用户忽略提示 | 低 | xp-consensus BLOCK 强制 |
| 性能问题 | 中 | 大 spec 需优化对比算法 |

---

## 测试场景

1. **首次 CREATE**：specification.yaml 不存在 → CREATE 模式
2. **增量 UPDATE**：specification.yaml 存在 + 新需求 → UPDATE 模式
3. **无变更 SKIP**：specification.yaml 存在 + 无新文档 → SKIP
4. **跨模块更新**：REQ-AUTH-* 和 REQ-USER-* 同时新增
5. **deprecated 标记**：旧需求被标记而非删除

---

## 评审请求

请专家评审以下问题：

1. UPDATE 模式设计是否完整？
2. ID 管理策略是否合理？
3. 集成变更是否会影响现有流程？
4. 有遗漏的 edge cases 吗？