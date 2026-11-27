import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import {
  HOME, effectivePath, envWithPath, firstExisting, isWindowsShim, npmCli, packageDir, probe,
  resetPackageDir, run, withPlatform, parseWhichOutput, PROBE_TIMEOUT_MS,
} from '../scripts/lib/proc.mjs';
import { isFile } from '../scripts/lib/util.mjs';

test('HOME is an absolute path', () => {
  assert.equal(typeof HOME, 'string');
  assert.ok(path.isAbsolute(HOME), `HOME must be absolute, got: ${HOME}`);
});

test('effectivePath is non-empty, deduplicated and contains the node dir', () => {
  const parts = effectivePath().split(path.delimiter).filter(Boolean);

  assert.ok(parts.length > 0);
  // The node directory must lead, otherwise npm .cmd shims cannot find node when
  // launched from Git Bash where `node` is absent from Windows PATH.
  assert.equal(parts[0], path.dirname(process.execPath));
  assert.equal(new Set(parts).size, parts.length);
});

test('effectivePath is cached and returns the identical string', () => {
  assert.equal(effectivePath(), effectivePath());
});

test('envWithPath copies the environment and overrides PATH', () => {
  const env = envWithPath();
  assert.equal(env.PATH, effectivePath());
  // A copy, not the live process.env object -- mutating it must not leak.
  assert.notEqual(env, process.env);
});

test('run executes a real command and reports its exit status', () => {
  const r = run(process.execPath, ['-e', 'process.stdout.write("ok")']);
  assert.equal(r.status, 0);
  assert.equal(String(r.stdout).trim(), 'ok');
});

test('run captures a non-zero exit instead of throwing', () => {
  assert.equal(run(process.execPath, ['-e', 'process.exit(3)']).status, 3);
});

test('run honours the timeout option', () => {
  // A hung gate tool must not hang the whole reinstall; it becomes a failed run.
  const r = run(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { timeout: 50 });
  assert.notEqual(r.status, 0);
});

test('npmCli resolves to an existing npm-cli.js next to node', () => {
  const cli = npmCli();
  // Empty means runNpm degrades to status 127.
  if (cli) assert.ok(isFile(cli), `resolved npmCli does not exist: ${cli}`);
});

test('packageDir honours XP_GATE_PACKAGE_DIR', () => {
  const original = process.env.XP_GATE_PACKAGE_DIR;
  try {
    process.env.XP_GATE_PACKAGE_DIR = process.cwd();
    resetPackageDir();
    // The override lets a test or sandbox pin the package location.
    assert.equal(packageDir(), process.cwd());
  } finally {
    if (original === undefined) delete process.env.XP_GATE_PACKAGE_DIR;
    else process.env.XP_GATE_PACKAGE_DIR = original;
    resetPackageDir();
  }
  assert.equal(typeof packageDir(), 'string');
});

test('resetPackageDir clears the memoised value without changing the answer', () => {
  const first = packageDir();
  resetPackageDir();
  assert.equal(first, packageDir());
});

// ---------------------------------------------------------------------------
// Platform injection (TODO-3 / WSL migration).
//
// process.platform is frozen at startup, so every Windows branch in proc.mjs was
// unreachable on Linux and untestable on Windows. After migrating the dev box to
// WSL the Windows code would have quietly lost its only coverage. `withPlatform`
// makes the decision an argument so both branches are testable from either OS.
//
// The rule this encodes: the injected value decides the branch, and the real
// process.platform is the default.
// ---------------------------------------------------------------------------

test('withPlatform runs the callback with the platform it was given', () => {
  const seen = withPlatform('win32', () => process.platform);
  assert.equal(seen, 'win32', 'the injected platform must be visible to the callback');
});

test('withPlatform restores the real platform afterwards, even when the callback throws', () => {
  const real = process.platform;
  assert.throws(() => withPlatform('win32', () => { throw new Error('boom'); }), /boom/);
  assert.equal(process.platform, real, 'a throwing callback must not leak the fake platform');
});

test('withPlatform returns whatever the callback returns', () => {
  assert.equal(withPlatform('linux', () => 42), 42);
});

test('isWindowsShim recognises .cmd and .bat only on win32', () => {
  // npm on Windows installs a .cmd shim, which needs cmd.exe; a .cmd path on
  // Linux is just an odd filename and must not trigger the comspec branch.
  withPlatform('win32', () => {
    assert.equal(isWindowsShim('C:\\npm\\jscpd.cmd'), true);
    assert.equal(isWindowsShim('C:\\npm\\jscpd.CMD'), true, 'the check is case-insensitive');
    assert.equal(isWindowsShim('C:\\npm\\jscpd.bat'), true);
  });
  withPlatform('linux', () => {
    assert.equal(isWindowsShim('/usr/local/bin/jscpd'), false);
    assert.equal(isWindowsShim('/home/u/jscpd.cmd'), false, 'extension alone is not enough off Windows');
  });
});

test('firstExisting accepts the bare path on any platform', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-first-'));
  try {
    const bare = path.join(dir, 'tool');
    fs.writeFileSync(bare, '');
    assert.equal(firstExisting(bare), bare);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('firstExisting appends PATHEXT-style extensions only on win32', () => {
  // The Windows failure this models: `where jscpd` lists the extensionless shell
  // shim FIRST, and spawnSync of that shim returns ENOENT even though jscpd.exe
  // sits right beside it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-first-'));
  try {
    const base = path.join(dir, 'tool');
    fs.writeFileSync(`${base}.exe`, '');
    assert.equal(firstExisting(base), '', 'off Windows an absent bare path is simply absent');
    assert.equal(
      withPlatform('win32', () => firstExisting(base)),
      `${base}.exe`,
      'on win32 the .exe beside it is the real executable',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probe routes a .cmd shim through cmd.exe on win32 instead of spawning it directly', () => {
  // Measured failure this models: spawnSync of a .cmd without a shell returns
  // EINVAL on Windows, so the gate reports "tool installed but produced no
  // output". The routed call must therefore name cmd.exe, and the shim must
  // arrive quoted with windowsVerbatimArguments so backslashes survive.
  const shim = path.join(os.tmpdir(), 'fake-tool.cmd');
  const r = withPlatform('win32', () => probe(shim, ['--version'], {
    env: { ComSpec: '/bin/echo' },
  }));
  // /bin/echo stands in for cmd.exe: whatever it echoes is the command line
  // that would have been handed to the shell.
  const line = String(r.stdout);
  assert.match(line, /fake-tool\.cmd/, 'the shim must be the program being run');
  assert.match(line, /--version/, 'the arguments must be forwarded');
});

test('probe spawns a plain executable directly on win32, without a shell', () => {
  // The comspec route is for shims only; an .exe must not be wrapped in cmd.exe,
  // which would break exit codes and quoting for every real tool.
  const r = withPlatform('win32', () => probe(process.execPath, ['-e', 'process.stdout.write("direct")']));
  assert.equal(r.status, 0);
  assert.equal(String(r.stdout), 'direct');
});

test('probe on linux never takes the comspec route, even for a .cmd path', () => {
  // /bin/sh is the stand-in: if the comspec branch ran, the output would be the
  // echoed command line rather than the tool's own error.
  const r = withPlatform('linux', () => probe('/nonexistent/tool.cmd', [], { env: { ComSpec: '/bin/echo' } }));
  assert.doesNotMatch(String(r.stdout || ''), /nonexistent\/tool\.cmd/);
  assert.notEqual(r.status, 0, 'a missing program must fail rather than fake success');
});

test('parseWhichOutput picks the first runnable path from where output on win32', () => {
  // Measured on the Windows box: `where jscpd` listed an extensionless shell
  // shim BEFORE jscpd.cmd, and spawnSync of that shim returns ENOENT -- the tool
  // was installed but unreachable. The parser must skip anything that is not a
  // real file and keep looking, rather than trusting the first line.
  const out = ['C:\\npm\\jscpd', 'C:\\npm\\jscpd.cmd'].join('\r\n');
  const resolved = withPlatform('win32', () => parseWhichOutput(out, () => 'C:\\npm\\jscpd'));
  assert.equal(resolved, 'C:\\npm\\jscpd', 'a resolvable first line is returned as-is');
});

test('parseWhichOutput skips entries that do not exist and falls through', () => {
  // Built on real files: `firstExisting` must be the code under test, not a stub
  // that returns the hit path (which `.find(Boolean)` would reduce to `true`).
  // The first line is a path that does not exist; the second is a real file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-which-'));
  try {
    const real = path.join(dir, 'tool');
    fs.writeFileSync(real, '');
    const out = `${path.join(dir, 'missing')}\n${real}\n`;
    assert.equal(withPlatform('win32', () => parseWhichOutput(out)), real);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseWhichOutput returns empty when where found nothing runnable', () => {
  assert.equal(withPlatform('win32', () => parseWhichOutput('', () => '')), '');
  assert.equal(withPlatform('win32', () => parseWhichOutput('\r\n\r\n', () => '')), '');
});

test('parseWhichOutput ignores carriage returns in where output', () => {
  // cmd.exe emits CRLF; a parser splitting on "\n" alone would keep a trailing \r
  // in the path and produce a path that does not exist.
  const out = 'C:\\a\\tool.exe\r\n';
  assert.equal(withPlatform('win32', () => parseWhichOutput('C:\\a\\tool.exe\r\n', (p) => p)), 'C:\\a\\tool.exe');
});

// ---------------------------------------------------------------------------
// Timeout budgets (magic-number refactor).
//
// These are values, not behaviour, and nothing above pins them: a refactor that
// silently turned 10s into 30s would still pass every other test in this file.
// The budgets are named by INTENT, not by duration, because three groups of
// equal numbers existed only by coincidence -- `npm root -g` and a node syntax
// check both got 30s for unrelated reasons and must be free to diverge.
// ---------------------------------------------------------------------------

test('PROBE_TIMEOUT_MS is a short budget for commands that must answer fast', () => {
  // which/where/registry queries. If one of these hangs, the tool is unusable
  // and a long wait only delays the report.
  assert.equal(PROBE_TIMEOUT_MS, 10000);
});

test('probe-tier lookups actually use PROBE_TIMEOUT_MS', () => {
  // The constant is worthless if the call sites kept their own literals.
  const src = fs.readFileSync(new URL('../scripts/lib/proc.mjs', import.meta.url), 'utf8');
  const probeCalls = src.match(/timeout: 10000\b/g) || [];
  assert.deepEqual(probeCalls, [], 'probe-tier call sites must reference PROBE_TIMEOUT_MS, not 10000');
});
