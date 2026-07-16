# Sprint E: Sprint Infra Hardening + Gate MW Anti-Fabrication

**Date**: 2026-07-14
**Sprint**: sprint-2026-07-14-01
**Issues**: #343, #338, #339, #332, #334

## Problem Statement

Five open issues expose systemic weaknesses in xp-gate's sprint infrastructure and quality gates:

1. **#343 (P1)**: Sprint State Manager missing — 3 readers expect different schemas, no programmatic write API, schema drift causes `sprint-status` failures
2. **#338 (P1)**: Rule 7 dashboard auto-render never fires — text-level MUST instruction is structurally unenforceable by LLM orchestrators
3. **#339 (P1)**: Gate MW code walkthrough trivially bypassable — LLM can fabricate `.code-walkthrough-result.json` without running any review
4. **#332 (Bug)**: `xp-gate upgrade --apply` doesn't update installed skills — silent incomplete upgrade
5. **#334 (Bug)**: Multi-language detection misclassification — already fixed in PR #336, needs verification + close

## Design Overview

Three design units + one close-out task:

| Unit | Issues | Theme |
|------|--------|-------|
| A | #343 + #338 | Sprint State Manager + auto-render enforcement |
| B | #339 | Gate MW provenance validation |
| C | #332 | Upgrade skills sync |
| D | #334 | Verify + close |

---

## Design Unit A: Sprint State Manager (#343 + #338)

### Root Cause Analysis

**Read-write asymmetry**:
- **Readers** (3 files): `sprint-status.js`, `sprint-discovery.js`, `next-sprint.js` — each defines its own field expectations
- **Writers**: Only AI skills via shell; no programmatic API
- **Schema**: Defined in SKILL.md documentation only, not enforced in code

**Field discrepancies**:
- `task_description`: required by `sprint-status.js` render, optional in TS interface, not validated by other readers
- `phase_history`: required by all readers but structure varies (some expect `reqs`, others don't)
- `status`: required by `sprint-discovery.js` for orphan filtering, optional elsewhere

**Rendering gap**:
- `render-sprint-progress.cjs` (398 lines + tests) is production-ready
- Phase Transition Rules Step 4 documents "execute render-sprint-progress.cjs" but no code enforces this
- Rule 7 in SKILL.md is text-only — LLMs prioritize task goals over meta-instructions

### Solution: Centralized SprintStateManager

**New module**: `src/npm-package/lib/sprint-state-manager.ts`

```typescript
class SprintStateManager {
  read(dir: string): SprintState
  write(dir: string, state: SprintState): void
  transitionPhase(dir: string, phase: number, status: PhaseStatus, outputs?: Record<string, string>): SprintState
  renderProgress(dir: string): string
  migrate(state: SprintState): SprintState  // legacy → v1
}

interface SprintState {
  _schema_version: 1
  id: string
  task_description: string  // NOW REQUIRED
  phase: 1 | 2 | 3 | 4 | 5 | 6
  status: "in_progress" | "paused" | "completed"
  started_at: string  // ISO8601
  phase_history: PhaseEntry[]
  isolation: { worktree_path: string; branch: string }
  outputs?: Record<string, string>
  metrics?: Record<string, unknown>
  auto_estimate?: AutoEstimate
}

interface PhaseEntry {
  phase: number
  phase_name: "PREP" | "DESIGN" | "BUILD" | "VERIFY" | "SHIP" | "CLOSE"
  status: "completed" | "in_progress" | "skipped" | "failed"
  started_at?: string
  completed_at?: string
  duration_seconds?: number
  reqs?: Record<string, { name: string; status: string }>
}
```

**Key behaviors**:
- `read()` validates schema, auto-migrates legacy (no `_schema_version` → v1)
- `write()` validates before writing
- `transitionPhase()` atomically updates phase + calls `renderProgress()` internally
- `migrate()` maps legacy phase numbers (-1..8) → 1-6

**Reader refactoring**:
- `sprint-status.js`: Use `SprintStateManager.read()`, remove ad-hoc validation
- `sprint-discovery.js`: Use `SprintStateManager.read()`, rely on schema validation
- `next-sprint.js`: Use `SprintStateManager.read()`, access `phase_history` safely

**#338 auto-render enforcement**:
- `transitionPhase()` calls `renderProgress()` after updating sprint-state.json
- Orchestrator calls `transitionPhase()` → rendering is automatic, cannot be skipped
- No text-level MUST needed — code enforces it

**Backward compatibility**:
- Old sprint-state.json without `_schema_version` → auto-migrated on first read
- Legacy phase numbers preserved in `phase_history` but normalized for rendering
- `task_description` missing → migration sets default "-" (prevents render crash)

---

## Design Unit B: Gate MW Provenance Validation (#339)

### Root Cause Analysis

**Current validation** (githooks/pre-push ~lines 450-550):
```bash
# Only checks 3 fields:
jq '.verdict // empty'           # required
jq '.commitHash // empty'        # required, must match HEAD
jq '.expiry // empty'            # required, must be future
```

**Missing provenance checks**:
- `experts[]` not validated (can be empty/missing)
- `consensus` not validated (can be omitted)
- `walkthroughHash` not validated (can be fabricated)
- Walkthrough doc existence not checked
- Audit trail not cross-referenced

**Attack vector**: LLM synthesizes `.code-walkthrough-result.json` with valid schema but zero actual review occurred.

### Solution: Structural Provenance + Audit Cross-Validation

**Phase 1: Structural validation (pre-push)**

Add to `gate_mw_code_walkthrough()`:

```bash
# 1. Experts array (REQUIRED)
local experts_count
experts_count=$(jq -r '.experts // [] | length' .code-walkthrough-result.json)
if [[ "$experts_count" -lt 3 ]]; then
    block_gate "MW" "Insufficient experts: $experts_count (minimum 3 required)"
    return 1
fi

# 2. Consensus (REQUIRED, ≥90%)
local consensus
consensus=$(jq -r '.consensus // 0' .code-walkthrough-result.json)
if (( $(echo "$consensus < 90" | bc -l) )); then
    block_gate "MW" "Consensus too low: ${consensus}% (minimum 90% required)"
    return 1
fi

# 3. Walkthrough hash (REQUIRED)
local walkthrough_hash
walkthrough_hash=$(jq -r '.walkthroughHash // empty' .code-walkthrough-result.json)
if [[ -z "$walkthrough_hash" ]]; then
    block_gate "MW" "Missing walkthroughHash (required for provenance)"
    return 1
fi

# 4. Verify walkthrough doc exists + hash matches
if [[ ! -f .delphi/code-walkthrough.md ]]; then
    block_gate "MW" "Walkthrough doc missing: .delphi/code-walkthrough.md"
    return 1
fi

local computed_hash
computed_hash=$(sha256sum .delphi/code-walkthrough.md | cut -d' ' -f1)
if [[ "$walkthrough_hash" != "$computed_hash" ]]; then
    block_gate "MW" "walkthroughHash mismatch (fabricated or stale)"
    return 1
fi

# 5. generatedAt (REQUIRED, replay protection)
local generated_at
generated_at=$(jq -r '.generatedAt // empty' .code-walkthrough-result.json)
if [[ -z "$generated_at" ]]; then
    block_gate "MW" "Missing generatedAt (required for replay protection)"
    return 1
fi
```

**Phase 2: Audit cross-validation (optional, future)**

- Verify `.xp-gate/audit/` contains a Gate MW delivery entry
- Timestamp delta between `generatedAt` and audit entry ≤ 5min
- Requires delphi-review to write audit entry when generating walkthrough

**Delphi-review output extension**:

Update `delphi-review --mode code-walkthrough` to output full provenance schema:

```json
{
  "verdict": "approved",
  "commitHash": "abc123...",
  "expiry": "2026-07-15T12:00:00Z",
  "experts": [
    {"name": "expert-1", "vote": "approved", "reviewedFiles": [...]},
    {"name": "expert-2", "vote": "approved", "reviewedFiles": [...]},
    {"name": "expert-3", "vote": "conditional", "reviewedFiles": [...]}
  ],
  "consensus": 95.5,
  "generatedAt": "2026-07-14T12:00:00Z",
  "walkthroughHash": "sha256hex...",
  "changedFiles": ["src/foo.ts", "tests/foo.test.ts"]
}
```

**Backward compatibility**:
- Grace period: old walkthroughs (generatedAt < 2026-08-01) → WARNING not BLOCK
- New walkthroughs → full provenance required

---

## Design Unit C: Upgrade Skills Sync (#332)

### Root Cause Analysis

**Current upgrade flow** (`src/npm-package/lib/upgrade.ts`):
1. Check if xp-gate is globally installed
2. Fetch latest version from npm registry
3. `npm install -g @boyingliu01/xp-gate@latest`
4. Report success

**Missing**: Post-upgrade skill sync.

**Skill storage**: `~/.config/opencode/skills/<name>/`
- No version tracking on disk
- No staleness detection
- `doctor` doesn't check skill versions

### Solution: Post-Upgrade Skill Sync + Version Tracking

**1. Upgrade flow enhancement**:

```typescript
// upgrade.ts
async function runUpgrade(apply: boolean): Promise<void> {
  // ... existing npm install logic ...
  
  if (apply) {
    await npmInstallGlobal();
    
    // NEW: Sync installed skills
    const syncResult = await syncInstalledSkills();
    console.log(`Updated ${syncResult.updated} skills, skipped ${syncResult.skipped}`);
  }
}

async function syncInstalledSkills(): Promise<{updated: number, skipped: number}> {
  const skillsDir = path.join(os.homedir(), '.config/opencode/skills');
  if (!fs.existsSync(skillsDir)) return {updated: 0, skipped: 0};
  
  const installedSkills = fs.readdirSync(skillsDir);
  let updated = 0, skipped = 0;
  
  for (const skillName of installedSkills) {
    const skillPath = path.join(skillsDir, skillName);
    if (!fs.statSync(skillPath).isDirectory()) continue;
    
    try {
      await updateSkill(skillName);  // reuse existing update-skill logic
      updated++;
    } catch (err) {
      console.warn(`Failed to update ${skillName}: ${err.message}`);
      skipped++;
    }
  }
  
  return {updated, skipped};
}
```

**2. Skill version tracking**:

When installing/updating a skill, write `.version.json`:

```json
{
  "version": "0.14.9.0",
  "installedAt": "2026-07-14T12:00:00Z",
  "source": "github"
}
```

**3. Doctor enhancement**:

```typescript
// doctor.ts
function checkSkillVersions(): DiagnosticResult[] {
  const skillsDir = path.join(os.homedir(), '.config/opencode/skills');
  const cliVersion = getCliVersion();
  const results: DiagnosticResult[] = [];
  
  if (!fs.existsSync(skillsDir)) return results;
  
  for (const skillName of fs.readdirSync(skillsDir)) {
    const versionFile = path.join(skillsDir, skillName, '.version.json');
    if (!fs.existsSync(versionFile)) {
      results.push({
        level: 'warning',
        message: `Skill ${skillName} has no version tracking`
      });
      continue;
    }
    
    const skillVersion = JSON.parse(fs.readFileSync(versionFile, 'utf8')).version;
    if (skillVersion !== cliVersion) {
      results.push({
        level: 'warning',
        message: `Skill ${skillName} is at v${skillVersion}, CLI is at v${cliVersion}`
      });
    }
  }
  
  return results;
}
```

---

## Design Unit D: Close #334

**Task**: Verify PR #336's multi-language detection works correctly.

**Verification steps**:
1. Check `githooks/pre-commit` for `PROJECT_LANGS` implementation
2. Create test project with mixed languages (package.json + requirements.txt)
3. Run pre-commit, verify both TypeScript and Python gates execute
4. Close issue with verification comment

---

## Testing Strategy

### Unit Tests

**Sprint State Manager**:
- Schema validation (valid/invalid states)
- Migration (legacy → v1)
- Phase transition (atomic update + render call)
- Reader integration (all 3 readers use manager)

**Gate MW provenance**:
- Valid walkthrough with full provenance → PASS
- Missing experts → BLOCK
- Consensus < 90% → BLOCK
- Walkthrough hash mismatch → BLOCK
- Missing walkthrough doc → BLOCK
- Grace period (old walkthrough) → WARNING

**Upgrade skills sync**:
- Post-upgrade sync (updated N, skipped M)
- Version tracking (.version.json write/read)
- Doctor skill version check

### Integration Tests

**Sprint flow**:
- Run full sprint (PREP → CLOSE), verify dashboard renders after each phase
- Verify sprint-state.json schema consistency throughout

**Gate MW end-to-end**:
- Run delphi-review --mode code-walkthrough
- Verify .code-walkthrough-result.json has full provenance
- Run pre-push, verify Gate MW validates provenance

**Upgrade end-to-end**:
- Install old xp-gate version
- Upgrade to new version
- Verify skills updated, .version.json created

---

## Rollout Plan

**Phase 1**: Sprint State Manager (#343 + #338)
- Implement `SprintStateManager`
- Refactor 3 readers
- Add auto-render to `transitionPhase()`
- Unit tests + integration tests

**Phase 2**: Gate MW provenance (#339)
- Extend pre-push validation
- Update delphi-review output schema
- Add grace period logic
- Unit tests + integration tests

**Phase 3**: Upgrade skills sync (#332)
- Add post-upgrade sync to upgrade.ts
- Implement version tracking
- Enhance doctor
- Unit tests + integration tests

**Phase 4**: Close #334
- Verify multi-language detection
- Close issue

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking existing sprint-state.json | High | Auto-migration in `read()`, backward compat for legacy phases |
| Gate MW breaks existing walkthroughs | Medium | Grace period (old → WARNING, new → BLOCK) |
| Upgrade sync fails for some skills | Low | Skip on error, report to user, don't block upgrade |
| Reader refactoring introduces bugs | Medium | Unit tests for all 3 readers, integration test for sprint-status CLI |

---

## Success Criteria

- [ ] `xp-gate sprint-status` works on all existing sprint-state.json files (auto-migration)
- [ ] Dashboard auto-renders after each phase transition (no manual `--status` needed)
- [ ] Gate MW blocks fabricated walkthroughs (experts < 3, consensus < 90%, hash mismatch)
- [ ] `xp-gate upgrade --apply` updates installed skills automatically
- [ ] `xp-gate doctor` warns about stale skill versions
- [ ] #334 closed with verification

---

## Appendix: File Changes

### New Files

- `src/npm-package/lib/sprint-state-manager.ts` — SprintStateManager class
- `src/npm-package/lib/__tests__/sprint-state-manager.test.ts` — Unit tests
- `src/npm-package/lib/__tests__/upgrade-skills-sync.test.ts` — Upgrade sync tests

### Modified Files

- `src/npm-package/lib/sprint-status.js` — Use SprintStateManager
- `src/npm-package/lib/sprint-discovery.js` — Use SprintStateManager
- `src/npm-package/lib/next-sprint.js` — Use SprintStateManager
- `src/npm-package/lib/upgrade.ts` — Add post-upgrade skill sync
- `src/npm-package/lib/doctor.ts` — Add skill version check
- `src/npm-package/lib/install-skill.ts` — Write .version.json
- `src/npm-package/lib/update-skill.ts` — Update .version.json
- `githooks/pre-push` — Add Gate MW provenance validation
- `skills/delphi-review/SKILL.md` — Document provenance schema
- `skills/sprint-flow/SKILL.md` — Remove Rule 7 text (now enforced in code)

### Deleted Files

- None

---

**End of Design Spec**
