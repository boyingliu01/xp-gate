#!/usr/bin/env bats
# @test REQ-ARCH03-FIX intent: a repo whose ROOT declares the project must never
# have PROJECT_SUBDIR hijacked by a nested marker that is merely a module file
# (skill-cert incident: skill_cert/cli/setup.py is a CLI wizard module, not a
# setuptools root) — Gates 1-9 then ran from the wrong cwd and false-BLOCKed
# on root-relative paths (#515). covers: root-marker short-circuit.
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

_teardown_sandbox() {
  unset SBX_REPO SBX_LANGS SBX_CHANGED SBX_SECTION SBX_DRIVE
  [ -n "$sandbox" ] && rm -rf "$sandbox"
}

@test "pre-commit short-circuits subdir derivation when repo root declares the project (#515)" {
  grep -q "_skip_subdir_derive" "$HOOK"
}

@test "short-circuit recognizes pyproject/package.json/setup.py/go.mod/pom.xml root markers (#515)" {
  run grep -B6 "_skip_subdir_derive=1" "$HOOK"
  [ "$status" -eq 0 ]
  for marker in pyproject.toml package.json setup.py go.mod pom.xml; do
    echo "$output" | grep -q -- "-f $marker"
  done
}

@test "functional: root pyproject.toml + nested setup.py leaves PROJECT_SUBDIR empty (#515)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION"
  printf '[project]\n' > "$SBX_REPO/pyproject.toml"
  mkdir -p "$SBX_REPO/pkg" && printf 'x = 1\n' > "$SBX_REPO/pkg/setup.py"
  SBX_CHANGED="pkg/setup.py" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" != *"SUBDIR DETECTED"* ]]
  [[ "$output" == *"SUBDIR=[]"* ]]
  _teardown_sandbox
}

@test "functional: root package.json + nested module marker is not hijacked (#515)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION"
  printf '{}\n' > "$SBX_REPO/package.json"
  mkdir -p "$SBX_REPO/tools" && printf '{}\n' > "$SBX_REPO/tools/package.json"
  SBX_LANGS="typescript" SBX_CHANGED="tools/app.ts" run bash "$SBX_DRIVE"
  echo "$output"
  [[ "$output" == *"SUBDIR=[]"* ]]
  _teardown_sandbox
}

@test "functional: monorepo without root markers still derives subdir (#515 unchanged behavior)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION"
  mkdir -p "$SBX_REPO/packages/front"
  printf '{}\n' > "$SBX_REPO/packages/front/package.json"
  SBX_LANGS="typescript" SBX_CHANGED="packages/front/app.ts" run bash "$SBX_DRIVE"
  echo "$output"
  [[ "$output" == *"SUBDIR DETECTED"* ]]
  [[ "$output" == *"SUBDIR=[packages/front]"* ]]
  _teardown_sandbox
}

@test "functional: short-circuit is skipped when no changed file is nested (#515 no-op)" {
  _setup_sandbox
  _extract_section "$SBX_SECTION"
  printf '[project]\n' > "$SBX_REPO/pyproject.toml"
  SBX_CHANGED="engine/metrics.py" run bash "$SBX_DRIVE"
  echo "$output"
  [[ "$output" == *"SUBDIR=[]"* ]]
  _teardown_sandbox
}
