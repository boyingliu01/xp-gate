# XGate Skill 验证文档

> 生成日期：2026-04-26
> 状态：所有验证完成，3 个 LLM-dependent skill 全部通过

## 目录结构

```
docs/skill-validation/
├── README.md                           # 本文件 — 验证文档索引
├── validation-summary.md               # 总验证报告（含 3 skill 汇总）
├── validation-methodology.md           # 验证方法论（L1-L4 框架 + 20 业界方案）
├── promptpressure/
│   ├── drift-report-final.md           # 最终漂移检测报告（改进后）
│   └── cross-model-results.json        # 跨模型对比原始数据
└── eval-cases/
    ├── delphi-review/evals.json        # delphi-review 测试用例
    ├── sprint-flow/evals.json          # sprint-flow 测试用例
    └── test-spec-alignment/evals.json  # test-spec-alignment 测试用例
```

## 验证结果总览

| Skill | L2 增量价值 | L3 步骤遵循 | L4 稳定性 | 总体评分 | 状态 |
|-------|-----------|-----------|----------|---------|------|
| delphi-review | +50% | 100% | 100% (4/4 模型) | 92/100 | ✅ 通过 |
| sprint-flow | +75% | 100% | 75% (3/4 模型) | 98/100 | ✅ 通过 |
| test-spec-alignment | +40% | 100% | 100% (4/4 模型) | 90/100 | ✅ 通过 |

## 验证维度

| 维度 | 验证内容 | 方法 |
|------|---------|------|
| **L1: 触发准确性** | skill 是否在该触发时触发 | description 字段覆盖测试 |
| **L2: 输出正确性** | with-skill vs without-skill 对比 | 6 次交叉验证 |
| **L3: 步骤遵循度** | 关键步骤是否都被执行 | 断言检查 + LLM-as-judge |
| **L4: 执行稳定性** | 跨模型/跨次运行的一致性 | 4 模型 × 3 prompt = 12 次 API 调用 |

## 业界验证方案调研

调研了 20 个业界验证框架，详见 `validation-methodology.md`。推荐三层验证体系：
1. **首次验证**: Anthropic skill-creator
2. **回归检测**: promptfoo (CI/CD 集成)
3. **漂移检测**: PromptPressure (模型更新时)
