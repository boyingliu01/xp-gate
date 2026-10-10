/**
 * @test REQ-010-03 canonical hook/adaptor mirror parity
 * @intent Verify githooks/ and src/npm-package mirrors cannot drift in content, file set, or executable bit
 * @covers AC-010-03
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('hook mirror validation', () => {
  let fixture;
  const script = path.resolve(__dirname, '../check-hook-mirror.sh');
  const repoRoot = path.resolve(__dirname, '../..');

  // Index-based assertions only hold when the tree under test IS the Git work
  // tree. Stryker copies the project into .stryker-tmp/ inside the repository,
  // where `git ls-files` resolves to the real root and would report every
  // copied file as untracked.
  function isGitTopLevel(dir) {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout.trim()) return false;
    const canonical = (p) => {
      try { return fs.realpathSync(p); } catch { return path.resolve(p); }
    };
    const toplevel = canonical(result.stdout.trim());
    const target = canonical(dir);
    return process.platform === 'win32'
      ? toplevel.toLowerCase() === target.toLowerCase()
      : toplevel === target;
  }

  const runsInRealWorktree = isGitTopLevel(repoRoot);
  const hookFiles = [
    'adapter-common.sh', 'gate-3.sh', 'gate-4.sh', 'gate-7.sh', 'gate-8.sh', 'gate-9.sh',
    'gate-10.sh', 'gate-12-file-hygiene.sh', 'post-merge', 'pre-commit', 'pre-push',
    'sprint-gate.sh', 'lib/now-ms.sh', 'lib/jscpd-run.sh', 'lib/sprint-gate-report.sh', 'lib/test-failure.sh', 'lib/typecheck.sh', 'lib/validate-code-walkthrough.cjs',
  ];
  // check-hook-mirror.sh also guards root-level shell copies and the
  // principles tree (#507 A-MAJOR-4) -- the fixture must carry the same
  // guarded regions or the byte-identical baseline itself fails. Keep in
  // sync with ROOT_MIRROR_FILES in scripts/check-hook-mirror.sh.
  const rootMirrorFiles = [
    'adapter-common.sh', 'gate-3.sh', 'gate-4.sh', 'gate-7.sh', 'gate-8.sh', 'gate-9.sh',
    'gate-10.sh', 'gate-12-file-hygiene.sh', 'sprint-gate.sh',
  ];

  function validate(cwd) {
    return spawnSync('bash', [script], { cwd, encoding: 'utf8' });
  }

  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-mirror-'));
    fs.mkdirSync(path.join(fixture, 'githooks/lib'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'githooks/adapters/typescript'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/hooks/lib'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/adapters/typescript'), { recursive: true });
    for (const rel of hookFiles) {
      fs.mkdirSync(path.join(fixture, 'src/npm-package/hooks', path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'githooks', rel), `${rel}\n`);
      fs.writeFileSync(path.join(fixture, 'src/npm-package/hooks', rel), `${rel}\n`);
    }
    fs.writeFileSync(path.join(fixture, 'githooks/adapters/typescript/adapter.sh'), 'adapter\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/adapters/typescript/adapter.sh'), 'adapter\n');
    for (const rel of rootMirrorFiles) {
      fs.writeFileSync(path.join(fixture, 'src/npm-package', rel), `${rel}\n`);
    }
    // The principles guard requires both tree roots to exist (diff -rq).
    fs.mkdirSync(path.join(fixture, 'src/principles'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/principles'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'src/principles/sample.ts'), 'sample\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/principles/sample.ts'), 'sample\n');
  });

  afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));

  it.skipIf(!runsInRealWorktree)('passes on the real repository, where mirrors are byte- and mode-identical', () => {
    const result = validate(repoRoot);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('accepts a byte-identical fixture tree', () => {
    expect(validate(fixture).status).toBe(0);
  });

  it.each([
    ['hook content drift', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/hooks/pre-commit'), 'drift\n')],
    ['extra hook mirror file', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/hooks/stale.sh'), 'stale\n')],
    ['missing hook mirror file', () => fs.rmSync(path.join(fixture, 'src/npm-package/hooks/post-merge'))],
    ['adapter content drift', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/adapters/typescript/adapter.sh'), 'drift\n')],
    ['adapter added only to canonical', () => fs.writeFileSync(path.join(fixture, 'githooks/adapters/typescript/only-canonical.sh'), 'x\n')],
    ['principles content drift', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/principles/sample.ts'), 'drift\n')],
  ])('rejects %s', (_name, arrange) => {
    arrange();

    expect(validate(fixture).status).toBe(1);
  });

  it('rejects an executable-bit mismatch recorded in the Git index', () => {
    const git = (args) => spawnSync('git', args, { cwd: fixture, encoding: 'utf8' });
    expect(git(['init', '-q']).status).toBe(0);
    expect(git(['add', '-A']).status).toBe(0);
    // Canonical hook becomes executable while its mirror stays 100644.
    expect(git(['update-index', '--chmod=+x', 'githooks/pre-commit']).status).toBe(0);

    const result = validate(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('mode mismatch');
  });
});
