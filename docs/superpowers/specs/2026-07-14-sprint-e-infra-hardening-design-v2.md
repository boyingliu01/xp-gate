# Sprint E: Sprint Infra Hardening + Gate MW Anti-Fabrication (v2)

**Date**: 2026-07-14
**Sprint**: sprint-2026-07-14-01
**Issues**: #343, #338, #339, #332, #334
**Supersedes**: 2026-07-14-sprint-e-infra-hardening-design.md

## Changes from v1

All critical and major issues from Delphi Round 1 addressed:

| Issue | Source | Fix |
|-------|--------|-----|
| 4th reader omitted | Expert A CRITICAL-1 | Added `src/debugger/sprint-state-io.ts` to scope |
| Render coupling | Expert A CRITICAL-2 | Decoupled via observer pattern (`onTransition` callback) |
| Gate MW field names wrong | Expert A MAJOR-1 | Fixed to use actual `.commit`/`.verdict`/`.expires`/`.branch` |
| Platform path blindness | Expert A MAJOR-2 | Use `getSkillsDir()` from shared-paths.js |
| Dual version tracking | Expert A MAJOR-3 | Extend existing `xp-gate.json` config, no `.version.json` |
| Schema migration underspecified | Expert A MAJOR-4 | Added explicit mapping table |
| Cross-platform SHA-256 | Expert B CRITICAL-1 | Added `compute_sha256()` portable helper |
| JS/TS interop | Expert B CRITICAL-2 | Manager as JS (CommonJS), not TS |
| Float comparison fragility | Expert B CRITICAL-3 | Integer math (multiply by 10, no `bc`) |
| Rollback strategy missing | Expert C CRITICAL-1 | Backup before migration + `sprint-state rollback` |
| Grace period hardcoded | Expert C CRITICAL-2 | Configurable via `XP_GATE_MW_GRACE_DAYS` env var |
| Delphi output coordination | Expert C CRITICAL-3 | 2-week WARNING-only transition period |

---

## Problem Statement

Five open issues expose systemic weaknesses in xp-gate's sprint infrastructure and quality gates:

1. **#343 (P1)**: Sprint State Manager missing — 4 readers expect different schemas, no programmatic write API, schema drift causes `sprint-status` failures
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
- **Readers** (4 files): `sprint-status.js`, `sprint-discovery.js`, `next-sprint.js`, `src/debugger/sprint-state-io.ts` — each defines its own field expectations
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

### Solution: Centralized SprintStateManager (JS, CommonJS)

**New module**: `src/npm-package/lib/sprint-state-manager.js`

**Decision: JS over TS** — All 3 npm-package readers are plain JavaScript (CommonJS). Using TS would require build step or interop layer. Keep the manager as JS for zero-friction integration. The debugger's `sprint-state-io.ts` will re-export types from a shared `.d.ts` file.

```javascript
class SprintStateManager {
  /**
   * Read sprint-state.json with schema validation + auto-migration.
   * @param {string} dir - Project root directory
   * @returns {SprintState} Validated state object
   */
  read(dir) { ... }

  /**
   * Write sprint-state.json with atomic write (tmp + rename).
   * @param {string} dir - Project root directory
   * @param {SprintState} state - State to write
   */
  write(dir, state) { ... }

  /**
   * Atomically transition phase + trigger optional callbacks.
   * Rendering is decoupled — caller provides onTransition callback.
   * @param {string} dir - Project root
   * @param {number} phase - Phase number (1-6)
   * @param {string} status - Phase status
   * @param {Object} options - { outputs, onTransition }
   * @returns {SprintState} Updated state
   */
  transitionPhase(dir, phase, status, options = {}) { ... }

  /**
   * Migrate legacy sprint-state.json to v1 schema.
   * Creates backup before migration.
   * @param {SprintState} state - Raw state from file
   * @returns {SprintState} Migrated state
   */
  migrate(state) { ... }
}
```

**Observer pattern for auto-render (#338 fix)**:
```javascript
// Sprint-flow skill calls:
manager.transitionPhase(dir, 2, 'completed', {
  outputs: { specification: 'specification.yaml' },
  onTransition: (state) => {
    // This is the auto-render hook — called after state is written
    // execSync from 'child_process'
    try {
      const output = execSync(
        `node scripts/render-sprint-progress.cjs`,
        { cwd: dir, encoding: 'utf8' }
      );
      console.log(output);
    } catch (err) {
      // Render failure is WARNING, not BLOCK
      console.warn(`[WARN] Dashboard render failed: ${err.message}`);
    }
  }
});
```

**Key design decisions**:
- `transitionPhase()` does NOT call render internally — caller provides `onTransition` callback
- Render failure is WARNING, not BLOCK (render is side-effect, not core state mutation)
- `write()` uses atomic write pattern (write to `.tmp`, then `fs.renameSync()`)
- `read()` creates backup before migration (`sprint-state.json.backup`)

### Schema (v1)

```javascript
/**
 * @typedef {Object} SprintState
 * @property {1} _schema_version - Schema version for migration
 * @property {string} id - Sprint ID
 * @property {string} task_description - Task description (REQUIRED, default "-")
 * @property {1|2|3|4|5|6} phase - Current phase
 * @property {"in_progress"|"paused"|"completed"} status
 * @property {string} started_at - ISO8601
 * @property {PhaseEntry[]} phase_history
 * @property {{worktree_path: string, branch: string}} isolation
 * @property {Object<string, string>} [outputs]
 * @property {Object<string, unknown>} [metrics]
 * @property {AutoEstimate} [auto_estimate]
 */

/**
 * @typedef {Object} PhaseEntry
 * @property {number} phase - Phase number (1-6)
 * @property {"PREP"|"DESIGN"|"BUILD"|"VERIFY"|"SHIP"|"CLOSE"} phase_name
 * @property {"completed"|"in_progress"|"skipped"|"failed"} status
 * @property {string} [started_at]
 * @property {string} [completed_at]
 * @property {number} [duration_seconds]
 * @property {Object<string, {name: string, status: string}>} [reqs]
 */
```

### Legacy Phase Migration Mapping

| Legacy Phase | Legacy Name | Maps To (v1) |
|-------------|-------------|--------------|
| -1 | ISOLATE | 1 (PREP) |
| -0.5 | AUTO-ESTIMATE | 1 (PREP) |
| 0 | THINK | 2 (DESIGN) |
| 1 (old) | PLAN | 2 (DESIGN) |
| 2 (old) | BUILD | 3 (BUILD) |
| 3 (old) | REVIEW | 4 (VERIFY) |
| 4 (old) | FEEDBACK | 4 (VERIFY) |
| 5 (old) | SHIP | 5 (SHIP) |
| 6 (old) | LAND | 5 (SHIP) |
| 7 (old) | USER ACCEPTANCE | 6 (CLOSE) |
| 8 (old) | CLEANUP | 6 (CLOSE) |

**Migration rules**:
1. If `_schema_version` exists → no migration needed
2. If `phase` is negative or > 6 → apply mapping table
3. If `task_description` missing → set to `"-"`
4. If `phase_history` entries have `timestamp` but no `started_at` → copy `timestamp` → `started_at`
5. Unknown fields → preserved (forward compat)
6. **Backup**: `sprint-state.json` → `sprint-state.json.backup` before first migration write

### Reader Refactoring

| Reader | Change |
|--------|--------|
| `sprint-status.js` | Replace `readSprintState()` with `new SprintStateManager().read(dir)` |
| `sprint-discovery.js` | Replace `readSprintState()` with `new SprintStateManager().read(dir)` |
| `next-sprint.js` | Replace `readSprintState()` with `new SprintStateManager().read(dir)` |
| `src/debugger/sprint-state-io.ts` | Re-export `SprintState` type from shared `.d.ts`; runtime calls delegate to manager |

### Rollback Strategy

- **Before migration**: `cp sprint-state.json sprint-state.json.backup`
- **Rollback command**: `xp-gate sprint-state rollback` restores from `.backup`
- **Migration warnings**: Logged to `.sprint-state/migration-warnings.json` for manual review

---

## Design Unit B: Gate MW Provenance Validation (#339)

### Root Cause Analysis

**Current validation** (githooks/pre-push):
```bash
# Checks 4 fields (not 3 as v1 spec stated):
jq '.commit // empty'     # required, must match HEAD
jq '.verdict // empty'    # required
jq '.expires // empty'    # required, must be future
jq '.branch // empty'     # required
```

**Note**: v1 spec incorrectly used `.commitHash` — actual field name is `.commit`.

**Missing provenance checks**:
- `experts[]` not validated (can be empty/missing)
- `consensus` not validated (can be omitted)
- `walkthroughHash` not validated (can be fabricated)
- Walkthrough doc existence not checked

### Solution: Structural Provenance + Portable Helpers

**Cross-platform SHA-256 helper** (new function in pre-push):
```bash
compute_sha256() {
    local file="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$file" | cut -d' ' -f1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$file" | cut -d' ' -f1
    elif command -v openssl >/dev/null 2>&1; then
        openssl sha256 -r "$file" | cut -d' ' -f1
    else
        echo ""  # No SHA-256 available
    fi
}
```

**Integer-only consensus check** (no `bc` dependency):
```bash
# Consensus is stored as percentage (e.g., 95.5)
# Multiply by 10 to get integer: 955 >= 900
local consensus_x10
consensus_x10=$(jq -r '(.consensus // 0) * 10 | floor' .code-walkthrough-result.json)
if [[ "$consensus_x10" -lt 900 ]]; then
    block_gate "MW" "Consensus too low: ${consensus}% (minimum 90% required)"
    return 1
fi
```

**Provenance validation** (additive to existing fields — no renaming):
```bash
# Existing fields (.commit, .verdict, .expires, .branch) remain unchanged
# New provenance fields added alongside:

# 1. Experts array (REQUIRED for new walkthroughs)
local experts_count
experts_count=$(jq -r '.experts // [] | length' .code-walkthrough-result.json)

# 2. Walkthrough hash (REQUIRED for new walkthroughs)
local walkthrough_hash
walkthrough_hash=$(jq -r '.walkthroughHash // empty' .code-walkthrough-result.json)

# 3. generatedAt (REQUIRED for new walkthroughs)
local generated_at
generated_at=$(jq -r '.generatedAt // empty' .code-walkthrough-result.json)

# Grace period: configurable via env var (default: 30 days)
local grace_days="${XP_GATE_MW_GRACE_DAYS:-30}"
local grace_cutoff
grace_cutoff=$(date -d "-${grace_days} days" +%s 2>/dev/null || date -v-${grace_days}d +%s 2>/dev/null || echo "0")

# Check if this is a "new" walkthrough (has provenance fields)
local has_provenance="false"
if [[ -n "$walkthrough_hash" && -n "$generated_at" && "$experts_count" -ge 3 ]]; then
    has_provenance="true"
fi

if [[ "$has_provenance" == "true" ]]; then
    # Full provenance validation
    if [[ "$consensus_x10" -lt 900 ]]; then
        block_gate "MW" "Consensus too low (minimum 90% required)"
        return 1
    fi

    # Verify walkthrough doc exists + hash matches
    if [[ ! -f .delphi/code-walkthrough.md ]]; then
        block_gate "MW" "Walkthrough doc missing: .delphi/code-walkthrough.md"
        return 1
    fi

    local computed_hash
    computed_hash=$(compute_sha256 .delphi/code-walkthrough.md)
    if [[ -z "$computed_hash" ]]; then
        block_gate "MW" "No SHA-256 tool available (install sha256sum, shasum, or openssl)"
        return 1
    fi
    if [[ "$walkthrough_hash" != "$computed_hash" ]]; then
        block_gate "MW" "walkthroughHash mismatch (fabricated or stale)"
        return 1
    fi
else
    # Grace period: WARNING for old walkthroughs without provenance
    local generated_ts=0
    if [[ -n "$generated_at" ]]; then
        generated_ts=$(date -d "$generated_at" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$generated_at" +%s 2>/dev/null || echo "0")
    fi

    if [[ "$generated_ts" -gt 0 && "$generated_ts" -lt "$grace_cutoff" ]]; then
        warn_gate "MW" "Walkthrough lacks provenance fields (experts, consensus, walkthroughHash). Update delphi-review skill."
    elif [[ "$generated_ts" -gt 0 ]]; then
        # Within grace period but still old format — WARNING
        warn_gate "MW" "Legacy walkthrough format. Provenance fields will be required after grace period (${grace_days} days)."
    else
        # No generatedAt at all — very old, WARNING
        warn_gate "MW" "Very old walkthrough format. Please re-run delphi-review --mode code-walkthrough."
    fi
fi
```

### Delphi-Review Output Extension

Update `delphi-review --mode code-walkthrough` to output full provenance schema:

```json
{
  "commit": "abc123...",
  "verdict": "approved",
  "expires": "2026-07-15T12:00:00Z",
  "branch": "sprint/2026-07-14-01",
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

**2-week WARNING-only transition**:
- After deployment, ALL walkthroughs (old and new) get WARNING, not BLOCK
- After 14 days, new-format walkthroughs get full BLOCK on missing provenance
- Old-format walkthroughs continue to get WARNING indefinitely (until re-generated)

---

## Design Unit C: Upgrade Skills Sync (#332)

### Root Cause Analysis

**Current upgrade flow** (`src/npm-package/lib/upgrade.ts`):
1. Check if xp-gate is globally installed
2. Fetch latest version from npm registry
3. `npm install -g @boyingliu01/xp-gate@latest`
4. Report success

**Missing**: Post-upgrade skill sync.

**Existing version tracking**: `~/.config/xp-gate/xp-gate.json` has `installedSkills[name].version` (currently hardcoded `'1.0.0'` by `install-skill.js`).

### Solution: Post-Upgrade Skill Sync (Extend Existing Config)

**Decision: No `.version.json`** — Extend existing `xp-gate.json` config to avoid dual sources of truth. Fix the hardcoded `'1.0.0'` to use actual CLI version.

**1. Upgrade flow enhancement**:

```javascript
// upgrade.js (JS, not TS — matches existing file)
async function runUpgrade(apply) {
  // ... existing npm install logic ...

  if (apply) {
    await handleApplyMode();

    // NEW: Sync installed skills
    const syncResult = await syncInstalledSkills();
    console.log(`Updated ${syncResult.updated} skills, skipped ${syncResult.skipped}`);
    if (syncResult.failed.length > 0) {
      console.warn(`Failed skills: ${syncResult.failed.join(', ')}`);
    }
  }
}

async function syncInstalledSkills() {
  // Use platform-aware path resolution
  // getSkillsDir from shared-paths
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) return { updated: 0, skipped: 0, failed: [] };

  const config = readConfig();  // ~/.config/xp-gate/xp-gate.json
  const installedSkills = Object.keys(config.installedSkills || {});
  let updated = 0, skipped = 0;
  const failed = [];

  for (const skillName of installedSkills) {
    try {
      await updateSingleSkill(skillName);  // reuse existing logic
      // Update version in config
      config.installedSkills[skillName].version = getCliVersion();
      updated++;
    } catch (err) {
      console.warn(`Failed to update ${skillName}: ${err.message}`);
      failed.push(skillName);
      skipped++;
    }
  }

  writeConfig(config);  // persist updated versions
  return { updated, skipped, failed };
}
```

**2. Fix install-skill.js version tracking**:

```javascript
// install-skill.js — fix hardcoded '1.0.0'
function installSkill(name) {
  // ... existing download logic ...

  // Record actual version (from CLI VERSION file)
  const version = getCliVersion();  // reads from VERSION file
  updateConfig((config) => {
    config.installedSkills[name] = {
      version: version,
      installedAt: new Date().toISOString(),
      source: 'github'
    };
  });
}
```

**3. Doctor enhancement**:

```javascript
// doctor.js
function checkSkillVersions() {
  const config = readConfig();
  const cliVersion = getCliVersion();
  const results = [];

  for (const [name, info] of Object.entries(config.installedSkills || {})) {
    if (!info.version || info.version === '1.0.0') {
      results.push({
        level: 'warning',
        message: `Skill ${name} has stale version (${info.version}). Run: xp-gate update-skill ${name}`
      });
    } else if (info.version !== cliVersion) {
      results.push({
        level: 'warning',
        message: `Skill ${name} is at v${info.version}, CLI is at v${cliVersion}`
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

**Sprint State Manager** (`src/npm-package/lib/__tests__/sprint-state-manager.test.js`):
- Schema validation (valid/invalid states)
- Migration v0 → v1 (all legacy phase numbers)
- Atomic write (tmp + rename)
- Backup creation before migration
- Reader integration (all 4 readers use manager)
- onTransition callback invocation
- Render failure → WARNING, not BLOCK

**Gate MW provenance** (`githooks/__tests__/gate-mw-provenance.bats`):
- Valid walkthrough with full provenance → PASS
- Missing experts → WARNING (grace) or BLOCK (post-grace)
- Consensus < 90% → BLOCK
- Walkthrough hash mismatch → BLOCK
- Missing walkthrough doc → BLOCK
- compute_sha256() on Linux/macOS/fallback
- Integer consensus check (no bc)
- Grace period env var override

**Upgrade skills sync** (`src/npm-package/lib/__tests__/upgrade-skills-sync.test.js`):
- Post-upgrade sync (updated N, skipped M, failed [])
- Version tracking in xp-gate.json
- Doctor skill version check
- Platform-aware getSkillsDir()

### Integration Tests

**Sprint flow**:
- Run full sprint (PREP → CLOSE) with real sprint-state.json fixtures from past sprints
- Verify dashboard renders after each phase (via onTransition callback)
- Verify sprint-state.json schema consistency throughout

**Gate MW end-to-end**:
- Run delphi-review --mode code-walkthrough
- Verify .code-walkthrough-result.json has full provenance
- Run pre-push, verify Gate MW validates provenance

**Rollback test**:
- Create legacy sprint-state.json (no _schema_version)
- Run SprintStateManager.read() → triggers migration
- Verify .backup file created
- Run `xp-gate sprint-state rollback` → verify original restored

---

## Rollout Plan

**Phase 1**: Sprint State Manager (#343 + #338) — PR 1 of 2
- Implement `SprintStateManager` (JS, CommonJS)
- Add migration logic + backup + rollback
- Unit tests

**Phase 1b**: Reader Refactoring — PR 2 of 2
- Refactor 4 readers to use SprintStateManager
- Integration tests with real sprint-state.json fixtures
- Update debugger's sprint-state-io.ts to re-export types

**Phase 2**: Gate MW provenance (#339)
- Add compute_sha256() portable helper
- Extend pre-push validation (additive, no field renaming)
- 2-week WARNING-only transition period
- Update delphi-review output schema in SKILL.md

**Phase 3**: Upgrade skills sync (#332)
- Fix install-skill.js version tracking (no more hardcoded '1.0.0')
- Add post-upgrade sync to upgrade.js
- Enhance doctor.js skill version check

**Phase 4**: Close #334
- Verify multi-language detection
- Close issue

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Breaking existing sprint-state.json | High | Auto-migration + backup + rollback command |
| Gate MW breaks existing walkthroughs | Medium | 2-week WARNING-only transition, then configurable grace period |
| Upgrade sync fails for some skills | Low | Skip on error, list failed skills prominently, don't block upgrade |
| Reader refactoring introduces bugs | Medium | Integration tests against real fixtures from past 5 sprints |
| Debugger module breaks | Medium | sprint-state-io.ts re-exports types; runtime delegates to manager |
| Render script missing on fresh install | Low | onTransition catches error → WARNING, not BLOCK |
| Concurrent access to sprint-state.json | Low | Atomic write (tmp + rename) prevents partial writes |

---

## Success Criteria

- [ ] `xp-gate sprint-status` works on all existing sprint-state.json files (auto-migration)
- [ ] Dashboard auto-renders after each phase transition (via onTransition callback)
- [ ] Gate MW blocks fabricated walkthroughs post-grace period (experts < 3, consensus < 90%, hash mismatch)
- [ ] Gate MW WARNING-only for legacy walkthroughs during grace period
- [ ] `xp-gate upgrade --apply` updates installed skills automatically
- [ ] `xp-gate doctor` warns about stale skill versions
- [ ] `xp-gate sprint-state rollback` restores from backup
- [ ] #334 closed with verification
- [ ] All 4 readers (including debugger) use SprintStateManager
- [ ] Integration tests pass against real sprint-state.json fixtures

---

## Appendix: File Changes

### New Files

- `src/npm-package/lib/sprint-state-manager.js` — SprintStateManager class (JS, CommonJS)
- `src/npm-package/lib/sprint-state-manager.d.ts` — TypeScript type declarations
- `src/npm-package/lib/__tests__/sprint-state-manager.test.js` — Unit tests
- `src/npm-package/lib/__tests__/upgrade-skills-sync.test.js` — Upgrade sync tests
- `githooks/__tests__/gate-mw-provenance.bats` — Gate MW provenance tests

### Modified Files

- `src/npm-package/lib/sprint-status.js` — Use SprintStateManager
- `src/npm-package/lib/sprint-discovery.js` — Use SprintStateManager
- `src/npm-package/lib/next-sprint.js` — Use SprintStateManager
- `src/debugger/sprint-state-io.ts` — Re-export types from manager .d.ts
- `src/npm-package/lib/upgrade.js` — Add post-upgrade skill sync
- `src/npm-package/lib/doctor.js` — Add skill version check
- `src/npm-package/lib/install-skill.js` — Fix version tracking (no more '1.0.0')
- `githooks/pre-push` — Add Gate MW provenance validation + compute_sha256()
- `skills/delphi-review/SKILL.md` — Document provenance schema
- `skills/sprint-flow/SKILL.md` — Update Rule 7 to reference onTransition callback

### Deleted Files

- None

---

**End of Design Spec v2**
