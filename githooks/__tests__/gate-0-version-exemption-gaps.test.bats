#!/usr/bin/env bats
# @test REQ-806-G0a
# @intent Gate 0 requires a VERSION/CHANGELOG bump for "production source" on a
#   protected branch, and decides what counts as production source with a path
#   whitelist at gate-0-entry.sh:414. That whitelist exempts
#   `githooks/adapters/*` but omits its sibling `githooks/gate-entries/*`, so a
#   commit that only edits gate logic was refused while an edit to an adapter
#   under the same hook layer passed. Two directories holding the same kind of
#   code cannot have opposite rules; the asymmetry means every gate-logic fix
#   needs either a real VERSION bump (polluting version history with changes
#   users cannot observe) or the SKIP_VERSION_CHECK escape hatch (bypassing the
#   gate rather than satisfying it).
# @covers AC-806-G0a
#
# The fix is a whitelist entry, but the risk is asymmetric: adding a path to the
# exemption list also exempts any REAL production source that happens to live
# under it. The anti-vacuity tests below therefore pin that ordinary source files
# still BLOCK, so the exemption cannot be widened into a blanket pass.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE_0_ENTRY="$REPO_ROOT/githooks/gate-entries/gate-0-entry.sh"
  FIXTURE_REPO="$(mktemp -d)"
}

teardown() {
  rm -rf "$FIXTURE_REPO"
}

# Minimal repo on a protected branch with a consistent version surface, so the
# ONLY thing a test perturbs is which paths are staged.
make_fixture() {
  (
    cd "$FIXTURE_REPO" || exit 1
    git init -q -b master
    git config user.email test@test.com
    git config user.name Test
    echo "1.2.3.4" > VERSION
    printf '{\n  "name": "root",\n  "version": "1.2.3.4"\n}\n' > package.json
    printf '{\n  "name": "root",\n  "version": "1.2.3.4",\n  "lockfileVersion": 3,\n  "packages": { "": { "version": "1.2.3.4" } }\n}\n' > package-lock.json
    mkdir -p src/npm-package plugins/opencode
    printf '{\n  "name": "pkg",\n  "version": "1.2.3"\n}\n' > src/npm-package/package.json
    printf '{\n  "name": "opencode",\n  "version": "1.2.3"\n}\n' > plugins/opencode/package.json
    mkdir -p githooks/gate-entries githooks/adapters githooks/lib scripts
    printf 'gate_1_run() { return 0; }\n' > githooks/gate-entries/gate-1-entry.sh
    printf 'run_lint() { :; }\n' > githooks/adapters/shell.sh
    printf 'helper() { :; }\n' > githooks/lib/helper.sh
    printf '#!/usr/bin/env bash\necho build\n' > scripts/build.sh
    # A skill's behaviour and its test harness, plus a skill's instructions.
    mkdir -p skills/demo/scripts skills/demo/__tests__
    printf '#!/usr/bin/env bash\necho verify\n' > skills/demo/scripts/verify.sh
    printf 'console.log(1);\n' > skills/demo/__tests__/demo.test.cjs
    printf '# Demo skill\n\nInstructions.\n' > skills/demo/SKILL.md
    printf 'def f():\n    return 1\n' > a.py
    git add -A
    git commit --no-verify -q -m seed
  )
}

# Drives gate_0_run with the driver contract pre-commit provides. Records the
# status Gate 0 hands to the audit writer -- the status the report reads.
run_gate_0() {
  cd "$FIXTURE_REPO" || return 1
  cat > harness.sh <<'HARNESS'
set +u
gate_start_ms() { echo 0; }
record_gate_audit() { printf '%s' "$3" > "$STATUS_OUT"; }
gate_enabled() { return 0; }
gate_selection_active() { return 1; }
export_staged_acm_cache() { :; }
jscpd_is_build_output() { return 1; }
detect_docs_only_commit() { cat >/dev/null; echo false; }
_detect_ext_lang() { echo ""; }
_detect_subdir() { echo ""; }
_cmake_multi_module_root() { return 1; }
_gradle_multi_module_root() { return 1; }
now_ms() { echo 0; }
source "$GATE_0_ENTRY"
gate_0_run > "$GATE0_OUT" 2>&1
HARNESS
  STATUS_OUT="$FIXTURE_REPO/status.txt" GATE0_OUT="$FIXTURE_REPO/gate0.log" \
    GATE_0_ENTRY="$GATE_0_ENTRY" bash harness.sh >/dev/null 2>&1 || true
  GATE0_STATUS_OBSERVED="$(cat "$FIXTURE_REPO/status.txt" 2>/dev/null)"
  GATE0_LOG="$(cat "$FIXTURE_REPO/gate0.log" 2>/dev/null)"
  return 0
}

# ---------------------------------------------------------------------------
# harness sanity -- without this, a stubbed-out early return makes the
# exemption tests below pass for the wrong reason.
# ---------------------------------------------------------------------------

@test "harness reaches the version check at all (anti-vacuity)" {
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  printf 'def f():\n    return 2\n' > a.py
  git add a.py
  run_gate_0
  # A real source change with no version bump must BLOCK; if the harness never
  # reached the check, this would read PASS and every "is exempt" test would be
  # a false green.
  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ] ||
    { echo "harness did not reach the version check (status=$GATE0_STATUS_OBSERVED)"; return 1; }
}

# ---------------------------------------------------------------------------
# G0a: gate-entries must be treated like adapters
# ---------------------------------------------------------------------------

@test "AC-806-G0a: editing only githooks/gate-entries/* needs no version bump" {
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  printf 'gate_1_run() { return 1; }\n' > githooks/gate-entries/gate-1-entry.sh
  git add githooks/gate-entries/gate-1-entry.sh

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ] ||
    { echo "gate-entries edit was treated as production source: $GATE0_LOG"; return 1; }
  [[ "$GATE0_LOG" == *"build-tooling"* ]] ||
    { echo "exemption reason not reported: $GATE0_LOG"; return 1; }
}

@test "AC-806-G0a: the sibling githooks/adapters/* still needs no bump (parity)" {
  # The rule Gate 0 already had. Pinning it beside the new one is what makes the
  # two directories demonstrably equivalent rather than merely both green.
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  printf 'run_lint() { echo hi; }\n' > githooks/adapters/shell.sh
  git add githooks/adapters/shell.sh

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ]
}

@test "AC-806-G0a: a mixed gate-entries + real source change still BLOCKS" {
  # The exemption must apply per-file, not per-commit. If any staged path is
  # real source, the commit needs the bump.
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  printf 'gate_1_run() { return 1; }\n' > githooks/gate-entries/gate-1-entry.sh
  printf 'def f():\n    return 3\n' > a.py
  git add githooks/gate-entries/gate-1-entry.sh a.py

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ] ||
    { echo "a real source change was exempted because a gate entry rode along"; return 1; }
}

@test "AC-806-G0a anti-vacuity: an unrelated .sh file still BLOCKS" {
  # `*.sh` is production source. The new exemption is a path prefix, so this
  # proves it did not degenerate into "any shell script is build tooling".
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  mkdir -p src
  printf '#!/usr/bin/env bash\necho real\n' > src/deploy.sh
  git add src/deploy.sh

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ] ||
    { echo "a real .sh under src/ was exempted"; return 1; }
}

# ---------------------------------------------------------------------------
# G0b: skills/ -- scripts and tests are tooling, the skill CONTENT is not
# ---------------------------------------------------------------------------
#
# The split is decided by what reaches a user. `src/npm-package/scripts/
# sync-package-content.js:79` copies the whole of skills/ into the published
# package, so both halves ship. But only one of them carries release semantics:
#   - a skill's scripts/ and __tests__/ are the machinery that produces confidence
#     in the skill; changing them changes no behaviour a user experiences.
#   - SKILL.md / references/ ARE the behaviour: they are the instructions the
#     agent follows after install.
# So the tooling is exempt and the content is not. The anti-vacuity test below
# exists because a `skills/*` prefix would have swept up both.

@test "AC-806-G0b: editing only skills/*/scripts/* needs no version bump" {
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  printf '#!/usr/bin/env bash\necho verify-v2\n' > skills/demo/scripts/verify.sh
  git add skills/demo/scripts/verify.sh

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ] ||
    { echo "a skill script was treated as production source: $GATE0_LOG"; return 1; }
}

@test "AC-806-G0b: editing only skills/*/__tests__/* needs no version bump" {
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  printf 'console.log(2);\n' > skills/demo/__tests__/demo.test.cjs
  git add skills/demo/__tests__/demo.test.cjs

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ] ||
    { echo "a skill test was treated as production source: $GATE0_LOG"; return 1; }
}

@test "AC-806-G0b anti-vacuity: skill CONTENT still BLOCKS (it is what the agent follows)" {
  # This is the line the user drew: exempt the mechanics, not the instructions.
  # `skills/` is synced into the published package, so SKILL.md IS shipped
  # behaviour -- exempting it would let a change to what the agent does land
  # without appearing anywhere in version history. A `.md` file alone reaches
  # the "doc-only" branch, so this stages a code file beside it to force the
  # content question: if a future edit widens the exemption to `skills/*`, this
  # test is what stops it.
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  mkdir -p skills/demo/references/src
  printf '# Demo skill\n\nDifferent instructions.\n' > skills/demo/SKILL.md
  printf 'export const helper = () => 1;\n' > skills/demo/references/src/helper.ts
  git add skills/demo/SKILL.md skills/demo/references/src/helper.ts

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ] ||
    { echo "skill content was exempted from the version bump"; return 1; }
}

@test "AC-806-G0b anti-vacuity: a script outside scripts/ under a skill still BLOCKS" {
  # The exemption is `skills/*/scripts/*`, not `skills/*`. A .sh sitting at the
  # skill root is not the declared tooling location and must not be swept in.
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  printf '#!/usr/bin/env bash\necho stray\n' > skills/demo/stray.sh
  git add skills/demo/stray.sh

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ] ||
    { echo "the skills exemption leaked outside scripts/ and __tests__/"; return 1; }
}

# ---------------------------------------------------------------------------
# G0c: test files anywhere in the repo
# ---------------------------------------------------------------------------
#
# 684 test files are tracked under src/, githooks/, scripts/, plugins/ and
# skills/; npm actually ships 261 of them (the `files` list names directories
# like lib/ and hooks/, and the prefix drags __tests__/ along with it). So a test
# file IS part of the package -- the same argument that made a skill's scripts/
# and __tests__/ exempt in G0b applies here.
#
# What a test asserts is not what a user experiences. A version number promises a
# behaviour change; changing how we know something works is not that. Requiring a
# bump for it trains maintainers to either inflate the version history or reach
# for SKIP_VERSION_CHECK=1, and both were observed before this fix.
#
# `__tests__/` and the `*.test.*` filename convention are both covered because
# this repo uses both: whole directories in src/ and githooks/, sibling
# `*.test.cjs` files in scripts/ and skills/.

@test "AC-806-G0c: a .cjs test inside __tests__/ needs no version bump" {
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  mkdir -p src/lib/__tests__ githooks/__tests__
  printf 'console.log(1);\n' > src/lib/__tests__/thing.test.cjs
  printf 'console.log(1);\n' > githooks/__tests__/helper.cjs
  git add src/lib/__tests__/thing.test.cjs githooks/__tests__/helper.cjs

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ] ||
    { echo "a test file was treated as production source: $GATE0_LOG"; return 1; }
}

@test "AC-806-G0c: a sibling *.test.* file outside __tests__/ needs no version bump" {
  # scripts/ and skills/ put tests beside the code as `*.test.cjs`, not in a
  # directory. A directory-only rule would leave those still blocked.
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  printf 'console.log(1);\n' > scripts/thing.test.cjs
  printf 'export const t = () => 1;\n' > src/other.test.ts
  git add scripts/thing.test.cjs src/other.test.ts

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ] ||
    { echo "a sibling *.test.* file was treated as production source: $GATE0_LOG"; return 1; }
}

@test "AC-806-G0c anti-vacuity: a NON-test .cjs beside the tests still BLOCKS" {
  # The exemption must key on the test convention, not on the extension. `*.cjs`
  # is a real source extension in this repo, so a rule that merely dropped .cjs
  # (or exempted its whole directory) would silently stop gating real code.
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  mkdir -p src/lib
  printf 'module.exports = () => 1;\n' > src/lib/real-module.cjs
  git add src/lib/real-module.cjs

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ] ||
    { echo "a real .cjs module was exempted as if it were a test"; return 1; }
}

@test "AC-806-G0c anti-vacuity: a _tests-ish name that is not a test convention BLOCKS" {
  # Guards against a sloppy substring match: `contest.cjs` and `latest.js` both
  # contain the letters "test", and a `*test*` glob would exempt them.
  make_fixture
  cd "$FIXTURE_REPO" || return 1
  mkdir -p src/lib
  printf 'module.exports = 1;\n' > src/lib/contest.cjs
  printf 'module.exports = 2;\n' > src/lib/latest.cjs
  git add src/lib/contest.cjs src/lib/latest.cjs

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ] ||
    { echo "a substring match exempted a non-test file"; return 1; }
}
