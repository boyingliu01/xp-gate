#!/usr/bin/env bats
# @test REQ-584
# @intent Gate 3's ratchet compares every function against `.ccn-baseline.json`,
#         keyed by `file::function` and valued by CCN. That comparison is only
#         meaningful if the analyzer that BUILT the baseline is the analyzer that
#         CHECKS it. Nothing pinned the version, so CI and developers silently ran
#         different ones.
#
#         Measured difference on the same file, same commit:
#
#             $ lizard src/principles/adapters/typescript.ts   # 1.21.3
#             findBodyBrace@64-191   CCN=69        <- one giant function
#
#             $ python -m lizard src/principles/adapters/typescript.ts  # 1.24.2
#             findBodyBrace@64-90    CCN=8
#             findDeclarationBrace@110-139  CCN=18   <- invisible to 1.21.3
#             maskLiterals@242-329   CCN=36          <- invisible to 1.21.3
#
#         1.24.2 nests-detects functions that 1.21.3 swallows into their parent.
#         Neither is wrong; they disagree on what a "function" is. So against a
#         baseline recorded under 1.21.3, every one of those newly-visible
#         functions reports as "new function over block threshold" and the gate
#         emits walls of BLOCKs that describe the analyzer, not the code:
#
#             BLOCK src/principles/adapters/typescript.ts:242 maskLiterals CCN=41
#                   (new function over block threshold 10)
#             BLOCK scripts/ccn-report.cjs:630 run CCN=39 (new function...)
#             ... 40+ more
#
#         An unpinned analyzer turns a complexity ratchet into a complexity random
#         number generator that re-rolls whenever CI's pip resolves a new release.
#
#         Pin: the workflow must install an exact version, and that version must be
#         the one `.ccn-baseline.json` was generated with, recorded in the repo.
# @covers AC-584-01, AC-584-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WF="$REPO_ROOT/.github/workflows/quality-gates.yml"
  # The single source of truth for the analyzer version.
  PIN_FILE="$REPO_ROOT/.lizard-version"
}

@test "AC-584-01: the repo records the lizard version its baseline was built with" {
  [ -f "$PIN_FILE" ] || {
    echo "no $PIN_FILE: the baseline has no declared analyzer version, so nothing"
    echo "stops CI from resolving a different one and invalidating every entry"
    return 1
  }
  local pinned
  pinned=$(tr -d ' \t\r\n' < "$PIN_FILE")
  [[ "$pinned" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
    echo "$PIN_FILE must hold an exact version like 1.21.3, got: '$pinned'"
    return 1
  }
}

@test "AC-584-02: CI installs the pinned lizard version, in the job that runs Gate 3" {
  local pinned
  pinned=$(tr -d ' \t\r\n' < "$PIN_FILE" 2>/dev/null)
  [ -n "$pinned" ] || {
    echo "cannot check the install without $PIN_FILE"
    return 1
  }
  run node - "$WF" "$pinned" << 'JS'
const fs = require('fs');
const yaml = require('js-yaml');
const wf = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));
const pinned = process.argv[3];
const GATE3 = /Gate 3: Cyclomatic Complexity/i;
// An UNpinned install (`pip install lizard`) is what broke the ratchet.
//
// Match the INSTALL COMMAND ITSELF, line by line. My first version searched the
// whole step body for `lizard==<pin>`, so a step whose echo/diagnostic text
// mentioned `lizard==$PINNED` kept the test green even after the actual install
// line was unpinned to `pip install lizard` — the anti-vacuity check caught it.
const literalArg = new RegExp(`^"?lizard==v?${pinned.replace(/\./g, '\\.')}"?$`);
const varArg = /^"?lizard==\$\{?[A-Za-z_]*PIN[A-Za-z_]*\}?"?$/;

// Every `pip install ...` argv across the step, one array per command.
function lizardInstalls(run) {
  const found = [];
  for (const raw of run.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim(); // strip comments and indentation
    const m = line.match(/(?:^|\s)(?:pip|pip3|uv)\s+install\s+(.*)$/);
    if (!m) continue;
    const args = m[1].split(/\s+/).filter(Boolean);
    if (args.some((a) => /^"?lizard(=|$)/.test(a) || /^lizard==/.test(a))) found.push(args);
  }
  return found;
}

const isPinnedInstall = (run) =>
  lizardInstalls(run).some(
    (args) => args.some((a) => literalArg.test(a) || varArg.test(a))
  );

let gateJob = null;
let ok = false;
let sawUnpinned = false;
for (const [name, job] of Object.entries(wf.jobs || {})) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const runsGate3 = steps.some((s) => GATE3.test(s.name || '') || GATE3.test(s.run || ''));
  if (runsGate3) gateJob = name;
  for (const s of steps) {
    const run = s.run || '';
    const installs = lizardInstalls(run);
    if (installs.length > 0) {
      if (!isPinnedInstall(run)) sawUnpinned = true;
      if (runsGate3 && isPinnedInstall(run)) ok = true;
    }
  }
}
if (!gateJob) {
  console.error('could not locate the Gate 3 step in any job');
  process.exit(1);
}
if (!ok) {
  console.error(`Gate 3 runs in '${gateJob}' but never installs lizard==${pinned}`);
  if (sawUnpinned) console.error('an UNPINNED `pip install lizard` is present; pip will resolve whatever is newest');
  process.exit(1);
}
console.log(`ok: '${gateJob}' installs the pinned lizard==${pinned}`);
JS
  [ "$status" -eq 0 ] || return 1
}
