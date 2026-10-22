#!/usr/bin/env bats
# @test REQ-591
# @intent Gate 5b invokes `npx bats githooks/__tests__/`. Without
#         `--print-output-on-failure`, a failing case reports ONLY the line that
#         failed:
#
#             not ok 53 doc-only staged files skip code, IaC, and SAST gates
#             # (in test file githooks/__tests__/changed-file-matcher.test.bats, line 37)
#             #   `[[ "$output" =~ "No code files changed, skipping SAST scan" ]]' failed
#
#         with no indication of what the hook actually printed. Two facts make that
#         fatal for diagnosis:
#           1. Gate 5b first ran on 2026-10-22, 203 commits after #484 wired it in;
#              it reported 67 failures nobody had ever seen.
#           2. The majority of those failures PASS locally. The evidence exists only
#              inside the CI runner, and without this flag it is discarded — the
#              failure cannot be told apart from "the hook changed".
#
#         A gate whose failures cannot be diagnosed does not get fixed; it gets
#         ignored, and then it gets deleted. Capturing the output is what keeps a
#         red build actionable.
# @covers AC-591-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WF="$REPO_ROOT/.github/workflows/quality-gates.yml"
}

@test "AC-591-01: the CI BATS command captures output on failure" {
  run node - "$WF" << 'JS'
const fs = require('fs');
const yaml = require('js-yaml');
const wf = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));

let found = null;
for (const [jobName, job] of Object.entries(wf.jobs || {})) {
  for (const s of Array.isArray(job.steps) ? job.steps : []) {
    const run = (s.run || '')
      .split('\n')
      .map((l) => l.replace(/(^|\s)#.*$/, ''))
      .join('\n');
    const m = run.match(/npx\s+bats[^\n]*/);
    if (m) found = { job: jobName, cmd: m[0] };
  }
}

if (!found) {
  console.error('no `npx bats` invocation found in the workflow');
  process.exit(1);
}
if (!found.cmd.includes('--print-output-on-failure')) {
  console.error(`Gate 5b runs "${found.cmd}" without --print-output-on-failure.`);
  console.error('A failing case then reports only the assertion line, not what the');
  console.error('hook printed — and most such failures pass locally, so the CI log');
  console.error('is the only evidence there is.');
  process.exit(1);
}
console.log(`ok: ${found.job} captures BATS output on failure`);
JS
  if [ "$status" -ne 0 ]; then
    echo "$output"
    return 1
  fi
}
