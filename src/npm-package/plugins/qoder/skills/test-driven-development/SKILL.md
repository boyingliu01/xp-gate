---
name: test-driven-development
description: >
  Test-Driven Development enforcement: RED → GREEN → REFACTOR cycle.
  Write failing test first, then minimum code to pass, then refactor.
  Includes Mock Usage Guidelines for integration-first testing.

maturity: stable
---

# Test-Driven Development

## Core Principles

| Principle | Description |
|-----------|-------------|
| **RED First** | Write a failing test before ANY implementation code |
| **GREEN Minimum** | Write minimum code to pass the test — no extra features |
| **REFACTOR** | Clean up code while keeping tests green |
| **Delete & Restart** | If you write code before test — delete it and start over |

## Workflow

```
1. RED: Write failing test (describe/it + expect)
2. GREEN: Write minimum implementation to pass
3. REFACTOR: Clean up, extract, simplify — tests stay green
4. Repeat for next behavior
```

## Mock Usage Guidelines (MANDATORY)

### When to use mocks (ONLY these cases):
1. External API/HTTP calls — use testcontainers or nock
2. Database I/O — use in-memory DB (sqlite, testcontainers)
3. File system I/O — use tmpdir / memfs
4. Time-dependent code — inject clock dependency
5. Non-deterministic behavior (random, UUID) — inject dependency

### When NOT to use mocks:
- Pure business logic → test with real values
- In-memory data transformations → test with real data
- Validation logic → test with real input/output
- State machines → test with real state transitions

### Mock Density Rule:
If > 30% of test lines contain mock/spy/fn references,
you are likely over-mocking. Add `// @mock-justified: <reason>` comment
explaining why integration test is not feasible.

### Annotation Format:
```typescript
// @mock-justified: external API wrapper, no sandbox environment available
```
Reason text must be at least 10 characters. Bare `@mock-justified` without colon+reason is invalid.

## Test Annotations

```typescript
/**
 * @test REQ-XXX Feature name
 * @intent Verify specific behavior
 * @covers AC-XXX-01, AC-XXX-02
 */
```

## Coverage Requirements

- Minimum 80% line coverage
- All acceptance criteria must have corresponding tests
- Tests must survive mutation testing (Gate M pre-push)
