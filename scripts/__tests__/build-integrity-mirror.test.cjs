/**
 * @test REQ-010-01 npm build-integrity mirror parity
 * @intent Verify mirror validation rejects modified, deleted, and newly added file drift
 * @covers AC-010-01
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('build-integrity mirror validation', () => {
  let fixture;
  let gitEnv;
  const script = path.resolve(__dirname, '../check-build-integrity-mirror.sh');

  function git(args) {
    return spawnSync('git', args, { cwd: fixture, env: gitEnv, encoding: 'utf8' });
  }

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'build-integrity-mirror-'));
    fs.mkdirSync(path.join(fixture, 'src/build-integrity'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/build-integrity'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'src/build-integrity/existing.ts'), 'canonical\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/build-integrity/existing.ts'), 'canonical\n');
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

  it.each([
    ['modified mirror file', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/build-integrity/existing.ts'), 'stale\n')],
    ['deleted mirror file', () => fs.rmSync(path.join(fixture, 'src/npm-package/build-integrity/existing.ts'))],
    ['new canonical file', () => fs.writeFileSync(path.join(fixture, 'src/build-integrity/new.ts'), 'new\n')],
  ])('rejects %s', (_name, arrangeDrift) => {
    arrangeDrift();
    const result = spawnSync('bash', [script], { cwd: fixture, env: gitEnv, encoding: 'utf8' });
    expect(result.status).toBe(1);
  });

  it('accepts byte-identical trees', () => {
    const result = spawnSync('bash', [script], { cwd: fixture, env: gitEnv, encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('accepts a clean committed mirror after sync', () => {
    const result = spawnSync('bash', [script, '--post-sync'], { cwd: fixture, env: gitEnv, encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('rejects an untracked mirror file after sync creates a new pair', () => {
    fs.writeFileSync(path.join(fixture, 'src/build-integrity/new.ts'), 'new\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/build-integrity/new.ts'), 'new\n');
    const result = spawnSync('bash', [script, '--post-sync'], { cwd: fixture, env: gitEnv, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('?? src/npm-package/build-integrity/new.ts');
  });
});
