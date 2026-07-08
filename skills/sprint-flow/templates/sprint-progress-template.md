# Sprint Progress Template

本模板定义了 Sprint 进度看板的标准显示格式。
Orchestrator 在每个 Phase 完成后、以及响应用户 `--status` 查询时，使用此模板渲染进度。

## 渲染规则

1. 从 `.sprint-state/sprint-state.json` 读取 `id`, `task_description`, `phase`, `status`, `started_at`, `phase_history`, `outputs`, `isolation`
2. 按下方模板渲染 ASCII 看板
3. 状态图标映射：✅ completed | 🔄 running | ⏸️ paused | ⬜ pending | ⏭️ skipped | ❌ failed

## 看板模板

```
+============================================================+
|  SPRINT PROGRESS                      {sprint_id}          |
+============================================================+
|  需求: {task_description}                                   |
|  分支: {branch}                                             |
|  状态: {overall_status}        启动: {started_at}           |
+============================================================+
|                                                             |
|  {icon_1} Phase 1/6  PREP             {duration_1}          |
|  {icon_2} Phase 2/6  DESIGN           {duration_2}          |
|  {icon_3} Phase 3/6  BUILD            {duration_3}          |
|  {icon_4} Phase 4/6  VERIFY           {duration_4}          |
|  {icon_5} Phase 5/6  SHIP             {duration_5}          |
|  {icon_6} Phase 6/6  CLOSE            {duration_6}          |
|                                                             |
|  [{progress_bar}] {pct}%                                    |
+============================================================+
|  > 当前: Phase {current_phase}/6 {current_phase_name}       |
|    状态: {current_phase_status}                              |
|                                                             |
|  下一步: {next_action}                                       |
|    {next_action_detail}                                      |
+============================================================+
|  输出物:                                                     |
|    {output_list}                                             |
+============================================================+
```

## 字段说明

| 字段 | 来源 | 说明 |
|------|------|------|
| `{sprint_id}` | `sprint-state.json → id` | Sprint 标识 |
| `{task_description}` | `sprint-state.json → task_description` | 需求描述（缺失时显示 "-"） |
| `{branch}` | `sprint-state.json → isolation.branch` | 工作分支 |
| `{overall_status}` | `sprint-state.json → status` | running / paused / completed |
| `{started_at}` | `sprint-state.json → started_at` | Sprint 启动时间（格式化: YYYY-MM-DD HH:MM） |
| `{icon_N}` | `phase_history[N].status` | 状态图标（见上方映射） |
| `{duration_N}` | `phase_history[N].duration_seconds` | 耗时（见下方格式化规则） |
| `{current_phase}` | `sprint-state.json → phase` | 当前阶段编号 (1-6) |
| `{current_phase_name}` | Phase 名称映射 | PREP / DESIGN / BUILD / VERIFY / SHIP / CLOSE |
| `{current_phase_status}` | `phase_history` 中当前阶段的 status | running / paused / completed |
| `{next_action}` | 下方"下一步行动表" | 用户需要执行的操作 |
| `{next_action_detail}` | 操作细节 | 具体指令 |
| `{output_list}` | `sprint-state.json → outputs` | 已生成的输出物路径列表（每项一行） |
| `{progress_bar}` | 已完成阶段数 / 总阶段数 | 格式: `████▓░░░░░░` |
| `{pct}` | 完成百分比 | 整数 |

## 进度条生成规则

```
总阶段数 = 6（Phase 1/6, 2/6, 3/6, 4/6, 5/6, 6/6）
已完成数 = phase_history 中 status == "completed" 的数量
每个阶段 = 1 个字符宽度
填充: 已完成 = █ | 当前 = ▓ | 待做 = ░ | 跳过 = ▒
```

## 下一步行动表

| 当前阶段 | 当前状态 | 下一步行动 | 行动细节 |
|---------|---------|-----------|---------|
| Phase 1/6 | completed | 确认评估 | 查看 AUTO-ESTIMATE 结果，选择流程级别 |
| Phase 1/6 | running | 等待隔离 | worktree 创建 + 评估中，无需操作 |
| Phase 2/6 | completed | 确认设计评审 | delphi-review 已通过，检查 specification.yaml |
| Phase 2/6 | paused | 等待设计 | brainstorming 或 delphi-review 等待 APPROVED |
| Phase 2/6 | running | 等待规划 | brainstorming/autoplan 执行中，无需操作 |
| Phase 3/6 | completed | 审阅代码 | BUILD 完成，进入 Phase 4/6 VERIFY |
| Phase 3/6 | running | 等待构建 | ralph-loop 迭代中，无需操作 |
| Phase 4/6 | completed | 确认发布 | 验证完成，反馈已收集，准备进入 Phase 5/6 SHIP |
| Phase 4/6 | running | 等待验证 | code-walkthrough + QA + feedback 执行中 |
| Phase 5/6 | completed | 确认验收 | PR 已创建 + 部署完成，准备进入 Phase 6/6 CLOSE |
| Phase 5/6 | paused | 确认合并 | PR 已创建，确认是否合并 |
| Phase 6/6 | completed | Sprint 完成 | 检查 Sprint Summary，如有 emergent issues 考虑 Sprint 2 |
| Phase 6/6 | paused | 执行验收 | ⚠️ 必须人工验收，请实际使用后确认 |
| 任意 | failed | 处理错误 | 查看错误信息，决定修复或放弃 |

## 耗时格式化规则

```
< 60s     → "{N}s"
< 60m     → "{N}m"
< 24h     → "{X}h {Y}m"
>= 24h    → "{X}d {Y}h"
无数据    → "-"
```

## 向后兼容

当 `sprint-state.json` 缺少以下字段时（旧版 sprint 创建的状态文件），渲染规则：
- `task_description` 缺失 → 显示 "-"
- `started_at` 缺失 → 显示 "-"
- `phase_history` 缺失 → 从 `phase` 字段推断：小于等于 `phase` 的阶段标记为 ✅，当前阶段标记为 🔄，其余标记为 ⬜；所有耗时显示 "-"
- **旧版 11-phase sprint-state.json**: phase 编号为 -1, -0.5, 0..8 的历史文件仍可渲染，但新 sprint 使用 1-6 numbering

## 示例渲染

```
+============================================================+
|  SPRINT PROGRESS                      sprint-2026-07-08-01 |
+============================================================+
|  需求: 为 sprint-flow 添加进度看板功能                       |
|  分支: sprint/2026-07-08-01                                 |
|  状态: running          启动: 2026-07-08 10:25              |
+============================================================+
|                                                             |
|  ✅ Phase 1/6  PREP             5m                           |
|  ✅ Phase 2/6  DESIGN          12m                           |
|  🔄 Phase 3/6  BUILD           15m                           |
|  ⬜ Phase 4/6  VERIFY           -                            |
|  ⬜ Phase 5/6  SHIP             -                            |
|  ⬜ Phase 6/6  CLOSE            -                            |
|                                                             |
|  [██▓░░░] 50%                                                |
+============================================================+
|  > 当前: Phase 3/6 BUILD                                    |
|    状态: running                                             |
|                                                             |
|  下一步: 等待构建完成                                        |
|    ralph-loop 迭代中，完成后自动进入 Phase 4/6 VERIFY        |
+============================================================+
|  输出物:                                                     |
|    设计文档: .sprint-state/phase-outputs/design-doc.md       |
|    评审报告: .sprint-state/delphi-reviewed.json              |
|    规格说明: .sprint-state/phase-outputs/specification.yaml  |
+============================================================+
```
