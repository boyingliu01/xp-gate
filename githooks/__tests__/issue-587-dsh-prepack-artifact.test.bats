#!/usr/bin/env bats
# @test REQ-587
# @intent `plugins/dsh/skills/` is a PREPACK artifact. It is gitignored
#         (.gitignore:150) and generated from the repo's `skills/` by
#         `plugins/dsh/scripts/prepack.cjs` during `npm pack`/`npm publish`.
#
#         `plugins/dsh/src/skills.test.ts` verifies that directory against the repo
#         skills — a good check, because it proves the artifact that ships is
#         complete. But a fresh checkout has no such directory:
#
#             plugins/dsh/skills/admin-template-guidelines/SKILL.md:
#             cannot read file (ENOENT: no such file or directory,
#             open '.../plugins/dsh/skills/admin-template-guidelines/SKILL.md')
#
#         It passed locally only because someone had packed the plugin on that
#         machine. Measured: remove the directory and skills.test.ts goes 2/2 RED;
#         run prepack and it goes 2/2 GREEN — the artifact, not the test, was
#         missing.
#
#         The right fix is to BUILD the artifact in CI, not to weaken the test: the
#         test should keep checking the same thing that gets published.
#
#         Pin: a job that runs a test over a gitignored prepack artifact must build
#         that artifact first.
# @covers AC-587-01, AC-587-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  WF="$REPO_ROOT/.github/workflows/quality-gates.yml"
  SKILLS_TEST="$REPO_ROOT/plugins/dsh/src/skills.test.ts"
  PREPACK="$REPO_ROOT/plugins/dsh/scripts/prepack.cjs"
}

@test "AC-587-01: plugins/dsh/skills is a gitignored prepack artifact that the test reads" {
  [ -f "$SKILLS_TEST" ] || {
    echo "plugins/dsh/src/skills.test.ts is gone -- this test's subject no longer exists"
    return 1
  }
  [ -f "$PREPACK" ] || {
    echo "the prepack script is missing; nothing would generate plugins/dsh/skills"
    return 1
  }
  # The artifact must really be gitignored, or CI would simply check it out and
  # there would be nothing to build.
  run git -C "$REPO_ROOT" check-ignore -v plugins/dsh/skills
  [ "$status" -eq 0 ] || {
    echo "plugins/dsh/skills is NOT gitignored any more; re-read this test's premise"
    return 1
  }
  # And the test must actually read that directory.
  grep -q 'skills' "$SKILLS_TEST" || {
    echo "skills.test.ts no longer references the bundled skills directory"
    return 1
  }
}

@test "AC-587-02: CI builds the artifact before the tests that check it" {
  run node - "$WF" << 'JS'
const fs = require('fs');
const yaml = require('js-yaml');
const wf = yaml.load(fs.readFileSync(process.argv[2], 'utf8'));

let built = false;
let ranTests = false;
for (const [, job] of Object.entries(wf.jobs || {})) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  for (const s of steps) {
    // Strip YAML comments: the workflow explains prepack in prose, and matching
    // that text made an earlier version of this check pass with the step removed.
    const run = (s.run || '')
      .split('\n')
      .map((l) => l.replace(/(^|\s)#.*$/, ''))
      .join('\n');
    if (/node\s+plugins\/dsh\/scripts\/prepack\.cjs/.test(run)) built = true;
    if (/vitest/.test(run)) ranTests = true;
  }
}
if (ranTests && !built) {
  console.error('CI runs vitest but never builds plugins/dsh/skills.');
  console.error('plugins/dsh/src/skills.test.ts reads that gitignored prepack artifact,');
  console.error('so a fresh checkout fails with ENOENT on every bundled SKILL.md.');
  process.exit(1);
}
if (!built) {
  console.error('CI does not build the plugins/dsh prepack artifact');
  process.exit(1);
}
console.log('ok: CI builds plugins/dsh/skills before running tests');
JS
  if [ "$status" -ne 0 ]; then
    echo "$output"
    return 1
  fi
}
