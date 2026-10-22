#!/usr/bin/env bats
# @test REQ-580
# @intent Every pre-push run writes a JSON journal to
#         `.xp-gate/reports/pre-push/<timestamp>.json` for `xp-gate audit` and
#         `xp-gate retro`. Each entry carries a per-gate `status` and a summary
#         `score`.
#
#         The score was:
#
#             'score': '10.0/10' if '$verdict' == 'PASS' else '0.0/10',
#
#         a restatement of the verdict, not a measurement. When every gate SKIPs
#         (docs-only push, no supported language, missing tools) the run reports
#         `0.0/10` — which reads as "every gate failed", a claim about the code
#         that was never tested. The honest reading is "nothing was measured".
#
#         Two distinct states were collapsed into one number:
#           - gates ran, some failed   -> a low score is TRUE and useful
#           - gates all skipped        -> there is no score; the journal must say so
#
#         A reader (dashboards, retros, a human skimming) cannot recover the
#         difference from `0.0/10`, which is why the fix is `None` rather than 0:
#         the field is absent/null and the reader is forced to consult `verdict`
#         and `gates_skipped`.
#
#         #597 rewrote the emitter: the Python body is now assembled with printf
#         into a temp script (a heredoc cannot be fed to python from the EXIT trap,
#         because the stdin loop upstream already consumed stdin). The old
#         extraction here relied on the source SPELLING — `awk '/^_ran = /,…'` —
#         so it broke the moment the emitter changed shape. It now runs the REAL
#         hook and reads the REAL journal, which is what the requirement says.
#
#         Pin: the score must be computed from gates that actually ran, and be
#         null when none did.
# @covers AC-580-01, AC-580-02, AC-580-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-push"
  WORK="$(mktemp -d)"

  cd "$WORK" || exit 1
  git init -q -b feature/score-fixture . || exit 1
  git config user.email "test@test.com"
  git config user.name "Test"
  mkdir -p .git/hooks/lib
  cp "$HOOK" .git/hooks/pre-push
  chmod +x .git/hooks/pre-push
  cp "$REPO_ROOT/githooks/lib/validate-code-walkthrough.cjs" .git/hooks/lib/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/adapter-common.sh" .git/hooks/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/hook-module-resolution.sh" .git/hooks/ 2>/dev/null || true
  git config core.hooksPath .git/hooks

  mkdir -p "$WORK/bin"
  for t in jscpd gitleaks lizard semgrep checkov hadolint; do
    printf '#!/bin/bash\nexit 0\n' > "$WORK/bin/$t"
    chmod +x "$WORK/bin/$t"
  done
  export PATH="$WORK/bin:$PATH"

  printf 'init\n' > README.md
  git add . >/dev/null 2>&1
  git commit -q --no-verify -m init
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# Run the real hook with the given per-gate statuses injected, then print
# `score|gates_run|gates_skipped|verdict` from the journal it wrote.
#
# The hook takes gate statuses from its own environment (GATE_*_STATUS), so the
# test drives the real code path instead of re-executing an extracted snippet.
run_score() {
  local statuses="$1"
  rm -rf .xp-gate

  local sha stdin_file
  sha="$(git rev-parse HEAD)"
  stdin_file="$WORK/push-stdin.txt"
  printf 'refs/heads/feature/score-fixture %s refs/heads/feature/score-fixture %s\n' \
    "$sha" "0000000000000000000000000000000000000000" > "$stdin_file"

  # Split "A,B,C,D" into the four Gate M-family env vars the hook reads. The
  # hook assigns more gates than these; the ones left unset keep their SKIP
  # default, which is exactly the docs-only-push situation.
  local s1 s2 s3 s4
  IFS=',' read -r s1 s2 s3 s4 <<< "$statuses"

  GATE_MP_STATUS="${s1:-SKIP}" \
  GATE_M_STATUS="${s2:-SKIP}" \
  GATE_M_PY_STATUS="${s3:-SKIP}" \
  GATE_M_GO_STATUS="${s4:-SKIP}" \
    .git/hooks/pre-push origin https://example.com < "$stdin_file" >/dev/null 2>&1 || true

  local f
  f="$(ls -1t .xp-gate/reports/pre-push/*.json 2>/dev/null | head -n1)"
  [ -n "$f" ] || { echo 'NO_JOURNAL_FILE'; return 0; }

  node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const o = j.overall || {};
    process.stdout.write(String(o.score) + "|" + String(o.gates_run) + "|" +
                         String(o.gates_skipped) + "|" + String(o.verdict));
  ' "$f"
}

@test "AC-580-01: an all-SKIP run has no score, not 0.0/10" {
  # Every gate skips: there is nothing to score.
  out=$(run_score "SKIP,SKIP,SKIP,SKIP")
  echo "$out"

  [ "$out" != "NO_JOURNAL_FILE" ] || {
    echo "the hook wrote no journal — this case cannot judge the score"
    return 1
  }
  score="${out%%|*}"
  [ "$score" = "null" ] || [ "$score" = "undefined" ] || {
    echo "an all-SKIP run produced a score of [$score]; it must be null/absent"
    echo "(0.0/10 reads as 'every gate failed', which was never measured)"
    return 1
  }
}

@test "AC-580-02: the score reflects gates that actually ran" {
  # Some gates pass -> the score is computed over the gates that RAN, so a run
  # where every executed gate passed scores 10.0/10, not 0.0 and not a fraction
  # diluted by the skips.
  out=$(run_score "PASS,PASS,PASS,PASS")
  echo "$out"

  [ "$out" != "NO_JOURNAL_FILE" ] || {
    echo "the hook wrote no journal — this case cannot judge the score"
    return 1
  }
  score="${out%%|*}"
  ran=$(printf '%s' "$out" | cut -d'|' -f2)
  echo "score=$score gates_run=$ran"
  [ "$ran" -ge 4 ] || {
    echo "expected at least 4 gates to be counted as run; got $ran"
    return 1
  }
  [ "$score" = "10.0/10" ] || {
    echo "a run where every executed gate passed scored [$score], not 10.0/10"
    return 1
  }
}

@test "AC-580-03: a real failure still scores low" {
  # The null-score fix must not make failures invisible: one PASS and the rest
  # NOT-PASS must produce a real, low number.
  out=$(run_score "PASS,FAIL,FAIL,FAIL")
  echo "$out"

  [ "$out" != "NO_JOURNAL_FILE" ] || {
    echo "the hook wrote no journal — this case cannot judge the score"
    return 1
  }
  score="${out%%|*}"
  echo "score=$score"
  case "$score" in
    null|undefined)
      echo "a run with real failures produced a null score; failures must be visible"
      return 1
      ;;
  esac
  # Whatever the exact format, it must be strictly below a perfect score.
  [ "$score" != "10.0/10" ] || {
    echo "a run with three failing gates scored 10.0/10"
    return 1
  }
}
