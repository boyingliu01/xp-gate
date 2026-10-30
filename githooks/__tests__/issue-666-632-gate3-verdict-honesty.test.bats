#!/usr/bin/env bats
# @test REQ-666, REQ-632
# @intent Gate 3 had two ways of mis-labelling a perfectly ordinary commit, and
#         both come from the same habit: inferring a verdict from ABSENCE instead
#         of from evidence.
#
#         #666: a module of pure constants has no functions. lizard prints no CSV
#         row for it (measured: `lizard pure_data.py --csv` emits nothing and
#         exits 0), so the "no parsable rows" guard fired and the gate reported
#         `lizard_output_unparsable` / WARN. That is the message for a BROKEN
#         lizard, and it is indistinguishable from one. An empty result set with
#         a healthy lizard means "zero functions to grade", which is a SKIP.
#
#         #632: the PowerShell ratchet reader required `e.name`, but the baseline
#         writer this gate's own fix-it message points at
#         (tools/Update-ComplexityBaseline.ps1) emits the key as `e.function`.
#         Every entry was dropped, `known` stayed empty, and every function above
#         the threshold was reported as a brand-new function -- a ratchet that can
#         never pass. The reader must accept both spellings: it is a READER, and
#         the writer's vocabulary is not ours to change from here.
# @covers AC-670-01, AC-670-01, AC-632-01, AC-632-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE3="$REPO_ROOT/githooks/gate-3.sh"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
}

# AC-670-01: the "zero rows" verdict must name which of the two causes it is.
# The gate distinguishes them by asking its own lizard to describe a file it
# definitely can parse: if that yields rows, lizard works and the input simply
# contained no functions.
@test "AC-670-01: gate-3 distinguishes 'no functions in input' from a broken lizard" {
  run grep -c 'no_functions_in_input\|lizard_healthy_no_functions' "$GATE3"
  [ "$output" -ge 1 ]

  # The proof must be a POSITIVE probe (run lizard on a known-parseable fixture),
  # not a second reading of the same empty output.
  run grep -qE '_lizard_probe|probe_output|__probe' "$GATE3"
  [ "$status" -eq 0 ]
}

# AC-670-01: the SKIP reason for the empty-but-healthy case is its own token, so a
# report reader can tell it from the genuine parse failure.
@test "AC-670-01: the healthy-empty case reports no_functions_in_input, not lizard_output_unparsable" {
  run grep -q 'GATE_3_REASON="no_functions_in_input"' "$GATE3"
  [ "$status" -eq 0 ]

  # And the genuine failure keeps its own reason: the two must not collapse.
  run grep -q 'GATE_3_REASON="lizard_output_unparsable"' "$GATE3"
  [ "$status" -eq 0 ]
}

# AC-632-01: the reader accepts the writer's spelling.
@test "AC-632-01: the PowerShell baseline reader accepts e.function as well as e.name" {
  run grep -qE 'e\.function' "$GATE3"
  [ "$status" -eq 0 ]
  run grep -qE 'e\.name' "$GATE3"
  [ "$status" -eq 0 ]
}

# AC-632-02: behaviourally, a baseline written with `function` keys must produce a
# MATCH (not "new function"). This drives the real embedded JS out of the gate
# rather than grepping it: extract the node program, hand it a baseline in the
# documented format, and require that a function present in it is not reported as
# new.
@test "AC-632-02: a baseline using 'function' keys matches, so no false new-function block" {
  local js baseline out
  # The embedded program is the single-quoted `node -e` payload of the PS verdict:
  # it opens on the line ending in `-e '` and closes on the first line that is
  # exactly `              '`.
  # The embedded program sits between the line opening `node -e '` and the line
  # that hands it the baseline path. Extract by those two anchors rather than by
  # indentation, which the surrounding shell reflows freely.
  local start end
  start=$(grep -n "PS_CC_VERDICT=\$(printf" "$GATE3" | head -1 | cut -d: -f1)
  end=$(grep -n '"$PS_BASELINE" "\$PS_CC_THRESHOLD"' "$GATE3" | head -1 | cut -d: -f1)
  if [ -z "$start" ] || [ -z "$end" ] || [ "$end" -le "$start" ]; then
    skip "embedded reader program not locatable in this revision"
  fi
  js=$(sed -n "$((start + 1)),$((end - 1))p" "$GATE3")
  if [ -z "$js" ]; then
    skip "embedded reader program not extractable in this revision"
  fi
  baseline="$BATS_TEST_TMPDIR/base.json"
  cat > "$baseline" <<'JSON'
{ "entries": [ { "file": "scripts/x.ps1", "function": "Main", "line": 10, "ccn": 20 } ] }
JSON
  # Main is at its recorded ccn (20), so it must NOT be a regression; a *new*
  # function above the threshold must be.
  out=$(printf '%s\n' 'OVER scripts/x.ps1:10 Main ccn=20' 'OVER scripts/x.ps1:99 Fresh ccn=30' \
        | node -e "$js" "$baseline" 5 2>&1 || true)
  # The recorded function must be absent from the regression list.
  if printf '%s\n' "$out" | grep -q 'Main *new function'; then
    echo "Main was reported as a new function despite being in the baseline:"
    echo "$out"
    return 1
  fi
  # The genuinely new one must still be caught -- otherwise the test passes by
  # the reader accepting nothing at all.
  printf '%s\n' "$out" | grep -q 'Fresh *new function'
}
