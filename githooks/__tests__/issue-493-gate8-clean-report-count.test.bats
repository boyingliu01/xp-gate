#!/usr/bin/env bats
# @test REQ-493
# @intent Gate 8 从 JSON 报告读取"发现数"时，零发现必须只得到一个值：`grep -c` 在零匹配
#         时既打印 0 又以 1 退出，`|| echo 0` 于是追加出第二行，判决表里三个字符串比较
#         全部落空，干净扫描被当成"有发现"而 exit 1（#493）。本套件跑的是从生产文件
#         抽出的那行表达式本身，不是它的誊写 —— 之前的测试正是逐字誊写了缺陷。
# @covers AC-493-01, AC-493-02, AC-493-03, AC-493-04, AC-493-05, AC-493-06, AC-493-07, AC-493-08

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export REPO_ROOT
}

# Extract the shipped assignment and run THAT text against an artifact.
count_with_shipped_expression() {
  local artifact="$1" line
  line=$(sed -n 's/^[[:space:]]*GITLEAKS_FINDINGS=\(.*\)$/\1/p' \
           "$REPO_ROOT/githooks/gate-8.sh" | grep -v '^"?"$' | head -1)
  if [ -z "$line" ]; then
    echo "could not extract the counting expression from githooks/gate-8.sh" >&2
    return 91
  fi
  local GITLEAKS_REPORT="$artifact"
  local GITLEAKS_FINDINGS
  eval "GITLEAKS_FINDINGS=$line"
  printf '%s' "$GITLEAKS_FINDINGS"
}

# AC-493-01: the value is what the gate string-compares, so a second line here
# is not cosmetic -- it silently turns every clean scan into a BLOCK.
@test "AC-493-01: a clean [] report yields exactly one zero" {
  empty="$BATS_TEST_TMPDIR/empty.json"
  printf '[]\n' > "$empty"

  run count_with_shipped_expression "$empty"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
  [[ "$output" != *$'\n'* ]]
}

@test "AC-493-02: two findings packed on one line count as two" {
  two="$BATS_TEST_TMPDIR/two.json"
  printf '[{"RuleID":"github-pat"},{"RuleID":"slack-token"}]\n' > "$two"

  run count_with_shipped_expression "$two"
  [ "$status" -eq 0 ]
  [ "$output" = "2" ]
}

# A hand-written fixture can drift from the tool; this one asks gitleaks itself.
@test "AC-493-03: the real gitleaks clean-scan artifact counts as zero" {
  command -v gitleaks >/dev/null 2>&1 || skip "gitleaks not installed"

  work="$BATS_TEST_TMPDIR/clean"
  mkdir -p "$work"
  cd "$work" || return 1
  git init -q .
  git config core.hooksPath /dev/null
  git config user.email t@t.t
  git config user.name t
  git commit -q --allow-empty -m init
  printf 'const x = 1\n' > ok.ts
  git add ok.ts

  gitleaks git --staged --redact --no-banner --report-format=json \
    --report-path="$BATS_TEST_TMPDIR/real.json" >/dev/null 2>&1
  [ -f "$BATS_TEST_TMPDIR/real.json" ]

  run count_with_shipped_expression "$BATS_TEST_TMPDIR/real.json"
  [ "$status" -eq 0 ]
  [ "$output" = "0" ]
}

@test "AC-493-04: every shipped gate-8 copy carries the identical counting line" {
  cd "$REPO_ROOT" || return 1
  reference=$(sed -n 's/^[[:space:]]*GITLEAKS_FINDINGS=\(.*\)$/\1/p' githooks/gate-8.sh \
              | grep -v '^"?"$' | head -1)
  copies=0
  for f in $(git ls-files 'gate-8*.sh' '*/gate-8*.sh'); do
    line=$(sed -n 's/^[[:space:]]*GITLEAKS_FINDINGS=\(.*\)$/\1/p' "$f" \
           | grep -v '^"?"$' | head -1)
    [ "$line" = "$reference" ] || { echo "counting line drifts in $f: $line" >&2; return 1; }
    copies=$((copies + 1))
  done
  # Anti-vacuity: the guard must actually have seen the five shipped copies.
  [ "$copies" -ge 5 ]
}

# The same class, repo-wide: grep -c prints its own zero, so `|| echo 0` yields
# two values exactly when the answer was zero.
@test "AC-493-05: no shipped shell appends a second line to grep -c's zero match" {
  cd "$REPO_ROOT" || return 1
  hits=$(git ls-files 'githooks/*.sh' 'githooks/pre-commit' 'githooks/pre-push' \
            'src/npm-package/*.sh' 'src/npm-package/hooks/*' 'src/npm-package/adapters/*' \
         | grep -v '__tests__' \
         | xargs grep -nE 'grep -c[^|]*\|\|[[:space:]]*echo' 2>/dev/null || true)
  [ -z "$hits" ] || { echo "grep -c ... || echo produces two values on zero matches: $hits" >&2; return 1; }
}

# --- verdict level ----------------------------------------------------------
# The counting expression alone does not prove the gate passes: these drive the
# whole shipped file with a stub gitleaks whose only job is to write the artifact.
source_gate8_with_stub() {
  local artifact="$1"
  local stubdir="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$stubdir"
  cat > "$stubdir/gitleaks" << 'STUB'
#!/bin/bash
for arg in "$@"; do
  case "$arg" in --report-path=*) report_path="${arg#--report-path=}" ;; esac
done
if [ -n "${STUB_ARTIFACT:-}" ] && [ -n "$report_path" ]; then
  cp "$STUB_ARTIFACT" "$report_path"
fi
echo "3:04AM INF 0 commits scanned."
echo "3:04AM INF no leaks found"
exit 0
STUB
  chmod +x "$stubdir/gitleaks"
  export STUB_ARTIFACT="$artifact"

  local work="$BATS_TEST_TMPDIR/work"
  mkdir -p "$work"
  (
    cd "$work" || exit 70
    export TMPDIR="$BATS_TEST_TMPDIR"
    export PATH="$stubdir:$PATH"
    gate_start_ms() { echo "0"; }
    record_gate_audit() { :; }
    GATE_8_STATUS=""
    source "$REPO_ROOT/githooks/gate-8.sh"
    echo "STATUS=$GATE_8_STATUS"
  )
}

@test "AC-493-06: a clean scan passes the gate instead of blocking the commit" {
  empty="$BATS_TEST_TMPDIR/empty.json"
  printf '[]\n' > "$empty"

  run source_gate8_with_stub "$empty"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=PASS"* ]]
  ! grep -q 'BLOCKED' <<< "$output"
}

# Anti-regression for the fix itself: skipping the false BLOCK must not have
# turned Gate 8 into a no-op.
@test "AC-493-07: a report with a finding still blocks" {
  found="$BATS_TEST_TMPDIR/found.json"
  printf '[{"RuleID":"github-pat","Secret":"REDACTED"}]\n' > "$found"

  run source_gate8_with_stub "$found"
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED - gitleaks reported 1 finding(s)"* ]]
}

@test "AC-493-08: exit 0 with no report is SKIP, never PASS" {
  run source_gate8_with_stub ""
  [ "$status" -eq 0 ]
  [[ "$output" == *"STATUS=SKIP"* ]]
}

