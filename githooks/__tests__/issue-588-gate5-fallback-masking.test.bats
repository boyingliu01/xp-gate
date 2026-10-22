#!/usr/bin/env bats
# @test REQ-588
# @intent Two defects in one wall, and the first hid the second.
#
#         Gate 5 called:
#             npm run test:coverage || npm run test:cover
#         `test:cover` does not exist in this repo. So whenever `test:coverage`
#         legitimately failed, npm ran the fallback, which died with
#             npm error Missing script: "test:cover"
#         and that error REPLACED the real failure in the log. Gate 5 reported a
#         missing script instead of the failing test, which sent the investigation
#         to the wrong place for several rounds — a fallback chain that swallows the
#         primary error is worse than having no fallback.
#
#         Underneath it, the actual failure was:
#             FAIL src/npm-package/lib/__tests__/doctor.test.js
#               > doctor > --fix: diagnoses TUI not registered then re-diagnoses
#             Error: Test timed out in 5000ms.
#         Measured in isolation that case takes ~3.8s — 76% of vitest's default
#         budget — so when the full 200-file suite shares the machine it crosses 5s.
#         The work is legitimate (it runs the whole `doctor --fix` pipeline over a
#         real temp install); the timeout was simply too small.
#
#         Pin: (1) a `||` fallback between two script names must only be attempted
#         for a script that exists, and must never replace the first failure;
#         (2) that specific case gets an explicit budget.
# @covers AC-588-01, AC-588-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WF="$REPO_ROOT/.github/workflows/quality-gates.yml"
  DOCTOR_TEST="$REPO_ROOT/src/npm-package/lib/__tests__/doctor.test.js"
}

@test "AC-588-01: Gate 5 does not chain a fallback that can replace the real failure" {
  run node - "$WF" "$REPO_ROOT/package.json" << 'JS'
const fs = require('fs');
const yaml = require('js-yaml');
const wf = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));
const PKG = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const scripts = PKG.scripts || {};

const problems = [];
for (const [jobName, job] of Object.entries(wf.jobs || {})) {
  for (const s of Array.isArray(job.steps) ? job.steps : []) {
    const run = (s.run || '')
      .split('\n')
      .map((l) => l.replace(/(^|\s)#.*$/, ''))
      .join('\n');
    // `npm run A || npm run B` — the shape that swallowed the failure.
    const chain = run.match(/npm\s+run\s+([\w:.-]+)\s*\|\|\s*npm\s+run\s+([\w:.-]+)/);
    if (chain) {
      problems.push(`${jobName} / ${s.name}: "npm run ${chain[1]} || npm run ${chain[2]}" — a failing first command is replaced by the second's error`);
    }
    // Any script actually invoked must exist, or the gate reports the wrong cause.
    for (const m of run.matchAll(/npm\s+run\s+([\w:.-]+)/g)) {
      const name = m[1];
      if (!(name in scripts)) {
        problems.push(`${jobName} / ${s.name}: runs "npm run ${name}" but package.json has no such script`);
      }
    }
  }
}
if (problems.length) {
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log('ok: every `npm run` target exists and no `||` chain can mask a failure');
JS
  if [ "$status" -ne 0 ]; then
    echo "$output"
    return 1
  fi
}

@test "AC-588-02: the doctor --fix TUI case has an explicit timeout budget" {
  [ -f "$DOCTOR_TEST" ] || {
    echo "$DOCTOR_TEST is gone -- this test's subject no longer exists"
    return 1
  }
  # The case runs the whole doctor --fix pipeline (~3.8s measured in isolation).
  grep -q "diagnoses TUI not registered then re-diagnoses after fix', { timeout:" "$DOCTOR_TEST" || {
    echo "the --fix TUI case runs on vitest's 5s default, which it exceeds under the"
    echo "full suite: 'Test timed out in 5000ms'. Give it an explicit budget."
    return 1
  }
}
