# AUTO-ESTIMATE 学习日志

本文件记录 AUTO-ESTIMATE 的用户纠偏历史和完成数据，用于阈值迭代优化。

## 文件位置

`.sprint-state/auto-estimate-learning.json`

## JSON Schema

```json
{
  "entries": [
    {
      "sprint_id": "sprint-2026-06-01-14",
      "task_description": "实现issue92 auto-estimate",
      "change_type": "新增功能",
      "estimated_level": "标准",
      "estimated_metrics": {
        "ref_count": null,
        "cross_module_count": 2,
        "circular_dep": false,
        "public_api_count": 0,
        "test_file_count": 0
      },
      "user_decision": "accepted",
      "override_reason": null,
      "actual_outcome": {
        "phase_count": 3,
        "duration_estimate": "30-45min",
        "was_accurate": true,
        "notes": "纯文档修改，实际确实为标准级别"
      },
      "timestamp": "2026-06-01T23:35:00+08:00"
    }
  ],
  "summary": {
    "total_entries": 1,
    "accepted_count": 1,
    "overridden_count": 0,
    "accurate_count": 1,
    "over_estimate_count": 0,
    "under_estimate_count": 0,
    "last_updated": "2026-06-01T23:35:00+08:00"
  }
}
```

## 字段说明

### Entry 级别

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sprint_id` | string | ✅ | Sprint 标识符 |
| `task_description` | string | ✅ | 需求描述 |
| `change_type` | string | ✅ | 变更类型：`删除已存在代码` / `修改已存在代码` / `新增功能` / `Bug修复` |
| `estimated_level` | string | ✅ | 评估级别：`轻量` / `标准` / `复杂` |
| `estimated_metrics` | object | ✅ | 评估时的指标数据 |
| `user_decision` | string | ✅ | 用户决定：`accepted` / `overridden` / `cancelled` |
| `override_reason` | string | 条件 | 当 `user_decision` 为 `overridden` 时必填 |
| `actual_outcome` | object | 条件 | Sprint 完成后回填 |
| `timestamp` | string | ✅ | ISO 8601 时间戳 |

### actual_outcome 级别

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `phase_count` | number | ✅ | 实际执行的 phase 数 |
| `duration_estimate` | string | 推荐 | 实际耗时估算 |
| `was_accurate` | boolean | ✅ | 评估是否准确 |
| `notes` | string | 推荐 | 备注说明 |

### summary 级别

| 字段 | 类型 | 说明 |
|------|------|------|
| `total_entries` | number | 总条目数 |
| `accepted_count` | number | 接受建议数 |
| `overridden_count` | number | 用户修改数 |
| `accurate_count` | number | 评估准确数 |
| `over_estimate_count` | number | 高估数（建议标准但实际轻量） |
| `under_estimate_count` | number | 低估数（建议轻量但实际复杂） |

## 初始化

新 sprint 创建时，自动创建 `.sprint-state/auto-estimate-learning.json`：

```json
{
  "entries": [],
  "summary": {
    "total_entries": 0,
    "accepted_count": 0,
    "overridden_count": 0,
    "accurate_count": 0,
    "over_estimate_count": 0,
    "under_estimate_count": 0,
    "last_updated": null
  }
}
```

## 阈值优化触发

当 `total_entries >= 20` 时，在 Phase 8 CLEANUP 阶段提示用户：

```
已积累 20 条 AUTO-ESTIMATE 记录。是否运行阈值优化分析？

当前准确率：{accurate_count / total_entries * 100}%
高估率：{over_estimate_count / total_entries * 100}%
低估率：{under_estimate_count / total_entries * 100}%

[运行分析] [跳过]
```

## 阈值优化规则

### 高估模式检测

IF `over_estimate_count / total_entries > 30%`:
→ 建议降低「标准」→「复杂」的引用计数阈值（当前 >10）
→ 分析高估的共性：是否某个指标权重过高？

### 低估模式检测

IF `under_estimate_count / total_entries > 20%`:
→ 建议增加额外检查项（如循环依赖、测试文件数）
→ 分析低估的共性：是否遗漏了关键复杂度信号？

### 纠偏频率检测

IF `overridden_count / total_entries > 30%`:
→ 用户频繁修改建议 → 阈值体系可能有问题
→ 建议全面阈值校准
