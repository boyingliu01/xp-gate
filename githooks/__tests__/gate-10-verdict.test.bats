#!/usr/bin/env bats
# @test REQ-518
# @intent Gate 10 could never block. Two independent causes stacked: (1) semgrep
#         exits 0 even with ERROR-severity findings unless --error is passed,
#         and the old code treated exit 0 as "no findings"; (2) the old red-flag
#         vocabulary (CRITICAL/HIGH) never intersects semgrep's own severity
#         scale (ERROR/WARNING/INFO), so the categorize branch counted 0
#         blocking findings even when it ran. Repro on semgrep 1.168.0: a
#         subprocess-shell=True finding (severity ERROR) in a staged .py file,
#         gate verdict PASS. The verdict now comes from the JSON; the exit code
#         only tells whether the tool itself ran to completion. --error stays
#         unused: its exit-code mapping has drifted across semgrep
#         versions/platforms and the JSON verdict needs nothing from it.
# @covers AC-518-01..13

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-10.sh"
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
  git commit -q -m "seed"
  echo "export const value = 1;" > app.ts
  git add app.ts
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

# Sources gate-10.sh with the stub semgrep on PATH and reports GATE_10_STATUS.
run_gate_with_json_stub() {
  (
    set -u
    cd "$TEST_DIR" || exit 1
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
    GATE_10_STATUS=""
    HOME="$TEST_DIR/no-home"
    PATH="$TEST_DIR/bin:$PATH"
    # shellcheck disable=SC1091
    source "$GATE"
    printf 'STATUS=%s' "$GATE_10_STATUS"
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

@test "AC-518-01: an ERROR-severity finding with exit 0 BLOCKs (the #518 regression)" {
  write_error_finding_json
  write_json_stub "$TEST_DIR/finding-error.json" 0
  run run_gate_with_json_stub "$TEST_DIR/finding-error.json" 0
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED"* ]]
  [[ "$output" == *"subprocess-shell-true"* ]]
  [[ "$output" != *"STATUS=PASS"* ]]
}

@test "AC-518-02: the legacy CRITICAL vocabulary still blocks" {
  cat > "$TEST_DIR/finding-critical.json" << 'JSON'
{"results":[{"check_id":"custom.rule","path":"src/bad.py","start":{"line":2},"extra":{"severity":"CRITICAL","message":"hardcoded credential"}}],"errors":[]}
JSON
  write_json_stub "$TEST_DIR/finding-critical.json" 0
  run run_gate_with_json_stub "$TEST_DIR/finding-critical.json" 0
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "AC-518-03: WARNING/INFO/MEDIUM/LOW findings pass with a visible warning" {
  cat > "$TEST_DIR/finding-warning.json" << 'JSON'
{"results":[{"check_id":"rule.a","path":"src/x.py","start":{"line":1},"extra":{"severity":"WARNING","message":"minor"}},{"check_id":"rule.b","path":"src/y.py","start":{"line":2},"extra":{"severity":"MEDIUM","message":"moderate"}}],"errors":[]}
JSON
  write_json_stub "$TEST_DIR/finding-warning.json" 0
  run run_gate_with_json_stub "$TEST_DIR/finding-warning.json" 0
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=PASS"* ]]
  [[ "$output" == *"non-blocking findings (warnings only)"* ]]
  [[ "$output" == *"rule.a"* ]]
}

@test "AC-518-04: mixed severities BLOCK with both counts shown" {
  cat > "$TEST_DIR/finding-mixed.json" << 'JSON'
{"results":[{"check_id":"rule.err","path":"src/v.py","start":{"line":9},"extra":{"severity":"ERROR","message":"bad"}},{"check_id":"rule.med","path":"src/m.py","start":{"line":3},"extra":{"severity":"MEDIUM","message":"meh"}}],"errors":[]}
JSON
  write_json_stub "$TEST_DIR/finding-mixed.json" 0
  run run_gate_with_json_stub "$TEST_DIR/finding-mixed.json" 0
  [ "$status" -eq 1 ]
  [[ "$output" == *"CRITICAL/HIGH/ERROR:     1  ❌ BLOCKED"* ]]
  [[ "$output" == *"rule.err"* ]]
}

@test "AC-518-05: exit 0 with no findings still PASSes (AC-475-03 contract kept)" {
  cat > "$TEST_DIR/clean.json" << 'JSON'
{"results":[],"errors":[],"paths":{"scanned":["app.ts"]}}
JSON
  write_json_stub "$TEST_DIR/clean.json" 0
  run run_gate_with_json_stub "$TEST_DIR/clean.json" 0
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=PASS"* ]]
}

@test "AC-518-06: nonzero exit + parseable JSON + zero results = runtime failure, SKIP with stderr shown" {
  cat > "$TEST_DIR/errored.json" << 'JSON'
{"results":[],"errors":[{"message":"Invalid scanning root"}]}
JSON
  write_json_stub "$TEST_DIR/errored.json" 2 "semgrep: invalid configuration"
  run run_gate_with_json_stub "$TEST_DIR/errored.json" 2 "semgrep: invalid configuration"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=SKIP"* ]]
  [[ "$output" == *"invalid configuration"* ]]
  [[ "$output" != *"STATUS=PASS"* ]]
}

@test "AC-518-07: exit 0 with unparseable stdout fails closed to SKIP, never PASS" {
  printf 'Segmentation fault (core dumped)\n' > "$TEST_DIR/garbage.txt"
  {
    printf '#!/bin/sh\n'
    printf 'cat "%s"\n' "$TEST_DIR/garbage.txt"
    printf 'exit 0\n'
  } > "$TEST_DIR/bin/semgrep"
  chmod +x "$TEST_DIR/bin/semgrep"
  run run_gate_with_json_stub
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=SKIP"* ]]
  [[ "$output" != *"STATUS=PASS"* ]]
}

@test "AC-518-08: stderr progress noise does not poison the JSON verdict" {
  # The old 2>&1 capture merged semgrep's stderr summary into the JSON; once the
  # verdict depends on parsing, that merge must stay gone.
  write_error_finding_json
  write_json_stub "$TEST_DIR/finding-error.json" 0 " • Findings: 1 (1 blocking)"
  run run_gate_with_json_stub "$TEST_DIR/finding-error.json" 0 " • Findings: 1 (1 blocking)"
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "AC-518-09 anti-vacuity: all three shipped copies carry the warning vocabulary and no --error flag" {
  for f in githooks/gate-10.sh src/npm-package/gate-10.sh src/npm-package/hooks/gate-10.sh; do
    # The warnings-only vocabulary must be present verbatim; anything outside it
    # is counted BLOCKING by the node verdict script (fail-closed on unknown
    # severities, functionally pinned by AC-518-10).
    grep -qF 'WARNING","INFO","MEDIUM","LOW' "$REPO_ROOT/$f" || {
      echo "$f: missing union warning vocabulary" >&2
      return 1
    }
    # The semgrep invocation must NOT gain --error (exit-code semantics drift
    # across versions/platforms; the JSON verdict needs nothing from it).
    if grep 'scan --config=p/security-audit' "$REPO_ROOT/$f" | grep -q -- '--error'; then
      echo "$f: semgrep invocation must not use --error" >&2
      return 1
    fi
  done
}

@test "AC-518-10: an unknown-severity finding BLOCKs (fail-closed on unrecognized tiers)" {
  cat > "$TEST_DIR/finding-unknown.json" << 'JSON'
{"results":[{"check_id":"future.rule","path":"src/z.py","start":{"line":7},"extra":{"severity":"COSMIC","message":"unrecognized severity tier"}}],"errors":[]}
JSON
  write_json_stub "$TEST_DIR/finding-unknown.json" 0
  run run_gate_with_json_stub "$TEST_DIR/finding-unknown.json" 0
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED"* ]]
  [[ "$output" == *"future.rule"* ]]
}

@test "AC-518-11: exit 0 + zero results + nonzero scan errors does NOT pass — it SKIPs" {
  # The R1 residue: semgrep can exit 0 with results:[] while every input failed
  # to parse (errors[] populated). Old behavior: PASS on nothing scanned.
  cat > "$TEST_DIR/all-errored.json" << 'JSON'
{"results":[],"errors":[{"message":"could not parse src/vuln.py"}]}
JSON
  write_json_stub "$TEST_DIR/all-errored.json" 0 "some stderr noise"
  run run_gate_with_json_stub "$TEST_DIR/all-errored.json" 0 "some stderr noise"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=SKIP"* ]]
  [[ "$output" != *"STATUS=PASS"* ]]
}

@test "AC-518-12: a drifted verdict line (missing count fields) fails closed to SKIP" {
  # Simulates the node verdict script's format drifting: PARSE=OK but the
  # BLOCKING/WARNINGS fields are gone. The shell must SKIP, not PASS.
  cat > "$TEST_DIR/clean.json" << 'JSON'
{"results":[]}
JSON
  cat > "$TEST_DIR/bin/node" << STUB
#!/bin/sh
cat > /dev/null
echo "PARSE=OK RESULTS=3"
exit 0
STUB
  chmod +x "$TEST_DIR/bin/node"
  write_json_stub "$TEST_DIR/clean.json" 0
  run run_gate_with_json_stub "$TEST_DIR/clean.json" 0
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=SKIP"* ]]
  [[ "$output" != *"STATUS=PASS"* ]]
}

@test "AC-518-13: node missing from PATH SKIPs up front with an actionable message" {
  write_json_stub "$TEST_DIR/clean.json" 0
  run bash -c '
    cd "$1" || exit 1
    gate_start_ms() { echo 0; }
    record_gate_audit() { :; }
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
    printf "STATUS=%s" "$GATE_10_STATUS"
  ' _ "$TEST_DIR" "$TEST_DIR" "$GATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=SKIP"* ]]
  [[ "$output" == *"node is not installed"* ]]
  [[ "$output" != *"STATUS=PASS"* ]]
}
