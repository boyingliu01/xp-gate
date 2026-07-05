# Resolve All Open Issues — Sprint Design

**Date**: 2026-07-05
**Sprint**: sprint-2026-07-05-01
**Status**: Approved

## Overview

Resolve all 11 open issues across xp-gate in a single sprint, batched into 3 independent groups.

## Issues

### Batch 1: sprint-flow (8 issues)

| # | Type | Title | Fix |
|---|------|-------|-----|
| 276 | bug | sprint-flow: coverage only 6 tests | Add comprehensive tests for triggers, step adherence, stability, value |
| 275 | enhancement | sprint-flow: L2 Value Enhancement | Document unique value propositions in SKILL.md |
| 274 | docs | sprint-flow: docs freshness 50% | Clean stale/outdated content from sprint-flow docs and refs |
| 273 | bug | sprint-flow: L4 Execution Stability | Reduce stddev < 0.10 in phase execution timing |
| 272 | enhancement | sprint-flow: L3 Step Adherence 65% | Simplify workflow transitions, improve step clarity |
| 271 | bug | sprint-flow: L1 Trigger Accuracy 40% | Narrow trigger phrases, add negative test cases |
| 270 | bug | sprint-flow: missing uncommitted changes gate | Add pre-BUILD gate in Phase 2 to detect uncommitted subagent code |

### Batch 2: doctor + auto-upgrade (2 issues)

| # | Type | Title | Fix |
|---|------|-------|-----|
| 277 | bug | doctor.test.js race condition | Fix parallel test isolation in doctor tests |
| 268 | bug | auto-upgrade only updates global | Also update local opencode plugin installation |

### Batch 3: Gate 5 performance (2 issues)

| # | Type | Title | Fix |
|---|------|-------|-----|
| 286 | bug | pre-commit Gate 5 timeout (2-3min) | Optimize to only run tests for changed files |
| 280 | enhancement | Gate 5 bottleneck 97s — pytest-fast/rtest | Evaluate and possibly adopt faster test runner |

## Architecture

Each batch is independent. Batches 1 and 2 can run in parallel but Batch 1 contains sprint-flow fixes that are higher priority. Batch 3 depends on understanding of the project's test infrastructure.

### Batch 1 — sprint-flow sub-tasks (processed sequentially):
1. Fix L1 Trigger Accuracy (#271): tighten trigger phrases
2. Fix L3 Step Adherence (#272): simplify phase transitions
3. Fix L4 Execution Stability (#273): reduce stddev
4. Fix coverage (#276): add test cases
5. Fix L2 Value (#275): document value proposition
6. Fix docs freshness (#274): clean stale content
7. Fix missing uncommitted gate (#270): add gate to Phase 2

## Dependencies

- Batch 1 → independent (sprint-flow code only)
- Batch 2 → independent (doctor.ts + npm-package/lib/ files)
- Batch 3 → depends on understanding githooks/pre-commit and test infra
- No cross-batch dependencies

## Success Criteria

- All 11 issues closed with verified fixes
- sprint-flow passes L1-L4 certification thresholds
- `npm test` passes on all batches
- Pre-commit Gate 5 completes in < 30s
