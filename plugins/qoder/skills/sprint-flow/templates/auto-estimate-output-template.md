# AUTO-ESTIMATE 输出模板

本模板定义了 Phase -0.5 在终端向用户展示 AUTO-ESTIMATE 结果的标准格式。

## 输出格式

```
+-------------------------------------------------------------+
| AUTO-ESTIMATE 评估结果                                        |
+-------------------------------------------------------------+
| 需求：{task_description}                                      |
| 类型：{change_type}                                          |
|                                                             |
| [{impact_level}] Impact: {impact_label}                      |
|                                                             |
| 引用：{ref_count} 处                                          |
| 跨模块：{cross_module_count} 个 ({module_list})               |
| 循环依赖：{circular_dep_status}                               |
| Public API：{public_api_count} 个                             |
| {additional_metrics}                                         |
|                                                             |
| 建议流程：{recommended_flow}                                  |
|                                                             |
| {risk_warning}                                               |
|                                                             |
| [接受建议]  [修改流程]  [取消]                                 |
+-------------------------------------------------------------+
```

## 字段说明

| 字段 | 说明 | 示例 |
|------|------|------|
| `{task_description}` | 用户输入的需求描述 | 删除平面维护界面 |
| `{change_type}` | 变更类型 | 删除/修改已存在代码 或 新增功能 |
| `{impact_level}` | 影响级别标识 | `[轻量]` / `[标准]` / `[复杂]` |
| `{impact_label}` | 影响级别标签 | 低 / 中 / 高 |
| `{ref_count}` | 引用出现次数 | 12 |
| `{cross_module_count}` | 跨模块数量 | 3 |
| `{module_list}` | 涉及模块名列表 | auth, user, admin |
| `{circular_dep_status}` | 循环依赖状态 | ✅ 无 / ⚠️ 存在 (A ↔ B) |
| `{public_api_count}` | Public API 暴露数 | 5 |
| `{additional_metrics}` | 附加指标（可选行） | 测试文件：4 个 / 影响范围：3 层调用 |
| `{recommended_flow}` | 建议流程描述 | 轻量流程 (Phase 2-3) |
| `{risk_warning}` | 风险警告（可选块） | ⚠️ 此操作涉及循环依赖… |
| 操作按钮 | 用户确认选项 | 接受建议 / 修改流程 / 取消 |

## 风险警告格式

当检测到高风险信号时（循环依赖、大范围 Public API、>10 处引用），追加风险警告块：

```
|                                                             |
| ⚠️ {risk_description}                                        |
|   {mitigation_suggestion}                                    |
|                                                             |
```

示例：
```
|                                                             |
| ⚠️ 此操作涉及循环依赖，建议保留层级结构作为过渡方案           |
|   避免直接删除导致编译失败                                    |
|                                                             |
```

## 修改流程子菜单

当用户选择「修改流程」时，展示以下选项：

```
+-------------------------------------------------------------+
| 选择流程级别：                                                |
|                                                             |
| [1] 轻量流程 — 直接编码 + 基础验证 (Phase 2-3)               |
| [2] 标准流程 — brainstorming + BUILD + REVIEW (Phase 0-4)    |
| [3] 完整流程 — 完整 Sprint Flow (Phase 0-8)                  |
|                                                             |
| 修改原因（必填）：____________________                        |
|                                                             |
| [确认]  [取消]                                                |
+-------------------------------------------------------------+
```

## 指标计算规则

### 对于删除/修改已存在代码

| 指标 | 计算方式 | 工具 |
|------|---------|------|
| 引用计数 | `grep -rn "{target_pattern}" --include="*.{ext}" | wc -l` | bash |
| 跨模块依赖 | 分析 import 语句中不同目录层级的引用 | bash + grep |
| 循环依赖 | 检查 import 图是否存在环（简单检查：A imports B, B imports A） | bash |
| Public API 暴露 | `grep -rn "^export "` 计数 | bash |
| 测试文件数 | `find . -name "*{target}*.test.*" | wc -l` | bash |

### 对于新增功能（brainstorming 后）

| 指标 | 计算方式 | 来源 |
|------|---------|------|
| 新增模块数 | 设计文档中列出的模块数 | Phase 0 输出 |
| 跨系统集成 | 涉及 API/DB/外部 数量 | Phase 0 输出 |
| 状态复杂度 | 状态机状态数 | Phase 0 输出 |
| REQ 数量 | user_stories 数量 | Phase 1 输出 |

## 路由决策表

| 评估结果 | 路由 | 说明 |
|---------|------|------|
| **轻量** (引用 ≤3, 同模块，无循环依赖) | Phase 2-3（跳过 brainstorming + delphi-review） | 直接编码 + 基础验证 |
| **标准** (引用 4-10, 跨 1-2 模块) | Phase 0-4（完整 THINK → BUILD → REVIEW） | 标准 sprint |
| **复杂** (引用 >10 或 循环依赖 或 跨 3+ 模块) | Phase 0-8（完整 sprint-flow） | 完整流程 + 风险警告 |

## 学习闭环

当用户选择「修改流程」时，记录 override 数据：

```json
{
  "sprint_id": "sprint-YYYY-MM-DD-NN",
  "task_description": "原始需求描述",
  "estimated_level": "标准",
  "user_override_level": "轻量",
  "override_reason": "用户输入原因",
  "actual_effort": "TBD",
  "timestamp": "ISO 8601"
}
```

数据写入 `.sprint-state/auto-estimate-learning.json`（追加模式），用于阈值迭代优化。
