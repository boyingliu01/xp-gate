#!/usr/bin/env bats
#
# @test REQ-GATE-STATUS-CALL-SITE The verdict helpers must be called in the
#       current shell
# @intent Round-3 review (expert B, MC-04): `xp_gate_status_escalate` and
#         `xp_gate_detail_append` update a caller variable via `printf -v`. Inside
#         a pipeline or command substitution that update lands in a subshell and
#         is discarded -- the line still runs, nothing errors, and the gate keeps
#         its previous verdict. That is the same silent-failure shape this helper
#         exists to remove, one layer down.
#
#         Verified at review time: the update IS lost in a pipe:
#             D="base"; echo x | while read _; do xp_gate_detail_append D "y"; done
#             -> D stays "base"
#
#         Audited 2026-11-24: no existing call site is inside a pipeline. This
#         test keeps it that way.
#
# @covers AC-GATE-STATUS-CALL-SITE-01
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

@test "AC-GATE-STATUS-CALL-SITE-01: no verdict-helper call sits on the right of a pipe" {
  local offenders=""
  local f
  for f in "$REPO_ROOT"/githooks/gate-entries/*.sh "$REPO_ROOT"/githooks/adapters/*.sh; do
    [ -f "$f" ] || continue
    # A pipe followed later on the same line by one of the helpers. Command
    # substitution is caught by the second pattern.
    local hits
    hits=$(grep -nE '\|[^|]*(xp_gate_status_escalate|xp_gate_detail_append)' "$f" 2>/dev/null || true)
    hits="${hits}$(grep -nE '\$\((xp_gate_status_escalate|xp_gate_detail_append)' "$f" 2>/dev/null || true)"
    if [ -n "$hits" ]; then
      offenders="${offenders}${f}: ${hits}
"
    fi
  done
  if [ -n "$offenders" ]; then
    printf 'verdict helper called in a subshell (the update is discarded):\n%s' "$offenders"
    return 1
  fi
}
