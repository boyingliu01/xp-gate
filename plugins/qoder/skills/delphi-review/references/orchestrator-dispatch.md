# Orchestrator Dispatch Rules（#218 自动多轮调度）

## 背景

Delphi review 在 sprint-flow 中通过 subagent 调用时，Round 1→Round 2→Round 3 的调度**必须在 subagent 内部自动完成**，不能每轮暂停等待 orchestrator 或用户干预。只有在以下情况才需要 orchestrator 暂停：

## 自动调度规则

| 场景 | 自动处理 | 需暂停 |
|------|---------|--------|
| Round 1 完成，需 Round 2 | ✅ subagent 自动继续 | ❌ |
| Round 2 完成，需 Round 3 | ✅ subagent 自动继续 | ❌ |
| Round 3+ 完成，仍需更多轮 | ✅ subagent 自动继续，直到 max_rounds | ❌ |
| 最终 APPROVED (>=90%) | ✅ subagent 输出结果后退出 | ❌ |
| 最终 REQUEST_CHANGES（可自动修复） | ✅ subagent 尝试修复措辞、AC 缺失等常见问题后自动重评审 | ❌ |
| 最终 REQUEST_CHANGES（无法自动修复） | ✅ subagent 输出详细失败报告 | **✅ orchestrator 暂停等用户** |
| 超过 max_rounds (5) 仍无共识 | ✅ subagent 输出"未达成共识报告" | **✅ orchestrator 暂停等用户决策** |

## Subagent 内部 Round 循环

当 delphi-review 以 subagent 启动时（非交互式），应执行以下自动循环：

```python
round = 1
while round <= max_review_rounds:
    results = execute_round(round)
    consensus = check_consensus(results)

    if consensus.verdict == "APPROVED" and consensus.ratio >= 0.9:
        emit_verdict("APPROVED", consensus)
        break

    if round == max_review_rounds:
        emit_verdict("NO_CONSENSUS", consensus)
        break

    round += 1

if verdict == "REQUEST_CHANGES":
    auto_fix_result = attempt_auto_fix(issues)
    if auto_fix_result.success:
        round = 2
        continue
    else:
        emit_verdict("REQUEST_CHANGES", auto_fix_result.failed_issues)
```

## 终止结果输出

当 subagent 因终态退出时，必须输出清晰的裁决：

- **APPROVED**: 共识报告 + specification.yaml
- **REQUEST_CHANGES（可自动修复）**: 自动修复后再次评审
- **REQUEST_CHANGES（不可自动修复）**: 失败报告 + 建议修复方向
- **NO_CONSENSUS**: 分歧详情报告

## 与 orchestrator 的交互约定

| 状态 | Subagent 输出 | Orchestrator 动作 |
|------|--------------|------------------|
| APPROVED | `{verdict:"APPROVED", consensus_ratio: N, ...}` | 自动进入下一 Phase |
| REQUEST_CHANGES (auto-fixed) | `{verdict:"APPROVED", auto_fixed: ["..."]}` | 自动进入下一 Phase |
| REQUEST_CHANGES (unfixable) | `{verdict:"REQUEST_CHANGES", failed_issues: [...]}` | ⚠️ 暂停等用户修复后，通过 task_id 重新 dispatch |
| NO_CONSENSUS | `{verdict:"NO_CONSENSUS", disagreements: [...]}` | ⚠️ 暂停等用户决策（可继续/中止/强制通过） |
