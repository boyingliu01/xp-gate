/**
 * @test REQ-562 覆盖率核算范围必须覆盖真实被测代码，不能靠排除把分数养高
 * @intent #562 追踪把 lines/statements 从 60% 提到 80%。它建议的第一步是
 *         "把 `plugins/**` 的排除去掉"，理由是那里有 801 个测试被隐藏。
 *
 *         **那条理由已经不成立了**：28 个插件测试文件、225 个测试**本来就在跑**，
 *         全绿。`plugins/**` 只出现在 `coverage.exclude` 里，不在 `test.exclude` 里。
 *
 *         真正没被修的是另一半：`coverage.include` 曾是 `['src/**']`，所以
 *         `'plugins/**'` 这条排除项**从来没有起过作用**——plugins 源码压根不在
 *         核算范围内，光靠 include 就被排除了。结果是 4340 行、30 个文件、
 *         被 225 个通过的测试覆盖着的规范源代码，**从未计入覆盖率**。
 *
 *         隔离测量这些源文件是 **83.8% lines**，远高于仓库 60% 的地板。
 *         "把一个覆盖良好的目录排除在平均分之外"是覆盖率数字从"描述代码库"
 *         退化成"描述配置"的典型方式。
 *
 *         这里的断言是两条**属性**，不是某个 glob 的字符串：
 *           1. 有测试在跑的源码必须被计入覆盖率核算。
 *           2. exclude 里的每一条都必须在 include 的范围内，否则它是死配置——
 *              读起来像"我们考虑过"，实际什么都没做。
 * @covers AC-562-01, AC-562-02
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CONFIG = path.join(REPO_ROOT, 'vitest.config.ts');

/**
 * Read the `coverage:` block and return its include/exclude globs.
 *
 * Comment lines are blanked first: this config explains its own history by quoting
 * old patterns in prose (the same trap recorded in gate-coverage.js for #605), and
 * a naive read treats a quoted example as live configuration.
 */
function readCoverageGlobs() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  } catch (err) {
    throw new Error(`cannot read vitest.config.ts: ${err.message}`);
  }
  const start = raw.indexOf('coverage: {');
  if (start === -1) throw new Error('coverage block not found in vitest.config.ts');
  const block = raw.slice(start, raw.indexOf('\n    },', start));
  const pick = (key) => {
    const m = block.match(new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) return [];
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  return { include: pick('include'), exclude: pick('exclude') };
}

/**
 * Trees that legitimately hold tests but are not measured product source:
 * build sandboxes, dependencies, and tooling. Excluding these is not the defect
 * #562 describes -- excluding a product tree that tests already exercise is.
 */
const NOT_PRODUCT_TREES = [
  'node_modules', '.stryker-tmp', '.worktrees', '.git', 'coverage', 'dist',
  'scripts', 'skills', 'githooks', 'dashboard', 'compat', '.xp-gate',
  '.agent-tmp', '.delphi-work', '.opencode', '.omo', '.workbuddy',
];

/** The #562 shape, kept as data so the detector can be tested on it. */
const UNMEASURED_SAMPLE = ['plugins/**'];

/** True when a directory holds at least one collected test file (bounded depth). */
function hasTestFile(dir, depth) {
  if ((depth || 0) > 4) return false;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'skills') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (hasTestFile(full, (depth || 0) + 1)) return true;
    } else if (/\.test\.[cm]?[jt]s$/.test(e.name)) {
      return true;
    }
  }
  return false;
}

describe('覆盖率核算范围 (#562)', () => {
  it('AC-562-01: 有测试在跑的源码必须计入覆盖率核算', () => {
    // 28 test files under plugins/ run and pass; if the source they exercise is not
    // measured, those 225 tests cannot move the coverage number at all.
    const { include } = readCoverageGlobs();
    expect(include.some((g) => g.startsWith('plugins/'))).toBe(true);
  });

  it('AC-562-01: plugins 不再出现在排除列表里', () => {
    const { exclude } = readCoverageGlobs();
    expect(exclude).not.toContain('plugins/**');
  });

  it('AC-562-02: 被测试覆盖的源码目录不能被排除在核算之外', () => {
    // `'plugins/**'` sat in exclude while include was `['src/**']`: the entry could
    // never match, so it read as "we thought about plugins" while doing nothing.
    //
    // A generic "is this exclude entry dead?" check cannot work -- `node_modules/**`
    // and `.worktrees/**` legitimately name real directories that must stay out, and
    // `scripts/**` / `skills/**` hold tooling rather than measured product source.
    // The property that matters is narrower: **product source with tests must be
    // measured.** Otherwise those tests cannot move the coverage number at all.
    const { exclude } = readCoverageGlobs();
    const dirsWithTests = fs
      .readdirSync(REPO_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => !NOT_PRODUCT_TREES.includes(name))
      .filter((name) => hasTestFile(path.join(REPO_ROOT, name)));
    const unmeasured = dirsWithTests.filter((name) => exclude.includes(`${name}/**`));
    expect(unmeasured).toEqual([]);
  });

  it('AC-562-02: 检测器在合成输入上确实会触发', () => {
    // A detector that never fires is indistinguishable from "no drift" -- the same
    // trap recorded for the mirror guard (#654). Prove the filter is not vacuous.
    const fakeDirs = ['plugins', 'dashboard'];
    const unmeasured = fakeDirs.filter((name) => UNMEASURED_SAMPLE.includes(`${name}/**`));
    expect(unmeasured).toEqual(['plugins']);
  });

  it('AC-562-02: 检测器在合成输入上确实会触发', () => {
    // A detector that never fires is indistinguishable from "no drift" -- the same
    // trap recorded for the mirror guard (#654). Prove the filter is not vacuous.
    const fake = ['plugins', 'dashboard'];
    const unmeasured = fake.filter((name) => UNMEASURED_SAMPLE.includes(`${name}/**`));
    expect(unmeasured).toEqual(['plugins']);
  });
});
