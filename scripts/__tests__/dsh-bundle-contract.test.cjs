/**
 * @test REQ-DSH-018 npm 主包作为合法 DSH bundle
 * @intent 验证 @boyingliu01/xp-gate 主包自身携带 dsh.bundle.patch、exports["./dsh"]
 *         指向包内已构建的插件入口，且不引入任何运行时依赖。
 *         这使 `dsh plugin add @boyingliu01/xp-gate` 能直接使用，而不必单独
 *         安装 @boyingliu01/dsh-plugin-xp-gate。
 * @covers AC-DSH-018-01
 *
 * 背景（2026-10-27）：用户重装 xp-gate 后 delphi-review 失效。根因是插件包
 * 0.31.4 的 peerDependencies 声明 ^0.1.1-rc.2，在 0.x caret 语义下展开为
 * >=0.1.1-rc.2 <0.2.0-0，把运行时 0.2.0-rc.2 整体排除，DSH 的
 * evaluatePluginCompatibility 判定不兼容并禁用该 bundle。
 * 该 bug 连同主包无 dsh.bundle 一起，使得插件无法通过主包安装。
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PKG_DIR = path.join(REPO_ROOT, 'src', 'npm-package');
const PKG_JSON = path.join(PKG_DIR, 'package.json');

function readPkg() {
  return JSON.parse(fs.readFileSync(PKG_JSON, 'utf8'));
}

describe('#DSH-018 the npm main package is a valid DSH bundle', () => {
  it('declares dsh.bundle.patch and the patch file mounts the tool row', () => {
    const pkg = readPkg();
    const patchDecl = pkg.dsh?.bundle?.patch;
    expect(typeof patchDecl === 'string' || Array.isArray(patchDecl)).toBe(true);

    const patchFiles = Array.isArray(patchDecl) ? patchDecl : [patchDecl];
    expect(patchFiles.length).toBeGreaterThan(0);

    for (const rel of patchFiles) {
      const abs = path.join(PKG_DIR, rel);
      expect(fs.existsSync(abs), `${rel} must exist in the package`).toBe(true);
      expect(fs.readFileSync(abs, 'utf8')).toContain('id: tool-xp-gate');
    }
  });

  it('exposes exports["./dsh"] pointing at an existing in-package entry', () => {
    const pkg = readPkg();
    const dshExport = pkg.exports?.['./dsh'];
    const entryPath =
      typeof dshExport === 'string' ? dshExport : dshExport?.import ?? dshExport?.default;

    expect(typeof entryPath).toBe('string');
    expect(fs.existsSync(path.join(PKG_DIR, entryPath)), String(entryPath)).toBe(true);
  });

  it('keeps dependencies empty so the zero-install contract holds', () => {
    const pkg = readPkg();
    expect(Object.keys(pkg.dependencies ?? {})).toHaveLength(0);
  });

  it('fails the pack step loudly when the compiled entry is missing', () => {
    // lib/ is gitignored and sync-package-content.js only COPIES it. Without a
    // guard, `npm publish` on a machine that skipped the build would ship a
    // tarball whose exports["./dsh"] target does not exist -- a load-time
    // failure on the user's machine that no unit test would catch.
    const sync = fs.readFileSync(
      path.join(PKG_DIR, 'scripts', 'sync-package-content.js'),
      'utf8',
    );
    expect(sync).toContain('function assertDshBundleEntry');
    expect(sync).toContain('assertDshBundleEntry()');

    const guard = sync.slice(sync.indexOf('function assertDshBundleEntry'));
    expect(guard).toContain("'dsh', 'lib', 'index.js'");
    expect(guard).toContain('process.exit(1)');
  });

  it('ships the plugins/ tree in files[] and has a built plugin entry', () => {
    const pkg = readPkg();
    const files = pkg.files ?? [];
    const shipsDsh = files.some(
      (f) => f === 'plugins/' || f === 'plugins' || f.startsWith('plugins/'),
    );
    expect(shipsDsh).toBe(true);

    // lib/ is a gitignored build artifact; prepack must build before publish or
    // the published tarball would carry an exports target that does not exist.
    expect(fs.existsSync(path.join(REPO_ROOT, 'plugins', 'dsh', 'lib'))).toBe(true);
  });
});
