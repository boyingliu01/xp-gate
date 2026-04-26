# Skill Effectiveness Validation Framework

## Overview

This framework provides a systematic methodology for validating LLM-dependent skills in the XGate project. It combines Anthropic's skill-creator eval pipeline with promptfoo regression testing.

## Tool Selection Guide

| Concern | Tool | When to Use |
|---------|------|-------------|
| Cross-validation (with vs without skill) | skill-creator eval | First-time validation, skill improvement |
| Trigger accuracy | skill-creator description optimization | Skill not firing or over-firing |
| Regression detection | promptfoo | CI/CD integration, weekly regression checks |
| Cross-model benchmarking | Calibra | Testing across different LLM providers |
| Behavioral stability | PromptPressure | Multi-turn drift detection |
| Step adherence | Custom checklist (this framework) | Verifying skill workflow compliance |

## Test Case Template

Each skill should have an `evals/evals.json` file with this structure:

```json
{
  "skill_name": "example-skill",
  "skill_path": "/path/to/SKILL.md",
  "evals": [
    {
      "id": 1,
      "name": "descriptive-test-name",
      "category": "normal|boundary|failure",
      "prompt": "The user's task prompt",
      "expected_output": "Description of expected behavior",
      "files": [],
      "assertions": [
        {"name": "assertion-name", "type": "contains|not_contains|regex", "value": "expected text"}
      ]
    }
  ],
  "trigger_evals": {
    "should_trigger": ["prompt1", "prompt2"],
    "should_not_trigger": ["prompt3", "prompt4"]
  }
}
```

### Assertion Types

| Type | Description | Example |
|------|-------------|---------|
| `contains` | Output must contain the value | `{"type": "contains", "value": "Round 1"}` |
| `not_contains` | Output must NOT contain the value | `{"type": "not_contains", "value": "跳过验收"}` |
| `regex` | Output must match the regex pattern | `{"type": "regex", "value": "(APPROVED|REQUEST_CHANGES)"}` |

### Eval Categories

| Category | Purpose | Count |
|----------|---------|-------|
| `normal` | Happy path, expected behavior | >= 1 |
| `boundary` | Edge cases, adversarial inputs | >= 1 |
| `failure` | Expected failure/rejection scenarios | >= 0 |

## Validation Metrics (L1-L4)

### L1: Trigger Accuracy
- **Metric**: Percentage of correct trigger/no-trigger decisions
- **Method**: Run 5+ should-trigger and 5+ should-not-trigger queries
- **Threshold**: >= 90% accuracy
- **Tool**: skill-creator description optimization

### L2: Output Correctness
- **Metric**: Assertion pass rate (with-skill vs without-skill delta)
- **Method**: Run eval cases with and without skill, compare assertion pass rates
- **Threshold**: With-skill pass rate >= without-skill pass rate + 20%
- **Tool**: skill-creator eval framework

### L3: Step Adherence
- **Metric**: Percentage of skill-defined steps that appear in the output
- **Method**: Parse skill's workflow/checklist, verify each step is addressed in output
- **Threshold**: >= 85% of critical steps present
- **Tool**: Custom checklist validator

### L4: Execution Stability
- **Metric**: Variance in assertion pass rates across N>=3 runs
- **Method**: Run same eval suite 3+ times, calculate standard deviation
- **Threshold**: Std dev <= 10% of mean pass rate
- **Tool**: Multiple skill-creator eval runs

## Report Template

Each skill validation produces a report:

```markdown
# Skill Validation Report: [skill-name]

## Summary
- Overall Score: [X/100]
- L1 Trigger Accuracy: [X%]
- L2 Output Correctness: [X%] (delta: +[X%])
- L3 Step Adherence: [X%]
- L4 Execution Stability: [σ=X%]

## L2 Cross-Validation Results
| Metric | With Skill | Without Skill | Delta |
|--------|-----------|---------------|-------|
| Assertion Pass Rate | X% | Y% | +Z% |
| Critical Steps Present | N/M | K/M | +(N-K)/M |

## L3 Step Adherence Details
| Step | Present? | Evidence |
|------|----------|----------|
| Step 1 | ✅/❌ | [quote from output] |

## Issues Found
| ID | Severity | Description | Recommendation |
|----|----------|-------------|----------------|

## Improvement Suggestions
1. [Specific suggestion based on data]
```

## Execution SOP

### First-Time Validation
1. Create `evals/evals.json` with test cases
2. Run cross-validation: 3 with-skill + 3 without-skill runs
3. Grade assertions against outputs
4. Generate validation report
5. File improvement issues if any L1-L4 metric below threshold

### Regression Check (Weekly)
1. Run existing evals/evals.json through promptfoo
2. Compare against baseline benchmark.json
3. Alert if any metric drops below threshold

### Skill Update Validation
1. Before modifying SKILL.md, snapshot current eval results
2. Make modification
3. Re-run cross-validation
4. Verify no regression + improvement in targeted metric
