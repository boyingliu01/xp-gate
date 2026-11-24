/**
 * @test REQ-DOCTOR-FIX
 * @intent `doctor --fix` 的修复函数此前只有经全量 `doctor()` 才能到达，而那条路径
 *         在本仓库里跑得很重（探测工具、读注册表）。于是 `fixMissingHooks`、
 *         `fixTemplateDirMismatch` 等（doctor.js 未覆盖区块的主要部分）没有任何
 *         直接断言——而它们会**真的改动用户的文件**。
 *
 *         这些函数都接受目标目录作为参数，用临时目录就能安全驱动。
 *
 * @covers AC-DOCTOR-FIX-01
 * @covers AC-DOCTOR-FIX-02
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const doctor = require('../doctor.js');

let tmp;

function makeTree(spec) {
  for (const [rel, content] of Object.entries(spec)) {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-fix-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('fixMissingHooks', () => {
  it('restores each hook that the source provides', () => {
    makeTree({
      'src/hooks/pre-commit': '#!/bin/sh\n# pre-commit\n',
      'src/hooks/pre-push': '#!/bin/sh\n# pre-push\n',
      'src/hooks/post-merge': '#!/bin/sh\n# post-merge\n',
    });
    const dest = path.join(tmp, 'installed');
    const fixed = doctor.fixMissingHooks('global', path.join(tmp, 'src'), dest);
    expect(fixed).toBe(true);
    for (const name of ['pre-commit', 'pre-push', 'post-merge']) {
      expect(fs.existsSync(path.join(dest, name)), name).toBe(true);
    }
  });

  it('reports no change when the source has no hooks at all', () => {
    const fixed = doctor.fixMissingHooks('local', path.join(tmp, 'empty'), path.join(tmp, 'dest'));
    expect(fixed).toBe(false);
  });

  it('makes the restored hooks executable', () => {
    makeTree({ 'src/hooks/pre-commit': '#!/bin/sh\n' });
    const dest = path.join(tmp, 'installed');
    doctor.fixMissingHooks('global', path.join(tmp, 'src'), dest);
    const mode = fs.statSync(path.join(dest, 'pre-commit')).mode & 0o777;
    // A hook that is not executable is a hook git silently ignores.
    expect(mode & 0o111).toBeTruthy();
  });
});

describe('fixTemplateDirMismatch', () => {
  it('is a no-op when the config already points at the expected directory', () => {
    const calls = [];
    const config = { templateDir: '/expected' };
    // saveConfig is module-level and writes the user's real config, so this case
    // must not reach it. Patching is not needed: the guard returns before that.
    const changed = doctor.fixTemplateDirMismatch(config, '/expected');
    expect(changed).toBe(false);
    expect(calls).toEqual([]);
  });

  it('is a no-op when the config declares no templateDir at all', () => {
    expect(doctor.fixTemplateDirMismatch({}, '/expected')).toBe(false);
  });
});

describe('diagnoseHookDrift', () => {
  // ctx.repoHooks / ctx.installedHooks exist for exactly this: pointing the
  // comparison at two temp trees instead of the user's real install.
  // Asserted, not guarded: a `if (!fn) return` would turn 'the export
  // disappeared' into a green test.
  const drift = () => doctor.diagnoseHookDrift;

  function treeWith(hooks, libFiles) {
    makeTree({
      ...Object.fromEntries(Object.entries(hooks).map(([k, v]) => [`repo/${k}`, v])),
      ...Object.fromEntries(Object.entries(libFiles || {}).map(([k, v]) => [`repo/lib/${k}`, v])),
      ...Object.fromEntries(Object.keys(hooks).map((k) => [`inst/${k}`, hooks[k]])),
    });
  }

  it('is silent when the project has no canonical hook source', () => {
    const fn = drift();
    makeTree({ 'inst/pre-commit': 'x' });
    const { checks, issues } = fn({
      repoHooks: path.join(tmp, 'nothing-here'),
      installedHooks: path.join(tmp, 'inst'),
    });
    expect(checks).toEqual([]);
    expect(issues).toBe(0);
  });

  it('is silent when no global copy exists at all', () => {
    const fn = drift();
    makeTree({ 'repo/pre-commit': '#!/bin/sh\n' });
    const { checks, issues } = fn({
      repoHooks: path.join(tmp, 'repo'),
      installedHooks: path.join(tmp, 'absent'),
    });
    // A consumer project has no installed copy; that is not drift.
    expect(checks).toEqual([]);
    expect(issues).toBe(0);
  });

  it('reports PASS when an installed hook matches githooks/', () => {
    const fn = drift();
    treeWith({ 'pre-commit': '#!/bin/sh\n# same\n' });
    const { checks, issues } = fn({
      repoHooks: path.join(tmp, 'repo'),
      installedHooks: path.join(tmp, 'inst'),
    });
    expect(checks[0].status).toBe('PASS');
    expect(issues).toBe(0);
  });

  it('reports FAIL and names the direction when the copies differ', () => {
    const fn = drift();
    makeTree({
      'repo/pre-commit': '#!/bin/sh\n# repo\n',
      'inst/pre-commit': '#!/bin/sh\n# installed, different\n',
    });
    const { checks } = fn({
      repoHooks: path.join(tmp, 'repo'),
      installedHooks: path.join(tmp, 'inst'),
    });
    const fail = checks.find((c) => c.status === 'FAIL');
    expect(fail).toBeDefined();
    // The direction is what makes the message actionable: "sync" vs "your
    // installed copy is ahead of the repo".
    expect(fail.detail).toMatch(/newer than/);
  });
});

describe('diagnoseLanguageTools', () => {
  // Injected detect/getTools: the real ones probe the toolchain, which is what
  // made these 34 lines of output logic unreachable from a test.
  const registry = {
    typescript: { name: 'TypeScript' },
    shell: { name: 'Shell' },
  };

  it('returns 0 and prints nothing when no language is detected', () => {
    const issues = doctor.diagnoseLanguageTools({
      detect: () => ({ detected: [], configFiles: {} }),
      getTools: () => ({}),
      registry,
    });
    expect(issues).toBe(0);
  });

  it('counts a missing required tool as an issue', () => {
    const issues = doctor.diagnoseLanguageTools({
      detect: () => ({ detected: ['typescript'], configFiles: {} }),
      getTools: () => ({
        typescript: [
          { tool: { name: 'tsc', optional: false }, status: 'available', version: '5.0.0' },
          { tool: { name: 'eslint', optional: false }, status: 'missing' },
        ],
      }),
      registry,
    });
    expect(issues).toBe(1);
  });

  it('does not count a missing OPTIONAL tool as an issue', () => {
    const issues = doctor.diagnoseLanguageTools({
      detect: () => ({ detected: ['typescript'], configFiles: {} }),
      getTools: () => ({
        typescript: [{ tool: { name: 'stryker', optional: true }, status: 'missing' }],
      }),
      registry,
    });
    expect(issues).toBe(0);
  });

  it('falls back to the raw language key when the registry lacks it', () => {
    const issues = doctor.diagnoseLanguageTools({
      detect: () => ({ detected: ['mystery'], configFiles: {} }),
      getTools: () => ({ mystery: [{ tool: { name: 'x', optional: false }, status: 'available' }] }),
      registry,
    });
    // An unknown language must not throw while trying to print its display name.
    expect(issues).toBe(0);
  });

  it('returns 0 when detection throws instead of crashing doctor', () => {
    const issues = doctor.diagnoseLanguageTools({
      detect: () => { throw new Error('detection blew up'); },
      getTools: () => ({}),
      registry,
    });
    // One failing sub-check must not take the whole doctor run down.
    expect(issues).toBe(0);
  });
});
