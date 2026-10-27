/**
 * @test REQ-010-03 canonical hook/adaptor mirror parity
 * @intent Verify githooks/ and src/npm-package mirrors cannot drift in content, file set, or executable bit
 * @covers AC-010-03
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// On Windows a bare PATH 'bash' may resolve to the WSL System32 stub, which
// cannot run these scripts (Linux filesystem view, dropped argv). Resolve the
// same authoritative MSYS bash the hooks get.
const { checkBash } = require('../../src/npm-package/lib/detect-deps.js');
const BASH = (() => { const b = checkBash(); return b.ok ? b.path : 'bash'; })();

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

  // #577 follow-up: the guarded file set is READ from the script, not restated.
  //
  // It used to be a hand-kept copy with a "Keep in sync with HOOK_MIRROR_FILES"
  // comment and no mechanism to enforce that. Adding githooks/lib/prepush-score.py
  // to the guard without also editing this list made every case fail at setup —
  // not because mirror parity broke, but because the fixture no longer described
  // the guarded set. A second copy of a whitelist is a latent failure; the test
  // reads the single source of truth instead.
  function hookMirrorFiles() {
    const src = fs.readFileSync(script, 'utf8');
    const match = /^HOOK_MIRROR_FILES="([^"]*)"/m.exec(src);
    if (!match) throw new Error('HOOK_MIRROR_FILES not found in ' + script);
    const files = match[1].trim().split(/\s+/).filter(Boolean);
    if (files.length === 0) throw new Error('HOOK_MIRROR_FILES is empty');
    return files;
  }

  // Same for the root-level copies.
  function rootMirrorFiles() {
    const src = fs.readFileSync(script, 'utf8');
    const match = /^ROOT_MIRROR_FILES="([^"]*)"/m.exec(src);
    if (!match) throw new Error('ROOT_MIRROR_FILES not found in ' + script);
    const files = match[1].trim().split(/\s+/).filter(Boolean);
    if (files.length === 0) throw new Error('ROOT_MIRROR_FILES is empty');
    return files;
  }

  const hookFiles = hookMirrorFiles();
  // check-hook-mirror.sh also guards root-level shell copies and the
  // principles tree (#507 A-MAJOR-4) -- the fixture must carry the same
  // guarded regions or the byte-identical baseline itself fails.
  const rootMirrorFileList = rootMirrorFiles();

  it('the guarded file set is non-trivial (anti-vacuity)', () => {
    // If the extraction above ever returned a stub, the fixture would be empty
    // and every "passes" case below would pass for the wrong reason.
    expect(hookFiles.length).toBeGreaterThan(10);
    expect(hookFiles).toContain('pre-commit');
    expect(hookFiles).toContain('pre-push');
    expect(rootMirrorFileList.length).toBeGreaterThan(3);
  });

  function validate(cwd) {
    return spawnSync(BASH, [script], { cwd, encoding: 'utf8' });
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
    for (const rel of rootMirrorFileList) {
      fs.writeFileSync(path.join(fixture, 'src/npm-package', rel), `${rel}\n`);
    }
    // The principles guard requires both tree roots to exist (diff -rq).
    fs.mkdirSync(path.join(fixture, 'src/principles'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/principles'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'src/principles/sample.ts'), 'sample\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/principles/sample.ts'), 'sample\n');
    // Same for the published mutation module guard (#544 follow-up).
    fs.mkdirSync(path.join(fixture, 'src/mutation'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/mutation'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'src/mutation/gate-m.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/mutation/gate-m.ts'), 'export const x = 1;\n');
    // Same for the published mock-policy module guard: the three mock-policy
    // fixes on main edited only src/mock-policy/, so the mirror kept the old
    // behaviour and nothing compared the trees.
    fs.mkdirSync(path.join(fixture, 'src/mock-policy'), { recursive: true });
    fs.mkdirSync(path.join(fixture, 'src/npm-package/mock-policy'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'src/mock-policy/gate-m3.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(fixture, 'src/npm-package/mock-policy/gate-m3.ts'), 'export const x = 1;\n');
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
    // #544 follow-up: the published mutation module is guarded the same way.
    ['mutation content drift', () => fs.writeFileSync(path.join(fixture, 'src/npm-package/mutation/gate-m.ts'), 'drift\n')],
    ['mutation file added only to canonical', () => fs.writeFileSync(path.join(fixture, 'src/mutation/extra.ts'), 'x\n')],
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
