/**
 * @test REQ-jscpd-entry 重复代码门禁必须能在全局安装下找到 jscpd（#853）
 * @intent 证明 Gate 2 在 npm 全局安装 + 干净 fixture 下不再恒失败。修复前实测：
 *   `npmGlobalRoots` 的元素已经以 `node_modules` 结尾，`runJscpd` 又拼了一次，
 *   于是探测的是 `<global>/npm/node_modules/node_modules/jscpd/bin/jscpd`，
 *   而真实路径是 `<global>/npm/node_modules/jscpd`。entry 恒为 undefined，
 *   落到 `npx --no-install jscpd` fallback，在 Windows 上报 spawnSync ENOENT。
 *
 *   第二个缺陷叠加：jscpd 5.x 把入口从 `bin/jscpd` 换成了 `run-jscpd.js`
 *   （package.json 的 bin 字段为 `{"jscpd": "./run-jscpd.js"}`）。硬编码
 *   `bin/jscpd` 在 5.x 上即便路径拼对了也找不到。
 *
 * @covers AC-JSCPD-ENTRY-01, AC-JSCPD-ENTRY-02, AC-JSCPD-ENTRY-03, AC-JSCPD-ENTRY-04
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { findJscpdEntry } = require('../gate-runner');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-jscpd-'));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Lay down a fake jscpd install whose package.json declares the given bin entry.
 *
 * The real 5.4.3 layout is reproduced faithfully: `run-jscpd.js` at the package
 * root, no `bin/jscpd`. Getting this wrong would make the test pass against a
 * layout that does not exist and never catch the regression it exists for.
 */
function plantJscpd(packageDir, binField) {
  try {
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'jscpd', version: '5.4.3', bin: binField }, null, 2),
    );
    for (const rel of Object.values(binField)) {
      const target = path.join(packageDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '// fake jscpd' + String.fromCharCode(10));
    }
  } catch (err) {
    throw new Error(`fixture: could not plant jscpd at ${packageDir}: ${err.message}`);
  }
  return packageDir;
}

describe('#853 jscpd entry resolution', () => {
  it('finds jscpd 5.x whose entry is run-jscpd.js, not bin/jscpd', () => {
    // The exact 5.4.3 declaration. Hardcoding `bin/jscpd` cannot satisfy this.
    const pkg = plantJscpd(path.join(tmpDir, 'node_modules', 'jscpd'), { jscpd: './run-jscpd.js' });
    const entry = findJscpdEntry({ searchRoots: [tmpDir] });
    expect(entry).toBe(path.join(pkg, 'run-jscpd.js'));
  });

  it('finds a legacy jscpd whose entry is bin/jscpd', () => {
    // 4.x layout must keep working; the fix must not trade one version for another.
    const pkg = plantJscpd(path.join(tmpDir, 'node_modules', 'jscpd'), { jscpd: './bin/jscpd' });
    const entry = findJscpdEntry({ searchRoots: [tmpDir] });
    expect(entry).toBe(path.join(pkg, 'bin', 'jscpd'));
  });

  it('does not append node_modules to a root that already ends with it', () => {
    // This is the #853 doubling. A global npm prefix IS `<...>/npm/node_modules`,
    // so probing `<...>/npm/node_modules/node_modules/jscpd` can never succeed.
    const globalPrefix = path.join(tmpDir, 'npm', 'node_modules');
    const pkg = plantJscpd(path.join(globalPrefix, 'jscpd'), { jscpd: './run-jscpd.js' });
    const entry = findJscpdEntry({ searchRoots: [globalPrefix] });
    expect(entry).toBe(path.join(pkg, 'run-jscpd.js'));
  });

  it('follows an unusual bin field rather than assuming a filename', () => {
    // A hardcoded filename silently breaks the next time upstream renames the
    // entry point -- which is exactly how #853's second defect appeared.
    const pkg = plantJscpd(path.join(tmpDir, 'node_modules', 'jscpd'), { jscpd: './dist/start.js' });
    const entry = findJscpdEntry({ searchRoots: [tmpDir] });
    expect(entry).toBe(path.join(pkg, 'dist', 'start.js'));
  });

  it('returns null when jscpd is genuinely absent', () => {
    // "not installed" must stay distinguishable from "installed but unfindable":
    // the first is a SKIP, the second was the bug.
    expect(findJscpdEntry({ searchRoots: [tmpDir] })).toBeNull();
  });

  it('ignores a half-written install with no resolvable entry file', () => {
    // A package.json whose bin target does not exist would be spawned and fail
    // with a message about missing files, reading as a gate defect not an install one.
    const pkgDir = path.join(tmpDir, 'node_modules', 'jscpd');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'jscpd', bin: { jscpd: './run-jscpd.js' } }),
    );
    expect(findJscpdEntry({ searchRoots: [tmpDir] })).toBeNull();
  });
});
