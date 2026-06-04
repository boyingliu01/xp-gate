# Phase -0.5: AUTO-ESTIMATE（自动化规模评估与流程路由）

**执行时机**: Phase -1 ISOLATE 完成后、Phase 0 THINK 之前。**自动执行**。

**目的**: 自动评估需求规模，匹配适度流程，避免小需求走重量级流程造成资源浪费。

**核心原则**: 
- **客观指标 > 主观判断**：依赖代码结构分析，不依赖人/AI 的主观直觉
- **显式告知**：用户看到客观指标，不是 AI 主观结论
- **可纠偏**：用户可接受/修改/取消
- **学习闭环**：记录用户 override，优化阈值

---

## 执行流程

### 步骤 1: 识别需求类型

分析用户输入的需求描述，判定变更类型：

| 关键词模式 | 变更类型 | AUTO-ESTIMATE 时机 |
|-----------|---------|-------------------|
| 删除、移除、去掉、砍掉、清理 + 已有模块名 | 删除已存在代码 | 立即执行 |
| 修改、改、调整、重构、优化 + 已有模块名 | 修改已存在代码 | 立即执行 |
| 新增、添加、开发、实现、创建 + 新模块名 | 新增功能 | brainstorming 后执行 |
| 修复、fix、bug | Bug 修复 | 立即执行 |
| 无法判断 | 询问用户 | — |

**IF 新增功能**: 跳过当前 AUTO-ESTIMATE，先执行 Phase 0 brainstorming，brainstorming 完成后以设计文档为输入重新执行 AUTO-ESTIMATE。

**IF 删除/修改/Bug 修复**: 继续执行以下步骤。

### 步骤 2: 收集指标

#### 2.1 引用计数

```bash
# 从用户输入中提取目标关键词（模块名、函数名、类名）
# 示例：删除平面维护界面 → target="plane", "平面"
grep -rn "{target_pattern}" --include="*.{ext}" . | grep -v node_modules | grep -v .git | wc -l
```

**阈值**：
- ≤3: 轻量
- 4-10: 标准
- >10: 复杂

#### 2.2 跨模块依赖

分析引用出现的目录分布：

```bash
# 提取引用所在的目录（取前两级目录）
grep -rn "{target_pattern}" --include="*.{ext}" . | grep -v node_modules | grep -v .git | \
  awk -F: '{print $1}' | sed 's|/[^/]*$||' | sort -u
```

**阈值**：
- 1 个目录: 轻量
- 2 个目录: 标准
- 3+ 个目录: 复杂

#### 2.3 循环依赖检测

简单检查：如果 A 引用 B 且 B 引用 A，则存在循环依赖。

```bash
# 简化检测：检查目标是否导入其调用者
# 这需要根据具体语言调整。对于 TS/JS:
grep -rn "import.*{target}" --include="*.ts" --include="*.tsx" .
grep -rn "import.*{caller}" --include="*.ts" --include="*.tsx" {target_dir}/
```

**阈值**：
- 无: 正常
- 存在: 高风险 → 无论如何输出风险警告

#### 2.4 Public API 暴露

```bash
# 统计目标模块中 export 的数量
grep -rn "^export " {target_dir}/ --include="*.ts" | wc -l
```

**阈值**：
- ≤2: 低影响
- 3-5: 中影响
- >5: 高影响 → 输出风险警告

#### 2.5 相关测试文件

```bash
# 统计与目标相关的测试文件数
find . -name "*{target}*.test.*" -o -name "*{target}*.spec.*" | grep -v node_modules | wc -l
```

**阈值**：
- 0: 无测试覆盖（风险提示）
- 1-2: 正常
- >3: 重构工作量大 → 提示

### 步骤 3: 汇总评估

根据各指标得分，汇总整体评估结果：

```
总分计算：
- 引用计数：轻量=1, 标准=2, 复杂=3
- 跨模块：轻量=1, 标准=2, 复杂=3
- 循环依赖：无=0, 存在=5（强制复杂）
- Public API：低=0, 中=1, 高=2
- 测试文件：正常=0, 多=1

总分：1-3 = 轻量 | 4-6 = 标准 | 7+ 或 循环依赖存在 = 复杂
```

### 步骤 4: 输出评估结果

使用 `templates/auto-estimate-output-template.md` 的标准格式向用户展示评估结果。

**MUST** 遵循模板格式，包含：
- 需求描述 + 变更类型
- 影响级别标识
- 各项指标的具体数值
- 建议流程
- 风险警告（如有）
- 用户操作选项

### 步骤 5: 处理用户选择

#### 用户选择「接受建议」

> 按推荐流程执行。保存评估结果到 sprint-state.json。

```json
{
  "auto_estimate": {
    "change_type": "删除已存在代码",
    "metrics": {
      "ref_count": 12,
      "cross_module_count": 3,
      "modules": ["auth", "user", "admin"],
      "circular_dep": true,
      "public_api_count": 5,
      "test_file_count": 4
    },
    "estimated_level": "复杂",
    "recommended_flow": "完整 Sprint Flow (Phase 0-8)",
    "risk_warnings": ["循环依赖: user ↔ plane"],
    "user_decision": "accepted"
  }
}
```

#### 用户选择「修改流程」

> 展示修改流程子菜单（3 个选项：轻量/标准/完整）。
> 要求用户输入修改原因（必填）。

记录到学习日志：
```json
{
  "sprint_id": "{sprint_id}",
  "task_description": "{需求描述}",
  "estimated_level": "标准",
  "user_override_level": "轻量",
  "override_reason": "{用户输入原因}",
  "timestamp": "{当前时间}"
}
```

数据写入 `.sprint-state/auto-estimate-learning.json`（追加模式）。

#### 用户选择「取消」

> 停止本次 sprint。
> 输出：`[CANCELLED] 用户取消 Sprint，AUTO-ESTIMATE 评估结果为 {estimated_level}`。

### 步骤 6: 路由执行

根据最终确定的流程级别，进入对应 Phase：

| 流程级别 | 路由 |
|---------|------|
| **轻量** | → Phase 2 BUILD（跳过 Phase 0 brainstorming、Phase 1 delphi-review） |
| **标准** | → Phase 0 THINK（正常流程） |
| **复杂** | → Phase 0 THINK（完整流程 + 风险警告提示） |

---

## 特殊场景处理

### 场景 1: 小改动（总计 < 20 行新增/删除代码）

```bash
# 检查预估改动量
git diff --stat HEAD 2>/dev/null  # 如果有局部修改
```

**处理**: 如果预估改动 < 20 行且涉及 ≤ 2 个文件，自动判定为「轻量」并告知用户，不强制展示完整 AUTO-ESTIMATE 面板。

### 场景 2: 无法提取目标关键词

**处理**: 询问用户「无法自动识别目标模块，请指定要分析的关键词（函数名/类名/模块名）：」

### 场景 3: 用户输入包含多个独立需求

**处理**: 提示用户「检测到多个独立需求，建议分别执行 sprint。是否拆分？」→ 等待确认

---

## 与学习循环的集成

### 数据收集

每次 sprint 完成（Phase 8 CLEANUP）后，将以下数据记录到 `.sprint-state/auto-estimate-learning.json`：

```json
{
  "entries": [
    {
      "sprint_id": "sprint-YYYY-MM-DD-NN",
      "estimated_level": "标准",
      "user_decision": "accepted",
      "actual_effort_phase_count": 5,
      "actual_duration_minutes": 45,
      "was_accurate": true
    }
  ]
}
```

### 阈值优化

当积累 ≥ 20 条记录后，提示用户可以运行阈值分析：

> 已积累 {n} 条 AUTO-ESTIMATE 记录。是否运行阈值优化分析？
> 分析会检查：过度估计（建议标准但实际轻量）、低估（建议轻量但实际复杂），并推荐阈值调整。
