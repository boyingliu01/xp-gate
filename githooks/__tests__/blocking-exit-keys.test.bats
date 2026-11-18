#!/usr/bin/env bats
#
# @test REQ-AUDIT-BLOCKING-EXIT-KEYS
# @intent A block raised by gate 12b or 12c was journaled as gate "unknown"
#         with no reason.
#
#         _record_blocking_exit() finds the gate that called exit by scanning
#         its status variables:
#
#             for _i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13; do
#               _st_var="GATE_${_i}_STATUS"
#
#         That list enumerates every gate NUMBER, and gates 12b and 12c are not
#         numbers. A block raised by either one left _bg_id empty, fell through
#         to:
#
#             _bg_name="unknown"
#             [ -n "$_bg_id" ] || _bg_id="unknown"
#
#         and the journal recorded a blocker whose name and reason were both
#         absent -- in the one case where "which gate stopped this commit" is the
#         whole point of the record.
#
#         Verified before fixing: `${!var}` indirect expansion works for keys
#         containing a letter, so this is a list bug, not a bash limitation.
#
# @covers AC-AUDIT-BLOCKING-01 AC-AUDIT-BLOCKING-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO/githooks/pre-commit"
}

# Extract the gate-key list from the blocking-exit loop.
blocking_exit_keys() {
  sed -n '/_record_blocking_exit()/,/^}/p' "$HOOK" \
    | sed -n 's/.*for _i in \(.*\); do.*/\1/p' \
    | head -1
}

@test "AC-AUDIT-BLOCKING-01: the scan covers every registered gate key" {
  local keys
  keys=$(blocking_exit_keys)
  [ -n "$keys" ] || {
    echo "could not locate the gate-key loop in _record_blocking_exit"
    return 1
  }

  # The registry is the authority for which keys exist. Every one of them must
  # be scannable here, or a block it raises is unattributable.
  #
  # Rows are written with a LEADING QUOTE --   "name|KEY|file|CAN_RUN|hook"
  # The first version of this test left that quote out of the pattern, matched
  # zero rows, looped over an empty set, and passed. A guard over an empty
  # collection is not a guard; hence the explicit non-empty assertion below.
  local known
  known=$(grep -oE '^  "[^"]+\|(0|1|2|3|4|5|6|7|8|9|10|11|12|12b|12c|13)\|' \
    "$REPO/githooks/gate-registry.sh" | awk -F'|' '{print $2}' | sort -u)

  [ -n "$known" ] || {
    echo "extracted no gate keys from the registry -- the pattern is wrong,"
    echo "and every assertion below would pass vacuously"
    return 1
  }
  # And it must have found the two keys this fix exists for.
  case "$(echo $known)" in
    *12b*12c*|*12c*12b*) : ;;
    *) echo "registry extraction lost 12b/12c; got: $known"; return 1 ;;
  esac

  local missing=""
  local k
  for k in $known; do
    case " $keys " in
      *" $k "*) : ;;
      *) missing="$missing $k" ;;
    esac
  done
  [ -z "$missing" ] || {
    echo "gates missing from the blocking-exit scan:$missing"
    echo "scan list is: $keys"
    return 1
  }
}

@test "AC-AUDIT-BLOCKING-02: 12b and 12c have a journal name, not 'unknown'" {
  # Symbolic on purpose: a name table that lacks the key records "unknown" even
  # once the scan finds it, so both halves must be present.
  local table
  table=$(sed -n '/Gate names for the journal/,/^  esac/p' "$HOOK")

  [[ "$table" == *"12b)"* ]] || {
    echo "no journal name for gate 12b; a block from it records 'unknown'"
    return 1
  }
  [[ "$table" == *"12c)"* ]] || {
    echo "no journal name for gate 12c; a block from it records 'unknown'"
    return 1
  }
}