#!/usr/bin/env bats

# Tests for A2: XP_GATE_ONLY_GATE, the gate-subset selector.
#
# @test REQ-A2-GATE-SELECTION
# @intent `pre-commit` runs ~13 gates and a commit costs ~26 s on an idle box,
#         spread evenly across gates that have nothing to do with each other
#         (measured: startup 3.5 s, Gate 1 4.8 s, Gate 2 3.1 s, Gate 4 4.2 s,
#         Gate 5 2.1 s). While iterating on ONE gate you re-run all of them just
#         to re-check that one. XP_GATE_ONLY_GATE=<ids> narrows the run.
#
#         The property that matters is not the speed, it is that a gate which
#         did NOT run must never be recorded as if it passed. A naive filter
#         (skip the body, leave the START-status PASS) would write green journal
#         entries for checks that never executed, and `xp-gate retro` /
#         `sprint-status --rework-check` would compute first-pass rates over
#         them. Every deselected gate here must set STATUS=SKIP and DETAIL=
#         not_selected.
#
# @covers AC-GATESEL-01, AC-GATESEL-02, AC-GATESEL-03, AC-GATESEL-04
#
# These exercise gate_enabled() directly rather than driving a whole commit:
# the function is the single decision point every gate asks, and a full hook run
# costs ~17-33 s per case (measured), which would put this file near the top of
# the slowest-test list it exists to shorten.

setup() {
  # Load ONLY the two helpers under test. Sourcing pre-commit is not an option:
  # it executes 13 gates on import.
  eval "$(sed -n '/^# ── A2: run a SUBSET of gates/,/^}/p' "$BATS_TEST_DIRNAME/../pre-commit")"
  eval "$(sed -n '/^gate_selection_active()/,/^}/p' "$BATS_TEST_DIRNAME/../pre-commit")"
  eval "$(sed -n '/^gate_enabled()/,/^}/p' "$BATS_TEST_DIRNAME/../pre-commit")"
  unset XP_GATE_ONLY_GATE
  XP_GATE_ONLY_GATE_STATE=""
}

# ── AC-GATESEL-01: no selection means every gate runs ─────────────────────────

@test "AC-GATESEL-01: with no XP_GATE_ONLY_GATE every gate is enabled" {
  gate_enabled 0
  gate_enabled 1
  gate_enabled 5
  gate_enabled 13
}

@test "AC-GATESEL-01: selection is inactive unless the variable is set and non-empty" {
  XP_GATE_ONLY_GATE=""
  XP_GATE_ONLY_GATE_STATE=""
  ! gate_selection_active
  gate_enabled 4
}

# ── AC-GATESEL-02: a named gate runs, everything else does not ─────────────────

@test "AC-GATESEL-02: a single id enables exactly that gate" {
  export XP_GATE_ONLY_GATE=5
  gate_enabled 5
  ! gate_enabled 4
  ! gate_enabled 1
}

@test "AC-GATESEL-02: a comma list enables each member and nothing else" {
  export XP_GATE_ONLY_GATE=1,5
  gate_enabled 1
  gate_enabled 5
  ! gate_enabled 2
  ! gate_enabled 6
}

@test "AC-GATESEL-02: a multi-digit id is not matched by its leading digit" {
  export XP_GATE_ONLY_GATE=13
  gate_enabled 13
  # The naive `case *"$1"*` form passes both of these: "1" is a substring of
  # "13". Anchoring on ",<id>," is what makes them fail.
  ! gate_enabled 1
  ! gate_enabled 3
}

@test "AC-GATESEL-02: whitespace around ids is tolerated" {
  export XP_GATE_ONLY_GATE="1, 5 , 9"
  gate_enabled 1
  gate_enabled 5
  gate_enabled 9
  ! gate_enabled 2
}

# The selector logic now lives in gate-entries/ (#798 split the hook into one file
# per gate plus an ordered driver), so the assertions below read the whole CHAIN.
# Pointing them at pre-commit alone reported "missing" for code that runs on
# every commit.
# Concatenated source of the whole chain. Assign to HOOK_TEXT, then grep it with a
# here-string: passing a multi-line string as grep's FILE argument makes grep look
# for files whose NAMES contain the pattern, which exits 2 and reads as "assertion
# failed" for entirely the wrong reason.
_load_gate_chain() {
  local root="$BATS_TEST_DIRNAME/.."
  HOOK_TEXT="$(cat "$root/pre-commit" "$root/gate-driver.sh" "$root"/gate-entries/*.sh 2>/dev/null)"
}

# ── AC-GATESEL-03: deselected gates are recorded as SKIP, never PASS ──────────

@test "AC-GATESEL-03: every gate arm that consults the selector sets SKIP detail" {
  # A gate that skipped its body but left its START status ("PASS") in place
  # would journal a pass for a check that never ran. Assert the arms agree.
  _load_gate_chain
  # Gate 0, 1, 2, 5 live in pre-commit; Gate 3 and 4 are gated at their
  # `source` site for the GATE_DIR reason documented there.
  grep -q 'GATE_0_DETAIL="not_selected"' <<< "$HOOK_TEXT"
  grep -q 'GATE_1_DETAIL="not_selected"' <<< "$HOOK_TEXT"
  grep -q 'GATE_2_DETAIL="not_selected"' <<< "$HOOK_TEXT"
  # Gate 5 records its detail through the shared helper, which APPENDS with
  # de-duplication instead of assigning; the assignment form it used before is still
  # accepted so the assertion tests the BEHAVIOUR (a SKIP is recorded) rather than one
  # spelling of it.
  grep -qE 'GATE_5_DETAIL="not_selected"|xp_gate_detail_append GATE_5_DETAIL "not_selected"' <<< "$HOOK_TEXT"
  grep -q 'GATE_3_REASON="not_selected"' <<< "$HOOK_TEXT"
  grep -q 'GATE_4_REASON="not_selected"' <<< "$HOOK_TEXT"
}

@test "AC-GATESEL-03: Gate 3 and Gate 4 are gated at the source site, not inside gate-N.sh" {
  # GATE_DIR resolves through three tiers and on an installed machine lands on
  # ~/.config/xp-gate/adapters/ -- a COPY without this change. An edit inside
  # gate-3.sh/gate-4.sh is inert there (verified against a real build: GATE_DIR
  # was /c/Users/think/.config/xp-gate/adapters). The check must live in
  # pre-commit so it works against either copy.
  _load_gate_chain
  grep -q 'if gate_enabled 3; then' <<< "$HOOK_TEXT"
  grep -q 'if gate_enabled 4; then' <<< "$HOOK_TEXT"
}

# ── AC-GATESEL-04: the selector is refused on a protected branch ─────────────

@test "AC-GATESEL-04: pre-commit refuses the selector on a protected branch" {
  _load_gate_chain
  # Refused outright, not silently ignored: a scripted
  # `XP_GATE_ONLY_GATE=1 git commit` on a protected branch must fail loudly
  # rather than appear to have run the full chain.
  grep -q 'is not allowed on protected branch' <<< "$HOOK_TEXT"
  grep -q 'exit 1' <<< "$HOOK_TEXT"
}

@test "AC-GATESEL-04: a active selection prints a visible PARTIAL GATE RUN banner" {
  _load_gate_chain
  grep -q 'PARTIAL GATE RUN' <<< "$HOOK_TEXT"
  grep -q 'This commit has NOT been checked against the gates it skips' <<< "$HOOK_TEXT"
}

# ── AC-GATESEL-05: EVERY gate honors the selector, not just the early ones ────
#
# The selector was implemented for Gates 0-5 only. Gates 6, 7, 8, 9, 10, 11, 12,
# 12b, 12c and 13 ignored it completely, so `XP_GATE_ONLY_GATE=5 git commit`
# printed the PARTIAL GATE RUN banner and "Gates not named are recorded as
# SKIP/not_selected" while semgrep, jscpd, gitleaks, the arch+boy-scout scan and
# the compiler-strictness pass all ran anyway.
#
# Measured 2026-11-16 on this host: one sandboxed hook run costs 38-90 s, and
# `semgrep --version` alone is 7-12 s (Python import tax). The selector exists to
# re-check ONE gate while iterating on it; a selector that skips only the cheap
# gates and still pays for the expensive ones does not do that, and its own
# banner tells the operator the opposite of what happened.
#
# The test is deliberately about EVERY id in XP_GATE_ORDER rather than a fixed
# list of gate numbers: a gate added later without the guard would otherwise
# reintroduce the same silent partial run.

# Read the ids the driver actually runs, so the assertion cannot drift from it.
_gate_order_ids() {
  sed -n 's/^XP_GATE_ORDER="\([^"]*\)".*/\1/p' "$BATS_TEST_DIRNAME/../gate-driver.sh" | tr ' ' '\n' | grep -v '^$'
}

@test "AC-GATESEL-05: the gate order is discoverable (anti-vacuity)" {
  local ids
  ids="$(_gate_order_ids)"
  [ -n "$ids" ]
  # Sanity: the chain is the full pre-commit ladder, not a stub.
  [ "$(printf '%s\n' "$ids" | wc -l)" -ge 10 ]
}

@test "AC-GATESEL-05: every gate in XP_GATE_ORDER consults gate_enabled" {
  local ids id missing
  ids="$(_gate_order_ids)"
  missing=""
  for id in $ids; do
    local entry="$BATS_TEST_DIRNAME/../gate-entries/gate-${id}-entry.sh"
    # 12b/12c have their own entry files named exactly that way.
    if [ ! -f "$entry" ]; then
      missing="$missing ${id}(no-entry-file)"
      continue
    fi
    # The guard may be `gate_enabled N` or `! gate_enabled N` (the latter is the
    # shape every existing gate uses to take its SKIP branch).
    if ! grep -qE "(^|[^a-z_])gate_enabled +${id}([^0-9]|$)" "$entry"; then
      missing="$missing $id"
    fi
  done
  if [ -n "$missing" ]; then
    echo "gates in XP_GATE_ORDER that never consult gate_enabled:$missing" >&2
    echo "Each one runs on every commit even when XP_GATE_ONLY_GATE excludes it," >&2
    echo "while the hook's own banner claims they were recorded as SKIP/not_selected." >&2
    return 1
  fi
}

@test "AC-GATESEL-05: a deselected late gate records SKIP/not_selected, not PASS" {
  # Consulting the selector is not enough: the branch must also set the SKIP
  # detail, otherwise the journal records a pass for a gate that never ran --
  # the exact failure AC-GATESEL-03 pins for the early gates.
  local ids id bad
  ids="$(_gate_order_ids)"
  bad=""
  for id in $ids; do
    local entry="$BATS_TEST_DIRNAME/../gate-entries/gate-${id}-entry.sh"
    [ -f "$entry" ] || continue
    grep -q "not_selected" "$entry" || bad="$bad $id"
  done
  if [ -n "$bad" ]; then
    echo "gates that consult no not_selected detail:$bad" >&2
    return 1
  fi
}
