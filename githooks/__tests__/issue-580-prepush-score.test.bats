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
  # The scorer is a real install artefact (install.sh copies lib/*.py beside the
  # hook), so the fixture installs it too. Without it the hook cannot compute a
  # score and fails closed — which is the correct product behaviour, but it would
  # make every case here measure the fixture's omission instead of the score.
  cp "$REPO_ROOT/githooks/lib/prepush-score.py" .git/hooks/lib/ 2>/dev/null || true
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

  # Split "A,B,C,..." into the per-gate env vars the hook reads. Gates the caller
  # does not name keep their SKIP default, which is exactly the docs-only-push
  # situation. The hook reads nine GATE_*_STATUS variables, so the list is walked
  # positionally rather than with four fixed read slots -- a case that needs a
  # MAJORITY of the twelve gates (#577) names more than four.
  local -a parts
  IFS=',' read -r -a parts <<< "$statuses"
  local -a envs=(
    "GATE_MP_STATUS=${parts[0]:-SKIP}"
    "GATE_10_STATUS=${parts[1]:-SKIP}"
    "GATE_M_STATUS=${parts[2]:-SKIP}"
    "GATE_M_PY_STATUS=${parts[3]:-SKIP}"
    "GATE_M_GO_STATUS=${parts[4]:-SKIP}"
    "GATE_M_JAVA_STATUS=${parts[5]:-SKIP}"
    "GATE_M_KOTLIN_STATUS=${parts[6]:-SKIP}"
    "GATE_M2_STATUS=${parts[7]:-SKIP}"
    "GATE_M3_STATUS=${parts[8]:-SKIP}"
    "GATE_UI_STATUS=${parts[9]:-SKIP}"
    "GATE_DELPHI_STATUS=${parts[10]:-SKIP}"
    "GATE_S_STATUS=${parts[11]:-SKIP}"
  )

  env "${envs[@]}" \
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
  #
  # #577 changed what "the gates that ran" may be summarised as: a score needs a
  # MAJORITY of the twelve gates behind it. This case therefore drives a majority
  # (the six Gate M-family gates it can set, plus the unset ones staying SKIP puts
  # it exactly at the boundary -- so set seven), because four-of-twelve is
  # deliberately NOT scorable. The four-of-twelve shape is asserted separately in
  # the #577 suite; here the point is that a scorable run divides by what ran.
  out=$(run_score "PASS,PASS,PASS,PASS,PASS,PASS,PASS")
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
  if [ "$score" = "null" ]; then
    # A majority is required (#577); below it there is deliberately no score.
    echo "this run had only $ran of 12 gates, below the majority a score requires"
    echo "the case needs a majority to assert the division; widen the injection"
    return 1
  fi
  [ "$score" = "10.0/10" ] || {
    echo "a run where every executed gate passed scored [$score], not 10.0/10"
    return 1
  }
}

@test "AC-580-02: a sub-majority run publishes no score, and says why" {
  # #577: four of twelve gates is not enough to summarise, so the score is null
  # AND the journal must explain the absence rather than leave a bare null.
  out=$(run_score "PASS,PASS,PASS,PASS")
  echo "$out"

  [ "$out" != "NO_JOURNAL_FILE" ] || {
    echo "the hook wrote no journal — this case cannot judge the score"
    return 1
  }
  score="${out%%|*}"
  [ "$score" = "null" ] || [ "$score" = "undefined" ] || {
    echo "four of twelve gates produced a score of [$score]; a majority is required"
    return 1
  }

  local f scope
  f="$(ls -1t .xp-gate/reports/pre-push/*.json 2>/dev/null | head -n1)"
  scope=$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String((j.overall || {}).score_scope || ""));
  ' "$f")
  [[ "$scope" == *"too few"* ]] || {
    echo "a null score must carry score_scope saying why, got [$scope]"
    return 1
  }
}

@test "AC-580-03: a real failure still scores low" {
  # The null-score fix must not make failures invisible: a mostly-passing run with
  # real failures must produce a real, low number.
  #
  # Same #577 constraint as above: a score needs a majority behind it, so this
  # drives seven gates with one passing and six failing. A four-gate run with
  # three failures has no score at all -- correct, and covered by the sub-majority
  # case, but it cannot demonstrate "failures score low".
  out=$(run_score "PASS,FAIL,FAIL,FAIL,FAIL,FAIL,FAIL")
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
    echo "a run with six failing gates scored 10.0/10"
    return 1
  }
}
