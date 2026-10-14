#!/usr/bin/env bats
# @test REQ-A-02
# @intent #532: the #518 SAST fix (v0.21.0) landed on gate-10.sh and the TS entry
#         (src/gates/gate-9.ts), but the three legacy gate-9.sh fallback copies
#         still carry both root causes: (1) semgrep exit 0 is treated as "no
#         findings" although semgrep exits 0 even with ERROR-severity findings
#         unless --error is passed; (2) the CRITICAL/HIGH-only vocabulary never
#         intersects semgrep's own ERROR/WARNING/INFO scale. They stay reachable:
#         resolveGateScript(9) hits githooks/gates/gate-9-sast-security.sh first
#         in a TS-less repo checkout, githooks/gate-9.sh second, and the globally
#         installed ~/.config/xp-gate/adapters/gate-9.sh third (npm deployments).
#         gates/gate-9-sast-security.sh additionally carries a copy-paste
#         artifact: it sets GATE_10_STATUS, so a caller reading GATE_9_STATUS
#         after sourcing it sees an empty verdict. These tests pin gate-10.sh's
#         verdict semantics (JSON verdict, union vocabulary, fail-closed on
#         unknown/missing severity, stdout/stderr separation, node guard,
#         errors[] accounting, unparseable -> SKIP never PASS) on ALL THREE
#         copies, plus byte parity of the verdict block across them and the
#         invariant markers across all six shipped copies (3 repo + 3 npm
#         mirrors).
# @covers AC-A-02-01, AC-A-02-02, AC-A-02-03, AC-A-02-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-9.sh"
  GATE_GATES="$REPO_ROOT/githooks/gates/gate-9-sast-security.sh"
  GATE_ADAPTERS="$REPO_ROOT/githooks/adapters/gate-9.sh"
  TEST_DIR="$(mktemp -d)"

  mkdir -p "$TEST_DIR/bin"
  cd "$TEST_DIR" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  # Without this, the machine-wide core.hooksPath runs the real gate suite on every
  # fixture commit.
  git config core.hooksPath .git/hooks
  echo "seed" > README.md
  git add README.md
  git commit --no-verify -q -m "seed"
  echo "export const value = 1;" > app.ts
  git add app.ts
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# The three live fallback copies, in resolveGateScript(9) reach order.
all_gate_copies() {
  printf '%s\n' "$GATE" "$GATE_GATES" "$GATE_ADAPTERS"
}

# Sources the given gate copy with the stub semgrep on PATH and reports both
# status variables — GATE_9_STATUS (what a gate-9 caller reads) and
# GATE_10_STATUS (what the gates/ copy wrongly wrote before the #532 fix).
run_gate_with_json_stub() {
  local gate="$1"
  (
    set -u
    cd "$TEST_DIR" || exit 1
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    GATE_9_STATUS=""
    GATE_10_STATUS=""
    HOME="$TEST_DIR/no-home"
    PATH="$TEST_DIR/bin:$PATH"
    # shellcheck disable=SC1091
    source "$gate"
    printf 'STATUS_9=[%s] STATUS_10=[%s]' "$GATE_9_STATUS" "$GATE_10_STATUS"
  )
}

write_json_stub() {
  local json_file="$1" exit_code="$2" stderr_msg="${3:-}"
  {
    printf '#!/bin/sh\n'
    printf 'cat "%s"\n' "$json_file"
    if [ -n "$stderr_msg" ]; then
      printf 'printf "%%s\\n" "%s" >&2\n' "$stderr_msg"
    fi
    printf 'exit %s\n' "$exit_code"
  } > "$TEST_DIR/bin/semgrep"
  chmod +x "$TEST_DIR/bin/semgrep"
}

# One ERROR finding: subprocess with shell=True — the exact repro from #518.
write_error_finding_json() {
  cat > "$TEST_DIR/finding-error.json" << 'JSON'
{"results":[{"check_id":"python.lang.security.audit.subprocess-shell-true","path":"src/vuln.py","start":{"line":5},"extra":{"severity":"ERROR","message":"subprocess call with shell=True identified, security issue."}}],"errors":[]}
JSON
}

@test "AC-A-02-01: an ERROR-severity finding with exit 0 BLOCKs in all three copies (the #518 regression)" {
  write_error_finding_json
  write_json_stub "$TEST_DIR/finding-error.json" 0
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 1 ] || { echo "$gate: expected exit 1, got $status — output: $output"; return 1; }
    [[ "$output" == *"BLOCKED"* ]] || { echo "$gate: no BLOCKED banner"; return 1; }
    [[ "$output" == *"subprocess-shell-true"* ]] || { echo "$gate: finding not shown"; return 1; }
    [[ "$output" != *"STATUS_9=[PASS]"* ]] || { echo "$gate: silent PASS on ERROR finding"; return 1; }
  done < <(all_gate_copies)
}

@test "AC-A-02-02a: an unknown severity tier BLOCKs (fail-closed) in all three copies" {
  cat > "$TEST_DIR/finding-unknown.json" << 'JSON'
{"results":[{"check_id":"future.rule","path":"src/z.py","start":{"line":7},"extra":{"severity":"COSMIC","message":"unrecognized severity tier"}}],"errors":[]}
JSON
  write_json_stub "$TEST_DIR/finding-unknown.json" 0
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 1 ] || { echo "$gate: expected exit 1, got $status — output: $output"; return 1; }
    [[ "$output" == *"BLOCKED"* ]] || { echo "$gate: unknown severity did not fail closed"; return 1; }
    [[ "$output" == *"future.rule"* ]] || { echo "$gate: finding not shown"; return 1; }
  done < <(all_gate_copies)
}

@test "AC-A-02-02b: a MISSING severity field BLOCKs (fail-closed) in all three copies" {
  cat > "$TEST_DIR/finding-nosev.json" << 'JSON'
{"results":[{"check_id":"no.severity.rule","path":"src/x.py","start":{"line":1},"extra":{"message":"no severity field at all"}}],"errors":[]}
JSON
  write_json_stub "$TEST_DIR/finding-nosev.json" 0
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 1 ] || { echo "$gate: expected exit 1, got $status — output: $output"; return 1; }
    [[ "$output" == *"BLOCKED"* ]] || { echo "$gate: missing severity did not fail closed"; return 1; }
    [[ "$output" == *"no.severity.rule"* ]] || { echo "$gate: finding not shown"; return 1; }
  done < <(all_gate_copies)
}

@test "AC-A-02-03a: exit 0 with unparseable stdout SKIPs with diagnostics, never PASSes, in all three copies" {
  printf 'Segmentation fault (core dumped)\n' > "$TEST_DIR/garbage.txt"
  {
    printf '#!/bin/sh\n'
    printf 'cat "%s"\n' "$TEST_DIR/garbage.txt"
    printf 'exit 0\n'
  } > "$TEST_DIR/bin/semgrep"
  chmod +x "$TEST_DIR/bin/semgrep"
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 0 ] || { echo "$gate: expected exit 0 (SKIP), got $status"; return 1; }
    [[ "$output" == *"STATUS_9=[SKIP]"* ]] || { echo "$gate: expected SKIP — output: $output"; return 1; }
    [[ "$output" != *"STATUS_9=[PASS]"* ]] || { echo "$gate: silent PASS on unparseable output"; return 1; }
  done < <(all_gate_copies)
}

@test "AC-A-02-03b: exit 0 + zero results + nonzero scan errors SKIPs, never PASSes, in all three copies" {
  # semgrep can exit 0 with results:[] while every input failed to parse
  # (errors[] populated). Old behavior: PASS on nothing scanned.
  cat > "$TEST_DIR/all-errored.json" << 'JSON'
{"results":[],"errors":[{"message":"could not parse src/vuln.py"}]}
JSON
  write_json_stub "$TEST_DIR/all-errored.json" 0 "some stderr noise"
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 0 ] || { echo "$gate: expected exit 0 (SKIP), got $status"; return 1; }
    [[ "$output" == *"STATUS_9=[SKIP]"* ]] || { echo "$gate: expected SKIP — output: $output"; return 1; }
    [[ "$output" != *"STATUS_9=[PASS]"* ]] || { echo "$gate: silent PASS with only scan errors"; return 1; }
  done < <(all_gate_copies)
}

@test "AC-A-02-03c: node missing from PATH SKIPs up front with an actionable message in all three copies" {
  # Without node the JSON verdict cannot be classified; the old copies invoked
  # node only inside the exit-1 branch, so a node-less machine silently PASSed
  # every scan (or counted 0 blocking findings on exit 1).
  write_json_stub "$TEST_DIR/finding-error.json" 0
  while IFS= read -r gate; do
    run bash -c '
      cd "$1" || exit 1
      gate_start_ms() { echo 0; }
      record_gate_audit() { :; }
      GATE_9_STATUS=""
      GATE_10_STATUS=""
      HOME="$2/no-home"
      # Keep git on PATH (the gate lists staged files) but drop node: git ships
      # from its own directory, node from the managed runtime — dir-split works.
      GIT_DIR="$(dirname "$(command -v git)")"
      PATH="$1/bin:$GIT_DIR:/usr/bin:/bin"
      export PATH
      if command -v node >/dev/null 2>&1; then
        echo "fixture broken: node still resolvable" >&2
        exit 99
      fi
      source "$3"
      printf "STATUS_9=[%s] STATUS_10=[%s]" "$GATE_9_STATUS" "$GATE_10_STATUS"
    ' _ "$TEST_DIR" "$TEST_DIR" "$gate"
    [ "$status" -eq 0 ] || { echo "$gate: expected exit 0 (SKIP), got $status — output: $output"; return 1; }
    [[ "$output" == *"STATUS_9=[SKIP]"* ]] || { echo "$gate: expected SKIP without node — output: $output"; return 1; }
    [[ "$output" == *"node is not installed"* ]] || { echo "$gate: no actionable node message"; return 1; }
    [[ "$output" != *"STATUS_9=[PASS]"* ]] || { echo "$gate: silent PASS without node"; return 1; }
  done < <(all_gate_copies)
}

@test "kept contract: exit 0 with no findings still PASSes in all three copies (AC-475-03); gates copy writes GATE_9_STATUS, never GATE_10_STATUS" {
  cat > "$TEST_DIR/clean.json" << 'JSON'
{"results":[],"errors":[],"paths":{"scanned":["app.ts"]}}
JSON
  write_json_stub "$TEST_DIR/clean.json" 0
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 0 ] || { echo "$gate: expected exit 0, got $status"; return 1; }
    [[ "$output" == *"STATUS_9=[PASS]"* ]] || { echo "$gate: expected STATUS_9=[PASS] — output: $output"; return 1; }
    [[ "$output" == *"STATUS_10=[]"* ]] || { echo "$gate: wrote GATE_10_STATUS (copy-paste artifact)"; return 1; }
  done < <(all_gate_copies)
}

@test "kept contract: the legacy CRITICAL vocabulary still blocks with exit 0 in all three copies" {
  cat > "$TEST_DIR/finding-critical.json" << 'JSON'
{"results":[{"check_id":"custom.rule","path":"src/bad.py","start":{"line":2},"extra":{"severity":"CRITICAL","message":"hardcoded credential"}}],"errors":[]}
JSON
  write_json_stub "$TEST_DIR/finding-critical.json" 0
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 1 ] || { echo "$gate: expected exit 1, got $status — output: $output"; return 1; }
    [[ "$output" == *"BLOCKED"* ]] || { echo "$gate: CRITICAL finding did not block"; return 1; }
  done < <(all_gate_copies)
}

@test "kept contract: WARNING/MEDIUM findings pass with a visible warning in all three copies" {
  cat > "$TEST_DIR/finding-warning.json" << 'JSON'
{"results":[{"check_id":"rule.a","path":"src/x.py","start":{"line":1},"extra":{"severity":"WARNING","message":"minor"}},{"check_id":"rule.b","path":"src/y.py","start":{"line":2},"extra":{"severity":"MEDIUM","message":"moderate"}}],"errors":[]}
JSON
  write_json_stub "$TEST_DIR/finding-warning.json" 0
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 0 ] || { echo "$gate: expected exit 0, got $status"; return 1; }
    [[ "$output" == *"STATUS_9=[PASS]"* ]] || { echo "$gate: expected PASS — output: $output"; return 1; }
    [[ "$output" == *"warnings only"* ]] || { echo "$gate: warnings not surfaced"; return 1; }
    [[ "$output" == *"rule.a"* ]] || { echo "$gate: warning finding not shown"; return 1; }
  done < <(all_gate_copies)
}

@test "mixed severities BLOCK with both counts shown in all three copies" {
  cat > "$TEST_DIR/finding-mixed.json" << 'JSON'
{"results":[{"check_id":"rule.err","path":"src/v.py","start":{"line":9},"extra":{"severity":"ERROR","message":"bad"}},{"check_id":"rule.med","path":"src/m.py","start":{"line":3},"extra":{"severity":"MEDIUM","message":"meh"}}],"errors":[]}
JSON
  write_json_stub "$TEST_DIR/finding-mixed.json" 0
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 1 ] || { echo "$gate: expected exit 1, got $status"; return 1; }
    [[ "$output" == *"CRITICAL/HIGH/ERROR:     1  ❌ BLOCKED"* ]] || { echo "$gate: blocking count line drifted — output: $output"; return 1; }
    [[ "$output" == *"MEDIUM/LOW/WARNING/INFO: 1"* ]] || { echo "$gate: warning count line drifted"; return 1; }
    [[ "$output" == *"rule.err"* ]] || { echo "$gate: finding not shown"; return 1; }
  done < <(all_gate_copies)
}

@test "stderr progress noise does not poison the JSON verdict in all three copies" {
  # The old 2>&1 capture merged semgrep's stderr summary into the JSON the
  # verdict depends on; the ported copies capture the streams separately.
  write_error_finding_json
  write_json_stub "$TEST_DIR/finding-error.json" 0 " • Findings: 1 (1 blocking)"
  while IFS= read -r gate; do
    run run_gate_with_json_stub "$gate"
    [ "$status" -eq 1 ] || { echo "$gate: expected exit 1, got $status — output: $output"; return 1; }
    [[ "$output" == *"BLOCKED"* ]] || { echo "$gate: stderr noise swallowed the verdict"; return 1; }
  done < <(all_gate_copies)
}

# Extract the verdict node script (start marker through the fail-closed
# fallback line) from a gate copy. Returns 1 when a marker is missing.
verdict_block_of() {
  local f="$1" s e
  s=$(grep -nF 'SEMGREP_VERDICT=$(node' "$f" | head -1 | cut -d: -f1)
  e=$(grep -n 'WARNINGS=0"$' "$f" | head -1 | cut -d: -f1)
  if [ -z "$s" ] || [ -z "$e" ] || [ "$s" -gt "$e" ]; then
    return 1
  fi
  sed -n "${s},${e}p" "$f"
}

@test "AC-A-02-04a: the verdict block is byte-identical across the three repo copies" {
  verdict_block_of "$GATE" > "$TEST_DIR/vb-canonical" || {
    echo "githooks/gate-9.sh: verdict block markers missing"
    return 1
  }
  [ -s "$TEST_DIR/vb-canonical" ] || { echo "empty verdict block"; return 1; }
  for f in "$GATE_GATES" "$GATE_ADAPTERS"; do
    if ! verdict_block_of "$f" > "$TEST_DIR/vb-other"; then
      echo "$f: verdict block markers missing"
      return 1
    fi
    if ! diff -u "$TEST_DIR/vb-canonical" "$TEST_DIR/vb-other"; then
      echo "$f: verdict block drifted from githooks/gate-9.sh"
      return 1
    fi
  done
}

@test "AC-A-02-04b: all six shipped copies carry the invariant markers and no --error flag" {
  # The three repo sources plus the three npm mirrors (sync-package-content.js
  # copies githooks/gate-9.sh to package root AND hooks/, and
  # githooks/adapters/gate-9.sh to adapters/).
  local copies=(
    "$REPO_ROOT/githooks/gate-9.sh"
    "$REPO_ROOT/githooks/gates/gate-9-sast-security.sh"
    "$REPO_ROOT/githooks/adapters/gate-9.sh"
    "$REPO_ROOT/src/npm-package/gate-9.sh"
    "$REPO_ROOT/src/npm-package/hooks/gate-9.sh"
    "$REPO_ROOT/src/npm-package/adapters/gate-9.sh"
  )
  for f in "${copies[@]}"; do
    [ -f "$f" ] || { echo "$f: missing"; return 1; }
    # The warnings-only vocabulary must be present verbatim; anything outside it
    # is counted BLOCKING (fail-closed on unknown severities).
    grep -qF 'WARNV=["WARNING","INFO","MEDIUM","LOW"]' "$f" || {
      echo "$f: missing union warning vocabulary"
      return 1
    }
    # stdout and stderr must be captured separately (the old 2>&1 merge poisoned
    # the JSON the verdict is parsed from).
    grep -qF '2>&1 >"$SEMGREP_STDOUT_FILE"' "$f" || {
      echo "$f: stdout/stderr not captured separately"
      return 1
    }
    # node is a hard dependency of the verdict — checked before spending a scan.
    grep -qF 'command -v node >/dev/null 2>&1' "$f" || {
      echo "$f: missing node hard-dependency guard"
      return 1
    }
    # One path per array element with ./ prefix (spaces intact, leading '-' safe).
    grep -qF 'SEMGREP_ARGS+=("./$_semgrep_file")' "$f" || {
      echo "$f: missing array-based file passing"
      return 1
    }
    # Parse failure degrades to the fail-closed fallback line.
    grep -qF 'PARSE=FAIL RESULTS=0 ERRORS=0 BLOCKING=0 WARNINGS=0' "$f" || {
      echo "$f: missing fail-closed parse fallback"
      return 1
    }
    # The semgrep invocation must NOT gain --error (exit-code semantics drift
    # across versions/platforms; the JSON verdict needs nothing from it).
    if grep 'scan --config=p/security-audit' "$f" | grep -q -- '--error'; then
      echo "$f: semgrep invocation must not use --error"
      return 1
    fi
  done
}
