#!/usr/bin/env bats
# @test REQ-594
# @intent Gate 8 (secret scanning) is fail-closed since #499: when `gitleaks` is
#         absent the pre-commit hook BLOCKS the commit and exits. That is correct
#         behaviour — a security gate that cannot run must not report success — but
#         almost every `.bats` suite runs the REAL hook against a throwaway git repo,
#         so without gitleaks they stop at Gate 8 and never reach Gates 9–12.
#
#         Measured on the first Gate 5b run (866 ok / 67 failed), the CI log for
#         changed-file-matcher.test.bats case 1 ends at:
#             ❌ BLOCKED - gitleaks not installed (fail-closed, #499).
#             Secret scanning is mandatory before commit. Install gitleaks then retry:
#         and never prints the SAST line the case asserts on.
#
#         Reproduced locally by removing the gitleaks directories from PATH:
#             with gitleaks:    3/3 pass
#             without gitleaks: 1/3 pass   <- exactly the two CI failures
#
#         So the assertion was never wrong; the runner could not execute the code
#         path being asserted. The `gate-check` job installs gitleaks before Gate 5b.
#
#         Pin: a CI job that executes the real hook must install every fail-closed
#         gate's tool, or its BATS suites silently test the gate that BLOCKED first.
# @covers AC-594-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WF="$REPO_ROOT/.github/workflows/quality-gates.yml"
}

@test "AC-594-01: the gate-check job installs gitleaks before running BATS" {
  run node - "$WF" << 'JS'
const fs = require('fs');
const yaml = require('js-yaml');
const wf = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));

// Each CI job has its OWN filesystem — an install in `setup` is invisible to
// `gate-check`. So the check must be scoped to the job that runs BATS.
let batsJob = null;
for (const [jobName, job] of Object.entries(wf.jobs || {})) {
  for (const s of Array.isArray(job.steps) ? job.steps : []) {
    const run = (s.run || '')
      .split('\n')
      .map((l) => l.replace(/(^|\s)#.*$/, ''))
      .join('\n');
    if (/npx\s+bats/.test(run)) batsJob = jobName;
  }
}
if (!batsJob) {
  console.error('no job runs `npx bats`; this guard has nothing to check');
  process.exit(1);
}

const steps = wf.jobs[batsJob].steps || [];
let batsIdx = -1;
let gitleaksIdx = -1;
steps.forEach((s, i) => {
  const run = (s.run || '')
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
  if (batsIdx < 0 && /npx\s+bats/.test(run)) batsIdx = i;
  if (gitleaksIdx < 0 && /gitleaks/.test(run) && /(curl|wget|apt|brew|npm i|install)/.test(run)) {
    gitleaksIdx = i;
  }
});

if (gitleaksIdx < 0) {
  console.error(`job "${batsJob}" runs BATS but never installs gitleaks.`);
  console.error('Gate 8 is fail-closed (#499): without it the hook BLOCKs and every');
  console.error("later gate's assertion fails for a reason unrelated to the code.");
  process.exit(1);
}
if (gitleaksIdx > batsIdx) {
  console.error(`job "${batsJob}" installs gitleaks at step ${gitleaksIdx} but runs`);
  console.error(`BATS at step ${batsIdx} — the install must come first.`);
  process.exit(1);
}
console.log(`ok: "${batsJob}" installs gitleaks (step ${gitleaksIdx}) before BATS (step ${batsIdx})`);
JS
  if [ "$status" -ne 0 ]; then
    echo "$output"
    return 1
  fi
}
