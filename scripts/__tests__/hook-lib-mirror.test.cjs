/**
 * @test REQ-010-02 npm hook library mirror parity
 * @intent Verify generated hook libraries cannot drift or become symlinks
 * @covers AC-010-02
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('hook library mirror validation', () => {
  let fixture;
  const script = path.resolve(__dirname, '../check-hook-lib-mirror.sh');

  function validate() {
    return spawnSync('bash', [script], { cwd: fixture, encoding: 'utf8' });
  }

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-lib-mirror-'));
    fs.mkdirSync(path.join(fixture, 'githooks/lib'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/hooks/lib'), { recursive: true });
    for (const name of ['now-ms.sh', 'validate-code-walkthrough.cjs']) {
      fs.writeFileSync(path.join(fixture, 'githooks/lib', name), `${name}\n`);
      fs.writeFileSync(path.join(fixture, 'src/npm-package/hooks/lib', name), `${name}\n`);
    }
  });

  afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

  it('accepts regular byte-identical mirror files', () => {
    expect(validate().status).toBe(0);
  });

  it.each([
    ['missing mirror', () => fs.rmSync(path.join(fixture, 'src/npm-package/hooks/lib/now-ms.sh'))],
    ['extra mirror', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/hooks/lib/stale.sh'), 'stale\n')],
    ['content drift', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/hooks/lib/now-ms.sh'), 'drift\n')],
  ])('rejects %s', (_name, arrange) => {
    arrange();
    expect(validate().status).toBe(1);
  });

  it.each([
    ['canonical', 'githooks/lib/validate-code-walkthrough.cjs'],
    ['npm mirror', 'src/npm-package/hooks/lib/validate-code-walkthrough.cjs'],
  ])('rejects a symlinked %s', (_name, relativePath) => {
    const filePath = path.join(fixture, relativePath);
    const target = path.join(fixture, `target-${path.basename(relativePath)}`);
    fs.writeFileSync(target, 'validate-code-walkthrough.cjs\n');
    fs.rmSync(filePath);
    try {
      fs.symlinkSync(path.relative(path.dirname(filePath), target), filePath);
    } catch (error) {
      if (process.platform === 'win32' && error && error.code === 'EPERM') return;
      throw error;
    }

    expect(validate().status).toBe(1);
  });
});
