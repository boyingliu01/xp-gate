#!/usr/bin/env bats
# @test REQ-806-GATE0-D3
# @intent Gate 0 is named "Version Consistency Check" but only verified that
#         VERSION *or* CHANGELOG.md was staged on a protected branch. It never
#         compared the version literals, so the drift the name promises to
#         prevent could exist in a clean checkout while the gate reported PASS.
#         Two halves are pinned here:
#           (a) a real consistency assertion: every version field must match
#               VERSION, honouring the four-digit/three-digit split that
#               scripts/sync-version.cjs defines (root package.json and
#               package-lock.json keep MAJOR.MINOR.PATCH.MICRO; the npm-package
#               and plugin manifests drop MICRO);
#           (b) a sync-version FAILURE must BLOCK rather than print a warning and
#               continue, because continuing leaves the fan-out half-written and
#               reports success for the very step that failed.
# @covers AC-806-D3a AC-806-D3b
#
# MEASURED STATE WHEN WRITTEN (2026-11-16): VERSION=0.38.5.0,
# package.json=0.38.5.0, package-lock.json=0.38.5.0 (both the top-level field and
# packages[""]), and 0.38.5 in src/npm-package/package.json plus the four plugin
# manifests. All consistent -- but nothing asserted it, which is the defect.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE_0_ENTRY="$REPO_ROOT/githooks/gate-entries/gate-0-entry.sh"
  FIXTURE_REPO="$(mktemp -d)"
}

teardown() {
  rm -rf "$FIXTURE_REPO"
}

# Build a minimal fixture that carries exactly the version surface Gate 0
# should verify, so each test can perturb one field and watch the verdict flip.
make_fixture() {
  local full="$1" npm="$2"
  (
    cd "$FIXTURE_REPO" || exit 1
    git init -q -b master
    git config user.email test@test.com
    git config user.name Test
    echo "$full" > VERSION
    printf '{\n  "name": "root",\n  "version": "%s"\n}\n' "$full" > package.json
    printf '{\n  "name": "root",\n  "version": "%s",\n  "lockfileVersion": 3,\n  "packages": { "": { "version": "%s" } }\n}\n' "$full" "$full" > package-lock.json
    mkdir -p src/npm-package plugins/opencode
    printf '{\n  "name": "pkg",\n  "version": "%s"\n}\n' "$npm" > src/npm-package/package.json
    printf '{\n  "name": "opencode",\n  "version": "%s"\n}\n' "$npm" > plugins/opencode/package.json
    printf 'def f():\n    return 1\n' > a.py
    git add -A
    git commit --no-verify -q -m seed
  )
}

# Call gate_0_run with external helpers stubbed. Records the verdict Gate 0
# hands to the audit writer, which is the status the report reads.
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
# (a) a real consistency assertion
# ---------------------------------------------------------------------------

@test "AC-806-D3a: a consistent version surface PASSES Gate 0" {
  # Baseline. Both the four-digit group (VERSION, package.json,
  # package-lock.json) and the three-digit group (npm manifests) agree.
  make_fixture "1.2.3.4" "1.2.3"
  cd "$FIXTURE_REPO" || return 1
  # A VERSION bump satisfies the staging half of Gate 0, so reaching the
  # consistency check is possible; the values below are what it must verify.
  echo '1.2.3.5' > VERSION
  echo '1.2.3.5' > /dev/null
  git add VERSION
  # Keep the surface consistent with the bumped VERSION so the baseline is PASS.
  printf '{\n  "name": "root",\n  "version": "1.2.3.5"\n}\n' > package.json
  printf '{\n  "name": "root",\n  "version": "1.2.3.5",\n  "lockfileVersion": 3,\n  "packages": { "": { "version": "1.2.3.5" } }\n}\n' > package-lock.json
  git add package.json package-lock.json

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ]
}

@test "AC-806-D3a: a four-digit field disagreeing with VERSION BLOCKS Gate 0" {
  # This is the drift Gate 0's name promises to catch: someone edits VERSION and
  # forgets to run sync-version, so root package.json still carries the old one.
  make_fixture "1.2.3.4" "1.2.3"
  cd "$FIXTURE_REPO" || return 1
  echo '1.2.3.5' > VERSION
  git add VERSION
  # package.json deliberately left at 1.2.3.4.

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ]
  [[ "$GATE0_LOG" == *"package.json"* ]]
}

@test "AC-806-D3a: a three-digit field disagreeing with VERSION BLOCKS Gate 0" {
  # The three-digit group must be compared against VERSION minus MICRO, not
  # against the full string: 0.38.5 is correct for VERSION 0.38.5.0. A naive
  # string comparison would call every correct manifest wrong, so this test is
  # what stops the check from being implemented the easy, wrong way.
  make_fixture "1.2.3.4" "1.2.3"
  cd "$FIXTURE_REPO" || return 1
  echo '1.2.3.5' > VERSION
  git add VERSION
  # Bump the four-digit group so the only failure is the three-digit group.
  printf '{\n  "name": "root",\n  "version": "1.2.3.5"\n}\n' > package.json
  printf '{\n  "name": "root",\n  "version": "1.2.3.5",\n  "lockfileVersion": 3,\n  "packages": { "": { "version": "1.2.3.5" } }\n}\n' > package-lock.json
  git add package.json package-lock.json
  # src/npm-package/package.json stays at 1.2.3 while VERSION (minus MICRO) is
  # 1.2.3 -- that IS consistent, so perturb it to 1.2.2 to create the failure.
  printf '{\n  "name": "pkg",\n  "version": "1.2.2"\n}\n' > src/npm-package/package.json
  git add src/npm-package/package.json

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ]
  [[ "$GATE0_LOG" == *"npm-package"* ]]
}

@test "AC-806-D3a anti-vacuity: a correct three-digit manifest is NOT flagged" {
  # Guards the naive implementation: comparing the manifest against the FULL
  # four-digit VERSION would mark every correct repo as broken, which would make
  # this gate block unconditionally and get ripped out.
  make_fixture "1.2.3.4" "1.2.3"
  cd "$FIXTURE_REPO" || return 1
  echo '1.2.3.5' > VERSION
  printf '{\n  "name": "root",\n  "version": "1.2.3.5"\n}\n' > package.json
  printf '{\n  "name": "root",\n  "version": "1.2.3.5",\n  "lockfileVersion": 3,\n  "packages": { "": { "version": "1.2.3.5" } }\n}\n' > package-lock.json
  printf '{\n  "name": "pkg",\n  "version": "1.2.4"\n}\n' > src/npm-package/package.json
  # Note: 1.2.4 != 1.2.3 (VERSION minus MICRO is 1.2.3) -- make it correct.
  printf '{\n  "name": "pkg",\n  "version": "1.2.3"\n}\n' > src/npm-package/package.json
  git add -A

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ]
}

# ---------------------------------------------------------------------------
# (b) a sync-version failure must BLOCK
# ---------------------------------------------------------------------------

@test "AC-806-D3b: a failing sync-version BLOCKS instead of warning and continuing" {
  # The defect: `if $SYNC_VERSION_CMD > log 2>&1; then ... else echo "⚠️
  # sync-version failed ... continuing without auto-sync"; fi` then fell through
  # to "✅ PASSED - (VERSION/CHANGELOG staged)". The one step that failed was
  # exactly the fan-out this branch exists to perform, so the commit landed with
  # a half-updated version surface and a green Gate 0.
  make_fixture "1.2.3.4" "1.2.3"
  cd "$FIXTURE_REPO" || return 1
  mkdir -p scripts
  printf '#!/usr/bin/env node\nprocess.exit(1);\n' > scripts/sync-version.cjs
  git add scripts/sync-version.cjs
  git commit --no-verify -q -m "chore: failing sync-version"

  echo '1.2.3.5' > VERSION
  git add VERSION

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ]
}

@test "AC-806-D3b: a sync-version that cannot even be launched also BLOCKS" {
  # A missing node or a syntax error exits non-zero the same way; the gate must
  # not distinguish "failed cleanly" from "failed messily".
  make_fixture "1.2.3.4" "1.2.3"
  cd "$FIXTURE_REPO" || return 1
  mkdir -p scripts
  printf 'this is not javascript {{{\n' > scripts/sync-version.cjs
  git add scripts/sync-version.cjs
  git commit --no-verify -q -m "chore: broken sync-version"

  echo '1.2.3.5' > VERSION
  git add VERSION

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ]
}

@test "AC-806-D3b anti-vacuity: a succeeding sync-version still PASSES" {
  # Guards "block unconditionally", which would satisfy both tests above while
  # making every VERSION bump impossible.
  make_fixture "1.2.3.4" "1.2.3"
  cd "$FIXTURE_REPO" || return 1
  mkdir -p scripts
  cat > scripts/sync-version.cjs <<'STUB'
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const full = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const npm = full.replace(/\.\d+$/, '');
for (const f of ['package.json', 'package-lock.json']) {
  const p = path.join(root, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.version = full;
  if (j.packages && j.packages['']) j.packages[''].version = full;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
const m = path.join(root, 'src/npm-package/package.json');
const mj = JSON.parse(fs.readFileSync(m, 'utf8'));
mj.version = npm;
fs.writeFileSync(m, JSON.stringify(mj, null, 2) + '\n');
STUB
  git add scripts/sync-version.cjs
  git commit --no-verify -q -m "chore: working sync-version"

  echo '1.2.3.5' > VERSION
  git add VERSION

  run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "PASS" ]
}

@test "AC-806-D3a: minified manifests are read correctly (no node fallback)" {
  # Measured bug, caught by hand before this test existed: the node-free fallback
  # originally anchored on `^[[:space:]]*"version"`, which only matches
  # pretty-printed JSON. Every minified manifest therefore reported "no version
  # field found" and the gate BLOCKED a repository whose versions were correct.
  # A second bug hid behind the first: `grep -m1` limits LINES, not matches, so
  # on a single-line file it returned both the top-level and the nested
  # `packages[""].version`, and the compared string was two lines long.
  #
  # This pins the behaviour with node unavailable, because with node present the
  # reliable JSON parser masks the fallback entirely.
  make_fixture "1.2.3.4" "1.2.3"
  cd "$FIXTURE_REPO" || return 1
  git rm -r --cached -q . >/dev/null 2>&1 || true
  # Rewrite every manifest on ONE line, and bump VERSION so the check runs.
  echo '1.2.3.5' > VERSION
  printf '{"name":"root","version":"1.2.3.5"}\n' > package.json
  printf '{"name":"root","version":"1.2.3.5","lockfileVersion":3,"packages":{"":{"version":"1.2.3.5"}}}\n' > package-lock.json
  printf '{"name":"pkg","version":"1.2.3"}\n' > src/npm-package/package.json
  printf '{"name":"opencode","version":"1.2.3"}\n' > plugins/opencode/package.json
  git add -A

  # Shadow node with a failing shim so the fallback is the code under test.
  mkdir -p shadow
  printf '#!/bin/sh\nexit 127\n' > shadow/node
  chmod +x shadow/node
  PATH="$FIXTURE_REPO/shadow:$PATH" run_gate_0

  # Correct values must produce PASS, not a list of false "no version" drift.
  [ "$GATE0_STATUS_OBSERVED" = "PASS" ]
  [[ "$GATE0_LOG" != *"no version field found"* ]]
}

@test "AC-806-D3a: the node-free fallback still detects real drift" {
  # Anti-vacuity for the test above: "always PASS" would satisfy it. The
  # fallback must still catch a genuinely stale manifest.
  make_fixture "1.2.3.4" "1.2.3"
  cd "$FIXTURE_REPO" || return 1
  echo '1.2.3.5' > VERSION
  printf '{"name":"root","version":"1.2.3.5"}\n' > package.json
  printf '{"name":"root","version":"1.2.3.5","lockfileVersion":3,"packages":{"":{"version":"1.2.3.5"}}}\n' > package-lock.json
  printf '{"name":"pkg","version":"0.0.1"}\n' > src/npm-package/package.json
  printf '{"name":"opencode","version":"1.2.3"}\n' > plugins/opencode/package.json
  git add -A

  mkdir -p shadow
  printf '#!/bin/sh\nexit 127\n' > shadow/node
  chmod +x shadow/node
  PATH="$FIXTURE_REPO/shadow:$PATH" run_gate_0

  [ "$GATE0_STATUS_OBSERVED" = "BLOCK" ]
  [[ "$GATE0_LOG" == *"0.0.1"* ]]
}
