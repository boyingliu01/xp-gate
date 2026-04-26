# Skill Validation Grading Schema

## delphi-review Grading

### L2: Output Correctness Assertions

| Eval | Assertion | With-Skill Expected | Without-Skill Expected |
|------|-----------|--------------------|-----------------------|
| design-mode-full-review | round-1-executed | PASS (contains "Round 1") | LIKELY FAIL (no structured rounds) |
| design-mode-full-review | round-2-executed | PASS (contains "Round 2") | LIKELY FAIL (no Round 2 concept) |
| design-mode-full-review | consensus-check | PASS (contains "91%") | LIKELY FAIL (no consensus mechanism) |
| design-mode-full-review | terminal-state-checklist | PASS | LIKELY FAIL |
| design-mode-full-review | expert-a-present | PASS | LIKELY FAIL (no Expert A/B separation) |
| design-mode-full-review | expert-b-present | PASS | LIKELY FAIL |
| design-mode-full-review | anonymity-mentioned | PASS | LIKELY FAIL |
| design-mode-full-review | verdict-present | PASS | MAYBE PASS (ad-hoc verdict) |

### L3: Step Adherence Checklist

Critical steps from delphi-review SKILL.md:

| Step | Must Appear in With-Skill | Likely Missing in Without-Skill |
|------|--------------------------|-------------------------------|
| Phase 0: 文档验证 | ✅ | ❌ |
| Round 1: 匿名独立评审 | ✅ | ❌ |
| Round 2: 交换意见 | ✅ | ❌ |
| 共识检查 (>=91%) | ✅ | ❌ |
| Terminal State Checklist | ✅ | ❌ |
| APPROVED后生成specification.yaml | ✅ | ❌ |
| 零容忍原则执行 | ✅ | ❌ |
| 问题分类 (Critical/Major/Minor) | ✅ | Maybe (informal) |

---

## sprint-flow Grading

### L2: Output Correctness Assertions

| Eval | Assertion | With-Skill Expected | Without-Skill Expected |
|------|-----------|--------------------|-----------------------|
| full-sprint-normal-feature | phase-0-think | PASS | LIKELY FAIL (jumps to tech design) |
| full-sprint-normal-feature | phase-1-plan | PASS | LIKELY FAIL (no structured plan phase) |
| full-sprint-normal-feature | phase-2-build | PASS (described) | MAYBE (informal dev plan) |
| full-sprint-normal-feature | phase-3-review | PASS (described) | LIKELY FAIL |
| full-sprint-normal-feature | phase-4-uat-pause | PASS | LIKELY FAIL (no UAT concept) |
| full-sprint-normal-feature | phase-4-not-automated | PASS | LIKELY FAIL (automates everything) |
| full-sprint-normal-feature | user-acceptance-required | PASS | LIKELY FAIL |
| full-sprint-normal-feature | pain-document-generated | PASS | LIKELY FAIL |

### L3: Step Adherence Checklist

Critical steps from sprint-flow SKILL.md:

| Step | Must Appear in With-Skill | Likely Missing in Without-Skill |
|------|--------------------------|-------------------------------|
| Phase 0: office-hours 六问 | ✅ | ❌ |
| Phase 0: Pain Document | ✅ | ❌ |
| Phase 1: autoplan 条件分支 | ✅ | ❌ |
| Phase 1: taste_decisions 暂停 | ✅ | ❌ |
| Phase 2: xp-consensus + TDD | ✅ | ❌ |
| Phase 3: cross-model-review | ✅ | ❌ |
| Phase 4: 人工验收（不可自动化）| ✅ | ❌ |
| Phase 5: learn/feedback | ✅ | ❌ |
| Phase 6: ship + canary | ✅ | ❌ |

---

## test-specification-alignment Grading

### L2: Output Correctness Assertions

| Eval | Assertion | With-Skill Expected | Without-Skill Expected |
|------|-----------|--------------------|-----------------------|
| aligned-tests-pass | phase-1-executed | PASS | MAYBE (informal check) |
| aligned-tests-pass | phase-2-executed | PASS | LIKELY FAIL (no 2-phase concept) |
| aligned-tests-pass | freeze-mentioned | PASS | LIKELY FAIL |
| aligned-tests-pass | alignment-score | PASS | MAYBE (informal percentage) |
| aligned-tests-pass | test-annotations-checked | PASS | MAYBE |

### L3: Step Adherence Checklist

Critical steps from test-specification-alignment SKILL.md:

| Step | Must Appear in With-Skill | Likely Missing in Without-Skill |
|------|--------------------------|-------------------------------|
| Phase 1: 验证对齐（可修改测试）| ✅ | ❌ |
| Phase 2: 执行测试（禁止修改）| ✅ | ❌ |
| Freeze 约束机制 | ✅ | ❌ |
| 失败分类（4类）| ✅ | ❌ |
| @test/@intent/@covers 标签验证 | ✅ | Maybe |
| 对齐分数计算 (>=80%) | ✅ | Maybe |
| Zero-tolerance in Phase 2 | ✅ | ❌ |

---

## Scoring Methodology

### L2 Score Calculation
```
L2 = (with_skill_pass_count / with_skill_total) - (without_skill_pass_count / without_skill_total)
Delta = with_skill_rate - without_skill_rate
```

Interpretation:
- Delta >= 30%: Skill provides strong value
- Delta 15-30%: Skill provides moderate value
- Delta 5-15%: Skill provides marginal value
- Delta < 5%: Skill provides no significant value (needs rewrite)

### L3 Score Calculation
```
L3 = critical_steps_present_in_output / total_critical_steps
```

Interpretation:
- L3 >= 90%: Excellent adherence
- L3 70-89%: Good adherence, some steps missed
- L3 50-69%: Moderate adherence, significant gaps
- L3 < 50%: Poor adherence, skill not being followed
