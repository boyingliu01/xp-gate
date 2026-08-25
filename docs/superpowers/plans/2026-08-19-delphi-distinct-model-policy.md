# Delphi Distinct Model Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Delphi enforce three normalized, distinct model identifiers while allowing shared providers, gateways, vendors, countries, endpoints, and billing plans, then synchronize and verify the policy across every shipped surface.

**Architecture:** The canonical Node runner in `scripts/delphi-external-review.cjs` will own runtime validation through a renamed `validateDistinctModels()` function. It will validate exactly the `architecture`, `technical`, and `feasibility` roles, trim each non-empty `model` string, require three unique normalized values, and keep provider lookup only for transport. Canonical skill and documentation sources will be edited first, then generated npm and platform plugin mirrors will be rebuilt with the repository synchronization commands.

**Tech Stack:** Node.js CommonJS runner, Vitest, Markdown, JSON examples, shell synchronization scripts, npm packaging, BATS, `@archlinter/cli`, Git hooks, Delphi code-walkthrough evidence, GitHub Actions.

---

## Scope and Source Map

The implementation worker must edit canonical sources only. Generated mirrors are outputs and must be refreshed by the existing synchronization flow, never edited independently.

**Canonical runtime and tests:**

- `scripts/delphi-external-review.cjs`
- `scripts/__tests__/delphi-external-review.test.cjs`

**Canonical documentation and configuration:**

- `skills/delphi-review/SKILL.md`
- `skills/delphi-review/INSTALL.md`
- `skills/delphi-review/AGENTS.md`
- `skills/delphi-review/references/requirements.md`
- `skills/delphi-review/references/code-walkthrough.md`
- `skills/delphi-review/opencode.json.delphi.example`
- `skills/delphi-review/.delphi-config.json.example`
- `skills/sprint-flow/SKILL.md`
- `skills/sprint-flow/AGENTS.md`
- `skills/sprint-flow/references/phase-overview.md`
- `skills/sprint-flow/references/phase-4-verify.md`
- `README.md`
- `docs/CAPABILITIES.md`
- `AGENTS.md`
- `docs/AGENTS.md` only if its generated policy text or synchronization guidance is present and stale

**Canonical package and plugin synchronization entry points:**

- `src/npm-package/scripts/sync-package-content.js`
- `scripts/copy-skills.mjs`
- `scripts/build-plugin.mjs`
- `scripts/test-plugins.mjs`
- `scripts/test-plugins.sh`

**Generated outputs to verify, not hand-edit:**

- `src/npm-package/scripts/delphi-external-review.cjs`
- `src/npm-package/skills/delphi-review/**`
- `plugins/claude-code/skills/delphi-review/**`
- `plugins/opencode/skills/delphi-review/**`
- `plugins/qoder/skills/delphi-review/**`
- `src/npm-package/plugins/claude-code/skills/delphi-review/**`
- `src/npm-package/plugins/opencode/skills/delphi-review/**`
- `src/npm-package/plugins/qoder/skills/delphi-review/**`
- `plugins/qoder/agents/delphi-architecture.md`
- `plugins/qoder/agents/delphi-technical.md`
- `plugins/qoder/agents/delphi-feasibility.md`
- matching `src/npm-package/plugins/qoder/agents/**` outputs

**Immutable history rule:** Do not rewrite historical approved design documents or existing `CHANGELOG.md` entries. The approved design at `docs/superpowers/specs/2026-08-19-delphi-distinct-model-policy-design.md` is the authority. Its only planned correction is a newline-only EOF fix that preserves every content byte and resolves the file hygiene warning.

### Policy contract to preserve throughout the implementation

- The required roles are exactly `architecture`, `technical`, and `feasibility`.
- Each role must exist and define a string `model` value.
- Validation normalizes with `model.trim()`. Missing, non-string, or blank values fail.
- The three normalized model strings must be unique.
- `distinct_models_required` defaults to `true` when absent.
- `cross_provider_required` is deprecated, ignored for enforcement, and may produce a migration warning.
- Three experts using one provider and three distinct models pass.
- Three providers using the same model fail.
- Three distinct local models pass. Locality is not an exception.
- Provider entries remain required when an external API call is made, but provider uniqueness is never checked.
- No vendor, provider, country, endpoint, gateway, billing-plan, or model-family restriction is introduced.
- Failed validation blocks before any model call and does not expose API credentials.
- Consensus remains at least 90 percent and review rounds remain capped at five.
- API or model failure remains blocking. The workflow must not silently collapse to one model.

## Task 1: Establish the Red test contract and fix the approved spec EOF warning

**Files:**

- Modify: `scripts/__tests__/delphi-external-review.test.cjs`
- Modify: `docs/superpowers/specs/2026-08-19-delphi-distinct-model-policy-design.md` only to add the missing final newline

- [ ] **Step 1: Add the failing validation tests before changing production code.**

Replace the existing `validateCrossProvider` test block with tests that import `validateDistinctModels` and exercise the complete contract. Keep the existing `readConfig`, parser, prompt, and JSON extraction tests. The new block must include these cases:

```javascript
describe('validateDistinctModels', () => {
  const { validateDistinctModels } = loadModule();

  it('passes when one provider serves three distinct models', () => {
    const experts = {
      architecture: { provider: 'bailian-tp', model: 'qwen3.7-max' },
      technical: { provider: 'bailian-tp', model: 'deepseek-v4-pro' },
      feasibility: { provider: 'bailian-tp', model: 'glm-5.2' },
    };
    expect(validateDistinctModels(experts, {})).toEqual({ valid: true });
  });

  it('fails when different providers use the same model', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'qwen-provider', model: 'shared-model' },
      technical: { provider: 'deepseek-provider', model: ' shared-model ' },
      feasibility: { provider: 'glm-provider', model: 'other-model' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('duplicate');
    expect(result.reason).not.toContain('API key');
  });

  it('fails when a role has a missing model', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'p', model: 'm1' },
      technical: { provider: 'p' },
      feasibility: { provider: 'p', model: 'm3' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('technical');
  });

  it('fails when a model is blank after trimming', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'p', model: 'm1' },
      technical: { provider: 'p', model: '   ' },
      feasibility: { provider: 'p', model: 'm3' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('technical');
  });

  it('passes with three distinct local models', () => {
    expect(validateDistinctModels({
      architecture: { provider: 'local', model: 'local-a' },
      technical: { provider: 'local', model: 'local-b' },
      feasibility: { provider: 'local', model: 'local-c' },
    }, {})).toEqual({ valid: true });
  });

  it('does not restore provider blocking when the legacy option is present', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'same-provider', model: 'model-a' },
      technical: { provider: 'same-provider', model: 'model-b' },
      feasibility: { provider: 'same-provider', model: 'model-c' },
    }, {}, { cross_provider_required: true });
    expect(result.valid).toBe(true);
  });

  it('requires all three expert roles', () => {
    const result = validateDistinctModels({
      architecture: { provider: 'p', model: 'm1' },
      technical: { provider: 'p', model: 'm2' },
    }, {});
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('feasibility');
  });
});
```

Adapt the final optional argument to the production signature selected in Task 2. The test must still prove that a legacy `cross_provider_required: true` value cannot block a valid same-provider, distinct-model configuration.

- [ ] **Step 2: Run the focused test and confirm the red state.**

Run:

```bash
npx vitest run scripts/__tests__/delphi-external-review.test.cjs
```

Expected: FAIL because `validateDistinctModels` is not exported and the old provider-based behavior does not satisfy the new assertions. Do not change the test expectations to make the old implementation pass.

- [ ] **Step 3: Add the EOF newline without rewriting the approved spec.**

Use a byte-preserving operation that only appends `\n` if the file does not already end with one. Verify the content hash of the file excluding the final newline is unchanged. Do not alter wording, headings, dates, status, or historical design decisions.

- [ ] **Step 4: Re-run the focused test to record the expected red result after the EOF-only correction.**

Run the same Vitest command. Expected: the same policy assertions remain red, proving the newline fix did not change runtime behavior.

## Task 2: Implement canonical distinct-model validation and compatibility handling

**Files:**

- Modify: `scripts/delphi-external-review.cjs`
- Test: `scripts/__tests__/delphi-external-review.test.cjs`

- [ ] **Step 1: Rename the exported validator and define its exact input contract.**

Replace `validateCrossProvider(experts, providers)` with `validateDistinctModels(experts, providers, consensus = {})`. Validate only these roles in this order: `architecture`, `technical`, `feasibility`. Return `{ valid: true }` for valid input, or a structured `{ valid: false, reason }` that names the missing role, missing or blank model, or duplicate normalized model values. Never include provider API keys or full provider objects in a reason.

Use the following behavior as the implementation target:

```javascript
const REQUIRED_EXPERT_ROLES = ['architecture', 'technical', 'feasibility'];

function validateDistinctModels(experts, providers, consensus = {}) {
  const normalizedModels = [];

  for (const role of REQUIRED_EXPERT_ROLES) {
    const expert = experts?.[role];
    if (!expert) {
      return { valid: false, reason: `Missing required expert role: ${role}.` };
    }
    if (typeof expert.model !== 'string' || expert.model.trim() === '') {
      return { valid: false, reason: `Expert ${role} must define a non-empty model.` };
    }
    normalizedModels.push({ role, model: expert.model.trim() });
  }

  const seen = new Map();
  for (const assignment of normalizedModels) {
    const previousRole = seen.get(assignment.model);
    if (previousRole) {
      return {
        valid: false,
        reason: `Duplicate model "${assignment.model}" assigned to ${previousRole} and ${assignment.role}.`,
      };
    }
    seen.set(assignment.model, assignment.role);
  }

  if (consensus.cross_provider_required === true) {
    return { valid: true, warning: 'cross_provider_required is deprecated and ignored; distinct model identifiers are enforced.' };
  }

  return { valid: true };
}
```

The worker may refine the function signature to use the already parsed config object, but the observable contract must remain identical. `providers` may be retained as an unused transport-validation parameter if needed for the existing call path. `distinct_models_required` must default to true in `readConfig()` and must not create a path that accepts duplicate models. No provider uniqueness check, domestic-model check, vendor allowlist, or local-model exception may remain in the validator.

- [ ] **Step 2: Update configuration parsing without changing transport resolution.**

Ensure `readConfig()` returns `consensus.distinct_models_required` as true when the setting is absent. Preserve `threshold_percent: 90` and `max_review_rounds: 5`. If `cross_provider_required` is present, preserve it only for the migration warning path. Do not use it to decide validity.

- [ ] **Step 3: Call the new validator before any external model call.**

Update `main()` to call `validateDistinctModels()` after resolving the complete expert configuration and before `callWithRetry()`. Keep provider lookup required for external transport. A missing provider still blocks the selected call. A valid same-provider configuration must reach the API call path. A validator failure must exit before `callModelAPI()` and must print only the safe structured reason.

- [ ] **Step 4: Export the new validator and remove the obsolete public API.**

Update the module export block so tests import `validateDistinctModels`. Remove `validateCrossProvider` from the exported API and from internal call sites. Keep unrelated exports unchanged.

- [ ] **Step 5: Run the focused tests and confirm green.**

Run:

```bash
npx vitest run scripts/__tests__/delphi-external-review.test.cjs
```

Expected: PASS, including same-provider distinct models, cross-provider duplicate models, missing and blank models, three local models, legacy-option compatibility, and required-role validation.

## Task 3: Update canonical Delphi skill, examples, and project documentation

**Files:**

- Modify: `skills/delphi-review/SKILL.md`
- Modify: `skills/delphi-review/INSTALL.md`
- Modify: `skills/delphi-review/AGENTS.md`
- Modify: `skills/delphi-review/references/requirements.md`
- Modify: `skills/delphi-review/references/code-walkthrough.md`
- Modify: `skills/delphi-review/opencode.json.delphi.example`
- Modify: `skills/delphi-review/.delphi-config.json.example`
- Modify: `skills/sprint-flow/SKILL.md`
- Modify: `skills/sprint-flow/AGENTS.md`
- Modify: `skills/sprint-flow/references/phase-overview.md`
- Modify: `skills/sprint-flow/references/phase-4-verify.md`
- Modify: `README.md`
- Modify: `docs/CAPABILITIES.md`
- Modify: `AGENTS.md`
- Modify: `docs/AGENTS.md` only where the current Delphi policy is explicitly stated

- [ ] **Step 1: Replace policy language with the approved contract.**

Change statements such as “at least 2 different providers,” “different vendors,” “domestic models only,” and “foreign models are forbidden” to the precise rule: three required roles, three distinct normalized model strings, and no provider, vendor, country, endpoint, gateway, billing, or model-family restriction. Keep the 90 percent consensus and five-round limit.

- [ ] **Step 2: Document the compatibility behavior and configuration shape.**

Use this canonical example wherever a consensus example is needed:

```json
{
  "consensus": {
    "threshold_percent": 90,
    "max_review_rounds": 5,
    "distinct_models_required": true
  }
}
```

State that `distinct_models_required` defaults to true. State that `cross_provider_required` is deprecated, ignored for enforcement, and may emit a warning. State that all three roles must be present and each must have a non-empty model string after trimming.

- [ ] **Step 3: Update model examples without adding a vendor or country allowlist.**

Use the approved single-provider example in user-facing documentation:

```text
architecture: qwen3.7-max
technical: deepseek-v4-pro
feasibility: glm-5.2
provider: bailian-tp for all three roles
```

The example demonstrates distinct identifiers over one token plan. It must not be described as a domestic-only requirement. Keep platform-specific agent role names and model values only as examples, not as an enforcement list.

- [ ] **Step 4: Update operational guidance and anti-patterns.**

Document that duplicate models fail even when providers differ, blank models fail, three distinct local models pass, and API/model failures remain blocking. Preserve anonymous Round 1, consensus visibility rules, walkthrough output requirements, and exact commit binding.

- [ ] **Step 5: Audit the canonical documentation for stale policy words.**

Run:

```bash
rg -n -i "cross.provider|different providers|different provider|different vendors|domestic models|foreign models|国产|厂家|provider diversity|cross-provider" \
  skills/delphi-review skills/sprint-flow README.md docs/CAPABILITIES.md AGENTS.md docs/AGENTS.md
```

Expected: no remaining enforcement claim that conflicts with the approved contract. Historical references under `docs/plans/**`, `docs/superpowers/specs/**`, and `CHANGELOG.md` are intentionally excluded from this audit and remain unchanged.

## Task 4: Synchronize npm and platform plugin mirrors

**Files:**

- Generated by command: `src/npm-package/scripts/delphi-external-review.cjs`
- Generated by command: `src/npm-package/skills/delphi-review/**`
- Generated by command: `plugins/claude-code/skills/delphi-review/**`
- Generated by command: `plugins/opencode/skills/delphi-review/**`
- Generated by command: `plugins/qoder/skills/delphi-review/**`
- Generated by command: `src/npm-package/plugins/**`

- [ ] **Step 1: Run canonical package synchronization.**

Run:

```bash
node src/npm-package/scripts/sync-package-content.js
```

Expected: the npm runner and npm skill mirror are regenerated from canonical sources. Do not manually patch a generated file if the command reports a source or destination issue. Resolve the synchronization command or canonical source instead.

- [ ] **Step 2: Rebuild Claude Code and OpenCode plugin skill mirrors.**

Run:

```bash
npm run build:claude-plugin
npm run build:opencode-plugin
```

Expected: both plugin skill trees are copied from `skills/`, including all references, examples, and `AGENTS.md` files.

- [ ] **Step 3: Refresh Qoder and npm plugin outputs through the repository's existing packaging flow.**

Run the exact package and plugin synchronization commands used by the publish workflow:

```bash
node src/npm-package/scripts/sync-package-content.js
node plugins/opencode/scripts/prepack.cjs
```

The first command refreshes Qoder and the npm package plugin outputs from `plugins/**`; the second refreshes the OpenCode plugin's bundled skill content before packaging. Verify that all outputs are refreshed from canonical sources without hand edits.

- [ ] **Step 4: Verify byte parity and policy parity.**

Run:

```bash
cmp scripts/delphi-external-review.cjs src/npm-package/scripts/delphi-external-review.cjs
node scripts/copy-skills.mjs --source skills --dest plugins/claude-code/skills --verify
node scripts/copy-skills.mjs --source skills --dest plugins/opencode/skills --verify
node scripts/test-plugins.mjs
```

Expected: the runner comparison succeeds, skill checksums match, and plugin integration tests pass. Add or extend a mirror test if the current test suite does not assert that canonical and npm runner contents are byte-identical.

- [ ] **Step 5: Audit every shipped mirror for stale provider or domestic restrictions.**

Run:

```bash
rg -n -i "cross.provider|different providers|different provider|different vendors|domestic models|foreign models|国产|厂家|provider diversity|cross-provider" \
  src/npm-package/skills/delphi-review plugins src/npm-package/plugins
```

Expected: only intentionally historical examples or neutral provider transport descriptions remain. Any current instruction that enforces provider, vendor, or country diversity must be corrected at its canonical source and synchronized again.

## Task 5: Run focused, build, and full regression verification

**Files:** No new source files. Use the changed canonical files and generated outputs from Tasks 2 through 4.

- [ ] **Step 1: Run the focused runner tests before the build.**

Run:

```bash
npx vitest run scripts/__tests__/delphi-external-review.test.cjs
```

Expected: PASS.

- [ ] **Step 2: Run lint and TypeScript build before the full test suite.**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit 0. The CommonJS runner must remain compatible with Node.js 18 or newer, and no TypeScript diagnostics may be introduced by synchronization or plugin checks.

- [ ] **Step 3: Run the complete Vitest suite before rebuilding package outputs again.**

Run:

```bash
npm test
```

Expected: the complete suite passes with no test deletion or weakening.

- [ ] **Step 4: Re-run package and plugin builds after the tests.**

Run:

```bash
node src/npm-package/scripts/sync-package-content.js
npm run build:plugins
```

Expected: generated outputs remain stable and synchronized.

- [ ] **Step 5: Run the complete Vitest suite after the build.**

Run:

```bash
npm test
```

Expected: the post-build suite passes. Record both pre-build and post-build results in the implementation PR or verification log.

## Task 6: Run shell, architecture, and mirror quality gates

**Files:** No additional source changes. This task validates the implementation surface.

- [ ] **Step 1: Run BATS tests.**

Run:

```bash
bats githooks/__tests__
```

Expected: all available BATS tests pass. If a tool is unavailable, report the exact skipped command and reason rather than bypassing a gate.

- [ ] **Step 2: Run plugin integration tests.**

Run:

```bash
npm run test:plugins
bash scripts/test-plugins.sh
```

Expected: both plugin test paths pass and confirm that generated Claude Code, OpenCode, Qoder, and npm package content is usable.

- [ ] **Step 3: Run architecture validation and differential checks.**

Run:

```bash
npm run archlint
npx tsx src/architecture/index.ts --check
```

Use the repository's existing architecture differential command if the second command is not the configured entry point. Expected: no new architecture violations and no baseline increase. Do not update `.architecture-baseline.json` to hide a new warning.

- [ ] **Step 4: Run the stale-policy and mirror checks again.**

Run:

```bash
cmp scripts/delphi-external-review.cjs src/npm-package/scripts/delphi-external-review.cjs
rg -n -i "cross.provider|different providers|different provider|different vendors|domestic models|foreign models|国产|厂家|provider diversity|cross-provider" \
  scripts/delphi-external-review.cjs skills/delphi-review skills/sprint-flow README.md docs/CAPABILITIES.md AGENTS.md src/npm-package plugins
```

Expected: runner parity succeeds and no current shipped instruction contradicts the approved policy. Historical design and changelog paths remain excluded from the enforcement audit.

## Task 7: Validate exact-HEAD Delphi Token Plan review and walkthrough evidence

**Files:** Evidence artifacts only, generated during verification. Do not commit secrets or fabricated review output.

- [ ] **Step 1: Prepare the exact-HEAD Qwen, DeepSeek, and GLM Token Plan review.**

Use the current implementation commit at the exact review HEAD. Configure three roles with distinct normalized model strings, for example:

```text
architecture: qwen3.7-max
technical: deepseek-v4-pro
feasibility: glm-5.2
```

All three may use one provider or token plan. The review must use the repository's approved Token Plan route, remain anonymous in Round 1, reach at least 90 percent consensus, and stop within five rounds. Do not substitute a single model, provider-diversity requirement, or unrecorded local judgment.

- [ ] **Step 2: Run the design or requirements review against the exact HEAD.**

Run the repository's documented Delphi command for the applicable mode, using the exact commit content and the synchronized runner. Expected: the review completes with three expert records, three distinct model identifiers, consensus at least 90 percent, and no provider or country restriction in the evidence.

- [ ] **Step 3: Run the exact-HEAD code walkthrough.**

Run:

```text
/delphi-review --mode code-walkthrough
```

Expected: `.code-walkthrough-result.json` is written with the exact current `HEAD` commit, approved verdict, consensus at least 90 percent, three expert/model records, and the required walkthrough provenance. The artifact must be generated after the final implementation and synchronization changes, not copied from an earlier commit.

- [ ] **Step 4: Validate the walkthrough with the pre-push gate.**

Run the repository's normal pre-push validation path with the exact-HEAD walkthrough present. Expected: Gate MW accepts the artifact. Never use `--no-verify`, delete the walkthrough, or edit its commit binding to make the gate pass.

## Task 8: Final local hooks, CI, push, and merge evidence

**Files:** No additional implementation files. Review and release metadata must preserve existing history.

- [ ] **Step 1: Inspect the final diff and allowed file set.**

Run:

```bash
GIT_MASTER=1 git status --short
GIT_MASTER=1 git diff --check
GIT_MASTER=1 git diff --stat
GIT_MASTER=1 git diff -- scripts/delphi-external-review.cjs scripts/__tests__/delphi-external-review.test.cjs README.md docs/CAPABILITIES.md
```

Expected: only the planned canonical sources, generated mirrors, test changes, the newline-only spec correction, and required documentation are present. Historical approved designs and existing `CHANGELOG.md` content are unchanged.

- [ ] **Step 2: Run the normal pre-commit hook.**

Stage the implementation files and run the normal commit flow without `--no-verify`. Expected: Gate 0 through Gate 12 complete according to installed-tool behavior, with no new Gate 6 warnings. Do not commit generated or evidence secrets that are not part of the release contract.

- [ ] **Step 3: Run the normal pre-push hook with exact-HEAD walkthrough evidence.**

Run the normal push validation path. Expected: build integrity, applicable mutation and mock gates, plugin and sprint checks, and Gate MW pass or explicitly skip only under the repository's documented main/master rule. The feature branch must use the walkthrough evidence.

- [ ] **Step 4: Open the implementation PR and capture CI evidence.**

Push the feature branch through the normal remote workflow. Confirm GitHub Actions results for quality gates, cross-platform CI, npm packaging, plugin synchronization, security checks, and architecture validation. Do not rewrite history or force-push.

- [ ] **Step 5: Merge only after CI and review evidence are green.**

Merge through the repository's normal PR process. Preserve the approved design document and changelog history. Record the final merge commit and the exact-HEAD walkthrough evidence in the PR summary.

## Self-Review Checklist

Before declaring the implementation complete, the worker must inspect this plan and check every item below:

- [ ] Every requirement in `docs/superpowers/specs/2026-08-19-delphi-distinct-model-policy-design.md` maps to a task, including role count, trimming, duplicate detection, provider transport, compatibility defaults, no vendor/country restriction, failure blocking, consensus, and five-round limits.
- [ ] The required test cases are explicit: same provider with distinct models passes, different providers with the same model fails, missing model fails, blank model fails, three distinct local models pass, and the legacy provider option cannot restore provider blocking.
- [ ] Canonical runner, runner test, npm synchronized copy, `skills/delphi-review/**`, README, `docs/CAPABILITIES.md`, root and skill `AGENTS.md`, configuration examples, and plugin/package mirrors are named.
- [ ] Canonical-first editing and generated mirror synchronization are explicit. No step instructs a worker to hand-edit a generated mirror.
- [ ] Focused tests, lint, TypeScript build, full Vitest before and after build, BATS, plugin tests, archlint, mirror checks, pre-commit, pre-push, CI, push, merge, Token Plan review, and exact-HEAD walkthrough evidence are explicit.
- [ ] The approved spec EOF warning is fixed by a newline-only change, while historical approved design text and `CHANGELOG.md` history remain intact.
- [ ] No step contains `TBD`, `TODO`, “implement later,” “write tests for the above,” or another unresolved placeholder.
- [ ] No contradiction claims provider diversity is required while another step allows same-provider distinct models. The only provider rule is transport resolution.
- [ ] `distinct_models_required` defaults true, and no compatibility path permits duplicate models.
- [ ] The plan contains no em dash or en dash characters and uses plain, direct wording.
- [ ] The plan ends with a final newline.

## Completion Evidence

The implementation is ready for review only when the worker can provide:

1. Focused validation test output showing all policy cases green.
2. Pre-build and post-build full Vitest results.
3. Lint, TypeScript build, BATS, plugin, architecture, and mirror results.
4. Exact-HEAD Qwen, DeepSeek, and GLM Token Plan review evidence with at least 90 percent consensus.
5. Exact-HEAD `.code-walkthrough-result.json` accepted by Gate MW.
6. Normal pre-commit and pre-push results without bypass flags.
7. CI checks, PR review, push, and merge evidence.
