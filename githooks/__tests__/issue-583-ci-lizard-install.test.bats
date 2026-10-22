#!/usr/bin/env bats
# @test REQ-583
# @intent Gate 3 (cyclomatic complexity) is fail-closed by design (#499): if the
#         analyzer is missing the gate BLOCKs rather than reporting a pass it did
#         not earn. That is the right call — but it means the tool is a hard
#         prerequisite, and CI must install it.
#
#         It did not. `quality-gates.yml` installed ruff, mypy and pylint for the
#         Python toolchain and never `lizard`, so Gate 3 hit its own guard on every
#         run:
#
#             Running Gate 3: Cyclomatic complexity check...
#             ❌ lizard is not installed — Gate 3 cannot run.
#             A complexity gate that cannot run must not report success (#499 rationale).
#             ##[error]Process completed with exit code 1.
#
#         A permanently red gate is worse than no gate. It cannot distinguish "the
#         code got more complex" from "the analyzer was missing", so the signal is
#         lost, and the pipeline being red all the time teaches everyone to ignore
#         it. This was masked for a while because Gate 1's ESLint warnings failed
#         first (#581); fixing that only revealed the next wall.
#
#         Pin: whenever the workflow requires a tool fail-closed, it must also
#         install that tool. The guard and the install have to arrive together, or
#         the gate is guaranteed to fail on every run.
# @covers AC-583-01, AC-583-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WF="$REPO_ROOT/.github/workflows/quality-gates.yml"
}

@test "AC-583-01: CI installs lizard because Gate 3 hard-requires it" {
  [ -f "$WF" ] || {
    echo "quality-gates.yml not found at $WF"
    return 1
  }
  # The gate's fail-closed guard proves lizard is a prerequisite...
  grep -q 'lizard is not installed' "$WF" || {
    echo "Gate 3 no longer fails closed on a missing lizard — this test's premise is gone"
    return 1
  }
  # ...so an install line must exist. Accept pip/pip3/uv in any form.
  grep -qE '(pip|pip3|uv)[[:space:]]+install[^#]*\blizard\b' "$WF" || {
    echo "Gate 3 blocks when lizard is missing, but the workflow never installs lizard:"
    echo "the gate is guaranteed to fail on every run"
    grep -n 'pip install' "$WF" | sed 's/^/  /'
    return 1
  }
}

@test "AC-583-03: lizard is installed in the JOB that runs Gate 3" {
  # The bug that made the first attempt useless: `pip install lizard` in the
  # `setup` job reported "Successfully installed lizard-1.24.2", and Gate 3 in
  # `gate-check` still printed "❌ lizard is not installed". Different jobs,
  # different filesystems.
  #
  # Parsed with a YAML loader rather than matched as text: a line-range scan
  # cannot tell a job key from an `on:` trigger entry (`push:` also sits at two
  # spaces), and my first version of THIS test passed even with the install moved
  # back into `setup` — it could not see the bug it exists for.
  run node - "$WF" << 'JS'
const fs = require('fs');
const yaml = require('js-yaml');
const wf = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));
const INSTALL = /(?:pip|pip3|uv)\s+install[^#]*\blizard\b/;
const GATE3 = /Gate 3: Cyclomatic Complexity/i;

let gateJob = null;
let installedInGateJob = false;
const jobsWithInstall = [];

for (const [name, job] of Object.entries(wf.jobs || {})) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const runsGate3 = steps.some((s) => GATE3.test(s.name || '') || GATE3.test(s.run || ''));
  if (runsGate3) gateJob = name;
  if (steps.some((s) => INSTALL.test(s.run || ''))) {
    jobsWithInstall.push(name);
    if (runsGate3) installedInGateJob = true;
  }
}

if (!gateJob) {
  console.error('could not locate the Gate 3 step in any job');
  process.exit(1);
}
if (!installedInGateJob) {
  console.error(`Gate 3 runs in job '${gateJob}', but lizard is installed in: ${jobsWithInstall.join(', ') || '(nowhere)'}`);
  console.error('GitHub Actions jobs have separate filesystems: an install in another job cannot help Gate 3');
  process.exit(1);
}
console.log(`ok: lizard installed in '${gateJob}', the job that runs Gate 3`);
JS
  [ "$status" -eq 0 ] || return 1
}

@test "AC-583-02: the other fail-closed tool prerequisites are installed too" {
  # Same failure mode, different tool: ruff/mypy/pylint are installed already for
  # Gate 1. Asserting they stay installed prevents the same bug reappearing when
  # the Python toolchain line is edited.
  for tool in ruff mypy pylint; do
    grep -qE "pip[[:space:]]+install[^#]*\b$tool\b" "$WF" || {
      echo "$tool is required by a gate but no longer installed by CI"
      return 1
    }
  done
}
