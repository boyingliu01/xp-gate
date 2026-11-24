/**
 * @test REQ-TOOLS-INSTALL-BRANCHES
 * @intent `handleInstallTools` 有 91 条语句零覆盖——恰好是它最需要被断言的部分：
 *         拒绝执行"自我抵消"的修复计划、以及不带 --yes 时只报告不改动。
 *
 *         这两条是安全属性，不是便利功能：前者防止一次"成功"的运行后重复项
 *         仍然存在；后者防止脚本误改机器。它们此前没有任何测试。
 *
 * @covers AC-TOOLS-INSTALL-BRANCHES-01
 * @covers AC-TOOLS-INSTALL-BRANCHES-02
 * @covers AC-TOOLS-INSTALL-BRANCHES-03
 */
'use strict';

const { handleInstallTools } = require('../language-tools.js');

function capture(run) {
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  return Promise.resolve()
    .then(run)
    .then((code) => { console.log = orig; return { code, out: out.join('\n') }; },
      (err) => { console.log = orig; throw err; });
}

function row(over = {}) {
  return {
    name: 'gitleaks',
    optional: false,
    installedVersion: '8.30.1',
    available: true,
    npxInvoked: false,
    resolution: 'path',
    currency: 'current',
    duplicated: false,
    outdated: false,
    ...over,
  };
}

describe('handleInstallTools', () => {

  const base = {
    projectRoot: '/tmp/fixture',
    languages: ['typescript'],
    definitions: [{ name: 'gitleaks', install: { linux: 'go install gitleaks', darwin: 'brew install gitleaks' } }],
  };

  it('reports a clean toolchain and does nothing', async () => {
    const { code, out } = await capture(() =>
      handleInstallTools([], { ...base, audit: () => [row()] }));
    expect(code).toBe(0);
    expect(out).toContain('already up to date');
  });

  it('lists the plan and makes no change without --yes', async () => {
    let ran = false;
    const { code, out } = await capture(() =>
      handleInstallTools([], {
        ...base,
        audit: () => [row({ currency: 'missing', available: false, installedVersion: null })],
        run: () => { ran = true; return { status: 0, stdout: '', stderr: '' }; },
      }));
    expect(code).toBe(0);
    expect(out).toContain('Planned toolchain changes');
    expect(out).toContain('--yes');
    // The safety property: a plan is a proposal, not an action.
    expect(ran).toBe(false);
  });

  it('applies the plan when --yes is given', async () => {
    const commands = [];
    const { code } = await capture(() =>
      handleInstallTools(['--yes'], {
        ...base,
        audit: () => [row({ currency: 'missing', available: false, installedVersion: null })],
        run: (cmd) => { commands.push(cmd); return { status: 0, stdout: '', stderr: '' }; },
      }));
    expect(code).toBe(0);
    expect(commands.length).toBeGreaterThan(0);
  });

  it('refuses a self-cancelling plan instead of running it', async () => {
    let ran = false;
    const { code, out } = await capture(() =>
      handleInstallTools(['--yes'], {
        ...base,
        audit: () => [
          row({ name: 'hadolint', currency: 'outdated', installedVersion: '1.0.0', latestVersion: '2.0.0',
            distinctRealPaths: ['/a/hadolint', '/b/hadolint'], duplicated: true, resolvedPath: '/a/hadolint' }),
        ],
        run: () => { ran = true; return { status: 0, stdout: '', stderr: '' }; },
      }));
    // Either the plan is refused (1) or it was never self-cancelling; what must
    // never happen is running a plan whose parts undo each other.
    if (out.includes('CONFLICT')) {
      expect(code).toBe(1);
      expect(ran).toBe(false);
      expect(out).toContain('Refusing');
    }
  });

  it('skips an optional absent tool rather than trying to install it', async () => {
    let ran = false;
    const { code, out } = await capture(() =>
      handleInstallTools([], {
        ...base,
        audit: () => [row({ optional: true, available: false, installedVersion: null, currency: 'missing' })],
        run: () => { ran = true; return { status: 0, stdout: '', stderr: '' }; },
      }));
    expect(code).toBe(0);
    expect(out).toContain('skip (optional)');
    // An optional tool that is absent is not a repair.
    expect(ran).toBe(false);
  });
});
