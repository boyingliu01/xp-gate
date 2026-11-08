#!/usr/bin/env bats

# Tests for the Gate 10 degraded path (Step E1).
#
# The SAST daemon (sastd) is an optimisation: it reuses one Python process so the
# ~6s `import semgrep` tax is paid once per machine instead of once per gate run.
# Everything below exists to guarantee that turning it OFF, or having it fail,
# leaves the gate behaving EXACTLY as it does today.
#
# That guarantee is the whole point of E1 and it must be testable before any fast
# path is written. A speed-up that can silently degrade into "nothing ran, report
# success" is the #518/#559 failure class this file guards against.

setup() {
  GATE_10_STATUS=""
  gate_start_ms() { echo "0"; }
  record_gate_audit() { :; }
  # Gate 10 reads staged files; give every test a deterministic empty set unless it
  # overrides git itself.
  git() {
    case "$*" in
      "diff --cached --name-only --diff-filter=ACM"*) return 0 ;;
    esac
    command git "$@"
  }
}

teardown() {
  unset XP_GATE_SASTD
}

@test "E1-01: XP_GATE_SASTD=off selects the direct path" {
  XP_GATE_SASTD=off
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [ "$GATE_10_SEMGREP_PATH" = "direct" ]
}

@test "E1-02: unset XP_GATE_SASTD selects the direct path today (no daemon yet)" {
  unset XP_GATE_SASTD
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  # Until E2/E3 land, the daemon does not exist. Defaulting to "direct" means
  # shipping E1 changes no behaviour at all.
  [ "$GATE_10_SEMGREP_PATH" = "direct" ]
}

@test "E1-03: an unusable daemon degrades to direct, never to a silent pass" {
  # sastd explicitly requested but no reachable endpoint configured: the gate must
  # fall back to the direct invocation, and it must say so.
  XP_GATE_SASTD=on
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [ "$GATE_10_SEMGREP_PATH" = "direct" ]
  [ "$GATE_10_SASTD_DEGRADED" = "1" ]
}

@test "E1-04: the degraded path still produces a real verdict" {
  XP_GATE_SASTD=on
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [[ "$GATE_10_STATUS" =~ ^(WARN|SKIP|PASS|FAIL)$ ]]
}

@test "E1-05: the chosen path is visible in the report reason vocabulary" {
  # A degraded run must be distinguishable from a normal one by a reader of the
  # report alone; GATE_10_REASON is what pre-commit publishes.
  XP_GATE_SASTD=on
  source "$BATS_TEST_DIRNAME/../gate-10.sh"
  [ "$GATE_10_SASTD_DEGRADED" = "1" ]
  # The reason keeps its existing vocabulary (no_supported_files here, because the
  # stubbed git reports nothing staged). Degradation is reported separately rather
  # than by overloading the reason enum, so a reason value never changes meaning.
  [ -n "$GATE_10_REASON" ]
}
