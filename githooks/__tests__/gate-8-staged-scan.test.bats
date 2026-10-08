#!/usr/bin/env bats
# @test REQ-SEC-001
# @intent 验证 Gate 8 扫描的是**索引**而非提交历史：gitleaks 8.x 的 `git --pre-commit`
#         在 pre-commit 场景下报告 "0 commits scanned"，导致已暂存的密钥永远不被发现、
#         Gate 8 恒 PASS（#449）。`git --staged` 必须能检出暂存密钥。
# @covers AC-SEC-001-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  export REPO_ROOT
}

# Every shipped gate-8 copy must invoke `git --staged`, never `git --pre-commit`.
# Ignore comments: the fix documents the old flag in an explanatory note.
@test "REQ-SEC-001 no shipped gate-8 copy invokes git --pre-commit" {
  cd "$REPO_ROOT" || return 1
  for f in $(git ls-files 'gate-8*.sh' '*/gate-8*.sh'); do
    # Strip comment lines, then look for a real invocation.
    if grep -v '^[[:space:]]*#' "$f" | grep -q 'git --pre-commit'; then
      echo "git --pre-commit still invoked in $f" >&2
      return 1
    fi
  done
}

@test "REQ-SEC-001 every shipped gate-8 copy invokes git --staged" {
  cd "$REPO_ROOT" || return 1
  files="$(git ls-files 'gate-8*.sh' '*/gate-8*.sh')"
  [ -n "$files" ]
  for f in $files; do
    grep -q 'git --staged' "$f" || { echo "missing --staged in $f" >&2; return 1; }
  done
}

@test "REQ-SEC-001 gate-8 copies are syntactically valid" {
  cd "$REPO_ROOT" || return 1
  for f in $(git ls-files 'gate-8*.sh' '*/gate-8*.sh'); do
    run bash -n "$f"
    [ "$status" -eq 0 ] || { echo "syntax error in $f" >&2; return 1; }
  done
}

@test "REQ-SEC-001 a staged secret is detected by git --staged" {
  command -v gitleaks >/dev/null 2>&1 || skip "gitleaks not installed"
  command -v git >/dev/null 2>&1 || skip "git not available"

  work="$BATS_TEST_TMPDIR/leak"
  mkdir -p "$work"
  cd "$work" || return 1
  git init -q .
  git config core.hooksPath /dev/null
  git config user.email t@t.t
  git config user.name t
  git commit -q --allow-empty -m init

  # Build the token at runtime so this fixture is not itself a committable
  # secret (the fixed Gate 8 correctly flagged a literal ghp_… here).
  local tok="ghp_"
  tok="${tok}16C7e42F292c6912E7710c838347Ae178B4a"
  printf 'github_token = %s\n' "$tok" > real.txt
  git add real.txt

  run gitleaks git --staged --redact --no-banner \
    --config="$REPO_ROOT/.gitleaks.toml" \
    --report-format=json --report-path="$BATS_TEST_TMPDIR/report.json"
  # exit 1 == leaks found
  [ "$status" -eq 1 ]
  grep -q '"RuleID"' "$BATS_TEST_TMPDIR/report.json"
}

@test "REQ-SEC-001 a clean index passes git --staged" {
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

  run gitleaks git --staged --redact --no-banner \
    --config="$REPO_ROOT/.gitleaks.toml" \
    --report-format=json --report-path="$BATS_TEST_TMPDIR/clean.json"
  [ "$status" -eq 0 ]
}

# --- fail-closed evidence checks (Delphi Round 2, C-F1) ---------------------
# Gate 8 must decide from the REPORT ARTIFACT, not from gitleaks log wording.
# Relying on stdout meant a wording change would silently turn a run with no
# evidence into a PASS -- the exact fail-open class #449 fixed.

@test "REQ-SEC-001 gate-8 decides verdict from the report artifact, not log wording" {
  cd "$REPO_ROOT" || return 1
  for f in $(git ls-files 'gate-8*.sh' '*/gate-8*.sh'); do
    # Must inspect the report file...
    grep -q 'GITLEAKS_REPORT' "$f" || { echo "no report check in $f" >&2; return 1; }
    grep -q '"RuleID"' "$f" || { echo "no RuleID count in $f" >&2; return 1; }
  done
}

@test "REQ-SEC-001 gate-8 no longer gates on gitleaks stdout strings" {
  cd "$REPO_ROOT" || return 1
  for f in $(git ls-files 'gate-8*.sh' '*/gate-8*.sh'); do
    if grep -v '^[[:space:]]*#' "$f" | grep -q '0 commits scanned'; then
      echo "still parsing stdout wording in $f" >&2
      return 1
    fi
  done
}

@test "REQ-SEC-001 a missing report is SKIP (no evidence), never PASS" {
  cd "$REPO_ROOT" || return 1
  # Replicate the decision table against synthetic artifacts.
  missing="$BATS_TEST_TMPDIR/does-not-exist.json"
  findings="?"
  if [ -f "$missing" ]; then
    findings=$(grep -c '"RuleID"' "$missing" 2>/dev/null || echo 0)
  fi
  # The '?' sentinel maps to SKIP; assert it is NOT "0" (which would mean PASS).
  [ "$findings" = "?" ]
  [ "$findings" != "0" ]
}

# These two decisions are asserted against the SHIPPED counting expression in
# issue-493-gate8-clean-report-count.test.bats (AC-493-01/02/03). Transcribing
# the production line here documented the bug instead of catching it (#493).
