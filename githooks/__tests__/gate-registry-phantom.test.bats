#!/usr/bin/env bats
# @test REQ-REGISTRY-PHANTOM
#
# @intent A gate can exist in three places independently: a registry row, a row in
# the generated report, and code that actually runs. Any TWO of those agreeing is
# enough to look verified, which is exactly how three gates stayed phantom.
#
# Measured 2026-11-20 on this repo's own pre-push report:
#
#     M2  SKIP  details: {}
#     ML  SKIP  details: {}
#     UI  SKIP  details: {}
#
# all three always skipping, forever, in every push. The registry lists all three
# (mock-density / mock-layering / ui-sprint, the last two marked "can run
# standalone = YES"), and the report prints a row for each -- so a reader sees a
# gate that skipped for a reason it never states. But no code implements any of
# them: `grep -rn "mock-layering"` finds the registry row and nothing else.
#
# A SKIP that can never become a PASS is not a skip. It is an absence wearing a
# skip's clothes, and it is indistinguishable from the real gates beside it.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  REGISTRY="$REPO_ROOT/githooks/gate-registry.sh"
  PRE_PUSH="$REPO_ROOT/githooks/pre-push"
}

# Every gate id the pre-push report template emits, one per line.
report_gate_ids() {
  grep -oE "'id': '[A-Z0-9-]+'" "$PRE_PUSH" | sed "s/'id': '//; s/'//"
}

# @covers the report row and the implementation are the same fact
@test "every gate id emitted by the pre-push report has an implementation" {
  local missing=""
  local id
  while read -r id; do
    [ -z "$id" ] && continue
    # Take the variable this row's template entry ACTUALLY interpolates, not one
    # derived from the gate number: Gate MW is named MW but assigns
    # GATE_DELPHI_STATUS. Then ask whether any non-printf line assigns it -- the
    # template only PRINTS it, so print-only means nothing can ever change it.
    local var
    var=$(grep -F "'id': '${id}'" "$PRE_PUSH" \
      | grep -oE '\$\{GATE_[A-Z0-9_]+_STATUS' | head -1)
    var=${var#\$\{}
    if [ -z "$var" ]; then
      missing="$missing ${id}(no-status-variable)"
      continue
    fi
    local assignments
    assignments=$(grep -E "^[[:space:]]*${var}=" "$PRE_PUSH" | wc -l | tr -d ' ')
    if [ "$assignments" -eq 0 ]; then
      missing="$missing ${id}(${var}-never-assigned)"
    fi
  done < <(report_gate_ids)

  if [ -n "$missing" ]; then
    echo "Gates printed in the report that no code can ever set:$missing"
    echo "Each one reports SKIP forever and is indistinguishable from a real gate."
    return 1
  fi
}

# @covers the row's declared implementation actually exists
@test "every pre-push registry row names an implementation that exists" {
  # Column layout: name|number|implementation|can_block|trigger
  #   implementation == "inline"  -> the hook must have code for it
  #   implementation == "<file>"  -> that file must exist and be invoked
  local offenders=""
  local checked=0
  local name num impl standalone trigger _rest
  while IFS='|' read -r name num impl standalone trigger _rest; do
    name=$(printf '%s' "${name//\"/}" | tr -d '[:space:]')
    num=$(printf '%s' "${num//\"/}" | tr -d '[:space:]')
    impl=$(printf '%s' "${impl//\"/}" | tr -d '[:space:]')
    trigger=$(printf '%s' "${trigger//\"/}" | tr -d '[:space:]')
    [ "$trigger" = "pre-push" ] || continue
    checked=$((checked + 1))

    if [ "$impl" = "inline" ]; then
      # The variable this row's report entry actually reads. Taken from the template
      # rather than derived from the gate number, because Gate MW's row is "MW" while
      # its variable is GATE_DELPHI_STATUS (a name kept for compatibility).
      local var
      var=$(grep -F "'id': '${num}'" "$PRE_PUSH" \
        | grep -oE '\$\{GATE_[A-Z0-9_]+_STATUS' | head -1)
      # Strip the ${ prefix with bash expansion, not sed: the brace is a regex
      # metacharacter and 's/^\$\{//' is not a valid sed address on every build.
      var=${var#\$\{}
      if [ -z "$var" ]; then
        offenders="$offenders ${name}(${num}:no-status-variable-in-report)"
        continue
      fi
      # Assigned by code means: appears as VAR="..." on a line that is not printf.
      local sets
      sets=$(grep -E "^[[:space:]]*${var}=" "$PRE_PUSH" 2>/dev/null | wc -l | tr -d ' ')
      [ -z "$sets" ] && sets=0
      if [ "$sets" -eq 0 ]; then
        offenders="$offenders ${name}(${num}:${var}-never-assigned)"
      fi
    else
      # A named script must exist somewhere the hook can reach.
      if ! find "$REPO_ROOT/githooks" "$REPO_ROOT/scripts" -name "$impl" 2>/dev/null \
           | grep -q .; then
        offenders="$offenders ${name}(${num}:${impl}-missing)"
      fi
    fi
  done < <(grep -E '^[[:space:]]*"[a-z-]+\|[A-Z0-9]+\|' "$REGISTRY")

  if [ "$checked" -eq 0 ]; then
    echo "Registry parse examined 0 pre-push rows -- the check did not run."
    return 1
  fi

  if [ -n "$offenders" ]; then
    echo "Registry rows whose implementation cannot be found:$offenders"
    return 1
  fi
}
