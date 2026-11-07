/**
 * @test REQ-776
 * @intent The pre-push drift guard compared README gate rows against the gate
 *         names it scrapes out of githooks/pre-push, and it read the README side
 *         with /\| Gate (M\d*) \|/ — a pattern that only matches a bare
 *         `| Gate M2 |` cell. The README documents that gate as
 *         `| Gate M2 (Mock Density) |`, so the row NEVER matched. M2 counted as
 *         "in script but NOT in README" and the guard failed on a table that was
 *         correct.
 *
 *         That stayed invisible until a comment in githooks/pre-push started
 *         spelling "Gate M2" in prose: the script-side regex
 *         /[Gg][Aa][Tt][Ee] (M\d*)/ matches any occurrence, comments included, so
 *         the guard only misfired once the script side began reporting a gate it
 *         had always run. The failure then surfaced twice — directly in Mirror
 *         Parity, and indirectly in Tarball Size Guard, because
 *         sync-package-content.js runs in `prepack`: a failing drift check makes
 *         `npm pack` emit an error object instead of a size, and the size guard
 *         then reports "could not read a size" rather than the drift causing it.
 *
 *         These tests pin the README-side pattern against the suffixed cell the
 *         real table uses, so the guard cannot silently stop seeing gates.
 * @covers AC-776-01
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkPrePushDrift } = require('../../src/npm-package/scripts/sync-package-content');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function makeTree(script, readme) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-drift-'));
  const scriptPath = path.join(root, 'pre-push');
  const readmePath = path.join(root, 'README.md');
  fs.writeFileSync(scriptPath, script);
  fs.writeFileSync(readmePath, readme);
  return { root, scriptPath, readmePath };
}

describe('pre-push gate table drift (#776)', () => {
  let tree;

  afterEach(() => {
    if (tree) {
      fs.rmSync(tree.root, { recursive: true, force: true });
      tree = null;
    }
  });

  it('accepts a README row that carries a descriptive suffix after the gate id', () => {
    // The exact shape the shipped README uses for Gate M2.
    tree = makeTree(
      'echo "GATE M: mutation"\necho "Gate M2: mock density"\n',
      '| Gate M | 增量变异测试 | 阻断 |\n| Gate M2 (Mock Density) | Mock 密度扫描 | 警告 |\n',
    );

    expect(checkPrePushDrift(tree.scriptPath, tree.readmePath)).toBe(true);
  });

  it('accepts a README row with no suffix, so both spellings work', () => {
    tree = makeTree(
      'echo "GATE M: mutation"\necho "Gate M2: mock density"\n',
      '| Gate M | 增量变异测试 | 阻断 |\n| Gate M2 | Mock 密度扫描 | 警告 |\n',
    );

    expect(checkPrePushDrift(tree.scriptPath, tree.readmePath)).toBe(true);
  });

  it('still fails when a gate the script runs is genuinely absent from the README', () => {
    tree = makeTree(
      'echo "GATE M: mutation"\necho "Gate M2: mock density"\n',
      '| Gate M | 增量变异测试 | 阻断 |\n',
    );

    // The fix must widen what the README side recognises, not disable the check.
    expect(checkPrePushDrift(tree.scriptPath, tree.readmePath)).toBe(false);
  });

  it('sees every M-gate in the shipped table against the shipped script', () => {
    // A regression here is the exact CI failure this test exists to keep out:
    // the real table documents every M-gate the hook runs, so the guard must agree.
    expect(
      checkPrePushDrift(
        path.join(REPO_ROOT, 'githooks', 'pre-push'),
        path.join(REPO_ROOT, 'README.md'),
      ),
    ).toBe(true);
  });
});
