/**
 * @test REQ-152 Baseline CLI handler
 * @intent `xp-gate baseline create` silently recorded NOTHING for TypeScript.
 *         It built one command line from every source file and passed it as argv:
 *         measured in this repo, 652 files and 31,917 characters, against a
 *         Windows command-line limit around 8,191. The call therefore always
 *         failed, and the failure was swallowed by a bare `catch {}` whose comment
 *         said "ESLint unavailable — skip". The resulting baseline contained zero
 *         eslint entries and 70 shellcheck ones, so Gate 1 compared every TS/JS
 *         file against a baseline of nothing.
 *
 *         That is the worst possible shape for a baseline: it looks authoritative,
 *         it is committed and regenerated, and it silently waves through exactly
 *         the language this package is written in.
 *
 *         Three separate defects, each sufficient to produce the empty result:
 *           1. one argv for all files (fails over the platform limit);
 *           2. a thrown error treated as "tool unavailable" — the two states
 *              ("found nothing" and "could not evaluate") were indistinguishable;
 *           3. a `"undefined"` key written when a result could not be matched to a
 *              file, inflating the entry count by one and making the file count
 *              disagree with the number of real files.
 * @covers AC-BASELINE-01 AC-BASELINE-02 AC-BASELINE-03
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const { execFileSync } = require('child_process');

const { createBaseline } = require('../baseline.js');

describe('baseline completeness — a language must not vanish silently', () => {
  let tmpDir;
  const originalCwd = process.cwd;

  /**
   * Create a fake linter in node_modules/.bin, in the shape the PLATFORM actually
   * uses.
   *
   * On Windows cmd.exe cannot execute an extensionless POSIX sh wrapper at all --
   * not even by absolute path -- so npm installs a `.cmd` launcher next to it and
   * that is what a shell command resolves. A stub written only as `eslint` would
   * therefore test a layout that never exists on this platform, and the test would
   * fail for a reason unrelated to the defect under examination.
   *
   * @param {string} binDir node_modules/.bin
   * @param {string} name tool name
   * @param {string} jsBody statements to run, as JS
   */
  function writeLintStub(binDir, name, jsBody) {
    const js = `#!/usr/bin/env node\n${jsBody}\n`;
    if (process.platform === 'win32') {
      const cmdPath = path.join(binDir, `${name}.cmd`);
      // A .cmd shim that hands the script to node, mirroring npm's own launcher.
      const jsPath = path.join(binDir, `${name}-stub.js`);
      fs.writeFileSync(jsPath, js);
      fs.writeFileSync(cmdPath, `@node "%~dp0${name}-stub.js" %*\r\n`);
      return;
    }
    const stub = path.join(binDir, name);
    fs.writeFileSync(stub, js);
    fs.chmodSync(stub, 0o755);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-completeness-'));
    process.cwd = () => tmpDir;
    // `findFilesByExt` enumerates with `git ls-files`, so a fixture that is not a
    // git work tree yields NO files and the linter is never invoked. Without this
    // the tests would pass vacuously: the very code path under test would never
    // run, and silence would look like success -- the same defect one level up.
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
  });

  /**
   * Stage the fixture so `git ls-files` reports it. Files are only visible to the
   * baseline once tracked, which is also true of the real project.
   */
  function trackAll() {
    execFileSync('git', ['add', '-A', '-f'], { cwd: tmpDir });
  }

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('AC-BASELINE-01: many files do not become one over-long argv', async () => {
    // Enough files that a single concatenated command line would exceed the
    // platform limit. If the implementation still builds one argv, this is
    // exactly the case that failed in the real repo.
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const names = [];
    for (let i = 0; i < 400; i++) {
      const name = `src/file-with-a-long-descriptive-name-${String(i).padStart(4, '0')}.ts`;
      fs.writeFileSync(path.join(tmpDir, name), 'export const x = 1;\n');
      names.push(name);
    }
    fs.writeFileSync(path.join(tmpDir, 'eslint.config.js'), 'module.exports = [];\n');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0' })
    );
    // A stand-in linter: it records the argv it received, then answers with a
    // JSON array. The real one is not needed to test how the command is built.
    const binDir = path.join(tmpDir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    writeLintStub(
      binDir,
      'eslint',
      "const fs=require('fs');\n" +
        'fs.appendFileSync(process.env.ARGV_LOG, process.argv.length + "\\n");\n' +
        'process.stdout.write("[]");'
    );

    const logPath = path.join(tmpDir, 'argv.log');
    const prev = process.env.ARGV_LOG;
    process.env.ARGV_LOG = logPath;
    try {
      trackAll();
      await createBaseline();
    } finally {
      if (prev === undefined) delete process.env.ARGV_LOG;
      else process.env.ARGV_LOG = prev;
    }

    const invocations = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(Number)
      : [];
    // The stub MUST have run. A test that only checks "no invocation was too
    // large" passes vacuously when nothing ran at all -- and nothing running is
    // precisely the old defect (the linter was found, the call failed, the
    // failure was swallowed). Verified: against the pre-fix code this assertion
    // is what goes red; the size bound alone stayed green.
    expect(invocations.length).toBeGreaterThan(0);
    // 400 files at 100 per batch -> 4 calls (the observed count, not a guess).
    expect(invocations.length).toBeGreaterThanOrEqual(2);
    for (const argc of invocations) {
      expect(argc).toBeLessThanOrEqual(200);
    }
  });

  it('AC-BASELINE-02: an evaluation failure is not recorded as an empty result', async () => {
    // The linter exists but errors out. The baseline must not quietly claim the
    // language is clean — that is "did not evaluate" written as "found nothing".
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'eslint.config.js'), 'module.exports = [];\n');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0' })
    );
    const binDir = path.join(tmpDir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    writeLintStub(binDir, 'eslint', 'process.stderr.write("boom");process.exit(2);');

    const warnings = [];
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = (...a) => warnings.push(a.join(' '));
    console.error = (...a) => warnings.push(a.join(' '));
    let result;
    try {
      trackAll();
      result = await createBaseline();
    } finally {
      console.warn = origWarn;
      console.error = origError;
    }

    const keys = Object.keys(result).filter(k => k !== 'undefined');
    expect(keys.length).toBe(0);
    // The failure has to be visible: silence is what made this defect survive.
    expect(warnings.join('\n')).toMatch(/eslint/i);
  });

  it('AC-BASELINE-03: no "undefined" key is ever written', async () => {
    // Written when a tool's result could not be matched back to a file. It made
    // `Object.keys(baseline).length` disagree with the number of real files, so
    // "71 files tracked" was reported for 70.
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'eslint.config.js'), 'module.exports = [];\n');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'x', version: '1.0.0' })
    );
    const binDir = path.join(tmpDir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    // A result whose path matches NO discovered file -- the exact input that
    // produced the bogus key.
    const ranMarker = path.join(tmpDir, 'ran.marker');
    writeLintStub(
      binDir,
      'eslint',
      `require('fs').writeFileSync(${JSON.stringify(ranMarker)}, 'ran');` +
        'process.stdout.write(JSON.stringify([{filePath:"/nowhere/ghost.ts",warningCount:3,errorCount:0}]));'
    );

    trackAll();
    const result = await createBaseline();
    // The stub must actually have been invoked. Otherwise the linter never ran,
    // no unmatched result was ever produced, and "no undefined key" would hold
    // for a reason that has nothing to do with the defect -- verified against the
    // pre-fix code, where this assertion is required for the test to go red.
    expect(fs.existsSync(ranMarker)).toBe(true);
    expect(Object.keys(result)).not.toContain('undefined');
  });
});

describe('local binary resolution — the launcher must be executable', () => {
  // Measured on Windows, all four forms against the same installed tool:
  //   'node_modules/.bin/eslint'       -> "'node_modules' is not recognized"
  //   'node node_modules/.bin/eslint'  -> SyntaxError (POSIX sh wrapper)
  //   'node_modules/.bin/eslint.cmd'   -> "'node_modules' is not recognized"
  //   absolute path to eslint.cmd      -> works
  // So resolution has to yield an ABSOLUTE path and the platform's launcher.
  let tmpDir;
  const originalCwd = process.cwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-bin-'));
    process.cwd = () => tmpDir;
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true });
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('AC-BASELINE-04: returns an absolute path to the platform launcher', async () => {
    const { resolveLocalBin } = require('../baseline.js');
    const binDir = path.join(tmpDir, 'node_modules', '.bin');
    const expected = process.platform === 'win32'
      ? path.join(binDir, 'eslint.cmd')
      : path.join(binDir, 'eslint');
    fs.writeFileSync(expected, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n');

    const resolved = resolveLocalBin('eslint');
    expect(resolved).toBe(expected);
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  it('AC-BASELINE-04: a relative path is never returned', async () => {
    const { resolveLocalBin } = require('../baseline.js');
    const binDir = path.join(tmpDir, 'node_modules', '.bin');
    const name = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
    fs.writeFileSync(path.join(binDir, name), 'x');

    const resolved = resolveLocalBin('eslint');
    // The old code returned the literal relative string "node_modules/.bin/eslint",
    // which cmd.exe rejects even when the file exists.
    expect(resolved).not.toBe('node_modules/.bin/eslint');
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  it('AC-BASELINE-04: an absent tool resolves to null, not a broken path', async () => {
    const { resolveLocalBin } = require('../baseline.js');
    expect(resolveLocalBin('definitely-not-installed')).toBeNull();
  });
});
