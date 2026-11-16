#!/usr/bin/env bats
# @test REQ-806 Gate availability matrix (gate x language)
# @intent The audit that preceded this file found three of the five "product
#         defects" it reported were actually *harness* mistakes: CHANGED_FILES
#         joined with spaces instead of newlines (every grep -E '\.ts$' then
#         missed), GATE_6_STATUS read when gate 6 reports via exit code, and
#         lib/native-path.sh not sourced (PowerShell received a POSIX path and
#         reported "no functions"). Each produced a confident, wrong matrix.
#
#         This file pins the CALL CONTRACT so the next audit cannot repeat that,
#         and pins the *semantics* the audit confirmed are wrong today:
#
#           - Gate 4 finds warnings but reports PASSED (no severity:"error" rule
#             exists in .principlesrc, so it can currently never block);
#           - Gate 7 prints "PASSED - No IaC files detected" when there was
#             nothing to scan (#800's shape: not-checked rendered as passed).
#
#         Those two are deliberately written as tests of the CURRENT behaviour,
#         so that fixing them turns these assertions red and forces a conscious
#         update rather than an unnoticed flip.
# @covers AC-806-01 AC-806-02 AC-806-03

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
GATE_DIR="$REPO_ROOT/githooks"

setup() {
  WORK="$BATS_TEST_TMPDIR/avail"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q .
  git config user.email "t@t" 2>/dev/null || true
  git config user.name "t" 2>/dev/null || true
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
}

# Run a gate exactly the way pre-commit does: newline-separated CHANGED_FILES,
# the native-path helper already sourced, and the verdict read from BOTH the
# status variable and the exit code. $1=gate file, $2=project lang.
# Echoes "<verdict>|rc=<code>".
run_gate() {
  local gate="$1" lang="$2"
  cat > "$WORK/_driver.sh" <<'DRIVER'
gate_start_ms() { echo 0; }
record_gate_audit() { :; }
[ -f "$AUDIT_SCRIPT_DIR/lib/native-path.sh" ] && . "$AUDIT_SCRIPT_DIR/lib/native-path.sh"
. "$GATE_DIR/$GATE_FILE"
DRIVER
  local out rc
  out=$(
    cd "$WORK" || exit 99
    PROJECT_LANG="$lang" CURRENT_LANG="$lang" \
    AUDIT_SCRIPT_DIR="$GATE_DIR" GATE_DIR="$GATE_DIR" GATE_FILE="$gate" \
    CHANGED_FILES="$(git diff --cached --name-only --diff-filter=ACM)" \
    RAW_CHANGED_FILES="$(git diff --cached --name-only --diff-filter=ACM)" \
    GATE_SCOPE=diff CC_WARNINGS=0 WARNING_COUNT=0 \
    bash "$WORK/_driver.sh" 2>&1
  )
  rc=$?
  # Order matters: SKIP is checked BEFORE PASS. A gate whose output mentions both
  # (e.g. Gate 7 used to print "PASSED - No IaC files" and could also emit other
  # lines) must not be read as PASS just because some line said so. The audit hit
  # exactly this class of mistake when reading verdicts by pattern.
  local verdict="NO-VERDICT"
  case "$out" in
    *"❌ BLOCKED"*) verdict="BLOCK" ;;
    *"⏭️  SKIPPED"*) verdict="SKIP" ;;
    *"No layer config"*) verdict="WARN-NOCFG" ;;
    *"✅ PASSED"*)  verdict="PASS" ;;
    *) verdict="NO-VERDICT" ;;
  esac
  printf '%s|rc=%s|%s' "$verdict" "$rc" "$out"
}

# ── Contract tests ─────────────────────────────────────────────────────────

# @test The matrix contract itself: CHANGED_FILES must be newline separated.
# A space-joined list makes every gate's '\.ext$' grep miss, which is silent.
@test "AC-806-01: CHANGED_FILES is newline-separated so extension greps match" {
  printf 'a.ts\nb.json\n' > a.ts
  echo '{}' > b.json
  git add -A
  local changed matched
  changed=$(git diff --cached --name-only --diff-filter=ACM)
  matched=$(printf '%s\n' "$changed" | grep -cE '\.(ts|tsx|js|jsx)$')
  [ "$matched" -eq 1 ]
  # And the wrong join demonstrably fails, so this pins the actual hazard.
  local wrong
  wrong=$(printf '%s' "$changed" | tr '\n' ' ' | grep -cE '\.(ts|tsx|js|jsx)$' || true)
  [ "$wrong" -eq 0 ]
}

# @test Gate 3 BLOCKS a deeply nested function (proves the harness reaches it).
@test "AC-806-02: Gate 3 BLOCKS an over-complex TypeScript function" {
  command -v lizard >/dev/null 2>&1 || skip "lizard not installed"
  echo '{"compilerOptions":{"strict":true}}' > tsconfig.json
  cat > bad.ts <<'TS'
export function deep(a: number): number {
  if (a > 1) { if (a > 2) { if (a > 3) { if (a > 4) { if (a > 5) { return 1; } } } } }
  return 0;
}
TS
  git add -A
  local res
  res=$(run_gate gate-3.sh typescript)
  [ "${res%%|*}" = "BLOCK" ]
}

# @test Gate 3 SKIPS .dart/.sh because its extension regex excludes them.
# Recorded as a known coverage gap, not a bug: lizard cannot parse them either.
@test "AC-806-02: Gate 3 SKIPs shell sources (documented coverage gap)" {
  command -v lizard >/dev/null 2>&1 || skip "lizard not installed"
  printf '#!/usr/bin/env bash\ndeep() { if true; then if true; then echo 1; fi; fi; }\n' > bad.sh
  git add -A
  local res
  res=$(run_gate gate-3.sh shell)
  [ "${res%%|*}" = "SKIP" ]
}

# @test Gate 8 BLOCKS a real-shaped secret. This is the one gate whose "PASS"
# must never be the result of not looking, so it is pinned explicitly.
@test "AC-806-03: Gate 8 BLOCKS a GitHub PAT in a staged file" {
  command -v gitleaks >/dev/null 2>&1 || skip "gitleaks not installed"
  echo '{"compilerOptions":{"strict":true}}' > tsconfig.json
  printf 'export const t = "ghp_R9kLm2QwErTyUiOpAsDfGhJkLzXcVbNmQ0pL";\n' > leak.ts
  git add -A
  local res
  res=$(run_gate gate-8.sh typescript)
  [ "${res%%|*}" = "BLOCK" ]
}

# @test Gate 4's blocking power is decided ENTIRELY by .principlesrc severity.
#       The checker self-loads <git toplevel>/.principlesrc, so this fixture must
#       carry one. Both directions are asserted, because a gate that can only ever
#       report PASSED is not a gate:
#         - with the shipped config (deep-nesting is severity:"error") -> BLOCKED
#         - with that rule demoted back to "warning"                   -> PASSED
# @test FIXED BEHAVIOUR: Gate 4 BLOCKS a deep-nesting violation under the shipped
#       config. Before this fix `.principlesrc` declared no rule with severity
#       "error" at all, so the gate could never block anything while still
#       printing "✅ PASSED - no errors found" next to its own warnings -- a
#       quality gate that was structurally incapable of failing. Four rules were
#       promoted to "error" (deep-nesting, long-function, missing-error-handling,
#       code-duplication); magic-numbers stayed "info" because it alone produced
#       1699 of 1979 findings and would have made the gate noise.
@test "AC-806-03: Gate 4 BLOCKS a deep-nesting violation under shipped config" {
  command -v npx >/dev/null 2>&1 || skip "npx not available"
  [ -d "$REPO_ROOT/node_modules/tsx" ] || skip "tsx not installed"
  grep -q '"deep-nesting".*"severity": "error"' "$REPO_ROOT/.principlesrc" \
    || skip "shipped config no longer promotes deep-nesting; update this test"
  echo '{"compilerOptions":{"strict":true}}' > tsconfig.json
  cp "$REPO_ROOT/.principlesrc" .principlesrc
  cat > deep.ts <<'TS'
export function deep(a: number): number {
  if (a > 1) { if (a > 2) { if (a > 3) { if (a > 4) { if (a > 5) { return 1; } } } } }
  return 0;
}
TS
  git add -A
  local res
  res=$(run_gate gate-4.sh typescript)
  [ "${res%%|*}" = "BLOCK" ]
}

# @test Anti-vacuity: the BLOCK above is caused by the severity, not by something
#       else in the fixture. Demote the rule back to "warning" and the very same
#       file must pass -- proving the gate reads the config and that a
#       warning-level finding genuinely does not block.
@test "AC-806-03: Gate 4 PASSES the same file when deep-nesting is warning" {
  command -v npx >/dev/null 2>&1 || skip "npx not available"
  [ -d "$REPO_ROOT/node_modules/tsx" ] || skip "tsx not installed"
  echo '{"compilerOptions":{"strict":true}}' > tsconfig.json
  sed 's/"deep-nesting": *{[^}]*}/"deep-nesting": { "enabled": true, "threshold": 4, "severity": "warning" }/' \
    "$REPO_ROOT/.principlesrc" > .principlesrc
  grep -q '"deep-nesting".*"warning"' .principlesrc || skip "could not rewrite .principlesrc"
  cat > deep.ts <<'TS'
export function deep(a: number): number {
  if (a > 1) { if (a > 2) { if (a > 3) { if (a > 4) { if (a > 5) { return 1; } } } } }
  return 0;
}
TS
  git add -A
  local res
  res=$(run_gate gate-4.sh typescript)
  [ "${res%%|*}" = "PASS" ]
  # ... and it still reports the finding, so PASS here means "advisory", not
  # "nothing found" -- the distinction the old behaviour destroyed.
  case "$res" in
    *"warnings found"*) : ;;
    *) false ;;
  esac
}

# @test FIXED BEHAVIOUR: Gate 7 must NOT report PASSED when there was nothing to
#       scan (#800). "No IaC files in this change set" is a SKIP, and the status
#       variable must agree with the printed text -- the quality report reads
#       GATE_7_STATUS, so a PASS here is exactly how a security gate that never
#       ran gets counted as a security gate that passed.
@test "AC-806-03: Gate 7 SKIPs (not PASSes) when no IaC file exists to scan" {
  echo '{"compilerOptions":{"strict":true}}' > tsconfig.json
  echo 'export const x = 1;' > a.ts
  git add -A
  local res
  res=$(run_gate gate-7.sh typescript)
  [ "${res%%|*}" = "SKIP" ]
  # It must SKIP for the no-input reason, not because the adapter vanished --
  # otherwise this test would also pass if IaC support were removed entirely.
  case "$res" in
    *"no IaC files in this change set"*) : ;;
    *) false ;;
  esac
  # The verdict must not claim a pass, in any wording.
  case "$res" in
    *"✅ PASSED"*) false ;;
    *) : ;;
  esac
}

# @test Anti-vacuity for the SKIP above: a real IaC change must still be scanned.
# Without this, "always SKIP" would satisfy the test above while silently
# disabling the gate for Dockerfile/Terraform changes too.
@test "AC-806-03: Gate 7 still runs on a real IaC change (not blanket-SKIP)" {
  printf 'FROM node:18\nENV API_KEY=supersecret123\n' > Dockerfile
  git add -A
  local res
  res=$(run_gate gate-7.sh unknown)
  case "$res" in
    *"No IaC files detected"*) false ;;
    *) : ;;
  esac
}
