#!/usr/bin/env bats
# @test REQ-798-GATE-ORDER
# @intent #798 asked for the pre-commit gates to run in cost order, with the
# @intent expensive automated test suite last. The user then specified the
# @intent semantic ordering they actually want, which is a different axis:
# @intent
# @intent   Gate-Compile        first — the compiler is the cheapest static
# @intent                        check for a compiled language, and if it fails
# @intent                        nothing downstream is worth running
# @intent   Gate-StaticCheck    pluggable third-party linters
# @intent   Gate-SimianCheck    duplicate code
# @intent   Gate-CCNCheck       cyclomatic complexity (warn 5, block 10)
# @intent   Gate-SecurityCheck  secrets, SAST, IaC
# @intent   Gate-RegressiveTest automated regression suite
# @intent
# @intent Why order at all: a gate that BLOCKs ends the run, so a cheap gate
# @intent placed late lets an expensive gate run for a commit that will be
# @intent rejected anyway. Putting the compiler first means a broken build fails
# @intent in seconds instead of after the full test suite.
# @intent
# @intent HOW THE ORDER IS REPRESENTED NOW (#798 final shape)
# @intent   The order USED to BE the physical order of 16 inline blocks in a
# @intent   6341-line hook. That made it impossible to change safely: an attempt
# @intent   at reordering also moved the hook epilogue, after which every gate
# @intent   past it silently stopped running while `bash -n`, a line count and
# @intent   five ordering assertions all passed. Gate 5a stopped blocking commits
# @intent   and only a behavioural fingerprint caught it.
# @intent
# @intent   The order is now DATA: XP_GATE_ORDER in githooks/gate-driver.sh, with
# @intent   one body per gate in githooks/gate-entries/. These assertions read
# @intent   that list rather than scanning line numbers, because line numbers
# @intent   were never the contract — and pinning them is what made the previous
# @intent   approach look verified while being wrong.
# @covers AC-798-ORD-01: Gate 13 (compiler strictness) executes before Gate 1
# @covers AC-798-ORD-02: execution order matches the six declared classes
# @covers AC-798-ORD-03: regression tests (Gate 5) run LAST of the six classes
# @covers AC-798-ORD-04: a gate number is a label, so identity is preserved
# @covers AC-798-ORD-05: every existing gate still executes exactly once

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  DRIVER="$REPO_ROOT/githooks/gate-driver.sh"
  ENTRIES="$REPO_ROOT/githooks/gate-entries"
  [ -f "$HOOK" ]
  [ -f "$DRIVER" ]
  [ -d "$ENTRIES" ]

  # The single source of truth for order.
  ORDER=$(sed -n 's/^XP_GATE_ORDER="\([^"]*\)".*/\1/p' "$DRIVER" | head -1)
  [ -n "$ORDER" ]
}

# Echo the 1-based position of gate $1 in XP_GATE_ORDER, or nothing.
_order_pos() {
  local target="$1" i=0 key
  for key in $ORDER; do
    i=$((i + 1))
    if [ "$key" = "$target" ]; then
      echo "$i"
      return 0
    fi
  done
  return 0
}

# Assert gate $1 is positioned strictly before gate $2.
_assert_before() {
  local a="$1" b="$2" pa pb
  pa=$(_order_pos "$a")
  pb=$(_order_pos "$b")
  if [ -z "$pa" ] || [ -z "$pb" ]; then
    echo "gate $a or gate $b is missing from XP_GATE_ORDER ($ORDER)"
    return 1
  fi
  if [ "$pa" -ge "$pb" ]; then
    echo "Gate $a must execute before Gate $b, but the order is: $ORDER"
    return 1
  fi
}

@test "AC-798-ORD-01: Gate 13 compiler strictness executes before Gate 1" {
  # The compiler is the cheapest static analysis tool available for a compiled
  # language and the strictest gate that does not need a third-party install.
  # If it fails, every later check is wasted work on a commit that cannot land.
  _assert_before 13 1
}

@test "AC-798-ORD-02: the six classes execute in their declared order" {
  # Each class is represented by the gate that marks its BOUNDARY - the last
  # member to execute. Gate 9 closes the compile class (13 then 9); Gate 7 closes
  # the security class (8, 10 then 7). Using the closing member means a member
  # that drifts past the class boundary still fails the test.
  _assert_before 13 9
  _assert_before 9 1
  _assert_before 1 2
  _assert_before 2 3
  _assert_before 3 8
  _assert_before 8 10
  _assert_before 10 7
  _assert_before 7 5
}

@test "AC-798-ORD-03: regression tests are the LAST of the six classes" {
  # This is the entire point of #798: the test run plus coverage is the most
  # expensive gate, so no cheaper gate that can still reject the commit may
  # execute after it.
  local others
  for others in 0 11 12 12b 12c 13 9 1 2 3 8 10 7; do
    # Only gates that appear in the order can be compared.
    if [ -n "$(_order_pos "$others")" ]; then
      _assert_before "$others" 5
    fi
  done
}

@test "AC-798-ORD-04: gate numbers stay labels - every registry row still resolves" {
  # The reorder changes EXECUTION ORDER, it must not renumber. Gate N keeps the
  # identity the registry binds to it, because the registry is what other
  # tooling (report keys, XP_GATE_ONLY_GATE selection, doctor, gate-coverage)
  # resolves against. A renumber would silently repoint every one of those.
  source "$REPO_ROOT/githooks/gate-registry.sh"
  local row name num impl blocks hook

  for row in "${GATE_REGISTRY[@]}"; do
    IFS='|' read -r num name impl blocks hook <<< "$row"
    [ "$hook" = "pre-commit" ] || continue
    [ -n "$name" ] || { echo "registry row $num has no name"; return 1; }
    [ -n "$impl" ] || { echo "registry row $num has no implementation"; return 1; }
  done

  # All 14 numbers still resolve.
  local n count=0
  for n in 0 1 2 3 4 5 6 7 8 9 10 11 12 13; do
    if grep -q "|${n}|" "$REPO_ROOT/githooks/gate-registry.sh" 2>/dev/null; then
      count=$((count + 1))
    fi
  done
  if [ "$count" -lt 14 ]; then
    echo "expected 14 numbered gates in the registry, found $count"
    return 1
  fi
}

@test "AC-798-ORD-05: each gate still has exactly one execution point" {
  # With a data-driven order, "exactly once" means: listed once in the order AND
  # defined once in the entry files. A gate listed twice would run twice; a gate
  # defined twice would have its second definition silently shadow the first.
  local key n files f defs base
  for key in $ORDER; do
    n=$(printf '%s\n' $ORDER | grep -cx "$key" || true)
    if [ "$n" -ne 1 ]; then
      echo "gate $key appears $n times in XP_GATE_ORDER, expected exactly 1"
      return 1
    fi

    files=$(ls "$ENTRIES"/gate-"$key"-entry.sh 2>/dev/null | wc -l | tr -d ' ')
    if [ "$files" -ne 1 ]; then
      echo "gate $key has $files entry file(s), expected exactly 1"
      return 1
    fi
    f="$ENTRIES/gate-${key}-entry.sh"
    defs=$(grep -cE "^gate_${key}_run\(\) \{" "$f" || true)
    if [ "$defs" -ne 1 ]; then
      echo "gate $key defines gate_${key}_run $defs time(s), expected exactly 1"
      return 1
    fi
  done

  # No orphan entry files: a body nobody orders is dead code that looks live.
  for f in "$ENTRIES"/gate-*-entry.sh; do
    [ -f "$f" ] || continue
    base=$(basename "$f" | sed 's/^gate-//; s/-entry\.sh$//')
    if [ -z "$(_order_pos "$base")" ]; then
      echo "entry file $(basename "$f") exists but gate '$base' is not in XP_GATE_ORDER"
      return 1
    fi
  done
}
