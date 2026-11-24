/**
 * @test REQ-COVERAGE-EXCLUDE-PARITY
 * @intent 配置里有两个 exclude 列表：`test.exclude` 决定不收哪些测试，
 *         `coverage.exclude` 决定不计哪些源码。镜像目录 `src/npm-package/<sub>/`
 *         必须同时出现在两个列表里——测试导入正本，v8 只看到镜像，所以镜像
 *         永远是 0%，把它算进平均分就是把覆盖率变成配置的描述。
 *
 *         实测 2026-11-24：`src/npm-package/mutation/**` 只在 test.exclude 里，
 *         覆盖率的那个漏了，于是 12 个镜像文件、2813 条语句以 0% 计入总数，
 *         把真实覆盖率从 87.23% 报成 82.30%。
 *
 *         配置文件里的注释早就写着"两个列表不能漂移"——这条测试让那句话
 *         可执行。
 *
 * @covers AC-COVERAGE-EXCLUDE-PARITY-01
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG = path.resolve(__dirname, '..', '..', '..', '..', 'vitest.config.ts');

/** Pull the string literals out of one `exclude: [` block. */
function literalsIn(block) {
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function readBlocks() {
  const source = fs.readFileSync(CONFIG, 'utf8');
  const testAt = source.indexOf('test: {');
  const coverageAt = source.indexOf('coverage: {');
  expect(testAt).toBeGreaterThan(-1);
  expect(coverageAt).toBeGreaterThan(testAt);

  const testBlock = source.slice(testAt, coverageAt);
  const coverageBlock = source.slice(coverageAt);
  const testExcludeAt = testBlock.indexOf('exclude: [');
  const covExcludeAt = coverageBlock.indexOf('exclude: [');
  expect(testExcludeAt).toBeGreaterThan(-1);
  expect(covExcludeAt).toBeGreaterThan(-1);

  return {
    test: literalsIn(testBlock.slice(testExcludeAt, testBlock.indexOf(']', testExcludeAt))),
    coverage: literalsIn(coverageBlock.slice(covExcludeAt, coverageBlock.indexOf(']', covExcludeAt))),
  };
}

describe('vitest.config.ts exclude parity', () => {
  it('every src/npm-package/<sub> mirror excluded from tests is also excluded from coverage', () => {
    const { test, coverage } = readBlocks();
    const mirrors = test.filter((p) => /^src\/npm-package\/[a-z-]+\/\*\*$/.test(p));
    expect(mirrors.length).toBeGreaterThan(0);

    const missing = mirrors.filter((m) => !coverage.includes(m));
    expect(
      missing,
      `mirrors excluded from tests but still measured by coverage (they can never `
      + `be covered, so they only deflate the reported total): ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
