#!/usr/bin/env bats
# @test REQ-GATE-JOURNAL-DETAIL-REACHES
#
# @intent A gate that computed the reason it could not check something has to
# HAND it to the journal. `record_gate_audit`'s sixth argument is that hand-off:
#
#     record_gate_audit <gate_id> <name> <status> <issues> <start_ms> [detail]
#
# It defaults to empty, so a caller that omits it is not an error -- the line is
# still written, still has a status, and looks complete. That is exactly why this
# survived: the journal entry is well-formed, it just does not say why.
#
# MEASURED 2026-11-22 on this repository's own journal, at one commit:
#
#     gate-4   SKIP   detail ""
#     gate-6   SKIP   detail ""
#     gate-10  SKIP   detail ""
#
# while each had a reason variable already assigned:
#
#     GATE_4_REASON   set on six arms (documentation_project, tool_not_installed,
#                     checker_not_found, no_matching_files_changed, ...)
#     GATE_10_REASON  set on seven arms (tool_not_installed, no_supported_files,
#                     semgrep_timeout, output_unparseable, zero_rules, ...)
#     GATE_6_DETAIL   passed by gate-6's own early-return arm and NOT by its main
#                     exit point -- so the gate was inconsistent with itself
#
# A SKIP whose reason is computed and then dropped is the family's core failure
# in miniature: the information existed, the channel existed, nothing connected
# them. See AGENTS.md: "SKIP must be recorded, not merely printed".

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  G4="$REPO_ROOT/githooks/gate-4.sh"
  G10="$REPO_ROOT/githooks/gate-10.sh"
  G6="$REPO_ROOT/githooks/gate-entries/gate-6-entry.sh"
}

# @covers gate 4 hands its reason to the journal
@test "gate-4 passes GATE_4_REASON to record_gate_audit" {
  run grep -cE 'record_gate_audit "gate-4".*"\$\{GATE_4_REASON:-\}"' "$G4"
  [ "$output" = "1" ]
}

# @covers gate 10 hands its reason to the journal
@test "gate-10 passes GATE_10_REASON to record_gate_audit" {
  run grep -cE 'record_gate_audit "gate-10".*"\$\{GATE_10_REASON:-\}"' "$G10"
  [ "$output" = "1" ]
}

# @covers gate 6's MAIN exit point agrees with its own early-return arm
@test "gate-6 passes a reason from its main exit point" {
  # The early-return arm already did. A gate that records a reason on one path
  # and not another is worse than one that never does: the journal looks like it
  # carries reasons, so nobody checks whether it always does.
  run grep -cE 'record_gate_audit "gate-6".*"\$\{GATE_6_DETAIL:-\$\{GATE_6_REASON:-\}\}"' "$G6"
  [ "$output" = "1" ]
}

# @covers every record_gate_audit call site is well formed after the change
@test "the edited gates still parse" {
  run bash -n "$G4"
  [ "$status" -eq 0 ]
  run bash -n "$G10"
  [ "$status" -eq 0 ]
  run bash -n "$G6"
  [ "$status" -eq 0 ]
}

# @covers the variable exists before it is handed over
@test "the handed-over reasons are actually assigned somewhere" {
  run grep -cE '^[[:space:]]*GATE_4_REASON=' "$G4"
  [ "$output" -ge 2 ]
  run grep -cE '^[[:space:]]*GATE_10_REASON=' "$G10"
  [ "$output" -ge 2 ]
}

# @covers gate 13's four journal calls all carry the reason
@test "every gate-13 journal call passes GATE_13_DETAIL" {
  # There are four. One carried the detail and three did not, so the same gate
  # recorded a reason on one path and dropped it on the other three -- gate-6's
  # self-inconsistency, three times over, inside a single file.
  run bash -c 'grep -cE "record_gate_audit \"gate-13\".*GATE_13_DETAIL" "$1"' _ "$REPO_ROOT/githooks/gate-entries/gate-13-entry.sh"
  [ "$output" = "4" ]
}

# @covers gate 12 names the hygiene rule that fired
@test "gate-12 records WHICH hygiene check warned, not just how many" {
  # The console printed the rule names; the journal recorded a bare count.
  run grep -c 'GATE_12_DETAIL=' "$REPO_ROOT/githooks/gate-12-file-hygiene.sh"
  [ "$output" -ge 1 ]
  run bash -c 'grep -cE "record_gate_audit \"gate-12\".*GATE_12_DETAIL" "$1"' _ "$REPO_ROOT/githooks/gate-12-file-hygiene.sh"
  [ "$output" -ge 2 ]
}

# @covers the whole set, not a sample: every journal call in every gate
@test "EVERY record_gate_audit call site passes a detail argument" {
  # This is the invariant, checked by parsing the call rather than by grepping for
  # a variable name. Three earlier greps in this very session were wrong -- they
  # missed "$(gate_start_ms)", then counted the ':' in ${X:-0}', then matched a
  # comment -- and each wrong grep looked like a clean bill of health.
  #
  # MEASURED 2026-11-22 before the fix: 35 call sites across 16 gates, of which
  # gate-0 (2/4), gate-6 (1/2), gate-7 (2/2), gate-8 (1/1), gate-9 (1/2),
  # gate-11 (3/4) and gate-12 (1/4) were missing it.
  run node -e '
    const fs = require("fs"), path = require("path");
    const gates = ["0","1","2","3","4","5","6","7","8","9","10","11","12","12b","12c","13"];
    function walk(dir, out = []) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "adapters") walk(p, out); }
        else if (e.name.endsWith(".sh") || !e.name.includes(".")) out.push(p);
      }
      return out;
    }
    const files = walk(process.argv[1] + "/githooks");
    const bad = [];
    for (const g of gates) {
      const needle = `record_gate_audit "gate-${g}"`;
      const f = files.find(p => fs.readFileSync(p, "utf8").includes(needle));
      if (!f) continue;
      const lines = fs.readFileSync(f, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes(needle)) continue;
        let args = 0, depth = 0, inQ = false;
        const start = lines[i].indexOf("record_gate_audit") + 17;
        for (let k = start; k < lines[i].length; k++) {
          const c = lines[i][k];
          if (inQ) { if (c === "\"") inQ = false; continue; }
          if (c === "\"") { if (depth === 0) args++; inQ = true; continue; }
          if (c === "$" && lines[i][k+1] === "(") { depth++; k++; continue; }
          if (c === ")" && depth > 0) { depth--; continue; }
        }
        if (args < 6) bad.push(`gate-${g}:${i + 1}`);
      }
    }
    if (bad.length) { console.log(bad.join(" ")); process.exit(1); }
  ' "$REPO_ROOT"
  [ "$status" -eq 0 ]
}
