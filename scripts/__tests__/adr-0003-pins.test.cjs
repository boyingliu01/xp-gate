/**
 * @test REQ-ADR-0003
 * @intent ADR-0003 claims that every gate capability ships with a test that
 *         fails without it. That claim is itself a declaration, and this
 *         repository's most repeated defect is exactly a declaration nothing
 *         executes -- an ADR asserting "these defects are now pinned" while the
 *         pinning tests were later renamed, deleted or emptied would be that same
 *         defect in the document whose subject IS that defect.
 *
 *         So these assertions check the ADR against the tree: each test file it
 *         names must exist, and the specific @test cases it claims must be
 *         present. A deleted test therefore breaks this suite instead of leaving
 *         the ADR quietly wrong.
 * @covers AC-ADR-0003-01, AC-ADR-0003-02
 */
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const ROOT = resolve(__dirname, '..', '..');

function read(rel) {
  const p = resolve(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

describe('ADR-0003 pins declarations to executable tests', () => {
  const adr = read('docs/adr/0003-a-declaration-is-not-enforcement.md');

  it('AC-ADR-0003-01: every test file the ADR cites exists', () => {
    expect(adr).not.toBeNull();
    // Only paths that look like test artefacts; the ADR also cites source files,
    // and those are covered by the suites that exercise them. The prefix is
    // required because a bare `/__tests__/` fragment from prose would otherwise
    // be collected as a path that does not exist.
    const cited = [...adr.matchAll(/((?:githooks|scripts|src|docs)\/[\w./-]*(?:__tests__|\.test\.[cm]?js)[\w./-]*)/g)].map((m) => m[1]);
    const unique = [...new Set(cited)];
    expect(unique.length).toBeGreaterThan(0);
    const missing = unique.filter((p) => !existsSync(resolve(ROOT, p)));
    expect(missing).toEqual([]);
  });

  it('AC-ADR-0003-02: the layer suite still carries a test per claimed capability', () => {
    const suite = read('githooks/__tests__/gate-6-layers.test.bats');
    expect(suite).not.toBeNull();
    // Named behaviours, not a count: a count stays green when one test is
    // deleted and a trivial one added.
    expect(suite).toMatch(/@test "forbiddenImports blocks an import even when allowedImports permits the layer"/);
    expect(suite).toMatch(/@test "a CommonJS require\(\) crossing a layer boundary is a violation"/);
    expect(suite).toMatch(/@test "forbiddenImports does not fire when the layer is not imported at all"/);
  });

  it('AC-ADR-0003-03: the Gate 1 regression asserts on what tsc SAW, not only on exit 0', () => {
    const suite = read('githooks/__tests__/gate-1-tsc-test-files.test.bats');
    expect(suite).not.toBeNull();
    // The defect this pins is a config tsc rejected before reading any file. A
    // test that only checked the exit status would also pass for a run that
    // checked nothing, so the suite must assert both the absence of TS5010 and
    // the presence of the test file in the output.
    expect(suite).toMatch(/TS5010/);
    expect(suite).toMatch(/did not include the test file/);
  });
});
