# Skill Design Specification Template

Use this template when creating or refactoring any AI Skill.

---

## Metadata

```yaml
---
name: skill-name
description: One sentence describing WHEN to trigger this skill (required)
---
```

## Trigger Conditions

**Should trigger:**
- "trigger phrase 1"
- "trigger phrase 2"

**Should NOT trigger:**
- "non-trigger phrase 1"
- "non-trigger phrase 2"

## Input Contract

- **Required:** [What must be provided to run this skill]
- **Optional:** [What can be omitted]

## Workflow

Each step MUST produce a specific, verifiable output.

1. **[Step Name]** → Output: [Specific deliverable format]
2. **[Step Name]** → Output: [Specific deliverable format]
3. **[Step Name]** → Output: [Specific deliverable format]

## Output Contract (MANDATORY)

Every skill MUST define its output as valid JSON schema or machine-readable tokens.

```json
{
  "field_name": "type",
  "status": "PASS|FAIL|BLOCKED",
  "nested": {"key": "value"}
}
```

**Eval assertions check for:** `field_name`, `status`, `nested.key`.

## Anti-Patterns

| Pattern | Expected Behavior | Assertion |
|---------|------------------|-----------|
| [What NOT to do] | [How skill should handle it] | `not_contains` / `regex` |

## Token Budget

- **Max input tokens:** ~1500 (after optimization)
- **Max output tokens:** ~4000
- **Optimization:** Remove verbose examples, use concise tables

---

## Example: Minimal Viable Skill

```markdown
---
name: code-review
description: "Review code for quality and security. Trigger: 'review this PR', 'code review'"
---

# Code Review

## Trigger Conditions
**Should trigger:** "review this PR", "code review"
**Should NOT trigger:** "write code", "fix bug"

## Input Contract
- **Required:** Code diff or PR link
- **Optional:** Review focus area

## Workflow
1. **Analyze Changes** → Output: List of files and line ranges
2. **Check Patterns** → Output: Violations with severity
3. **Generate Report** → Output: JSON summary

## Output Contract (MANDATORY)
```json
{
  "review_status": "APPROVED|CHANGES_REQUESTED",
  "violations": [{"file": "string", "line": "number", "severity": "critical|major|minor"}],
  "summary": "string"
}
```
