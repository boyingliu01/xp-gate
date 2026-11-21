#!/usr/bin/env bats
#
# @test REQ-GATE-EXT-732 the gates that grade source must see .mjs/.cjs/.mts/.cts
# @intent Four gates selected their input with an extension regex written out
#         four times, and all four omitted the same four extensions:
#
#           Gate 3  (ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt)
#           Gate 4  (ts|tsx|js|jsx|py|go|java|kt|dart|swift|cpp|c|hpp|h|m|mm)
#           Gate 9  (ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift)
#           Gate 10 (ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift|ps1|psm1)
#
#         `.mjs`/`.cjs` are what Node tooling ships by default; `.mts`/`.cts` are
#         their TypeScript counterparts. Measured on a repository with 14
#         in-scope `.mjs`/`.cjs` files, Gate 3 graded none of the 24 production
#         functions above CCN 5 in them, and the SAST gates never handed those
#         files to semgrep — which flagged 6 ERROR-level findings when run on the
#         same files directly.
#
#         The gates reported SKIP, which was correct FOR THE FILE LIST THEY WERE
#         GIVEN. That is the defect: the file was never a candidate, so "not
#         checked" and "checked and clean" produced the same output.
#
#         The fix is one shared list (#732's own suggestion), not four edits.
#         These tests pin the shared list AND the four call sites, because a
#         shared list nobody sources fixes nothing.
#
# @covers AC-732-01  the shared classifier covers mjs, cjs, mts, cts
# @covers AC-732-02  Gate 3 selects .mjs/.cjs, not only .js
# @covers AC-732-03  Gate 4 selects .mjs/.cjs
# @covers AC-732-04  Gate 10 (the SAST gate) selects .mjs/.cjs
# @covers AC-732-05  an unknown family is an error, never an empty list
# @covers AC-732-06  the regex is anchored, so foo.mjs.bak is not a source file
#
# #732 body says "Gate 9 (SAST)". That was already wrong when the issue was filed:
# `xp-gate gate-capability` reports 9 = build-integrity and 10 = sast, and
# gate-registry.sh carries the same note from #717 (a C# SAST fix was once written
# into a gate-9.sh that is not sourced). There is no gate-9.sh to patch. The SAST
# extension filter this test must pin is gate-10.sh's.
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  CLASSIFIER="$REPO_ROOT/githooks/lib/file-classifier.sh"
  GATE3="$REPO_ROOT/githooks/adapters/gate-3.sh"
  GATE3_TWIN="$REPO_ROOT/githooks/gate-3.sh"
  GATE4="$REPO_ROOT/githooks/adapters/gate-4.sh"
  GATE10="$REPO_ROOT/githooks/adapters/gate-10.sh"
}

load_classifier() {
  # shellcheck source=/dev/null
  . "$CLASSIFIER"
}

@test "AC-732-01: the shared classifier names mjs, cjs, mts and cts for every family" {
  load_classifier

  for family in ccn principles semgrep; do
    local exts
    exts="$(xp_gate_source_exts "$family")"
    for want in mjs cjs mts cts; do
      case "|$exts|" in
        *"|$want|"*) : ;;
        *)
          echo "family '$family' is missing '$want': $exts"
          false
          ;;
      esac
    done
  done
}

@test "AC-732-02: Gate 3 selects .mjs and .cjs, and its twin agrees" {
  # The gate-3 twin is byte-identical by contract; the comment above its file
  # list says a fix that lands in only one of them leaves the other silently
  # wrong. Pin both.
  run grep -F "file-classifier.sh" "$GATE3"
  [ "$status" -eq 0 ] || {
    echo "Gate 3 does not source the shared classifier"
    false
  }

  run diff -q "$GATE3" "$GATE3_TWIN"
  [ "$status" -eq 0 ] || {
    echo "gate-3.sh and adapters/gate-3.sh have drifted apart"
    false
  }

  # The old literal must be gone; leaving it beside the sourced list would keep
  # the narrower population in effect.
  run grep -F 'grep -E '"'"'\.(ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt|cs|dart|php|phtml)$'"'"'' "$GATE3"
  [ "$status" -ne 0 ] || {
    echo "Gate 3 still filters with the hardcoded extension literal"
    false
  }
}

@test "AC-732-03: Gate 4 selects .mjs and .cjs" {
  run grep -F "file-classifier.sh" "$GATE4"
  [ "$status" -eq 0 ] || {
    echo "Gate 4 does not source the shared classifier"
    false
  }

  run grep -F 'grep -E '"'"'\.(ts|tsx|js|jsx|py|go|java|kt|dart|swift|cpp|c|hpp|h|m|mm|cs|php)$'"'"'' "$GATE4"
  [ "$status" -ne 0 ] || {
    echo "Gate 4 still filters with the hardcoded extension literal"
    false
  }
}

@test "AC-732-04: Gate 10 (the SAST gate) selects .mjs and .cjs" {
  run grep -F "file-classifier.sh" "$GATE10"
  [ "$status" -eq 0 ] || {
    echo "Gate 10 does not source the shared classifier"
    false
  }

  run grep -F 'grep -E '"'"'\.(ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift|ps1|psm1)$'"'"'' "$GATE10"
  [ "$status" -ne 0 ] || {
    echo "Gate 10 still filters with the hardcoded extension literal"
    false
  }
}

@test "AC-732-05: an unknown family is an error, not an empty extension list" {
  # Fail-open guard. If xp_gate_source_exts answered "" for a typo'd family, the
  # gate would build `\.()$`, match nothing, and report a clean SKIP -- the same
  # defect this file exists to remove, reintroduced by its own API.
  load_classifier

  # stdout must stay empty even though the reason goes to stderr: a caller that
  # does `exts=$(xp_gate_source_exts "$family")` without checking the status
  # must not receive the error text as its extension list.
  run xp_gate_source_exts nosuchfamily
  [ "$status" -ne 0 ] || {
    echo "an unknown family returned success; expected a non-zero status"
    false
  }
  local out
  out="$(xp_gate_source_exts nosuchfamily 2>/dev/null || true)"
  [ -z "$out" ] || {
    echo "an unknown family printed to stdout: $out"
    false
  }
}

@test "AC-732-06: the regex is anchored, so a backup file is not graded" {
  # `\.(js)$` must not match `foo.mjs.bak`. An unanchored pattern would sweep in
  # editor backups and, worse, make the population depend on filename suffixes
  # nobody intended to grade.
  load_classifier

  local pat
  pat="$(xp_gate_ext_regex "$(xp_gate_source_exts ccn)")"

  echo "src/tool.mjs" | grep -qE "$pat" || {
    echo "tool.mjs was not selected"
    false
  }
  echo "src/tool.cjs" | grep -qE "$pat" || {
    echo "tool.cjs was not selected"
    false
  }

  if echo "src/tool.mjs.bak" | grep -qE "$pat"; then
    echo "tool.mjs.bak was selected; the pattern is not anchored"
    false
  fi
  if echo "src/tool.mjsx" | grep -qE "$pat"; then
    echo "tool.mjsx was selected; the pattern is not anchored"
    false
  fi
}
