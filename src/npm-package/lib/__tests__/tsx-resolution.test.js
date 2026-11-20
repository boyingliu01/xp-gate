/**
 * @test REQ-audit-cli 定位 tsx 时不得多拼一层 node_modules（#817）
 * @intent 证明 `xp-gate audit --check` 在 npm 全局安装下不再 MODULE_NOT_FOUND。
 *   修复前实测：`bin/xp-gate.js` 从 `bin/` 出发走三个 `..` 已经到达
 *   `<global>/node_modules`，再拼 `node_modules/tsx` 就变成
 *   `<global>/node_modules/node_modules/tsx/dist/cli.mjs`，必然不存在。
 *
 *   这不是"路径写错了"这么简单：`audit --check` 是 doctor 在缺审计证据时
 *   推荐给用户的恢复路径，它一崩，用户就没有可用的恢复手段。
 *
 * @covers AC-TSX-RESOLVE-01, AC-TSX-RESOLVE-02, AC-TSX-RESOLVE-03
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { findTsxCliFrom } = require('../tsx-resolve');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-tsxres-'));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Plant a fake `tsx/dist/cli.mjs` under `root` and return its absolute path.
 *
 * Failing to plant is a fixture defect, so the error names the fixture rather
 * than letting it surface later as "the resolver returned undefined", which
 * would be read as a resolver bug.
 */
function plantTsx(root) {
  const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  try {
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, '// fake tsx cli' + String.fromCharCode(10));
  } catch (err) {
    throw new Error(`fixture: could not plant tsx at ${cli}: ${err.message}`);
  }
  return cli;
}

describe('#817 tsx resolution from the CLI entry point', () => {
  it('finds the sibling tsx of a globally installed xp-gate', () => {
    // Reproduce the real global layout:
    //   <prefix>/node_modules/@boyingliu01/xp-gate/bin
    //   <prefix>/node_modules/tsx/dist/cli.mjs
    // The fix is to search UPWARD for node_modules rather than counting `..`.
    const prefix = path.join(tmpDir, 'npm');
    const pkgRoot = path.join(prefix, 'node_modules', '@boyingliu01', 'xp-gate');
    fs.mkdirSync(path.join(pkgRoot, 'bin'), { recursive: true });
    const expected = plantTsx(prefix);
    const resolved = findTsxCliFrom(path.join(pkgRoot, 'bin'));
    expect(resolved).toBe(expected);
  });

  it('finds a tsx hoisted into the consumer project', () => {
    // A local install hoists tsx next to the package under the same node_modules.
    const project = path.join(tmpDir, 'project');
    const pkgRoot = path.join(project, 'node_modules', '@boyingliu01', 'xp-gate');
    fs.mkdirSync(path.join(pkgRoot, 'bin'), { recursive: true });
    const expected = plantTsx(project);
    expect(findTsxCliFrom(path.join(pkgRoot, 'bin'))).toBe(expected);
  });

  it('never produces a doubled node_modules segment', () => {
    // The exact #817 shape. Even when it resolves to nothing, the returned path
    // must never contain node_modules/node_modules -- that is always a bug, and
    // it is indistinguishable from "not installed" at the call site.
    const prefix = path.join(tmpDir, 'npm');
    const pkgRoot = path.join(prefix, 'node_modules', '@boyingliu01', 'xp-gate');
    fs.mkdirSync(path.join(pkgRoot, 'bin'), { recursive: true });
    const resolved = findTsxCliFrom(path.join(pkgRoot, 'bin'));
    expect(resolved === null || !resolved.includes(`node_modules${path.sep}node_modules`)).toBe(true);
  });

  it('returns null when tsx is genuinely absent, rather than a broken path', () => {
    // The caller must be able to tell "not installed" (print an install hint)
    // apart from "here is a path" (spawn it).
    const pkgRoot = path.join(tmpDir, 'nowhere', 'bin');
    fs.mkdirSync(pkgRoot, { recursive: true });
    expect(findTsxCliFrom(pkgRoot)).toBeNull();
  });
});
