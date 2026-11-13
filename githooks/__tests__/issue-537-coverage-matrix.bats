#!/usr/bin/env bash
# Tests for #537 — per-language coverage matrix + Gate 6 reason.
#
# @test REQ-A,REQ-A2,REQ-B,REQ-C,REQ-D,REQ-E
# @intent Prove that a mixed-language repo can no longer present a SKIPped
#         dimension as "fully covered": every gate x language cell must land on
#         exactly one honest classification, and the dynamic nature of
#         PROJECT_LANGS must be exposed rather than hidden.
# @covers AC-A-01,AC-A-02,AC-A2-01,AC-A2-02,AC-B-01,AC-B-02,AC-C-01,AC-C-02,AC-D-02,AC-E-01
#
# These tests source the helpers from githooks/pre-commit rather than
# re-implementing them, so a drift between the tested contract and the
# shipped hook fails here.

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
  # #798 moved every gate BODY out of pre-commit into githooks/gate-entries/.
  # `classify_coverage_reason` stayed in the preamble (it is a shared helper),
  # but the matrix fields (`languagesSource`, `coverageMatrix`) and the Gate 6
  # reason strings moved with Gate 6's body. A test grepping only pre-commit
  # found nothing there and reported "the contract is missing" on 12 cases --
  # indistinguishable from the drift this suite exists to catch.
  #
  # HOOK_ALL concatenates the preamble and every entry file, so each assertion
  # below still proves the string is SHIPPED somewhere in the hook, rather than
  # re-implementing the contract here.
  HOOK_ALL="$(cat "$PRE_COMMIT" "$REPO_ROOT"/githooks/gate-entries/*.sh 2>/dev/null)"
  [ -n "$HOOK_ALL" ] || { echo "no hook sources to search"; return 1; }
}

# Assertions over HOOK_ALL. Plain functions rather than `run grep`, because the
# herestring redirection and bats's `run` do not compose cleanly and every one of
# these cases only reads the exit status.
hook_has() { grep -q "$1" <<< "$HOOK_ALL"; }
hook_count() { grep -c "$1" <<< "$HOOK_ALL"; }

# ── REQ-A: reason -> classification mapping ───────────────────────────────────

@test "classify_coverage_reason maps every documented reason" {
  # Source just the function, not the whole hook (which runs gates on load).
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ "$(type -t classify_coverage_reason)" = "function" ]

  # PASS with no reason is the ONLY way to reach covered.
  [ "$(classify_coverage_reason "" PASS)" = "covered" ]
  [ "$(classify_coverage_reason "" SKIP)" = "unknown" ]
  [ "$(classify_coverage_reason "" PASS_WITH_WARNINGS)" = "covered" ]
  [ "$(classify_coverage_reason "" WARN)" = "covered" ]

  [ "$(classify_coverage_reason documentation_project SKIP)" = "not_applicable" ]
  [ "$(classify_coverage_reason no_source_files_changed SKIP)" = "no_changes" ]
  [ "$(classify_coverage_reason tool_not_installed SKIP)" = "tool_missing" ]
  [ "$(classify_coverage_reason no_powershell_tool SKIP)" = "tool_missing" ]
  [ "$(classify_coverage_reason no_archlint_detector SKIP)" = "tool_missing" ]
  [ "$(classify_coverage_reason architecture_skip_exemption SKIP)" = "not_applicable" ]
}

@test "classify_coverage_reason understands Gate 4's own reason vocabulary" {
  # Learned by running the hook for real: Gate 4 emits these three, none of
  # which were in the original mapping, so every principles cell came out
  # `unknown` on a normal commit.
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ "$(classify_coverage_reason no_matching_files_changed SKIP)" = "no_changes" ]
  [ "$(classify_coverage_reason checker_not_found SKIP)" = "tool_missing" ]
  # A checker that ran and crashed measured nothing — unknown, not covered.
  [ "$(classify_coverage_reason checker_execution_error SKIP)" = "unknown" ]
}

@test "classify_coverage_reason never defaults an unknown reason to covered" {
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  # The whole point: an unrecognised reason must FAIL CLOSED.
  [ "$(classify_coverage_reason some_future_reason SKIP)" = "unknown" ]
  [ "$(classify_coverage_reason some_future_reason PASS)" = "unknown" ]
  # Mixed-summary sentinel from the Gate 6 aggregate.
  [ "$(classify_coverage_reason mixed SKIP)" = "unknown" ]
}

# ── REQ-A2: languagesSource ───────────────────────────────────────────────────

@test "quality-status declares languagesSource alongside coverageMatrix" {
  hook_has '"languagesSource"' || { echo "expected hook source to contain: "languagesSource""; return 1; }
  hook_has '"coverageMatrix"' || { echo "expected hook source to contain: "coverageMatrix""; return 1; }
}

@test "languagesSource distinguishes override, config, changed_files and none" {
  # The helper may live in the preamble OR in a gate entry file (#798).
  eval "$(sed -n '/^resolve_languages_source()/,/^}/p' "$PRE_COMMIT"           "$REPO_ROOT"/githooks/gate-entries/*.sh 2>/dev/null)"
  [ "$(type -t resolve_languages_source)" = "function" ]
  [ "$(resolve_languages_source "override" "config" "typescript")" = "override" ]
  [ "$(resolve_languages_source "" "config" "typescript")" = "config" ]
  [ "$(resolve_languages_source "" "" "typescript")" = "changed_files" ]
  [ "$(resolve_languages_source "" "" "")" = "none" ]
}

# ── REQ-B: Gate 6 reason ──────────────────────────────────────────────────────

@test "Gate 6 sets a reason when archlint has no detector for the language" {
  # The catch-all branch used to only echo. It must now record a reason.
  hook_has 'GATE_6_REASON_BY_LANG\["\$CURRENT_LANG"\]="no_archlint_detector"' || { echo "expected hook source to contain: GATE_6_REASON_BY_LANG\["\$CURRENT_LANG"\]="no_archlint_detector""; return 1; }
}

@test "Gate 6 keeps the scalar aggregate for the existing JSON field shape" {
  # The legacy field must survive: consumers read gates.gate6_arch_boyscout.
  # Structural check only — the value's correctness is proven by the
  # classification tests above, which execute the real functions.
  hook_has 'gate6_arch_boyscout' || { echo "expected hook source to contain: gate6_arch_boyscout"; return 1; }
  hook_has '"reason": "\${GATE_6_REASON' || { echo "the report must carry the Gate 6 reason alongside the aggregate"; return 1; }
  # And the scalar must be initialised before the language loops, so a config-
  # missing run cannot inherit a stale value from a previous gate.
  # The scalar may be initialised in the preamble or in Gate 6's body; both are
  # shipped sources. Search them all rather than only the preamble.
  grep -q 'GATE_6_REASON=""' <<< "$HOOK_ALL" || {
    echo 'GATE_6_REASON="" is not initialised anywhere in the hook'
    return 1
  }
}

@test "a language archlint really measured is not labelled tool_missing" {
  # Learned by running the hook: the TypeScript branch runs archlint, but the
  # catch-all's reason leaked into the matrix for typescript too, so a covered
  # dimension was reported as tool_missing. The TS branch must set no reason at
  # all (absent reason + PASS status => covered).
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ "$(classify_coverage_reason "" PASS)" = "covered" ]
  # And the ASSIGNMENT must exist exactly once (in the catch-all), never in the
  # typescript case. The mapping table legitimately mentions the token too.
  local count
  count=$(hook_count 'GATE_6_REASON_BY_LANG\["\$CURRENT_LANG"\]="no_archlint_detector"')
  # Exactly one assignment: the catch-all. A second one in the typescript branch
  # is the bug this case exists for.
  [ "$count" -eq 1 ] || {
    echo "expected exactly 1 no_archlint_detector assignment, found $count"
    return 1
  }
}

# ── REQ-C: matrix key set ─────────────────────────────────────────────────────

@test "coverage matrix is keyed by PROJECT_LANGS and covers gates 3, 4 and 6" {
  hook_has 'for _cm_lang in \$PROJECT_LANGS' || { echo "expected hook source to contain: for _cm_lang in \$PROJECT_LANGS"; return 1; }
  for gate in gate3_complexity gate4_principles gate6_architecture; do
    hook_has "$gate" || { echo "expected hook source to contain: "$gate""; return 1; }
  done
}

# ── REQ-E: unsupported language must not block ────────────────────────────────

@test "no-tool languages still SKIP rather than BLOCK" {
  hook_has 'SKIPPED - Architecture validation (not configured for \$CURRENT_LANG)' || { echo "expected hook source to contain: SKIPPED - Architecture validation (not configured for \$CURRENT_LANG)"; return 1; }
  # And the gate must not exit 1 in that branch.
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ "$(classify_coverage_reason no_archlint_detector SKIP)" = "tool_missing" ]
}

@test "Gate 6 per-language reasons survive into the report function" {
  # `declare -A` inside a function is function-local in bash, and the report is
  # written by generate_quality_report() — a different function. So the gate
  # must flatten its per-language reasons into a GLOBAL string. Found by
  # running the hook for real: the matrix said tool_missing for typescript
  # because the lookup inside the report saw an empty array.
  hook_has 'GATE_6_LANG_REASONS=' || { echo "expected hook source to contain: GATE_6_LANG_REASONS="; return 1; }
  # The report must read the flattened string (via the extracted helper),
  # never the gate's function-local assoc array.
  if hook_has 'GATE_6_REASON_BY_LANG\[\$_cm_lang\]'; then
    echo "the report reads the gate's function-local array instead of the flattened string"
    return 1
  fi
  hook_has 'coverage_g6_reason_for' || { echo "expected hook source to contain: coverage_g6_reason_for"; return 1; }
}

@test "flattened lang=reason pairs parse back to the right language" {
  # Same parsing shape the report uses, exercised directly.
  GATE_6_LANG_REASONS="powershell=no_archlint_detector,typescript=tool_missing"
  for lang in powershell typescript iac; do
    pairs=",${GATE_6_LANG_REASONS},"
    got=""
    case "$pairs" in
      *",${lang}="*) got="${pairs#*",${lang}="}"; got="${got%%,*}" ;;
    esac
    case "$lang" in
      powershell) [ "$got" = "no_archlint_detector" ] ;;
      typescript) [ "$got" = "tool_missing" ] ;;
      iac)        [ -z "$got" ] ;;
    esac
  done
}

@test "the Gate 6 scalar summary never labels a language it did not measure" {
  # Real run: langs=[typescript iac], reasons=[iac=no_archlint_detector].
  # TypeScript had been measured by archlint and passed, but the scalar
  # summary read "no_archlint_detector" and the fallback relabelled it
  # tool_missing — the matrix telling the lie it exists to prevent.
  #
  # This test exercises the REAL report-side lookup, extracted from
  # pre-commit, not a hand-copied reimplementation (the earlier version of
  # this test was a copy with a vacuous `|| true` that could never fail).
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  eval "$(sed -n '/^coverage_g6_reason_for()/,/^}/p' "$PRE_COMMIT"           "$REPO_ROOT"/githooks/gate-entries/*.sh 2>/dev/null)"
  [ "$(type -t coverage_g6_reason_for)" = "function" ]

  GATE_6_STATUS="PASS"
  GATE_6_REASON="no_archlint_detector"
  GATE_6_LANG_REASONS="iac=no_archlint_detector"

  # typescript has no pair: must NOT inherit iac's reason -> covered.
  _r=$(coverage_g6_reason_for "typescript")
  [ -z "$_r" ]
  [ "$(classify_coverage_reason "$_r" "$GATE_6_STATUS")" = "covered" ]

  # iac has an explicit pair: wins over the scalar -> tool_missing.
  _r=$(coverage_g6_reason_for "iac")
  [ "$_r" = "no_archlint_detector" ]
  [ "$(classify_coverage_reason "$_r" "$GATE_6_STATUS")" = "tool_missing" ]

  # With NO per-language detail at all, the scalar legitimately speaks for all.
  GATE_6_LANG_REASONS=""
  GATE_6_REASON="architecture_skip_exemption"
  [ "$(coverage_g6_reason_for "typescript")" = "architecture_skip_exemption" ]
}

@test "a configured-tool branch that skips still records why" {
  # Review finding (architecture seat, CI-01): the python/go/java branches SKIP
  # when their config is absent but used to record nothing, so the matrix read
  # "no reason + PASS" and called an unmeasured dimension `covered`. That is
  # precisely the false confidence this feature exists to remove.
  eval "$(sed -n '/^classify_coverage_reason()/,/^}/p' "$PRE_COMMIT")"
  [ "$(classify_coverage_reason architecture_not_configured SKIP)" = "tool_missing" ]
  # Every config-missing branch must record the reason. Asserted as a lower
  # bound rather than an exact count: the count said 3 and went to 5 when #717
  # added the C# config-missing branches, failing a test whose property was
  # still true. An exact count also stays green if one branch is deleted while
  # another is duplicated, which is the wrong direction entirely.
  local arch_reason_count
  arch_reason_count=$(hook_count 'GATE_6_REASON_BY_LANG\["\$CURRENT_LANG"\]="architecture_not_configured"')
  # Lower bound, per the comment above: #717 took 3 -> 5.
  [ "$arch_reason_count" -ge 3 ] || {
    echo "expected >= 3 architecture_not_configured assignments, found $arch_reason_count"
    return 1
  }
  # The C# dimension added in #717 must be among them: without it, a C# commit
  # with no arch-csharp.yaml returns to the "no reason + PASS => covered" path
  # this issue exists to remove.
  #
  # C# has TWO config-missing decision points, each ending in its own recording:
  #   1. an arch-csharp.yaml exists but no .csproj is found beneath it
  #   2. no arch-csharp.yaml at all
  # An "at least one C# recording exists" check is satisfied by either one, so
  # breaking the other stays green (measured: removing branch 1's recording
  # passed such an assertion). Both decision points must be accounted for.
  run awk '
    /if \[ -z "\$_cs_arch_proj" \]/ { pending = 1; next }
    /No arch-csharp\.yaml found/ { pending = 1; next }
    /GATE_6_REASON_BY_LANG\["\$CURRENT_LANG"\]="architecture_not_configured"/ {
      if (pending) { recorded++; pending = 0 }
      next
    }
    END { exit(recorded >= 2 ? 0 : 1) }
  ' "$REPO_ROOT/githooks/gate-entries/gate-6-entry.sh" "$PRE_COMMIT"
  [ "$status" -eq 0 ]
}

@test "no language branch can reach the matrix with no reason and no measurement" {
  # The safety property behind "absent reason + PASS => covered": every named
  # case either measures (typescript, or python/go/java with config+tool) or
  # records a reason. Only the bare catch-all assigns no_archlint_detector; the
  # three config-missing branches assign architecture_not_configured; the two
  # tool-missing paths exit 1 before the matrix is written.
  assigns=$(grep -c 'GATE_6_REASON_BY_LANG\[' <<< "$HOOK_ALL")
  # 1 declare/init reference + 5 assignments (catch-all + 3 config + typescript
  # case has none by design)
  [ "$assigns" -ge 5 ]
}

@test "pre-commit still parses after the change" {
  run bash -n "$PRE_COMMIT"
  [ "$status" -eq 0 ]
}

# ── REQ-D: zero behaviour change for the existing fields ──────────────────────

@test "existing quality-status fields keep their shape" {
  for field in reportVersion generatedAt branch commit overall gates; do
    hook_has "\"$field\"" || { echo "expected hook source to contain: "\"$field\"""; return 1; }
  done
}
