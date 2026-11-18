/**
 * @test REQ-152 Baseline CLI handler
 * @intent `xp-gate baseline create` rebuilt the baseline from an empty object and
 *         then wrote it unconditionally. Files whose linter could not RUN were
 *         therefore recorded as "no entry", which the gate reads as "no known
 *         issues" -- and because the write always happened, a run in which every
 *         tool failed replaced a good baseline with `{}`.
 *
 *         That is not hypothetical in this repo. It presents as
 *             BLOCKED - 50 NEW shellcheck issue(s) (baseline: 0, current: 50)
 *         on a tree where nothing had changed, and the two states that must never
 *         be confused are exactly the ones being confused:
 *             "the linter found nothing"
 *             "the linter never answered"
 *         The second was being written to disk as the first.
 *
 *         The repair keeps the ratchet honest in both directions, which is why
 *         these tests come in a pair: a fix that preserved every old entry would
 *         pass the failure test while making the baseline unable to ever shrink.
 * @covers AC-BASELINE-05 AC-BASELINE-06
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const { execFileSync } = require('child_process');

const { createBaseline } = require('../baseline.js');

describe('baseline rebuild — an unevaluated file is not a clean file', () => {
  let tmpDir;
  const originalCwd = process.cwd;

  /**
   * Write an eslint stand-in in the layout this platform actually executes.
   *
   * On Windows cmd.exe cannot run an extensionless POSIX wrapper, so npm installs
   * a `.cmd` launcher; a stub named only `eslint` would exercise a path that never
   * exists here and the test would fail for an unrelated reason.
   *
   * @param {string} jsBody statements the fake linter runs
   */
  function writeEslintStub(jsBody) {
    const binDir = path.join(tmpDir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    const js = `#!/usr/bin/env node\n${jsBody}\n`;
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(binDir, 'eslint-stub.js'), js);
      fs.writeFileSync(
        path.join(binDir, 'eslint.cmd'),
        '@node "%~dp0eslint-stub.js" %*\r\n'
      );
      return;
    }
    const stub = path.join(binDir, 'eslint');
    fs.writeFileSync(stub, js);
    fs.chmodSync(stub, 0o755);
  }

  function git(...args) {
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: tmpDir,
      stdio: 'pipe',
    });
  }

  function readBaseline() {
    return JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.xp-gate', 'lint-baseline.json'), 'utf8')
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-unevaluated-'));
    process.cwd = () => tmpDir;
    // findFilesByExt enumerates with `git ls-files`, so a fixture outside a work
    // tree yields no files and the linter is never invoked -- every assertion
    // below would then pass while the code under test never ran.
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, '.eslintrc.json'), '{}\n');
    // Under src/, not at the root: findFilesByExt enumerates with
    // `git ls-files "**/*.js"`, and that glob matches only files in a
    // subdirectory -- a root-level a.js is invisible to it, so the linter branch
    // would never run and both tests would pass without exercising the fix.
    // Measured: `git ls-files "**/*.js"` returns "" for a tracked root a.js.
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'const a = 1;\n');
    git('add', '.eslintrc.json', 'src/a.js');

    // A baseline from a previous successful run: this file had two warnings.
    fs.mkdirSync(path.join(tmpDir, '.xp-gate'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.xp-gate', 'lint-baseline.json'),
      JSON.stringify({
        'src/a.js': { eslint: { warnings: 2, errors: 0 }, totalWarnings: 2 },
      }, null, 2)
    );
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('AC-BASELINE-05: keeps the previous entry when the linter cannot run', async () => {
    // Exit non-zero with no stdout: the shape of a crashed or unspawnable tool,
    // and the only shape runLintInBatches treats as "not evaluated".
    writeEslintStub('process.exit(1);');

    const baseline = await createBaseline();

    // The defect: without the carry-over this entry vanished, so Gate 1 compared
    // a.js against a baseline of nothing and reported its two known warnings as
    // brand new.
    expect(baseline['src/a.js']).toBeDefined();
    expect(baseline['src/a.js'].eslint.warnings).toBe(2);
    expect(readBaseline()['src/a.js'].eslint.warnings).toBe(2);
  });

  it('AC-BASELINE-06: still shrinks when the linter DOES answer', async () => {
    // The companion the failure test cannot provide: a "preserve everything" fix
    // would pass AC-BASELINE-05 and leave the baseline permanently unshrinkable.
    writeEslintStub(`
      const files = process.argv.slice(2).filter(
        a => !a.startsWith('-') && a !== 'json'
      );
      const out = files.map(f => ({
        filePath: require('path').resolve(f),
        warningCount: 0,
        errorCount: 0,
      }));
      process.stdout.write(JSON.stringify(out));
    `);

    const baseline = await createBaseline();

    // Evaluated and clean: the stale count must be replaced, not carried.
    expect(baseline['src/a.js']).toBeDefined();
    expect(baseline['src/a.js'].eslint.warnings).toBe(0);
    expect(readBaseline()['src/a.js'].eslint.warnings).toBe(0);
  });
});