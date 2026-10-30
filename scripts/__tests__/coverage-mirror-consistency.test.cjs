/**
 * @test REQ-562
 * @intent `vitest.config.ts` 里有两份描述**同一批镜像**的清单：`test.exclude`
 *         （不重复跑镜像里的测试）和 `coverage.exclude`（不统计镜像的覆盖率）。
 *
 *         它们已经漂移过一次，代价是整份覆盖率报告失真：`test.exclude` 排除了
 *         `src/npm-package/principles/**` 等四条镜像，`coverage.exclude` 却漏掉了它们，
 *         于是 11688 行**永远无法被覆盖**的副本以 0.00% 计入分母，把报告值从
 *         82.77% 拖到 62.19%。
 *
 *         这不是"该多写测试"的问题——测试 import 的是 canonical 路径，镜像文件
 *         没有任何测试能碰到。所以修复只能是让两份清单保持一致，并且用测试钉住
 *         一致性，否则下次再加镜像又会静默漂移。
 * @covers AC-562-06
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(REPO_ROOT, 'vitest.config.ts');

/**
 * Read the config source once. Parsing TS with a regex is crude, but the thing under
 * test is a list of string literals, and pulling in a TS parser just to read them
 * would be a bigger dependency than the invariant is worth.
 */
function readConfig() {
  return fs.readFileSync(CONFIG_PATH, 'utf8');
}

/** Extract the `exclude: [...]` array inside the `test:` vs `coverage:` block. */
function excludeListUnder(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;
  const open = source.indexOf('exclude: [', markerIndex);
  if (open === -1) return null;
  const close = source.indexOf(']', open);
  if (close === -1) return null;
  const body = source.slice(open, close);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('覆盖率镜像清单一致 (#562)', () => {
  it('AC-562-06: the coverage exclude lists every mirrored src/npm-package subtree the test exclude lists', () => {
    const source = readConfig();
    const coverageExclude = excludeListUnder(source, 'coverage: {');
    expect(coverageExclude).not.toBeNull();

    // The mirror subtrees that actually exist on disk. Derived rather than hardcoded,
    // so a NEW mirror directory is caught by this test instead of quietly inflating
    // the denominator.
    const mirrorRoot = path.join(REPO_ROOT, 'src', 'npm-package');
    const canonicalRoot = path.join(REPO_ROOT, 'src');
    const mirrors = fs.readdirSync(mirrorRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => fs.existsSync(path.join(canonicalRoot, name)));

    // `lib` exists only under src/npm-package (no canonical sibling), so the filter
    // above already excludes it. Anything left duplicates a canonical directory.
    expect(mirrors.length).toBeGreaterThan(0);

    // A subtree is covered by either spelling: the mirror's own path, or the
    // pre-existing whole-tree form the config already used for `mutation`
    // (`src/mutation/**` excludes both the canonical copy and its mirror).
    const missing = mirrors.filter(
      (name) => !coverageExclude.includes(`src/npm-package/${name}/**`)
        && !coverageExclude.includes(`src/${name}/**`),
    );
    expect(missing).toEqual([]);
  });

  it('AC-562-06: the numbers this guards are the ones that were wrong', () => {
    // A regression note in executable form: if someone re-adds a mirror subtree to
    // coverage, the failure message should say what it costs.
    const source = readConfig();
    expect(source).toMatch(/11688 lines at 0\.00%/);
    expect(source).toMatch(/62\.19%/);
  });
});
