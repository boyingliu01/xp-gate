# Ralph Loop — Progress Log

Feature: [feature name]
Started: [ISO 8601]
Source: specification.yaml
Topology Order: [REQ-001, REQ-002, ...]

---

## REQ-001 — [title]

**Status**: PASS / FAIL / TIMEOUT / BLOCKED
**Retry count**: 0
**Files changed**: [file1, file2, ...]
**Learnings**:
- `[permanent]` migration files must be in src/migrations/
- `[contextual]` off-by-one at line 42 in utils.ts
**Timestamp**: [ISO 8601]

---

## REQ-002 — [title]

**Status**: PASS
**Retry count**: 1
**Failure injected**: Linter: unused-var at line 42
**Files changed**: [file1, file2, ...]
**Learnings**:
- `[permanent]` Auth middleware must run before validation
**Timestamp**: [ISO 8601]

---

<!-- Append new REQs below. Tag: permanent / contextual -->
