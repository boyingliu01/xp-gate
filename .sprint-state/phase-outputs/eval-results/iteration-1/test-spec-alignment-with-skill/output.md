# Test-Specification Alignment Evaluation

**Skill:** test-specification-alignment V2.0
**Scenario:** Project with `specification.yaml` defining 3 requirements and 6 acceptance criteria. Test files contain `@test REQ-001`, `@intent`, `@covers AC-001-01` annotations.
**Evaluator:** Simulated execution following the skill's two-phase process exactly.

---

## Phase 0: Preparation

### Step-by-step per the Skill

1. **Verify `specification.yaml` exists** — The skill mandates checking for the specification file. In our scenario, it exists with 3 requirements (REQ-001, REQ-002, REQ-003) and 6 acceptance criteria (AC-001-01, AC-001-02, AC-002-01, AC-002-02, AC-003-01, AC-003-02).

2. **Verify `tests/` directory exists** — The skill checks for the test directory. In our scenario, test files exist with `@test`, `@intent`, `@covers` annotations.

3. **IF missing → BLOCK** — The skill specifies that if either is missing, the process must BLOCK with a clear error message directing the user to complete the requirements flow first: `brainstorming → delphi-review → specification-generator`.

**State transition:** IDLE (0) → PHASE0_PREPARING (1) → PHASE0_COMPLETE (2)

---

## Phase 1: Alignment Verification (Tests May Be Modified)

### Alignment Verification Algorithm Steps

The skill defines the following verification sequence:

#### Step 1: Parse `specification.yaml` (YAML parser)

Extract all structured data from the specification:

```yaml
# Simulated specification.yaml content:
requirements:
  - id: REQ-001
    description: "User authentication with credentials"
    acceptance_criteria:
      - id: AC-001-01
        description: "Returns 200 and token on valid credentials"
      - id: AC-001-02
        description: "Returns 401 on invalid credentials"

  - id: REQ-002
    description: "Session management with token refresh"
    acceptance_criteria:
      - id: AC-002-01
        description: "Token refreshes before expiry"
      - id: AC-002-02
        description: "Expired token returns 403"

  - id: REQ-003
    description: "Role-based access control"
    acceptance_criteria:
      - id: AC-003-01
        description: "Admin can access all resources"
      - id: AC-003-02
        description: "Regular user blocked from admin resources"
```

**Extracted counts:**
- Total Requirements: 3
- Total Acceptance Criteria: 6

#### Step 2: Parse test files (AST parser)

Parse all test files using AST analysis, extracting structured annotations:

```typescript
// Simulated test file: auth.test.ts

/**
 * @test REQ-001
 * @intent Verify user can login with valid credentials
 * @covers AC-001-01, AC-001-02
 */
describe('REQ-001: User Authentication', () => {
  it('should return 200 and token on valid credentials', () => {
    // AC-001-01: Returns 200 and token
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });

  it('should return 401 on invalid credentials', () => {
    // AC-001-02: Returns 401
    expect(response.status).toBe(401);
  });
});

/**
 * @test REQ-002
 * @intent Verify session management and token refresh
 * @covers AC-002-01
 */
describe('REQ-002: Session Management', () => {
  it('should refresh token before expiry', () => {
    // AC-002-01: Token refresh before expiry
    expect(newToken).toBeDefined();
    expect(newToken !== oldToken).toBe(true);
  });

  // ⚠️ NOTE: AC-002-02 is NOT covered — missing test for expired token returning 403
});

/**
 * @test REQ-003
 * @intent Verify role-based access control
 * @covers AC-003-01, AC-003-02
 */
describe('REQ-003: Role-Based Access Control', () => {
  it('should allow admin to access all resources', () => {
    // AC-003-01: Admin full access
    expect(adminResponse.status).toBe(200);
  });

  it('should block regular user from admin resources', () => {
    // AC-003-02: User blocked
    expect(userResponse.status).toBe(403);
  });
});
```

**Extracted test annotations:**

| Test | @test | @intent | @covers |
|------|-------|---------|---------|
| REQ-001: User Authentication | REQ-001 | ✅ Present | AC-001-01, AC-001-02 |
| REQ-002: Session Management | REQ-002 | ✅ Present | AC-002-01 |
| REQ-003: Role-Based Access Control | REQ-003 | ✅ Present | AC-003-01, AC-003-02 |

#### Step 3: Verify alignment rules

The skill defines **three mandatory alignment rules**:

**Rule 1: Each Requirement must have a test** (`requirement_to_test`)

| Requirement | Has Test? | Status |
|-------------|-----------|--------|
| REQ-001 | ✅ Yes | PASS |
| REQ-002 | ✅ Yes | PASS |
| REQ-003 | ✅ Yes | PASS |

**Rule 2: Each Acceptance Criterion must have an assertion** (`ac_to_assertion`)

| AC ID | Has Assertion? | Status |
|-------|---------------|--------|
| AC-001-01 | ✅ Yes | PASS |
| AC-001-02 | ✅ Yes | PASS |
| AC-002-01 | ✅ Yes | PASS |
| AC-002-02 | ❌ No | **FAIL** |
| AC-003-01 | ✅ Yes | PASS |
| AC-003-02 | ✅ Yes | PASS |

**Rule 3: Test intent must be explicitly declared** (`test_intent_declaration`)

| Test | @test | @intent | @covers | Status |
|------|-------|---------|---------|--------|
| REQ-001 suite | ✅ REQ-001 | ✅ Present | ✅ AC-001-01, AC-001-02 | PASS |
| REQ-002 suite | ✅ REQ-002 | ✅ Present | ⚠️ Only AC-002-01 | PARTIAL |
| REQ-003 suite | ✅ REQ-003 | ✅ Present | ✅ AC-003-01, AC-003-02 | PASS |

**Required tags check:**
- `@test REQ-XXX`: All 3 test suites have it ✅
- `@intent`: All 3 test suites have it ✅
- `@covers AC-XXX-XX`: REQ-002 is missing AC-002-02 ❌

#### Step 4: Calculate Alignment Score

Per the skill's weighted dimensions:

| Dimension | Score | Weight | Weighted Score | Calculation |
|-----------|-------|--------|----------------|------------|
| Requirement Coverage | 100% (3/3) | 30% | 30.0 | 3/3 = 1.0 × 30 |
| Acceptance Criteria Coverage | 83.3% (5/6) | 25% | 20.8 | 5/6 = 0.833 × 25 |
| Test Intent Correctness | 100% (3/3) | 20% | 20.0 | All @test, @intent present × 20 |
| Edge Case Coverage | 66.7% (2/3) | 15% | 10.0 | Missing AC-002-02 (edge case) × 15 |
| Test Data Validity | 90% | 10% | 9.0 | Reasonable test data assumed × 10 |
| **Total** | | | **89.8** | |

**Alignment Score: 89.8/100**

#### Step 5: Checkpoint — Alignment Score >= 80%?

- 89.8 >= 80 ✅ → **Proceed to Phase 2**

#### Step 6: Fix alignment issues (allowed in Phase 1)

Since AC-002-02 is uncovered, the agent **may** add a test in Phase 1 (modification is permitted):

```typescript
// Proposed fix for AC-002-02 in Phase 1:

it('should return 403 when token is expired', () => {
  // AC-002-02: Expired token returns 403
  const expiredToken = generateExpiredToken();
  const response = request.withToken(expiredToken);
  expect(response.status).toBe(403);
});
```

And update the `@covers` tag:

```typescript
/**
 * @test REQ-002
 * @intent Verify session management and token refresh
 * @covers AC-002-01, AC-002-02  ← Updated
 */
```

**After fix, revised Alignment Score: 95.0/100** (AC Coverage → 100%, Edge Case → 100%)

**State transition:** PHASE0_COMPLETE (2) → PHASE1_ALIGNING (3) → PHASE1_ALIGNMENT_ISSUES (4) → PHASE1_FIXING_TESTS (5) → PHASE1_COMPLETE (6)

---

### Alignment Report (Phase 1 Output)

```markdown
## Test-Specification Alignment Report

### Summary
- Alignment Score: 95/100
- Total Requirements: 3
- Covered Requirements: 3/3 (100%)
- Total Acceptance Criteria: 6
- Covered AC: 6/6 (100%)

### Coverage by Dimension
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Requirement Coverage | 100% | 30% | 30.0 |
| Acceptance Criteria Coverage | 100% | 25% | 25.0 |
| Test Intent Correctness | 100% | 20% | 20.0 |
| Edge Case Coverage | 100% | 15% | 15.0 |
| Test Data Validity | 90% | 10% | 9.0 |
| **Total** | | | **99.0** |

### Misaligned Tests
| Test ID | Issue | Specification Ref | Recommendation |
|---------|-------|-------------------|----------------|
| REQ-002 suite | Missing @covers AC-002-02 | AC-002-02 | Fixed: Added test for expired token |

### Missing Tests
| Requirement ID | Description | Priority |
|----------------|-------------|----------|
| (none after fix) | — | — |

### Fixes Applied (Phase 1)
1. Added test case for AC-002-02 ("should return 403 when token is expired")
2. Updated @covers annotation from `AC-002-01` to `AC-002-01, AC-002-02`

### Status
✅ Alignment Score >= 80%, can proceed to Phase 2
```

---

## Pre-Phase 2: Freeze Mechanism

### Freeze Step (MANDATORY)

The skill specifies: **Before Phase 2 begins, invoke the `/freeze` skill to lock all test directories and files.**

**Freeze boundary (from skill definition):**

```
freeze_boundary:
  - "tests/"
  - "test/"
  - "__tests__/"
  - "*.test.ts"
  - "*.test.js"
  - "*.spec.ts"
  - "*.spec.js"
  - "*_test.py"
  - "*_test.go"
  - "cypress/"
  - "playwright/"
mode: "strict"
```

**What happens when freeze is active:**
- The agent's `Edit` and `Write` tool calls targeting any file within the freeze boundary are **pre-intercepted and blocked**
- The freeze skill returns `BLOCKED_ERROR` for any attempt to modify, delete, or create test files
- Business code, config files, and environment variables remain editable

**State transition:** PHASE1_COMPLETE (6) → PRE_PHASE2_FREEZE (7) → CHECKPOINT_VERIFIED (8)

**Result:** ✅ Test files frozen — `auth.test.ts` and all test directories locked.

---

## Phase 2: Test Execution (Tests Must NOT Be Modified)

### Phase 2 Constraints (Zero-Tolerance)

The skill defines these **forbidden actions** during Phase 2:

| Action | Severity | Response |
|--------|----------|----------|
| Modify test files | CRITICAL | freeze skill returns BLOCKED_ERROR |
| Delete test files | CRITICAL | freeze skill returns BLOCKED_ERROR |
| Skip tests (test.skip, @skip, xit) | CRITICAL | Detected and rejected |
| Modify assertions to always pass | CRITICAL | Detected and rejected |

**Allowed actions:**
- ✅ Modify business code
- ✅ Modify configuration files
- ✅ Modify environment variables

### Step 1: Execute all tests

```
Test Runner: jest --coverage --no-cache

Tests run:
  REQ-001: User Authentication
    ✅ should return 200 and token on valid credentials
    ✅ should return 401 on invalid credentials
  REQ-002: Session Management
    ✅ should refresh token before expiry
    ❌ should return 403 when token is expired  ← FAILED
  REQ-003: Role-Based Access Control
    ✅ should allow admin to access all resources
    ✅ should block regular user from admin resources

Results: 5 passed, 1 failed, 0 skipped
```

**State transition:** PHASE2_EXECUTING (9) → PHASE2_TEST_FAILURE (10)

### Step 2: Failure Analysis

The skill defines a **four-category failure classification taxonomy**:

| Failure Type | Judgment Basis | Handling |
|--------------|---------------|----------|
| **BUSINESS_CODE_ERROR** | Test is correct, business code has a bug | Modify business code |
| **TEST_DATA_ERROR** | Test data doesn't match business logic | Roll back to Phase 1 |
| **SPECIFICATION_ERROR** | Test is correct, but specification is wrong | ESCALATE_TO_HUMAN |
| **ENVIRONMENT_ERROR** | Environment/dependency issues | Fix environment config |

**Analyzing the failure:**

```
Test: "should return 403 when token is expired"
Error: AssertionError: Expected 401, Received 403
  at Object.<anonymous> (auth.test.ts:45:18)
```

**Root cause determination:**
- The test expects `403` for expired tokens (as per AC-002-02)
- The business code returns `401` instead of `403`
- The specification says "Expired token returns 403" (AC-002-02)
- The specification is consistent — the business code has the bug

**Classification: BUSINESS_CODE_ERROR**

The test is correct; the business code's `authMiddleware` returns `401` for expired tokens but should return `403` per the specification.

**State transition:** PHASE2_TEST_FAILURE (10) → PHASE2_FAILURE_ANALYSIS (11) → PHASE2_FIXING_CODE (12)

### Step 3: Fix business code (NOT test files)

Since this is a `BUSINESS_CODE_ERROR`, the agent modifies the business code while the freeze prevents any test modification:

```typescript
// src/middleware/auth.ts — BEFORE:
if (isTokenExpired(token)) {
  return res.status(401).json({ error: 'Token expired' });
}

// src/middleware/auth.ts — AFTER:
if (isTokenExpired(token)) {
  return res.status(403).json({ error: 'Token expired' });
}
```

**Note:** The freeze skill **allowed** this edit because `src/middleware/auth.ts` is NOT within the freeze boundary (it's business code, not a test file).

### Step 4: Re-run tests

```
Test Runner: jest --coverage --no-cache

Results: 6 passed, 0 failed, 0 skipped
Coverage: 85% (branches), 90% (functions), 88% (lines), 82% (statements)
```

**State transition:** PHASE2_FIXING_CODE (12) → PHASE2_COMPLETE (14)

### If the failure were a SPECIFICATION_ERROR

Had the analysis revealed that the specification was wrong (e.g., the specification says "403" but the intended behavior is actually "401"), the skill mandates:

```
ESCALATE_SPECIFICATION_ISSUE

User options:
  A) Fix Specification → unfreeze tests → restart Phase 1
  B) Confirm Specification is correct → modify business code (user explicitly authorizes)
  C) Clarify Specification ambiguity → unfreeze tests → restart Phase 1
```

The agent **MUST NOT** decide on its own — it **MUST ESCALATE_TO_HUMAN** and wait for user direction.

**State:** BLOCKED_SPECIFICATION_ISSUE (93)

---

## Post-Phase 2: Unfreeze Mechanism

### Unfreeze Step (MANDATORY)

After all tests pass, invoke the `/unfreeze` skill to release the test directory lock:

```
INVOKE unfreeze skill
→ Test directories unlocked
→ Subsequent modifications to test files are allowed again
```

**State transition:** PHASE2_COMPLETE (14) → POST_PHASE2_UNFREEZE (15) → ALL_TESTS_PASS (16)

---

## Test Execution Report (Phase 2 Output)

```markdown
## Test Execution Report

### Summary
- Total Tests: 6
- Passed: 6
- Failed: 0
- Skipped: 0

### Initial Run
- Passed: 5
- Failed: 1 (AC-002-02: expired token returns wrong status code)

### Failed Tests (Initial)
| Test ID | Error | Root Cause | Classification | Fix Applied |
|---------|-------|------------|----------------|-------------|
| REQ-002/AC-002-02 | AssertionError: Expected 403, Received 401 | Business code returns 401 instead of 403 | BUSINESS_CODE_ERROR | Fixed auth.ts: changed 401→403 for expired tokens |

### Re-run After Fix
- Passed: 6
- Failed: 0

### Freeze Status
- Pre-Phase 2: ✅ Test directories frozen
- Phase 2: ✅ No violation attempts (1 business code edit allowed through freeze)
- Post-Phase 2: ✅ Test directories unfrozen

### Status
✅ All tests pass. Ready for next stage.
```

---

## Terminal State Verification

Per the skill's `<MANDATORY-CHECKLIST>`, the following must ALL be true before declaring completion:

### Pre-requisites
- [x] `specification.yaml` exists and is parseable
- [x] `tests/` directory exists and has test files
- [x] Phase 1 alignment verification complete

### CRITICAL — Alignment Verification
- [x] Alignment Score >= 80% (95/100 after Phase 1 fixes)
- [x] All Critical alignment issues fixed (AC-002-02 missing test → added)
- [x] All Major alignment issues handled (none remaining)

### CRITICAL — Phase 2 Execution
- [x] freeze skill invoked, test directories locked
- [x] All tests executed (6/6)
- [x] No test modification violations (freeze blocked zero attempts; 1 business code edit passed through)
- [x] unfreeze skill invoked

### Final Requirements
- [x] All tests pass (6/6)
- [x] Report generated (this document)

**✅ ALL CONDITIONS MET — test-specification-alignment complete**

---

## Complete State Machine Trace

```
State 0 (IDLE)
  → State 1 (PHASE0_PREPARING): Verified specification.yaml + tests/
  → State 2 (PHASE0_COMPLETE): Both exist
  → State 3 (PHASE1_ALIGNING): Parsing specification + tests via AST
  → State 4 (PHASE1_ALIGNMENT_ISSUES): Found AC-002-02 uncovered (score 89.8)
  → State 5 (PHASE1_FIXING_TESTS): Added test for AC-002-02, updated @covers
  → State 6 (PHASE1_COMPLETE): Score now 95.0, >= 80% threshold
  → State 7 (PRE_PHASE2_FREEZE): Invoked /freeze, test directories locked
  → State 8 (CHECKPOINT_VERIFIED): Alignment score verified
  → State 9 (PHASE2_EXECUTING): Running all 6 tests
  → State 10 (PHASE2_TEST_FAILURE): 1 test failed (AC-002-02)
  → State 11 (PHASE2_FAILURE_ANALYSIS): Classified as BUSINESS_CODE_ERROR
  → State 12 (PHASE2_FIXING_CODE): Fixed auth.ts (401→403 for expired tokens)
  → State 14 (PHASE2_COMPLETE): Re-run, all 6 tests pass
  → State 15 (POST_PHASE2_UNFREEZE): Invoked /unfreeze, test directories unlocked
  → State 16 (ALL_TESTS_PASS): ✅ COMPLETE
```

---

## Anti-Patterns Guarded Against

| Anti-Pattern | How This Skill Prevents It |
|-------------|---------------------------|
| Phase 2 modifies test files | `freeze` skill blocks Edit/Write to test paths; returns BLOCKED_ERROR |
| Phase 2 deletes test files | `freeze` skill blocks deletion within freeze boundary |
| Phase 2 skips tests (test.skip) | Detected and rejected per Phase 2 constraints |
| Test failure → modify assertion | Freeze blocks test modification; must fix business code instead |
| Missing @test tags | Rule 3 enforces `@test REQ-XXX` as mandatory; alignment score penalizes absence |
| Specification error forced through | Classification `SPECIFICATION_ERROR` → `ESCALATE_TO_HUMAN`; agent cannot decide alone |
| Low alignment score (<80%) | Checkpoint blocks transition to Phase 2 (State 91: BLOCKED_ALIGNMENT_TOO_LOW) |
| Exceeding max retries | State 94: BLOCKED_MAX_RETRIES_EXCEEDED |

---

## Failure Classification Taxonomy (Detailed)

```
Test Failure
├── BUSINESS_CODE_ERROR
│   ├── Test is correct
│   ├── Business code has a bug
│   ├── Fix: Modify business code (within freeze constraints)
│   └── Re-run tests
│
├── TEST_DATA_ERROR
│   ├── Test logic is correct
│   ├── Test data doesn't match business reality
│   ├── Fix: Roll back to Phase 1 (unfreeze first)
│   └── Modify test data, then re-enter Phase 2
│
├── SPECIFICATION_ERROR
│   ├── Test is correct per specification
│   ├── But specification itself is wrong/ambiguous
│   ├── Fix: ESCALATE_TO_HUMAN (agent cannot decide)
│   └── User chooses:
│       A) Fix spec → restart Phase 1
│       B) Confirm spec correct → fix business code
│       C) Clarify spec → restart Phase 1
│
└── ENVIRONMENT_ERROR
    ├── Test code is correct
    ├── Business code is correct
    ├── Environment/dependency issue
    └── Fix: Modify config/env, re-run tests
```

---

## Summary

The `test-specification-alignment` skill defines a rigorous two-phase process that ensures tests accurately reflect requirements before they are executed:

1. **Phase 1 (Alignment)** allows test modifications to ensure coverage of all requirements and acceptance criteria. It uses weighted scoring across 5 dimensions (Requirement Coverage 30%, AC Coverage 25%, Intent Correctness 20%, Edge Cases 15%, Data Validity 10%) with an 80% pass threshold.

2. **Phase 2 (Execution)** locks test files via the freeze skill and runs all tests. Any failures are classified into 4 categories (business code, test data, specification, environment) with specific handling for each. Specification errors require human escalation.

The freeze/unfreeze mechanism is the critical safety boundary between phases — it ensures that once alignment is verified, tests become immutable during execution, forcing all fixes to target the business code rather than weakening the test suite.
