/**
 * @test REQ-010-01 npm Delphi runner mirror parity
 * @intent Verify the generated Delphi runner cannot drift before or after package sync
 * @covers AC-010-01
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('Delphi runner mirror validation', () => {
  let fixture;
  let gitEnv;
  const script = path.resolve(__dirname, '../check-delphi-runner-mirror.sh');

  function git(args) {
    return spawnSync('git', args, { cwd: fixture, env: gitEnv, encoding: 'utf8' });
  }

  function validate(...args) {
    return spawnSync('bash', [script, ...args], { cwd: fixture, env: gitEnv, encoding: 'utf8' });
  }

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'delphi-runner-mirror-'));
    fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/scripts'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'scripts/delphi-external-review.cjs'), 'canonical\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/scripts/delphi-external-review.cjs'), 'canonical\n');
    const home = path.join(fixture, 'home');
    fs.mkdirSync(home);
    gitEnv = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
    };
    git(['init', '-q']);
    git(['config', 'user.name', 'Mirror Fixture']);
    git(['config', 'user.email', 'mirror-fixture@example.invalid']);
    git(['config', 'core.hooksPath', '/dev/null']);
    git(['add', '.']);
    git(['commit', '-qm', 'initial mirror']);
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
