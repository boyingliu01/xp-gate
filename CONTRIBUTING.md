# Contributing to XP Workflow Automation

Thank you for your interest in contributing!

## Development Setup

```bash
# Clone and install
git clone https://github.com/boyingliu01/xp-workflow-automation.git
cd xp-workflow-automation
npm install

# Setup git hooks (MANDATORY)
cp githooks/pre-commit .git/hooks/pre-commit
cp githooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

## Quality Gates

All commits must pass the 8-gate quality system:

| Gate | Check | Threshold |
|------|-------|-----------|
| 1 | TypeScript strict | No errors |
| 2 | ESLint | No warnings |
| 3 | Tests | All pass |
| 4 | Coverage | ≥80% |
| 5 | Shell check | No errors |
| 6 | Principles | No violations |
| 7 | CCN | ≤5 warn, ≤10 block |
| 8 | Boy Scout | No warning increase |

## Pull Request Process

### Before Implementation

1. **MANDATORY**: Run `/delphi-review` for design decisions
2. Get APPROVED verdict from Delphi consensus
3. Create `specification.yaml` with requirements and ACs

### During Implementation

1. Write tests first (TDD)
2. Add test annotations: `@test REQ-XXX`, `@covers AC-XXX`
3. Verify coverage ≥80%
4. Run `git commit` to trigger quality gates

### Before Merge

1. Run `/xp-consensus` for final verification
2. Get Arbiter APPROVED with confidence ≥8
3. Ensure all ACs have passing tests

## Coding Standards

### File Naming
- Source: `src/module/file-name.ts`
- Tests: `src/module/__tests__/file-name.test.ts`
- Skills: `skills/skill-name/SKILL.md`

### Test Annotations
```typescript
/**
 * @test REQ-XXX Feature name
 * @intent Verify specific behavior
 * @covers AC-XXX-01, AC-XXX-02
 */
describe('Feature', () => {
  it('should do X when Y', () => { ... });
});
```

### Anti-Patterns (NEVER)
- `as any`, `@ts-ignore`, `@ts-expect-error`
- Empty catch blocks
- Skipping quality gates via flags
- Modifying frozen tests in Phase 2

## Push Limits

- Maximum **20 files** per push
- Maximum **500 LOC** changes per push

Split large changes into multiple commits.

## Skill Development

Skills are markdown files, not executable code:

```markdown
---
name: skill-name
description: Brief description
---

# Skill Title

## Core Principles
...

## Workflow
...
```

## Questions?

Open an issue or discussion on GitHub.