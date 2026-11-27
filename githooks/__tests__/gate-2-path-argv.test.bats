#!/usr/bin/env bats
# @test REQ-GATE2-PATH-ARGV
# @intent Gate 2 flattened newline-separated paths into a string and expanded it
#         unquoted. Spaces split one path into several arguments and glob
#         characters can expand, so jscpd scanned the wrong paths while Gate 2
#         still recorded PASS. Unicode itself works; quotes are included to prove
#         exact argv preservation, not because expansion re-parses quote syntax.
# @covers AC-GATE2-PATH-ARGV-01 AC-GATE2-PATH-ARGV-02 AC-GATE2-PATH-ARGV-03

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WORK="$BATS_TEST_TMPDIR/中文 项目"
  mkdir -p "$WORK/src"
  cd "$WORK" || return 1
  ARGS_FILE="$BATS_TEST_TMPDIR/jscpd-args"
  AUDIT_FILE="$BATS_TEST_TMPDIR/audit"
  : > "$ARGS_FILE"
  : > "$AUDIT_FILE"
}

run_gate2() {
  local changed=${2-$'src/含 空格.ts\nsrc/单引号\'文件.ts\nsrc/[literal].ts'}
  G2_LANG="$1" G2_FILES="$changed" G2_ROOT="$REPO" G2_WORK="$WORK" \
  G2_ARGS="$ARGS_FILE" G2_AUDIT="$AUDIT_FILE" bash -c '
    source "$G2_ROOT/githooks/lib/jscpd-run.sh"
    source "$G2_ROOT/githooks/gate-entries/gate-2-entry.sh"
    PROJECT_ROOT="$G2_WORK"
    PROJECT_LANG="$G2_LANG"
    PROJECT_LANGS="$G2_LANG"
    DOCS_ONLY_COMMIT=false
    CHANGED_FILES="$G2_FILES"
    gate_enabled() { return 0; }
    gate_start_ms() { printf 0; }
    require_tool() { return 0; }
    record_gate_audit() { printf "%s|%s\n" "$3" "${6:-}" >> "$G2_AUDIT"; }
    jscpd() {
      printf "%s\0" "$@" > "$G2_ARGS"
      printf "Found 0 clones.\n"
    }
    gate_2_run
  ' 2>&1
}

assert_paths() {
  printf '%s\0' "$@" > "$BATS_TEST_TMPDIR/expected-args"
  cmp "$BATS_TEST_TMPDIR/expected-args" "$ARGS_FILE" || {
    echo "jscpd argv differed; actual arguments:"
    od -An -tx1c "$ARGS_FILE"
    return 1
  }
  [ "$(cat "$AUDIT_FILE")" = "PASS|" ]
}

@test "AC-GATE2-PATH-ARGV-01: TypeScript preserves Unicode, spaces, quotes and glob characters" {
  printf '{"ignore":[]}' > "$WORK/jscpd.conf.json"
  run run_gate2 typescript
  [ "$status" -eq 0 ]
  assert_paths --config "$WORK/jscpd.conf.json" \
    "src/含 空格.ts" "src/单引号'文件.ts" "src/[literal].ts"
}

@test "AC-GATE2-PATH-ARGV-03: real jscpd scans Unicode paths containing spaces" {
  command -v jscpd >/dev/null 2>&1 || skip "jscpd is not installed; run npm install"
  printf '{"ignore":[]}' > "$WORK/jscpd.conf.json"
  local body='export function duplicate(value: number) {
  const doubled = value * 2;
  const tripled = value * 3;
  const summed = doubled + tripled;
  if (summed > 100) return summed - doubled;
  return summed + value;
}
'
  printf '%s%s%s' "$body" "$body" "$body" > "$WORK/src/含 空格.ts"
  printf '%s%s%s' "$body" "$body" "$body" > "$WORK/src/乙.ts"
  local changed=$'src/含 空格.ts\nsrc/乙.ts'
  # shellcheck disable=SC2016 # the child shell expands these variables
  run env PATH="$REPO/node_modules/.bin:$PATH" \
    G2_ROOT="$REPO" G2_WORK="$WORK" G2_FILES="$changed" G2_AUDIT="$AUDIT_FILE" bash -c '
      source "$G2_ROOT/githooks/lib/jscpd-run.sh"
      source "$G2_ROOT/githooks/gate-entries/gate-2-entry.sh"
      PROJECT_ROOT="$G2_WORK"
      PROJECT_LANG=typescript
      PROJECT_LANGS=typescript
      DOCS_ONLY_COMMIT=false
      CHANGED_FILES="$G2_FILES"
      gate_enabled() { return 0; }
      gate_start_ms() { printf 0; }
      require_tool() { return 0; }
      record_gate_audit() { printf "%s|%s\n" "$3" "${6:-}" >> "$G2_AUDIT"; }
      gate_2_run
    ' 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"found duplicated code"* ]] || {
    echo "real jscpd did not find the duplicate; output was:"
    printf '%s\n' "$output"
    return 1
  }
  [ "$(cat "$AUDIT_FILE")" = "PASS|" ]
}

@test "AC-GATE2-PATH-ARGV-02: generic languages preserve each changed path as one argument" {
  run run_gate2 rust
  [ "$status" -eq 0 ]
  assert_paths "src/含 空格.ts" "src/单引号'文件.ts" "src/[literal].ts"
}

@test "AC-GATE2-EMPTY-ARGV-04: an empty TypeScript scan list remains nounset-safe" {
  printf '{"ignore":[]}' > "$WORK/jscpd.conf.json"
  run run_gate2 typescript ""
  [ "$status" -eq 0 ]
  assert_paths --config "$WORK/jscpd.conf.json"
}

@test "AC-GATE2-EMPTY-ARGV-05: TypeScript keeps guarded empty-array expansions" {
  local expected='jscpd ${JSCPD_ARGS[@]+"${JSCPD_ARGS[@]}"} ${JSCPD_SCAN_FILES[@]+"${JSCPD_SCAN_FILES[@]}"}'
  local copy
  for copy in "$REPO/githooks/gate-entries/gate-2-entry.sh" \
              "$REPO/src/npm-package/hooks/gate-entries/gate-2-entry.sh"; do
    grep -Fq "$expected" "$copy"
  done
}

@test "AC-GATE2-MIRROR-06: the npm Gate 2 copy stays byte-identical" {
  cmp -s "$REPO/githooks/gate-entries/gate-2-entry.sh" \
    "$REPO/src/npm-package/hooks/gate-entries/gate-2-entry.sh"
}

@test "AC-GATE2-EMPTY-ARGV-07: generic jscpd keeps guarded empty-array expansion" {
  local expected='jscpd ${GENERIC_JSCPD_FILES[@]+"${GENERIC_JSCPD_FILES[@]}"}'
  local copy
  for copy in "$REPO/githooks/gate-entries/gate-2-entry.sh" \
              "$REPO/src/npm-package/hooks/gate-entries/gate-2-entry.sh"; do
    grep -Fq "$expected" "$copy"
  done
}
