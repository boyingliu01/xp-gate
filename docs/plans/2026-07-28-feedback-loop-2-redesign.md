# Feedback Loop 2 Redesign: Requirements ↔ Tests Deterministic Closure

**Date:** 2026-07-28
**Status:** DRAFT
**Author:** Sisyphus (with user direction)

## Problem Statement

XP-Gate implements three feedback loops inspired by XP methodology:

1. **Code level:** code ↔ unit tests ↔ static checks — **90% working**, mostly deterministic
2. **Requirements level:** requirements ↔ end-to-end tests — **30% working**, mostly non-deterministic (LLM-driven)
3. **Iteration level:** planning ↔ retrospective — **40% working**, data produced but doesn't drive future plans

Loop 2 is the bottleneck. The original design intent was to achieve "OneShot" development — LLM builds correctly the first time, no rework. The strategy was:

- **Delphi Review** — multi-model consensus to compensate for weaker domestic models during requirements/design phase
- **TDD** — enforce RED→GREEN→REFACTOR during build
- **test-specification-alignment** — ensure tests actually cover the requirements

**Root cause diagnosis:** After months of use across multiple projects, OneShot is still not achieved. The diagnosis is:

1. **Pre-build requirements review was missing** — requirements weren't validated before code was written
2. **test-specification-alignment was non-deterministic** — the alignment checking algorithm (493 lines of TypeScript pseudocode) exists only as SKILL.md documentation, executed by LLM interpretation, not by deterministic code
3. As a result, the requirements↔tests loop never actually closed — tests could pass but be semantically disconnected from requirements

## Current State: The Patchwork

Because the feedback loop wasn't closing deterministically, multiple overlapping mechanisms were added as patches:

### Mechanism A: Delphi Review (requires LLM)
- 3 modes: `requirements`, `design`, `code-walkthrough`
- Each mode writes a JSON evidence file with verdict
- `delphi-reviewed.json` is shared across all modes with different schemas
- Checked by both `sprint-gate.sh` (git hook) and the skill middleware

### Mechanism B: Phase Transition Evidence (CLI, programmatic)
- `phase-transition 2 completed` checks `requirements-reviewed.json`
- `phase-transition 4 completed` checks `test-alignment-report.json`
- Dual-hash staleness check: `head_commit` + `spec_hash`
- `--skip-evidence` escape hatch with audit logging

### Mechanism C: Sprint Gate Hook (shell, programmatic)
- `sprint-gate.sh --pre-commit` checks `delphi-reviewed.json` verdict
- `sprint-gate.sh --pre-push` checks `delphi-reviewed.json` + `specification.yaml` existence
- JSON parsing fallback chain: `jq → node → degradation`

### Mechanism D: Gate 5a Test File Pairing (shell, programmatic)
- Checks `file.ts` → `file.test.ts` exists
- File-level only, no semantic annotation check
- `// @no-test-required: <reason>` escape valve

### Mechanism E: TDD Skill (LLM, instructional)
- Iron Law: no production code without failing test first
- RED→GREEN→REFACTOR cycle
- Purely LLM discipline, no programmatic enforcement

### Mechanism F: Code Walkthrough (requires LLM, shell-checked)
- `pre-push` Gate MW directly validates `.code-walkthrough-result.json`
- jq-based: commit ancestry, no stale commits, verdict, expiration, provenance
- Skip on main/master

### Redundancies identified:
1. `delphi-reviewed.json` is written by 3 Delphi modes with different schemas but same filename — no mode discriminator
2. `requirements-reviewed.json` and `delphi-reviewed.json` overlap on verdict field — checked by different systems
3. `specification.yaml` has two possible locations (root vs `.sprint-state/phase-outputs/`)
4. Evidence validation exists in 3 places: `phase-transition.js`, `sprint-gate.sh`, and skill middleware
5. `sprint-gate.sh` pre-commit mode checks phase ≥ 1 (including PREP), which blocks legitimate setup commits

## Design Goal

Replace the patchwork with a **single deterministic feedback loop**:

```
specification.yaml ──parse──► requirement IDs (REQ-XXX)
                                      │
                                      ▼
                              ┌──────────────────┐
                              │  test-alignment   │  ← deterministic TS code
                              │  checker engine   │
                              └──────┬───────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              file pairing    annotation check    coverage check
              (file.test.ts   (@test REQ-XXX     (≥80% score)
               exists)         matches spec)
                                     │
                                     ▼
                            ┌──────────────────┐
                            │  evidence file    │
                            │  .sprint-state/   │
                            │  phase-outputs/   │
                            │  alignment.json   │
                            └──────┬───────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              pre-commit      phase-transition   retro reports
              Gate 5b         CLI validation     (rework rate)
              (BLOCK)         (BLOCK)            (data → plan)
```

The key insight: **Delphi Review remains as the requirements QUALITY gate, but it is not the requirements CORRECTNESS gate.** Delphi says "these requirements look good to multiple experts." The alignment checker says "the tests actually trace back to these requirements." Both are needed, but they serve different purposes and should not be conflated.

## Design Decisions

### D1: Single Deterministic Alignment Engine

Extract the 493-line pseudocode from `skills/test-specification-alignment/references/alignment-verification-algorithm.md` into real TypeScript code in `src/npm-package/lib/test-alignment.ts`.

**Why:** The pseudocode is already complete — 7 interfaces, 4-step algorithm, 5 rules, weighted scoring. It just needs to be compiled and run, not interpreted by an LLM.

**What it does:**
1. Parse `specification.yaml` → extract REQ-XXX IDs, AC-XXX-XX IDs
2. Parse test files → extract `@test REQ-XXX`, `@intent`, `@covers AC-XXX-XX` annotations via regex
3. Cross-reference: every REQ must have ≥1 test, every AC must have ≥1 assertion, every test must have `@intent`
4. Calculate score (weighted: req coverage 30%, AC coverage 25%, intent 20%, edge cases 15%, data validity 10%)
5. Write `test-alignment-report.json` with `alignment_status`, `score`, `head_commit`, `spec_hash`

**CLI entry point:** `xp-gate check-alignment [--spec <path>] [--tests <dir>] [--json]`

### D2: Elevate Gate 5a to Semantic Annotation Check (Gate 5b)

Current Gate 5a: checks `file.ts` → `file.test.ts` exists.
New Gate 5b: additionally, for files with `@test REQ-XXX` annotations, verifies the REQ exists in `specification.yaml`.

**Implementation:** In `githooks/pre-commit`, after existing Gate 5a passes:
1. Collect staged test files
2. Grep for `@test REQ-\S+` patterns
3. Cross-reference against `specification.yaml` requirements
4. BLOCK if any REQ reference points to a non-existent requirement

**Why:** This is a lightweight grep-based check, not full AST parsing. It catches the most common failure mode: test annotated with a stale/typo'd REQ ID. Full alignment scoring is left to `xp-gate check-alignment`.

### D3: Unify Evidence Validation

Consolidate the 3 evidence validation locations into 2 (eliminate skill middleware):

**Before:**
- `phase-transition.js` — validates evidence at CLI time
- `sprint-gate.sh` — validates delphi-reviewed.json at hook time
- Skill middleware (instructional) — validates delphi-reviewed.json at build time

**After:**
- `phase-transition.js` — **single source of truth** for all evidence validation. Called by both CLI and hooks.
- Skill layer — only responsible for **generating** evidence, not validating it

**Specifically:**
- Remove delphi-reviewed.json validation from `sprint-gate.sh`. Instead, `sprint-gate.sh` calls `xp-gate phase-transition --check-evidence` (a new read-only mode) which uses the same `EVIDENCE_FILES` map and `validateEvidence()` function as the CLI.
- Pre-push code-walkthrough validation moves from inline shell (380 lines of jq logic) into `phase-transition.js` as `--check-walkthrough` mode.

### D4: Single specification.yaml Location

Eliminate the dual-location ambiguity. `specification.yaml` lives at **project root only**.

**Why:** The dual-location was a hack for isolated sprints. The sprint already has a worktree — the spec should be in the worktree root. All readers already check root first; `.sprint-state/phase-outputs/` was a fallback that complicates `sprint-gate.sh` and `phase-transition.js` without clear benefit.

### D5: Unify delphi-reviewed.json Schema

Add a `mode` discriminator field and version field to `delphi-reviewed.json`:

```json
{
  "schema_version": 1,
  "mode": "requirements|design|code-walkthrough",
  "verdict": "APPROVED|GAPS_FOUND|REJECTED",
  "timestamp": "<ISO 8601>",
  "consensus_ratio": 0.95,
  "rounds": 2,
  "head_commit": "<sha>",
  "experts": [
    {"role": "architecture", "verdict": "APPROVED", "confidence": 8},
    {"role": "feasibility", "verdict": "APPROVED", "confidence": 9}
  ],
  "mode_specific": { ... }   // flexible: requirements_hash, files_reviewed, etc.
}
```

**Why:** Currently 3 Delphi modes write to the same file with different schemas. Adding `mode` and `schema_version` makes validation code self-documenting and prevents schema-drift bugs.

### D6: Fix Phase Model

Change `sprint-gate.sh` pre-commit to check `phase > 1` (DESIGN completed) instead of `phase >= 1` (PREP).

**Why:** PREP is setup-only (worktree creation, branch isolation). It never produces requirements. Requiring Delphi review at phase 1 is a known bug — it blocks legitimate setup commits.

### D7: Close the Outer Feedback Loop (Iteration → Plan)

Use `xp-gate retro` data as input to `xp-gate sprint-init`:

- When creating a new sprint, if retro data exists from the previous sprint, auto-populate sprint constraints:
  - Previous sprint rework rate → suggested extra time for Phase 2 (DESIGN)
  - Previous sprint evidence skip count → suggested evidence_schema_version
  - Previous sprint duration → auto-estimate for new sprint

**Implementation:** `xp-gate sprint-init` reads `.sprint-history/<last-sprint>/` and surfaces the data in `sprint-state.json` metrics.

### D8: Hard-Block `--no-verify` Bypass (Cross-Cutting)

**Problem:** When quality gates fail at commit time, LLM agents may choose `git commit --no-verify` to bypass them. Since `--no-verify` is a git built-in behavior that hooks cannot prevent, this bypass makes all deterministic gate enforcement vulnerable. This problem is not hypothetical — it has been observed in production across xp-gate users.

**Root cause:** LLMs make decisions based on feedback signals. When a pre-commit hook outputs technical error details without actionable fix instructions, the LLM perceives "unfixable complexity" and seeks the path of least resistance (`--no-verify`). This is not a hook strength problem — it's a feedback design problem. No amount of gate hardening can fix this because `--no-verify` is a git-level escape hatch.

**Strategy: Three-layer defense**

*Layer 1 — Prevention (hook output redesign):* Make the pre-commit hook output "AI-friendly". Every error MUST include:
- The exact file and line
- A concrete, actionable fix instruction (one-liner)
- An estimated fix time
- A clear next-step directive at the end: `NEXT STEP FOR AI AGENT: Do NOT use --no-verify. Fix each issue above, then re-run commit.`

This removes the "unfixable complexity" signal that triggers bypass.

*Layer 2 — Detection (post-commit bypass audit):* Create a `post-commit` hook that detects `--no-verify` bypass:
```bash
# pre-commit: write session marker
echo "$(date +%s)" > /tmp/.xp-gate-precommit-$$

# post-commit: detect bypass
if [ ! -f /tmp/.xp-gate-precommit-$$ ]; then
  echo "[BYPASS DETECTED] pre-commit was bypassed via --no-verify"
  echo "Writing audit trail to .xp-gate/bypass-audit.jsonl"
  # Log the bypass event with commit hash + timestamp
  echo "{\"commit\":\"$(git rev-parse HEAD)\",\"timestamp\":\"$(date -Iseconds)\"}" >> .xp-gate/bypass-audit.jsonl
fi
rm -f /tmp/.xp-gate-precommit-$$
```
The `post-commit` hook cannot block the commit (git semantics), but it creates an audit trail.

*Layer 3 — Consequence (phase transition blockade):* In `phase-transition.js`, add a `checkBypassAudit()` function:
```
Read .xp-gate/bypass-audit.jsonl → extract commit SHAs
Compare against git log of current sprint branch
If any commit on the branch has a bypass audit entry → BLOCK phase transition
Output: "Sprint contains bypassed commits: <SHAs>. Squash or replace these commits before proceeding."
```

This makes bypass have concrete, unavoidable consequences — the sprint cannot advance past the current phase until bypassed commits are resolved.

**Non-technical defense (LLM behavior constraint):** Update `AGENTS.md` with:
```markdown
## Critical Rule: Never use --no-verify
- `git commit --no-verify` is FORBIDDEN
- If pre-commit hooks fail, fix the issues — every error has a concrete fix instruction
- Bypassing hooks is a process violation that will be detected and block sprint progression
```

**Implementation order:** Layer 1 and Layer 2 can be done immediately (hook script changes). Layer 3 is part of Phase 3 (Unify Evidence Validation). The AGENTS.md update ships with any release.

## What Gets Removed (the simplification)

| Removed | Why | Replacement |
|---------|-----|-------------|
| `sprint-gate.sh` delphi validation logic (~200 lines) | Non-deterministic schema matching; replaced by D3 | `xp-gate phase-transition --check-evidence` |
| `pre-push` code-walkthrough inline jq logic (~380 lines) | Moved to programmatic TypeScript | `xp-gate phase-transition --check-walkthrough` |
| `specification.yaml` dual-location logic in sprint-gate.sh | Ambiguity eliminated | Root only |
| Skill middleware DELPHI-GATE (instructional, 4 places) | Redundant with D3 | PhaseTransition CLI |
| `verify-consensus.sh` (43 lines) | Obsolete after D5 (schema_version discriminates) | Built into `phase-transition.js` evidence validation |
| `sprint-state-migrator.js` legacy phase mapping (11→6) | All active sprints are on the new phase model | Keep migrator, remove LEAGCY_PHASE_MAP |
| `--no-verify` as a gate bypass vector | Three-layer defense (D8): output redesign prevents the decision, post-commit detection creates audit trail, phase blockade enforces consequences | LLM sees fixable errors + bypass has sprint-level consequences |

## Implementation Plan

### Phase 1: Deterministic Alignment Engine (the core)

1. Create `src/npm-package/lib/test-alignment.ts` from pseudocode
   - 7 TypeScript interfaces (SpecificationMap, Requirement, TestCase, TestMap, AlignmentReport, AlignmentIssue, CoverageReport)
   - 4-step algorithm: parseSpec(), parseTestFiles(), verifyAlignment(), calculateScore()
   - YAML parser for specification.yaml (js-yaml is already a dependency)
   - Regex parsers for TS, Python, Go test annotation formats
   - SHA-256 spec_hash computation

2. Add `xp-gate check-alignment` CLI command
   - `--spec <path>` (default: `./specification.yaml`)
   - `--tests <dir>` (default: auto-detect: `tests/`, `test/`, `__tests__/`, `src/__tests__/`)
   - `--json` output mode
   - Writes `.sprint-state/phase-outputs/test-alignment-report.json`

3. Integrate with `phase-transition 4 completed`
   - Replace current file-existence-only check with `xp-gate check-alignment` execution
   - Keep anti-staleness checks (head_commit, spec_hash)

### Phase 2: AI-Friendly Hook Output + Bypass Detection (D8 Layers 1-2)

1. Redesign pre-commit error output for AI agent consumption
   - Each gate failure: file + line + concrete fix instruction + estimated fix time
   - End-of-output directive: `NEXT STEP FOR AI AGENT: Do NOT use --no-verify. Fix each issue above.`
   - Gate 4 (Principles): auto-generate fix suggestions from rule config
   - Gate 5 (Tests): suggest minimal fix strategy based on failure type
   - Gate 8 (Secrets): suggest `git reset` to unstage the file containing the secret

2. Add post-commit bypass detection hook
   - pre-commit writes session marker (`/tmp/.xp-gate-precommit-$$`)
   - post-commit checks marker; if absent, logs to `.xp-gate/bypass-audit.jsonl`
   - `xp-gate doctor --fix` auto-installs the post-commit hook
   - Existing post-commit hook (version sync) is preserved — bypass detection is added, not replacing

3. Update AGENTS.md with `--no-verify` prohibition rule

### Phase 3: Semantic Annotation Check (Gate 5b)

1. Add annotation extraction to pre-commit Gate 5 section
   - After existing Gate 5a passes, grep staged test files for `@test REQ-\S+`
   - Cross-reference against specification.yaml
   - BLOCK if any REQ doesn't exist in spec
   - WARN if any REQ in spec has no annotated test (but don't block — that's the alignment checker's job)

2. Keep existing Gate 5a file-pairing check as-is

### Phase 4: Unify Evidence Validation (including D8 Layer 3)

1. Add `--check-evidence` and `--check-walkthrough` modes to `phase-transition.js`
   - Read-only: validate evidence, return exit code, do not modify sprint state
   - `--check-evidence <phase>`: validates evidence for given phase using EVIDENCE_FILES map
   - `--check-walkthrough`: validates `.code-walkthrough-result.json` (port from shell)

2. Simplify `sprint-gate.sh` to delegate to `xp-gate phase-transition --check-evidence`
   - Remove inline jq/node JSON parsing (~150 lines)
   - Become a thin wrapper: detect sprint project → delegate to CLI → exit with CLI's exit code

3. Simplify `pre-push` Gate MW to delegate to `xp-gate phase-transition --check-walkthrough`
   - Remove inline jq logic (~380 lines)
   - Thin wrapper

### Phase 5: Schema + Path Unification

1. Add `schema_version` and `mode` fields to delphi evidence output
   - Update `skills/delphi-review/SKILL.md` output schema
   - Update `phase-transition.js` validation to check schema_version

2. Remove `.sprint-state/phase-outputs/specification.yaml` fallback
   - Update `sprint-gate.sh` to only check root
   - Update skill docs to specify root as canonical location

### Phase 6: Close Outer Loop

1. `xp-gate sprint-init` reads previous sprint retro data
   - Read `.sprint-history/<last-sprint>/retro.json` if exists
   - Populate `sprint-state.json` metrics with previous sprint stats
   - Surface as suggestions (not automatic decisions)

## Metrics: How to Know This Worked

| Metric | Current | Target |
|--------|---------|--------|
| test-spec alignment check latency | N/A (LLM-driven, minutes) | <2s (deterministic TS) |
| Num of evidence validation code paths | 3 (CLI, shell hook, skill middleware) | 2 (CLI + thin hook wrapper) |
| Delphi evidence schema variants | 3 (one per mode, same file) | 1 (with mode discriminator) |
| specification.yaml locations | 2 (root + .sprint-state/) | 1 (root) |
| Gate 5 check type | File pairing only | File pairing + annotation existence |
| Pre-push walkthrough code (shell) | 380 lines jq | <50 lines (delegates to CLI) |
| --no-verify bypass detectable | No | Yes (post-commit audit + phase block) |
| Hook error output AI-actionable | No (raw tool output only) | Yes (fix instruction per error) |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| YAML parser can't handle all spec variants | Medium | High | Start with strict schema validation; add lenient mode for legacy specs |
| Regex-based annotation extraction misses edge cases | Medium | Medium | Add test suite with 30+ real-world annotation patterns before shipping |
| Removing shell validation breaks existing sprints | Low | High | Keep sprint-gate.sh as thin fallback during transition; remove after 1 release |
| New `check-alignment` runs slow on large repos | Low | Medium | Add `--changed-only` mode for pre-commit; full scan only on demand |
| LLM agent uses `--no-verify` to bypass new gates | **High** | **High** | D8 three-layer defense: AI-friendly output + post-commit audit + phase transition blockade. See D8. |
| Post-commit bypass audit marker race condition | Low | Medium | Use `$$` (PID) in marker filename; marker is scoped to single shell session |

## References

- `skills/test-specification-alignment/references/alignment-verification-algorithm.md` — 493-line pseudocode (source of truth for Phase 1)
- `src/npm-package/lib/phase-transition.js` (499 lines) — current evidence validation
- `githooks/sprint-gate.sh` (291 lines) — current hook-level validation
- `githooks/pre-push` lines 824-1179 — current code-walkthrough validation
- `skills/delphi-review/SKILL.md` — evidence output schemas
- `specification.yaml` — real spec format (274 lines, 6 REQs)
