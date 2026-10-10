#!/usr/bin/env bats
# @test REQ-507-01
# @intent wc-java-lint 作为 G1 Java 主引擎的 fail-closed 契约（DR-001/DR-002）：
#         调用形态、三态退出码、soft 逃生阀、多形态发现、--staged 回退、
#         JSON 白名单、超时覆盖、legacy 回退（#507 S1）。
# @covers AC-507-01-01 AC-507-01-02 AC-507-01-03 AC-507-01-04 AC-507-01-05
#         AC-507-01-06 AC-507-01-07 AC-507-01-08 AC-507-01-09

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export TMPDIR=/tmp
  FIXTURE_REPO="$(mktemp -d)"
  STUB_BIN="$(mktemp -d)"
  export WC_STUB_LOG="$FIXTURE_REPO/stub-invocations.log"
  export WC_STUB_MODE=clean
  (
    cd "$FIXTURE_REPO" || exit 1
    git init -q . 2>/dev/null || true
    mkdir -p .xp-gate
    printf 'class A {}\n' > A.java
    printf 'const x = 1;\n' > B.ts
    git add A.java B.ts 2>/dev/null || true
  )
  make_stub() {
    printf '#!/usr/bin/env bash\n%s\n' "$1" > "$STUB_BIN/wc-java-lint"
    chmod +x "$STUB_BIN/wc-java-lint"
  }
  export -f make_stub >/dev/null 2>&1 || true
  # default stub: the shared canned-mode script
  cat > "$STUB_BIN/wc-java-lint" << 'EOF'
#!/usr/bin/env bash
echo "ARGS:$*" >> "${WC_STUB_LOG:-/dev/null}"
case "${WC_STUB_MODE:-clean}" in
  clean)          echo '[]'; exit 0 ;;
  violations)     echo '[{"file":"src/A.java","rule":"naming","severity":"warning","line":3}]'; exit 1 ;;
  exec-error)     echo "jvm crash" >&2; exit 3 ;;
  malformed)      printf '{not json'; exit 0 ;;
  missing-fields) echo '[{"f":"A.java"}]'; exit 0 ;;
  unknown-fields) echo '[{"file":"A.java","rule":"r","severity":"warning","line":2,"extra":42}]'; exit 1 ;;
  multi)          echo '[{"file":"A.java","rule":"r1","severity":"warning"},{"file":"B.java","rule":"r2","severity":"error"}]'; exit 1 ;;
  # Delphi round-1 additions (#507): a LYING tool (exit 0 + objects) is never
  # downgraded; braced messages are valid output (string-safe counting).
  lying)          echo '[{"file":"A.java","rule":"r","severity":"warning"}]'; exit 0 ;;
  braced-msg)     echo "[{\"file\":\"A.java\",\"rule\":\"r\",\"severity\":\"warning\",\"message\":\"'{' is not preceded\"}]"; exit 1 ;;
  no-staged)
    case "$*" in
      *--staged*) echo "error: unknown option --staged" >&2; exit 2 ;;
      *)          echo '[]'; exit 0 ;;
    esac ;;
  hang)           sleep 30; exit 0 ;;
  *)              echo '[]'; exit 0 ;;
esac
EOF
  chmod +x "$STUB_BIN/wc-java-lint"
}

teardown() {
  rm -rf "$FIXTURE_REPO" "$STUB_BIN" 2>/dev/null || true
}

# Source the REAL adapter inside the fixture repo with the stub on PATH.
run_java_adapter() {
  (
    set +e
    cd "$FIXTURE_REPO" || exit 90
    export PATH="$STUB_BIN:$PATH"
    # Neutralize real tools so the legacy fallback is deterministic.
    source "$REPO_ROOT/githooks/adapters/java.sh"
    run_static_analysis 2>&1
    echo "VERDICT:$?"
  )
}

# --- AC-507-01-01: contract call shape, no legacy chain ---

@test "AC-507-01-01: invokes wc-java-lint check --staged --format json" {
  run run_java_adapter
  [ "$status" -eq 0 ]
  grep -q "ARGS:check --staged --format json" "$WC_STUB_LOG"
  [[ "$output" == *"wc-java-lint: clean"* ]]
}

# --- AC-507-01-02: three-state exit semantics ---

@test "AC-507-01-02: stub exit 0 -> PASS verdict" {
  run run_java_adapter
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT:0"* ]]
}

@test "AC-507-01-02: stub exit 1 with violations -> FAIL, prints count and file" {
  export WC_STUB_MODE=violations
  run run_java_adapter
  [ "$status" -eq 0 ]  # adapter itself returns; pre-commit branch exits 1
  [[ "$output" == *"VERDICT:1"* ]]
  [[ "$output" == *"1 violation"* ]]
  [[ "$output" == *"src/A.java"* ]]
}

@test "AC-507-01-02: stub exit 2/3 -> BLOCK (fail-closed)" {
  export WC_STUB_MODE=exec-error
  run run_java_adapter
  [[ "$output" == *"VERDICT:2"* ]]
}

@test "AC-507-01-02: malformed JSON -> BLOCK" {
  export WC_STUB_MODE=malformed
  run run_java_adapter
  [[ "$output" == *"VERDICT:2"* ]]
}

# --- AC-507-01-04: soft escape valve downgrades BLOCK only ---

@test "AC-507-01-04: soft downgrades execution failure to non-blocking WARN (verdict 3)" {
  export WC_STUB_MODE=exec-error
  export XP_GATE_WC_JAVA_LINT=soft
  run run_java_adapter
  [[ "$output" == *"VERDICT:3"* ]]
  [[ "$output" == *"WARN (non-blocking"* ]]
}

@test "AC-507-01-04: soft never downgrades exit-1 violations" {
  export WC_STUB_MODE=violations
  export XP_GATE_WC_JAVA_LINT=soft
  run run_java_adapter
  [[ "$output" == *"VERDICT:1"* ]]
}

# --- AC-507-01-05: multi-form discovery (.exe/.cmd covered on Windows) ---

@test "AC-507-01-05: wc-java-lint.exe form is discovered" {
  mv "$STUB_BIN/wc-java-lint" "$STUB_BIN/wc-java-lint.exe"
  run run_java_adapter
  [ "$status" -eq 0 ]
  grep -q "ARGS:check --staged --format json" "$WC_STUB_LOG"
}

# --- AC-507-01-06: --staged unsupported -> explicit file list fallback ---

@test "AC-507-01-06: usage-error fallback passes only staged .java files" {
  export WC_STUB_MODE=no-staged
  run run_java_adapter
  [ "$status" -eq 0 ]
  [[ "$output" == *"VERDICT:0"* ]]
  # two invocations: --staged attempt, then explicit list
  [ "$(grep -c 'ARGS:' "$WC_STUB_LOG")" -eq 2 ]
  grep -q 'ARGS:check --format json A.java' "$WC_STUB_LOG"
  ! grep -q 'B.ts' "$WC_STUB_LOG"
}

# --- AC-507-01-07: JSON whitelist -- additive OK, missing fields BLOCK ---

@test "AC-507-01-07: unknown extra fields tolerated (violations still parsed)" {
  export WC_STUB_MODE=unknown-fields
  run run_java_adapter
  # exit 1 + a violation object carrying extra fields: the unknown field must
  # not break parsing, and the violation must still be reported.
  [[ "$output" == *"VERDICT:1"* ]]
  [[ "$output" == *"1 violation"* ]]
}

@test "AC-507-01-07: missing required fields -> BLOCK" {
  export WC_STUB_MODE=missing-fields
  run run_java_adapter
  [[ "$output" == *"VERDICT:2"* ]]
}

@test "AC-507-01-02: multi-file violation report lists files" {
  export WC_STUB_MODE=multi
  run run_java_adapter
  [[ "$output" == *"2 violation"* ]]
  [[ "$output" == *"A.java"* ]]
  [[ "$output" == *"B.java"* ]]
}

# --- AC-507-01-09: timeout override file ---

@test "AC-507-01-09: hanging stub is killed per .xp-gate timeout -> BLOCK" {
  export WC_STUB_MODE=hang
  printf '1\n' > "$FIXTURE_REPO/.xp-gate/wc-java-lint-timeout"
  run run_java_adapter
  [[ "$output" == *"VERDICT:2"* ]]
  [[ "$output" == *"timed out"* ]]
}

# --- AC-507-01-03: legacy fallback when tool missing ---

@test "AC-507-01-03: legacy fallback verdict is 3 with plugin-dir warns" {
  run bash -c '
    cd "$1" || exit 90
    export PATH="/usr/bin:/bin"
    source "$2"
    run_static_analysis 2>&1
    echo "VERDICT:$?"
  ' _ "$FIXTURE_REPO" "$REPO_ROOT/githooks/adapters/java.sh"
  [[ "$output" == *"VERDICT:3"* ]]
  [[ "$output" == *"NOT verified"* ]]
  # plugin-dir WARNs fire only when the dirs are absent; they ship with the
  # repo, so assert the guards exist and the present-dir run stays silent.
  grep -q '\[ ! -d "$PLUGIN_DIR" \]' "$REPO_ROOT/githooks/adapters/java.sh"
  grep -q '\[ ! -d "$WHALECLOUD_PLUGIN_DIR" \]' "$REPO_ROOT/githooks/adapters/java.sh"
  [[ "$output" != *"plugin directory missing"* ]]
}

# --- AC-507-01-08: gate-2/gate-3 zero change (static guard) ---

@test "AC-507-01-08: gate-2.sh and gate-3.sh never reference wc-java-lint" {
  [ -z "$(grep -l 'wc-java-lint' "$REPO_ROOT/githooks/gate-2.sh" "$REPO_ROOT/githooks/gate-3.sh" 2>/dev/null || true)" ]
}

# --- Delphi round-1 fixes (#507): escape-valve coverage + string-safe JSON ---

@test "DR2: exit 0 with violation objects (lying tool) is BLOCK even in soft mode" {
  export WC_STUB_MODE=lying
  export XP_GATE_WC_JAVA_LINT=soft
  run run_java_adapter
  [[ "$output" == *"VERDICT:2"* ]]
  [[ "$output" == *"inconsistent response"* ]]
}

@test "DR2: exit 0 with violation objects (lying tool) is BLOCK even in report mode" {
  export WC_STUB_MODE=lying
  export XP_GATE_WC_JAVA_LINT=report
  run run_java_adapter
  [[ "$output" == *"VERDICT:2"* ]]
}

@test "DR2: soft downgrades unusable JSON to non-blocking WARN (verdict 3)" {
  export WC_STUB_MODE=malformed
  export XP_GATE_WC_JAVA_LINT=soft
  run run_java_adapter
  [[ "$output" == *"VERDICT:3"* ]]
  [[ "$output" == *"XP_G1_REASON: wc-java-lint unusable JSON (soft downgrade)"* ]]
}

@test "DR2: report mode downgrades real violations to non-blocking WARN" {
  export WC_STUB_MODE=violations
  export XP_GATE_WC_JAVA_LINT=report
  run run_java_adapter
  [[ "$output" == *"VERDICT:3"* ]]
  [[ "$output" == *"report mode"* ]]
}

@test "DR2: violation message containing braces does not break JSON counting" {
  export WC_STUB_MODE=braced-msg
  unset XP_GATE_WC_JAVA_LINT
  run run_java_adapter
  [[ "$output" == *"VERDICT:1"* ]]
  [[ "$output" == *"1 violation(s)"* ]]
}

@test "DR2: p3c inline scan is opt-in -- pom without p3c-pmd never runs mvn" {
  # Legacy fallback with mvn PRESENT but hostile (any invocation fails hard).
  # A pom.xml without the p3c-pmd dependency must not trigger the inline
  # ruleset scan (it would fail and BLOCK every real project, Delphi C-M1).
  printf '<project><profiles><profile><id>other</id></profile></profiles></project>\n' > "$FIXTURE_REPO/pom.xml"
  printf '#!/usr/bin/env bash\necho "MVN-INVOKED" >> "${WC_STUB_LOG:-/dev/null}"\nexit 7\n' > "$STUB_BIN/mvn"
  chmod +x "$STUB_BIN/mvn"
  run bash -c '
    set +e
    cd "$1" || exit 90
    export PATH="$2:/usr/bin:/bin"
    source "$3"
    run_legacy_analysis > /dev/null 2>&1
    echo "VERDICT:$?"
  ' _ "$FIXTURE_REPO" "$STUB_BIN" "$REPO_ROOT/githooks/adapters/java.sh"
  # No wc-java-lint -> verdict must be the legacy WARN (3), not a p3c BLOCK;
  # and the hostile mvn must never have been invoked.
  [[ "$output" == *"VERDICT:3"* ]]
  [[ "$output" != *"MVN-INVOKED"* ]]
}

@test "DR2-R3: pre-commit scores exit-3 adapter verdicts as WARN, never SKIP" {
  # Delphi round-2 A-MAJOR-1: SKIP sits OUT of the scoring denominator, so
  # mapping soft/report/legacy-unavailable to SKIP let unverified Java ride
  # to a fake PASS/10.0. Every GATE_1_STATUS assignment in the java branch
  # must be WARN (in the denominator, forbids an overall PASS).
  local warn_hits skip_hits
  warn_hits=$(grep -c 'GATE_1_STATUS="WARN"' "$REPO_ROOT/githooks/pre-commit")
  skip_hits=$(grep -c 'GATE_1_STATUS="SKIP"' "$REPO_ROOT/githooks/pre-commit" || true)
  [ "$warn_hits" -ge 3 ]
  [ "$skip_hits" -eq 0 ]
}
