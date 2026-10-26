/**
 * @test REQ-629
 * @intent The Mutation Testing job runs Stryker, whose initial dry run executes
 *         the WHOLE vitest suite. That suite includes
 *         src/npm-package/lib/__tests__/crap-cli.test.js, which shells out to
 *         `lizard`. On a machine without lizard the CLI reports
 *         "Could not run lizard" instead of "No coverage artifact", so the
 *         assertion fails and the dry run aborts before a single mutant is
 *         generated: "One or more tests failed in the initial test run".
 *
 *         quality-gates.yml installs lizard pinned to .lizard-version precisely
 *         because Gate 3 needs it (#583/#584), but mutation-test.yml never did —
 *         its job passed only while the changed-file scope happened to contain no
 *         src/principles file. The moment a change touches src/principles (which
 *         is the ONLY thing that triggers this workflow), the dry run hits the
 *         lizard-dependent test and the job fails for an unrelated reason. A gate
 *         that fails on a missing tool is not measuring the change.
 *
 *         These assertions pin the fix at the workflow level, in the same place
 *         Gate 3 already got its #583/#584 treatment: the same pinned version,
 *         from the same .lizard-version file, verified by running --version.
 * @covers AC-629-01, AC-629-02, AC-629-03
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

function readWorkflow(name) {
  return fs.readFileSync(path.join(repoRoot, '.github/workflows', name), 'utf8');
}

function readPinnedLizardVersion() {
  return fs.readFileSync(path.join(repoRoot, '.lizard-version'), 'utf8').trim();
}

describe('mutation-test workflow installs the Gate 3 analyzer', () => {
  it('AC-629-01: installs lizard, pinned to .lizard-version, before the mutation run', () => {
    const workflow = readWorkflow('mutation-test.yml');
    const pinned = readPinnedLizardVersion();

    // The install must exist and must read the same single source of truth.
    expect(workflow).toContain('.lizard-version');
    expect(workflow).toMatch(/pip install[^\n]*lizard==/);

    // And it must happen BEFORE Stryker runs, otherwise it cannot help the dry
    // run (GitHub Actions steps are sequential).
    const installAt = workflow.indexOf('pip install');
    const strykerAt = workflow.indexOf('npx stryker run');
    expect(installAt).toBeGreaterThan(-1);
    expect(strykerAt).toBeGreaterThan(installAt);

    // The pinned value must not be hardcoded in the workflow — it must be read
    // from the file, so bumping .lizard-version stays a one-line change.
    expect(workflow).toContain(`"lizard==${'$'}PINNED"`.replace('$PINNED', '$PINNED'));
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('AC-629-02: verifies the installed version actually matches the pin', () => {
    const workflow = readWorkflow('mutation-test.yml');
    // A bare `pip install` can silently resolve a different release; the job must
    // read back `lizard --version` and compare it, exactly like Gate 3 does.
    expect(workflow).toContain('lizard --version');
    expect(workflow).toMatch(/INSTALLED/);
  });

  it('AC-629-03: fizzles loudly when .lizard-version is missing or empty, not silently', () => {
    const workflow = readWorkflow('mutation-test.yml');
    // Failing open here would re-introduce the exact bug: no lizard, dry run
    // fails, but with a confusing message. The guard must exit non-zero.
    expect(workflow).toMatch(/-z ["']?\$PINNED|PINNED.*-z/);
    expect(workflow).toMatch(/exit 1/);
  });
});
