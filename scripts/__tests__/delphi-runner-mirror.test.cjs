/**
 * @test REQ-010-01 npm Delphi runner mirror parity
 * @intent Verify the generated Delphi runner cannot drift before or after package sync
 * @covers AC-010-01
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Resolve the authoritative MSYS bash on Windows (PATH 'bash' may be the WSL stub).
const { checkBash } = require('../../src/npm-package/lib/detect-deps.js');
const BASH = (() => { const b = checkBash(); return b.ok ? b.path : 'bash'; })();

describe('Delphi runner mirror validation', () => {
  let fixture;
  let gitEnv;
  const script = path.resolve(__dirname, '../check-delphi-runner-mirror.sh');

  function git(args) {
    return spawnSync('git', args, { cwd: fixture, env: gitEnv, encoding: 'utf8' });
  }

  function validate(...args) {
    return spawnSync(BASH, [script, ...args], { cwd: fixture, env: gitEnv, encoding: 'utf8' });
  }

  /**
   * Build the committed fixture repository ONCE, then copy it per test.
   *
   * Every case needs its own repo -- they mutate tracked files, commit, and
   * remove paths -- but building one from scratch means six git invocations
   * (init, two configs, hooksPath, add, commit), measured at 1.8-2.3 s per case
   * on this machine. With eight cases that was ~16 s of the file's 19.1 s.
   *
   * Copying a prepared template costs ~100 ms and preserves `.git` intact,
   * including the `core.hooksPath=/dev/null` that keeps this machine's global
   * XP-Gate hooks from running on the seed commit. Verified: after cpSync the
   * copy reports `git status` clean and `core.hooksPath` still `/dev/null`.
   */
  let template;

  beforeAll(() => {
    template = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi-runner-mirror-tpl-'));
    fs.mkdirSync(path.join(template, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(template, 'src/npm-package/scripts'), { recursive: true });
    fs.writeFileSync(path.join(template, 'scripts/delphi-external-review.cjs'), 'canonical\n');
    fs.writeFileSync(path.join(template, 'src/npm-package/scripts/delphi-external-review.cjs'), 'canonical\n');
    const templateHome = path.join(template, 'home');
    fs.mkdirSync(templateHome);
    const seedEnv = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: templateHome,
      XDG_CONFIG_HOME: path.join(templateHome, '.config'),
    };
    const seedGit = (args) => spawnSync('git', args, { cwd: template, env: seedEnv, encoding: 'utf8' });
    seedGit(['init', '-q']);
    seedGit(['config', 'user.name', 'Mirror Fixture']);
    seedGit(['config', 'user.email', 'mirror-fixture@example.invalid']);
    seedGit(['config', 'core.hooksPath', '/dev/null']);
    seedGit(['add', '.']);
    seedGit(['commit', '-qm', 'initial mirror']);
  });

  afterAll(() => {
    if (template) fs.rmSync(template, { recursive: true, force: true });
  });

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi-runner-mirror-'));
    fs.cpSync(template, fixture, { recursive: true });
    // HOME lives inside the fixture, so it must be recomputed for the copy.
    const home = path.join(fixture, 'home');
    gitEnv = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
    };
  });

  afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

  it('accepts a clean byte-identical committed pair', () => {
    expect(validate().status).toBe(0);
  });

  it.each([
    ['modified mirror', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/scripts/delphi-external-review.cjs'), 'stale\n')],
    ['deleted mirror', () => fs.rmSync(path.join(fixture, 'src/npm-package/scripts/delphi-external-review.cjs'))],
    ['changed canonical runner', () => fs.writeFileSync(path.join(fixture, 'scripts/delphi-external-review.cjs'), 'changed\n')],
  ])('rejects a %s before sync', (_name, arrangeDrift) => {
    arrangeDrift();
    expect(validate().status).toBe(1);
  });

  it('accepts a clean committed mirror after sync', () => {
    expect(validate('--post-sync').status).toBe(0);
  });

  it('rejects a dirty tracked mirror after sync', () => {
    fs.writeFileSync(path.join(fixture, 'src/npm-package/scripts/delphi-external-review.cjs'), 'rewritten\n');
    const result = validate('--post-sync');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(' M src/npm-package/scripts/delphi-external-review.cjs');
  });

  it('rejects an untracked mirror after sync', () => {
    git(['rm', '-q', 'src/npm-package/scripts/delphi-external-review.cjs']);
    git(['commit', '-qm', 'remove generated mirror']);
    fs.mkdirSync(path.join(fixture, 'src/npm-package/scripts'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'src/npm-package/scripts/delphi-external-review.cjs'), 'regenerated\n');
    const result = validate('--post-sync');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('?? src/npm-package/scripts/delphi-external-review.cjs');
  });

  it.each([
    ['canonical', 'scripts/delphi-external-review.cjs'],
    ['npm mirror', 'src/npm-package/scripts/delphi-external-review.cjs'],
  ])('rejects a committed symlinked %s before and after sync', (_name, relativePath) => {
    const filePath = path.join(fixture, relativePath);
    const targetPath = path.join(fixture, `target-${path.basename(relativePath)}`);
    fs.writeFileSync(targetPath, 'canonical\n');
    fs.rmSync(filePath);
    try {
      fs.symlinkSync(path.relative(path.dirname(filePath), targetPath), filePath);
    } catch (error) {
      if (process.platform === 'win32' && error && error.code === 'EPERM') return;
      throw error;
    }
    git(['add', '.']);
    git(['commit', '-qm', `symlink ${relativePath}`]);

    expect(validate().status).toBe(1);
    expect(validate('--post-sync').status).toBe(1);
  });
});
