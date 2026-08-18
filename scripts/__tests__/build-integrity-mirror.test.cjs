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
  const script = path.resolve(__dirname, '../check-build-integrity-mirror.sh');

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'build-integrity-mirror-'));
    fs.mkdirSync(path.join(fixture, 'src/build-integrity'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/build-integrity'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'src/build-integrity/existing.ts'), 'canonical\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/build-integrity/existing.ts'), 'canonical\n');
    spawnSync('git', ['init', '-q'], { cwd: fixture });
    spawnSync('git', ['add', '.'], { cwd: fixture });
  });

  afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

  it.each([
    ['modified mirror file', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/build-integrity/existing.ts'), 'stale\n')],
    ['deleted mirror file', () => fs.rmSync(path.join(fixture, 'src/npm-package/build-integrity/existing.ts'))],
    ['new canonical file', () => fs.writeFileSync(path.join(fixture, 'src/build-integrity/new.ts'), 'new\n')],
  ])('rejects %s', (_name, arrangeDrift) => {
    arrangeDrift();
    const result = spawnSync('bash', [script], { cwd: fixture, encoding: 'utf8' });
    expect(result.status).toBe(1);
  });

  it('accepts byte-identical trees', () => {
    const result = spawnSync('bash', [script], { cwd: fixture, encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('rejects an untracked mirror file after sync creates a new pair', () => {
    fs.writeFileSync(path.join(fixture, 'src/build-integrity/new.ts'), 'new\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/build-integrity/new.ts'), 'new\n');
    const result = spawnSync('bash', [script, '--post-sync'], { cwd: fixture, encoding: 'utf8' });
    expect(result.status).toBe(1);
  });
});
