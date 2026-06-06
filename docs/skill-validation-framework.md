# Skill Effectiveness Validation Framework

## Overview

This framework provides a systematic methodology for validating LLM-dependent skills before they are distributed by XP-Gate. Regression and security evaluation now belongs to the external skill-cert project; XP-Gate itself only distributes and invokes approved skills.

## Tool Selection Guide

| Concern | Tool | When to Use |
|---------|------|-------------|
| Cross-validation (with vs without skill) | skill-creator eval | First-time validation, skill improvement |
| Trigger accuracy | skill-creator description optimization | Skill not firing or over-firing |
| Regression detection | external skill-cert evals | Creation/update-time regression checks |
| Cross-model benchmarking | Calibra | Testing across different LLM providers |
| Behavioral stability | external drift evaluation | Model-update drift detection |
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

## Validation Metrics (L1-L8)

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

### L5: Safety/Security Scan
- **Metric**: High-severity security findings count (must be 0 for PASS)
- **Method**: Run security scanner against skill's code/output for 19 attack patterns across 5 categories (INJ/EXF/DCMD/CRD/OBF)
- **Threshold**: `security_scan.high_findings == 0` (blocking)
- **Tool**: Built-in security scanner (AgentShield-compatible)
- **Blocking Rule**: Any high-severity finding → verdict = FAIL, skill cannot be published

### L6: Cost Efficiency
- **Metric**: Token cost delta (with-skill vs without-skill), cost efficiency ratio
- **Method**: Track actual TokenUsage dataclass (not approximations), convert to USD via provider pricing
- **Threshold**: Cost delta acceptable for value delivered; `cost_analysis.total_cost` or `local/free` marker in report
- **Tool**: Token usage tracker with provider pricing lookup
- **Output Field**: `cost_analysis`: { `total_cost`: number, `with_skill_cost`: number, `without_skill_cost`: number, `delta`: number, `efficiency_ratio`: number, `marker`: "paid" | "local/free" }

### L7: Latency/Performance
- **Metric**: P50/P95/P99 latency measurements, with/without skill overhead
- **Method**: Measure response times across eval runs, calculate percentiles
- **Threshold**: Latency overhead acceptable for value delivered; no timeout violations
- **Tool**: Performance timer around eval execution
- **Output Field**: `latency_analysis`: { `p50`: number, `p95`: number, `p99`: number, `with_skill_p50`: number, `without_skill_p50`: number, `overhead_ms`: number }

### L8: Verdict Integration
- **Metric**: Final PASS/FAIL/PASS_WITH_CAVEATS determination based on all L1-L7 metrics
- **Method**: Aggregate all metric results against thresholds, apply blocking rules
- **Thresholds**:
  - **PASS**: L1>=90%, L2>=20%, L3>=85%, L4 std<=10%, L5 high_findings==0, drift none/low
  - **PASS_WITH_CAVEATS**: Core metrics pass, but drift moderate
  - **FAIL**: Any core metric fails, or drift high, or coverage <70%, or L5 high_findings>0
- **Tool**: Verdict aggregator
- **Output Field**: `verdict`: "PASS" | "PASS_WITH_CAVEATS" | "FAIL", `overall_score`: 0-1 number, `blocking_reasons`: string[]

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
- L5 Security Scan: [0 high findings]
- L6 Cost Efficiency: [X% delta, ratio]
- L7 Latency: [P50/P95/P99 ms]
- Verdict: [PASS|PASS_WITH_CAVEATS|FAIL]

## L2 Cross-Validation Results
| Metric | With Skill | Without Skill | Delta |
|--------|-----------|---------------|-------|
| Assertion Pass Rate | X% | Y% | +Z% |
| Critical Steps Present | N/M | K/M | +(N-K)/M |

## L3 Step Adherence Details
| Step | Present? | Evidence |
|------|----------|----------|
| Step 1 | ✅/❌ | [quote from output] |

## L5 Security Scan
| Category | Findings | Severity |
|----------|----------|----------|
| INJ (Injection) | 0 | - |
| EXF (Exfiltration) | 0 | - |
| DCMD (Dangerous Command) | 0 | - |
| CRD (Data Destruction) | 0 | - |
| OBF (Obfuscation) | 0 | - |
| **High Findings Total** | **0** | **Blocking** |

## L6 Cost Analysis
| Metric | Value |
|--------|-------|
| Total Cost | $X.XX (or local/free) |
| With-Skill Cost | $X.XX |
| Without-Skill Cost | $X.XX |
| Delta | +$X.XX (X%) |
| Efficiency Ratio | X.X |

## L7 Latency Analysis
| Percentile | Value |
|------------|-------|
| P50 | X ms |
| P95 | X ms |
| P99 | X ms |
| Overhead (with vs without) | X ms |

## Issues Found
| ID | Severity | Description | Recommendation |
|----|----------|-------------|----------------|

## Improvement Suggestions
1. [Specific suggestion based on data]

## JSON Report Fields (Machine-Readable)
```json
{
  "verdict": "PASS",
  "overall_score": 0.82,
  "metrics": {
    "l1_trigger_accuracy": 0.90,
    "l2_with_without_skill_delta": 0.25,
    "l3_step_adherence": 0.88,
    "l4_execution_stability": 0.93,
    "l5_security_high_findings": 0,
    "l6_cost_efficiency_ratio": 1.15,
    "l7_latency_overhead_ms": 120
  },
  "drift_analysis": {
    "drift_detected": false,
    "highest_severity": "none",
    "average_variance": 0.0,
    "model_pairs_compared": 1,
    "overall_verdict": "PASS"
  },
  "evaluation_coverage": {
    "total_evaluations": 207,
    "avg_pass_rate": 1.0,
    "assertion_breakdown": {
      "critical": {"passed": 40, "total": 40},
      "important": {"passed": 54, "total": 58},
      "normal": {"passed": 113, "total": 113}
    }
  },
  "cost_analysis": {
    "total_cost": 0.12,
    "with_skill_cost": 0.08,
    "without_skill_cost": 0.04,
    "delta": 0.04,
    "efficiency_ratio": 1.15,
    "marker": "paid"
  },
  "latency_analysis": {
    "p50": 1200,
    "p95": 2400,
    "p99": 3600,
    "with_skill_p50": 1320,
    "without_skill_p50": 1200,
    "overhead_ms": 120
  },
  "security_scan": {
    "high_findings": 0,
    "categories": {
      "INJ": 0,
      "EXF": 0,
      "DCMD": 0,
      "CRD": 0,
      "OBF": 0
    }
  },
  "improvement_suggestions": ["增加输出格式声明以提高 L3 得分"],
  "config_summary": {
    "models": "model-list",
    "max_concurrency": 5,
    "rate_limit_rpm": 60
  },
  "benchmark": {
    "timestamp": "ISO 8601 UTC",
    "total_requirements": 10,
    "total_acceptance_criteria": 66,
    "test_coverage": "描述"
  }
}
```

**Required JSON Fields for Publish Blocking:**
- `cost_analysis.total_cost` or `cost_analysis.marker` (must be "local/free" if no cost)
- `latency_analysis.p50`, `latency_analysis.p95`, `latency_analysis.p99`
- `security_scan.high_findings` (must be 0 for PASS)
- `verdict` impact rules: high findings → FAIL, drift high → FAIL, coverage <70% → FAIL
```

## Execution SOP

### First-Time Validation
1. Create `evals/evals.json` with test cases
2. Run cross-validation: 3 with-skill + 3 without-skill runs
3. Grade assertions against outputs
4. Generate validation report
5. File improvement issues if any L1-L4 metric below threshold

### Regression Check (Creation/Update Time)
1. Run existing evals/evals.json through the external skill-cert project
2. Compare against baseline benchmark.json
3. Alert if any metric drops below threshold

### Skill Update Validation
1. Before modifying SKILL.md, snapshot current eval results
2. Make modification
3. Re-run cross-validation
4. Verify no regression + improvement in targeted metric
