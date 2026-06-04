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
|  {icon_-1} Phase -1   ISOLATE         {duration_-1}        |
|  {icon_-0.5} Phase -0.5 AUTO-ESTIMATE  {duration_-0.5}     |
|  {icon_0} Phase 0    THINK           {duration_0}          |
|  {icon_1} Phase 1    PLAN            {duration_1}          |
|  {icon_2} Phase 2    BUILD           {duration_2}          |
|  {icon_3} Phase 3    REVIEW          {duration_3}          |
|  {icon_4} Phase 4    USER ACCEPT     {duration_4}          |
|  {icon_5} Phase 5    FEEDBACK        {duration_5}          |
|  {icon_6} Phase 6    SHIP            {duration_6}          |
|  {icon_7} Phase 7    LAND            {duration_7}          |
|  {icon_8} Phase 8    CLEANUP         {duration_8}          |
|                                                             |
|  [{progress_bar}] {pct}%                                    |
+============================================================+
|  > 当前: Phase {current_phase} {current_phase_name}         |
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
| `{current_phase}` | `sprint-state.json → phase` | 当前阶段编号 |
| `{current_phase_name}` | Phase 名称映射 | ISOLATE / AUTO-ESTIMATE / THINK 等 |
| `{current_phase_status}` | `phase_history` 中当前阶段的 status | running / paused / completed |
| `{next_action}` | 下方"下一步行动表" | 用户需要执行的操作 |
| `{next_action_detail}` | 操作细节 | 具体指令 |
| `{output_list}` | `sprint-state.json → outputs` | 已生成的输出物路径列表（每项一行） |
| `{progress_bar}` | 已完成阶段数 / 总阶段数 | 格式: `████▓░░░░░░` |
| `{pct}` | 完成百分比 | 整数 |

## 进度条生成规则

```
总阶段数 = 11（Phase -1, -0.5, 0, 1, 2, 3, 4, 5, 6, 7, 8）
已完成数 = phase_history 中 status == "completed" 的数量
每个阶段 = 1 个字符宽度
填充: 已完成 = █ | 当前 = ▓ | 待做 = ░ | 跳过 = ▒
```

## 下一步行动表

| 当前阶段 | 当前状态 | 下一步行动 | 行动细节 |
|---------|---------|-----------|---------|
| Phase -1 | completed | 确认环境 | 检查 worktree 路径，准备进入需求分析 |
| Phase -0.5 | completed | 确认评估 | 查看 AUTO-ESTIMATE 结果，选择流程级别 |
| Phase 0 | completed | 确认设计 | 审阅设计文档，确认后进入 Phase 1 |
| Phase 0 | paused | 审阅设计 | 设计文档等待您的 APPROVED 确认 |
| Phase 1 | completed | 确认评审 | delphi-review 已通过，检查 specification.yaml |
| Phase 1 | paused | 等待评审 | delphi-review 进行中或等待 taste_decisions 确认 |
| Phase 2 | completed | 审阅代码 | BUILD 完成，进入 Phase 3 REVIEW |
| Phase 2 | running | 等待构建 | ralph-loop 迭代中，无需操作 |
| Phase 3 | completed | 开始验收 | 进入 Phase 4 人工验收 |
| Phase 4 | completed | 确认反馈 | 验收完成，Phase 5 自动进行 |
| Phase 4 | paused | 执行验收 | 必须人工验收，请实际使用后确认 |
| Phase 5 | completed | 确认发布 | 反馈已收集，准备进入 Phase 6 SHIP |
| Phase 6 | completed | 确认合并 | PR 已创建，确认是否合并 |
| Phase 7 | completed | 确认清理 | 合并成功，准备清理 worktree |
| Phase 8 | completed | Sprint 完成 | 检查 Sprint Summary，如有 emergent issues 考虑 Sprint 2 |
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

## 示例渲染

```
+============================================================+
|  SPRINT PROGRESS                      sprint-2026-06-04-01 |
+============================================================+
|  需求: 为 sprint-flow 添加进度看板功能                       |
|  分支: sprint/2026-06-04-01                                 |
|  状态: running          启动: 2026-06-04 19:25              |
+============================================================+
|                                                             |
|  ✅ Phase -1   ISOLATE         3m                           |
|  ✅ Phase -0.5 AUTO-ESTIMATE   1m                           |
|  ✅ Phase 0    THINK           2m                           |
|  ✅ Phase 1    PLAN            5m                           |
|  🔄 Phase 2    BUILD           12m                          |
|  ⬜ Phase 3    REVIEW          -                            |
|  ⬜ Phase 4    USER ACCEPT     -                            |
|  ⬜ Phase 5    FEEDBACK        -                            |
|  ⬜ Phase 6    SHIP            -                            |
|  ⬜ Phase 7    LAND            -                            |
|  ⬜ Phase 8    CLEANUP         -                            |
|                                                             |
|  [████▓░░░░░░] 36%                                          |
+============================================================+
|  > 当前: Phase 2 BUILD                                      |
|    状态: running                                             |
|                                                             |
|  下一步: 等待构建完成                                        |
|    ralph-loop 迭代中，完成后自动进入 Phase 3 REVIEW          |
+============================================================+
|  输出物:                                                     |
|    设计文档: .sprint-state/phase-outputs/design-doc.md       |
|    评审报告: .sprint-state/delphi-reviewed.json              |
|    规格说明: .sprint-state/phase-outputs/specification.yaml  |
+============================================================+
```
