/**
 * @test REQ-608
 * @intent `xp-gate check . --all` is documented as a full-tree check, but Gate 3
 *         resolved its file list from `git diff`, so on a clean tree it scanned
 *         the empty set and printed
 *
 *             ⏭️  SKIPPED - Complexity (no source files to check)
 *
 *         `--all` therefore checked LESS than a normal commit — and the wording
 *         ("no source files to check") describes an empty PROJECT when the real
 *         cause is an empty DIFF. Reading it as "this gate passed" is the
 *         documented failure mode: the reporter worked around it by running lizard
 *         by hand.
 *
 *         Gate 4 does not depend on CHANGED_FILES and works fine under the same
 *         preamble, which is the proof that the file SOURCE is the defect and not
 *         the preamble.
 *
 *         Under `--all` the set must be the repository's tracked sources; and a
 *         gate that genuinely only makes sense per-change must say so, not look
 *         like it found an empty project.
 * @covers AC-608-01, AC-608-02, AC-608-03
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gateRunner = require('../gate-runner.js');

/**
 * Create a throwaway git repo with one commit and a clean working tree, plus the
 * given tracked files.
 *
 * A clean tree is the whole point: it is the state in which `--all` used to scan
 * nothing.
 *
 * @param {string[]} files - repo-relative paths to create and commit
 * @param {(dir: string) => void} [afterCommit] - optional mutation after the commit
 * @returns {string} the repo directory
 */
function makeCleanRepo(files, afterCommit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-589-'));
  const git = (/** @type {string[]} */ args) =>
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  // Every fixture step is IO that can fail for environment reasons (no git, a
  // read-only tmp, a path already taken). Failing with the operation and the path
  // named turns "the test broke" into a diagnosable message instead of a bare
  // exception from inside a helper.
  try {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@t.t']);
    git(['config', 'user.name', 't']);
    git(['config', 'core.hooksPath', process.platform === 'win32' ? 'NUL' : '/dev/null']);
    for (const f of files) {
      const full = path.join(dir, f);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, `// ${f}\nexport const x = 1;\n`);
    }
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'clean tree']);
  } catch (err) {
    throw new Error(`makeCleanRepo failed while preparing ${dir}: ${err.message}`);
  }
  if (afterCommit) afterCommit(dir);
  return dir;
}

/**
 * The `--all` file list the runner should produce, as a sorted array.
 *
 * @param {string} cwd
 * @returns {string[]}
 */
function allModeFiles(cwd) {
  const out = gateRunner.resolveAllModeChangedFiles(cwd);
  return out.split('\n').filter(Boolean).sort();
}

describe('REQ-608: check --all scans the tree, not the diff', () => {
  /** @type {string[]} */
  const repos = [];

  afterEach(() => {
    for (const dir of repos.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-608-01: on a clean tree the file list is the tracked sources, not empty', () => {
    const repo = makeCleanRepo(['src/a.ts', 'src/b.ts', 'lib/c.js']);
    repos.push(repo);

    const files = allModeFiles(repo);

    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/b.ts');
    expect(files).toContain('lib/c.js');
  });

  it('AC-608-01: data and documentation files are not claimed as sources', () => {
    // The control that stops `--all` from becoming "every tracked file": the
    // point is to scan SOURCES, not to hand a markdown file to lizard.
    const repo = makeCleanRepo(['src/a.ts', 'docs/readme.md', 'data/rows.csv', 'notes.txt']);
    repos.push(repo);

    const files = allModeFiles(repo);

    expect(files).toContain('src/a.ts');
    expect(files).not.toContain('docs/readme.md');
    expect(files).not.toContain('data/rows.csv');
    expect(files).not.toContain('notes.txt');
  });

  it('AC-608-01: every supported language extension is discovered', () => {
    const repo = makeCleanRepo([
      'a.ts', 'b.tsx', 'c.js', 'd.py', 'e.go', 'f.java', 'g.kt', 'h.rs', 'i.sh',
    ]);
    repos.push(repo);

    const files = allModeFiles(repo);

    for (const f of ['a.ts', 'b.tsx', 'c.js', 'd.py', 'e.go', 'f.java', 'g.kt', 'h.rs', 'i.sh']) {
      expect(files, `${f} must be a source file`).toContain(f);
    }
  });

  it('AC-608-02: an empty file list explains that the DIFF is empty, not the project', () => {
    // The exact wording defect: "no source files to check" describes an empty
    // project. The honest message names the real cause and the action that fixes
    // it.
    const msg = gateRunner.describeEmptyChangedFiles('diff', 0);

    expect(msg).toContain('no changed files');
    expect(msg).toContain('--all');
    // It must NOT claim the project has no sources.
    expect(msg.toLowerCase()).not.toContain('no source files');
  });

  it('AC-608-02: under --all an empty list says the tree has no sources, not the diff', () => {
    const msg = gateRunner.describeEmptyChangedFiles('all', 0);

    expect(msg).toContain('tracked');
    // `--all` already scanned everything, so pointing at `--all` again is useless.
    expect(msg).not.toContain('run with `--all`');
  });

  it('AC-608-03: the resolved mode is reported so the scan scope is visible', () => {
    // #589 point 1's second half: the user must be able to see which scope was
    // used. A silent switch between diff and tree is the same defect one level up.
    const fileCount = 3;
    const allScope = gateRunner.describeChangedFilesScope('all', fileCount);
    expect(allScope).toContain(String(fileCount));
    expect(allScope.toLowerCase()).toContain('all');

    const diffScope = gateRunner.describeChangedFilesScope('diff', 1);
    expect(diffScope).toContain('1');
    expect(diffScope).not.toContain('all');
  });

  it('AC-608-03: checkAllGates actually passes the all scope through to every gate', () => {
    // The wire, not just the resolver. Every piece above can be correct while the
    // scope never reaches the gates — which is exactly how the first attempt at
    // this fix failed (an edit to check.js was reverted by a snapshot restore, and
    // the resolver tests stayed green because none of them exercised the call).
    const { checkAllGates } = require('../check.js');
    const seen = [];
    const saved = new Map();
    for (const id of Object.keys(gateRunner.GATE_REGISTRY)) {
      const gate = gateRunner.GATE_REGISTRY[id];
      if (!gate.run) continue;
      saved.set(id, gate.run);
      gate.run = (_target, opts) => {
        seen.push({ id, scope: opts && opts.scope });
        return 0;
      };
    }
    const log = console.log;
    console.log = () => {};
    return checkAllGates(undefined).then(() => {
      console.log = log;
      for (const [id, fn] of saved) gateRunner.GATE_REGISTRY[id].run = fn;

      expect(seen.length).toBeGreaterThan(0);
      const missing = seen.filter((s) => s.scope !== 'all').map((s) => s.id);
      expect(missing, `these gates did not receive scope=all: ${missing.join(', ')}`).toEqual([]);
    });
  });
});
