#!/usr/bin/env bats
# @test REQ-ARCH03-FIX intent: a repo whose ROOT declares the project must never
# have PROJECT_SUBDIR hijacked by a nested marker that is merely a module file
# (skill-cert incident: skill_cert/cli/setup.py is a CLI wizard module, not a
# setuptools root) — Gates 1-9 then ran from the wrong cwd and false-BLOCKed
# on root-relative paths (#515). covers: root-marker short-circuit.
#
# R2 (delphi walkthrough): marker set aligned with _detect_subdir's full set;
# npm workspaces roots keep deriving; every structural pin fails loudly.
#
# The functional tests extract the hook's REAL derivation block (from
# `PROJECT_SUBDIR=""` up to the subdirectory-fallback comment) and execute it in
# a sandbox, so they lock the hook's behaviour rather than a re-implementation.

HOOK="$BATS_TEST_DIRNAME/../pre-commit"

# Extract the derivation block into $1 (sandbox file). Fails if the anchors move.
_extract_section() {
  sed -n '/# ---- Derive PROJECT_SUBDIR from changed file paths/,/# ---- Subdirectory fallback/p' "$HOOK" \
    | sed '$d' > "$1"
  [ -s "$1" ] && grep -q "_detect_subdir" "$1"
}

_setup_sandbox() {
  sandbox="$(mktemp -d)"
  cat > "$sandbox/drive.sh" <<'DRIVE'
cd "$SBX_REPO" || exit 1
PROJECT_LANGS="$SBX_LANGS"
CHANGED_FILES="$SBX_CHANGED"
# shellcheck source=/dev/null
source "$SBX_SECTION"
echo "SUBDIR=[$PROJECT_SUBDIR]"
DRIVE
  export SBX_REPO="$sandbox/repo" SBX_LANGS="python" SBX_CHANGED=""
  export SBX_SECTION="$sandbox/section.sh" SBX_DRIVE="$sandbox/drive.sh"
  mkdir -p "$SBX_REPO"
}

teardown() {
  if [ -n "${sandbox:-}" ]; then
    rm -rf "$sandbox"
    sandbox=""
  fi
  unset SBX_REPO SBX_LANGS SBX_CHANGED SBX_SECTION SBX_DRIVE sandbox
}

@test "structural: root short-circuit pins the full _detect_subdir marker set + workspaces exception (#515)" {
  # Extract from the #515 comment down to the derivation loop entry; the
  # short-circuit block always sits between those two anchors.
  run sed -n '/# #515: when the repo ROOT/,/_subdir_set=/p' "$HOOK"
  [ "$status" -eq 0 ]
  block="$output"
  [ -n "$block" ] || fail "short-circuit block anchors moved — extraction empty"
  # -F is mandatory: without it the [ ] in the pattern is a BRE character class
  # and matches anything, making every marker check vacuous (#515 R2 review).
  for marker in tsconfig.json package.json pyproject.toml setup.py go.mod pubspec.yaml pom.xml build.gradle build.gradle.kts CMakeLists.txt; do
    echo "$block" | grep -qF -- "[ -f $marker ]" || fail "root short-circuit missing marker: $marker"
  done
  # The JS-monorepo check must run FIRST (before the short-circuit OR-chain),
  # otherwise a root tsconfig.json alongside package.json{workspaces} bypasses
  # the exception (#515 R2 critical finding).
  first_if_line=$(echo "$block" | grep -n '^    if ' | head -1 | cut -d: -f1)
  [ -n "$first_if_line" ] || fail "no if statement found in short-circuit block"
  echo "$block" | sed -n "${first_if_line}p" | grep -qF 'workspaces' || fail "workspaces check must be the first branch (order matters)"
  echo "$block" | grep -qF '"workspaces":' || fail "npm workspaces monorepo exception missing from short-circuit"
}

@test "functional: root pyproject.toml + nested setup.py leaves PROJECT_SUBDIR empty (#515)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION" || fail "derivation block extraction failed (anchors moved?)"
  printf '[project]\n' > "$SBX_REPO/pyproject.toml"
  mkdir -p "$SBX_REPO/pkg" && printf 'x = 1\n' > "$SBX_REPO/pkg/setup.py"
  SBX_CHANGED="pkg/setup.py" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" != *"SUBDIR DETECTED"* ]]
  [[ "$output" == *"SUBDIR=[]"* ]]
}

@test "functional: root package.json + nested module marker is not hijacked (#515)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION" || fail "derivation block extraction failed (anchors moved?)"
  printf '{}\n' > "$SBX_REPO/package.json"
  mkdir -p "$SBX_REPO/tools" && printf '{}\n' > "$SBX_REPO/tools/package.json"
  SBX_LANGS="typescript" SBX_CHANGED="tools/app.ts" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR=[]"* ]]
}

@test "functional: npm workspaces monorepo root keeps deriving subdir (#515 R2 regression lock)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION" || fail "derivation block extraction failed (anchors moved?)"
  printf '{\n  "workspaces": ["packages/*"]\n}\n' > "$SBX_REPO/package.json"
  mkdir -p "$SBX_REPO/packages/front"
  printf '{}\n' > "$SBX_REPO/packages/front/package.json"
  SBX_LANGS="typescript" SBX_CHANGED="packages/front/app.ts" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR DETECTED"* ]]
  [[ "$output" == *"SUBDIR=[packages/front]"* ]]
}

@test "functional: workspaces root with shared tsconfig.json still derives (#515 R2 critical regression lock)" {
  # Most common JS monorepo layout: root package.json{workspaces} + root
  # tsconfig.json (shared base config inherited by every package). The
  # workspaces check must win over the tsconfig root marker.
  _setup_sandbox
  _extract_section "$SBX_SECTION" || fail "derivation block extraction failed (anchors moved?)"
  printf '{\n  "workspaces": ["packages/*"]\n}\n' > "$SBX_REPO/package.json"
  printf '{\n  "compilerOptions": {}\n}\n' > "$SBX_REPO/tsconfig.json"
  mkdir -p "$SBX_REPO/packages/front"
  printf '{}\n' > "$SBX_REPO/packages/front/package.json"
  SBX_LANGS="typescript" SBX_CHANGED="packages/front/app.ts" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR DETECTED"* ]]
  [[ "$output" == *"SUBDIR=[packages/front]"* ]]
}

@test "functional: monorepo without root markers still derives subdir (#515 unchanged behavior)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION" || fail "derivation block extraction failed (anchors moved?)"
  mkdir -p "$SBX_REPO/packages/front"
  printf '{}\n' > "$SBX_REPO/packages/front/package.json"
  SBX_LANGS="typescript" SBX_CHANGED="packages/front/app.ts" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR DETECTED"* ]]
  [[ "$output" == *"SUBDIR=[packages/front]"* ]]
}

@test "functional: root build.gradle without settings.gradle include keeps the short-circuit (#527 single-project control)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION" || fail "derivation block extraction failed (anchors moved?)"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/build.gradle"
  mkdir -p "$SBX_REPO/services/api"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/services/api/build.gradle"
  SBX_LANGS="java" SBX_CHANGED="services/api/src/main/java/App.java" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  # Single-project Gradle root (no settings.gradle include): the #515
  # short-circuit still applies. The multi-module case (settings.gradle with
  # include) now derives the module instead — see
  # issue-527-subdir-multimodule.test.bats, which replaced this pin's
  # known-limitation role.
  [[ "$output" == *"SUBDIR=[]"* ]]
}

@test "functional: no nested marker hit keeps SUBDIR empty on a declaring root (#515 no-op)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION" || fail "derivation block extraction failed (anchors moved?)"
  printf '[project]\n' > "$SBX_REPO/pyproject.toml"
  SBX_CHANGED="engine/metrics.py" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR=[]"* ]]
}
