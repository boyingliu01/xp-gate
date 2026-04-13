---
name: code-reviewer
description: "Code review with principles analysis. Combines Clean Code/SOLID checking with AI-powered code review. Outputs console reports and SARIF format for IDE integration."
---

# Code Reviewer - Principles-Aware Code Review

## 核心原则

**只有一个目的：为代码变更提供全面的 Clean Code/SOLID 原则分析 + AI 评审。**

---

## 触发条件

### 自动触发
- `/code-reviewer` 命令
- `/review-pr` 命令（PR 评审）
- Git pre-commit hook（可选）

### 手动触发
- 用户请求代码评审

---

## 与 Principles Checker 的集成

```yaml
integrations:
  - principles.analyzer  # Clean Code + SOLID rules
  - ast-grep             # AST pattern matching
  - lizard               # Cyclomatic complexity
  
output_formats:
  - console              # Terminal output
  - json                 # Structured data
  - sarif                # IDE compatible (VSCode, GitHub Actions)
```

---

## 评审流程

```
/code-reviewer [files or PR]
    │
    ▼
┌────────────────────────────────────────────┐
│ Phase 1: Static Analysis                   │
│                                            │
│ ├─→ Principles Checker                     │
│ │      ├─→ Clean Code Rules (9)            │
│ │      ├─→ SOLID Rules (5)                 │
│ │      └─→ Output: violations list         │
│ │                                          │
│ ├─→ Cyclomatic Complexity (lizard)        │
│ │      ├─→ CCN > 5 → Warning               │
│ │      ├─→ CCN > 10 → Error                │
│ │      └─→ Output: complexity report       │
│ │                                          │
│ └─→ AST Pattern Analysis (ast-grep)       │
│      ├─→ Security patterns                 │
│      ├─→ Performance patterns              │
│      └─→ Output: pattern violations        │
│                                            │
└────────────────────────────────────────────┘
    │
    ▼
┌────────────────────────────────────────────┐
│ Phase 2: AI Code Review                    │
│                                            │
│ ├─→ Expert A (Architecture Review)         │
│ │      ├─→ Review principles findings      │
│ │      ├─→ Design pattern analysis         │
│ │      └─→ Output: architecture feedback   │
│ │                                          │
│ ├─→ Expert B (Implementation Review)      │
│ │      ├─→ Review principles findings      │
│ │      ├─→ Code quality analysis           │
│ │      └─→ Output: implementation feedback │
│ │                                          │
│ └─→ Summary Report                         │
│      ├─→ Principles violations merged      │
│      ├─→ AI review findings merged         │
│      └─→ Action items prioritized          │
│                                            │
└────────────────────────────────────────────┘
    │
    ▼
Output: Console / JSON / SARIF
```

---

## 输出格式

### Console Output

```markdown
## Code Review Report

### Principles Analysis

#### Clean Code Violations (N found)

| Rule | Severity | File:Line | Description |
|------|----------|-----------|-------------|
| ... | ... | ... | ... |

#### SOLID Violations (N found)

| Rule | Severity | File:Line | Description |
|------|----------|-----------|-------------|
| ... | ... | ... | ... |

### Complexity Analysis

| Function | File | CCN | Status |
|----------|------|-----|--------|
| processData | src/api.ts | 12 | ⚠️ Warning |
| calculateTotal | src/utils.ts | 4 | ✅ OK |

### AI Review Findings

#### Architecture (Expert A)
- [Finding 1]
- [Finding 2]

#### Implementation (Expert B)
- [Finding 1]
- [Finding 2]

### Summary

- Total violations: [N]
- Critical: [N] (must fix)
- Warning: [N] (should fix)
- Info: [N] (consider)

### Recommended Actions
1. [Priority 1 action]
2. [Priority 2 action]
```

### SARIF Output (IDE Compatible)

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "xp-workflow-principles",
          "version": "1.0.0",
          "rules": [
            {
              "id": "clean-code.long-function",
              "name": "Long Function",
              "shortDescription": "Function exceeds 50 lines"
            }
          ]
        }
      },
      "results": [
        {
          "ruleId": "clean-code.long-function",
          "level": "warning",
          "message": {
            "text": "Function 'processData' has 65 lines (threshold: 50)"
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "src/api.ts"
                },
                "region": {
                  "startLine": 45
                }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 命令行接口

```bash
# Review specific files
npx tsx src/principles/index.ts --files "src/api.ts src/utils.ts"

# Review with SARIF output
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif --output results.sarif

# Review only changed files (git diff)
npx tsx src/principles/index.ts --changed-only

# Review with custom threshold
npx tsx src/principles/index.ts --files "src/api.ts" --config .principlesrc
```

---

## 与其他 Skill 的关系

| Skill | 关系 |
|-------|------|
| `code-walkthrough` | code-reviewer 产出输入到 Delphi 评审 |
| `delphi-review` | 专家评审时参考 principles findings |
| `verification-loop` | 评审通过后进入验证流程 |

---

## 性能目标

| 指标 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 100 文件分析 | <5s | ~340ms (est.) | ✅ 7x faster |
| 全项目扫描 (10k lines) | <10s | ~2.6s (28 files) | ✅ 4x faster |
| 内存使用 | <50MB | ~102MB | ⚠️ Node.js baseline |
| 错误检出率 | >90% | TBD | 待验证 |
| SARIF 输出 | 完整 | 已实现 | ✅ 完成 |

**注：** 内存超目标是由于 Node.js 运行时基础开销（~80MB），不可避免。如需达到 50MB 目标，需编译为原生二进制。

---

## Terminal State Checklist

<MANDATORY-CHECKLIST>

### 只能在以下条件全部满足后完成评审：

**Phase 1 (Static Analysis):**
- [ ] Principles checker 完成
- [ ] Complexity check 完成
- [ ] 所有 violations 已记录

**Phase 2 (AI Review):**
- [ ] Expert A 完成评审
- [ ] Expert B 完成评审
- [ ] Summary report 已生成

**Output:**
- [ ] Console report 输出
- [ ] SARIF 文件生成（如请求）

**IF 有 Critical violations:**
- 建议 BLOCK 变更
- 列出必须修复的问题

**IF 有 Warning violations:**
- 建议 FIX before merge
- 列出建议修复的问题

</MANDATORY-CHECKLIST>

---

## 配置文件示例 (.principlesrc)

```json
{
  "rules": {
    "clean-code": {
      "long-function": { "enabled": true, "threshold": 50, "severity": "warning" },
      "large-file": { "enabled": true, "threshold": 500, "severity": "warning" },
      "god-class": { "enabled": true, "threshold": 15, "severity": "warning" },
      "deep-nesting": { "enabled": true, "threshold": 4, "severity": "warning" },
      "too-many-params": { "enabled": true, "threshold": 7, "severity": "info" },
      "magic-numbers": {
        "enabled": true,
        "exclude": [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024],
        "severity": "info"
      },
      "missing-error-handling": { "enabled": true, "severity": "warning" },
      "unused-imports": { "enabled": true, "severity": "info" },
      "code-duplication": { "enabled": true, "threshold": 15, "severity": "warning" }
    },
    "solid": {
      "srp": { "enabled": true, "methodThreshold": 15, "severity": "warning" },
      "ocp": { "enabled": true, "severity": "info" },
      "lsp": { "enabled": true, "severity": "info" },
      "isp": { "enabled": true, "methodThreshold": 10, "severity": "info" },
      "dip": {
        "enabled": true,
        "exclude": ["Date", "Map", "Set", "Error", "Array", "Object", "Promise"],
        "severity": "warning"
      }
    }
  },
  "output": {
    "format": "console",
    "show-score": true,
    "colorize": true
  }
}
```

---

## Anti-Patterns

| 错误 | 正确 |
|------|------|
| 跳过 principles checker | 始终运行，即使无 violations |
| 只输出 violations 不给建议 | 每个 violation 附带修复建议 |
| SARIF 格式不兼容 VSCode | 使用标准 SARIF 2.1.0 schema |
| 阻塞 info 级别 violations | info 只记录，不阻塞 |