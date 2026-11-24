/**
 * `xp-gate install-tools` must make the toolchain converge to "one valid,
 * current copy of every tool" — and it must be safe to run.
 *
 * The rules encoded here were decided explicitly for this machine (2026-11-23):
 *
 *   - Remove a duplicate only when the SAME tool has more than one real entity
 *     (two byte-identical hadolint binaries, an old archlint shadowing a new
 *     one). Never uninstall a distro package: `jq` from apt is not a duplicate,
 *     it is the system's copy, and removing it can take other software with it.
 *   - Prefer the copy the PATH resolves FIRST: that is the one gates actually
 *     execute, so keeping it means the repair does not change gate behaviour.
 *   - Dry-run is the default outcome for anything destructive: without `--yes`
 *     the command only reports.
 *
 * Every test injects its own filesystem/command layer; none touches the real
 * toolchain or the network.
 */
const path = require('path');

const { planToolRepairs, handleInstallTools } = require('../language-tools.js');
const { capture, auditRow: row, toolDefinition: def } = require('./tool-audit-fixtures.js');

describe('install-tools: repair planning', () => {
  /**
   * @test REQ-TOOLS-011
   * @intent 重复实体必须产出"删除多余副本"动作，且保留 PATH 首个（门禁实际执行的）那份
   * @covers AC-TOOLS-011-01
   */
  it('plans removal of every duplicate entity except the first-resolved one', () => {
    const dup = row('hadolint', {
      duplicated: true,
      paths: ['/home/u/.local/bin/hadolint', '/home/u/.npm-global/bin/hadolint'],
      distinctRealPaths: ['/home/u/.local/bin/hadolint', '/home/u/.npm-global/bin/hadolint'],
    });
    const plan = planToolRepairs([dup]);
    const removals = plan.actions.filter((a) => a.kind === 'remove-duplicate');
    expect(removals).toHaveLength(1);
    // The FIRST path is what gates execute; keep it.
    expect(removals[0].path).toBe('/home/u/.npm-global/bin/hadolint');
    expect(plan.actions.some((a) => a.kind === 'keep' && a.path === '/home/u/.local/bin/hadolint')).toBe(true);
  });

  /**
   * @test REQ-TOOLS-011
   * @intent 缺失的必需工具产出安装动作
   * @covers AC-TOOLS-011-02
   */
  it('plans an install for a missing required tool', () => {
    const plan = planToolRepairs(
      [row('mypy', { available: false, currency: 'missing', installedVersion: null })],
      { definitions: [def('mypy', { install: { linux: 'pip install mypy' } })] },
    );
    const installs = plan.actions.filter((a) => a.kind === 'install');
    expect(installs).toHaveLength(1);
    expect(installs[0].command).toContain('pip install mypy');
  });

  /**
   * @test REQ-TOOLS-011
   * @intent 可选的缺失工具不应被自动安装（避免装一堆用不上的东西）
   * @covers AC-TOOLS-011-03
   */
  it('does not auto-install a missing OPTIONAL tool', () => {
    const plan = planToolRepairs(
      [row('terraform', { available: false, currency: 'missing', installedVersion: null, optional: true })],
      { definitions: [def('terraform', { optional: true })] },
    );
    expect(plan.actions.filter((a) => a.kind === 'install')).toHaveLength(0);
    expect(plan.actions.some((a) => a.kind === 'skip-optional')).toBe(true);
  });

  /**
   * @test REQ-TOOLS-011
   * @intent 过期的必需工具产出升级动作
   * @covers AC-TOOLS-011-04
   */
  it('plans an upgrade for an outdated required tool', () => {
    const plan = planToolRepairs(
      [row('hadolint', { outdated: true, currency: 'outdated', installedVersion: '2.14.0', latestVersion: '2.15.1' })],
      { definitions: [def('hadolint', { install: { linux: 'brew upgrade hadolint' } })] },
    );
    const upgrades = plan.actions.filter((a) => a.kind === 'upgrade');
    expect(upgrades).toHaveLength(1);
    expect(upgrades[0].command).toContain('brew upgrade hadolint');
  });

  /**
   * @test REQ-TOOLS-011
   * @intent 系统包（apt 装的 jq）不得被当作可删除的重复
   * @covers AC-TOOLS-011-05
   */
  it('never plans removal of a distro-owned copy', () => {
    const dup = row('jq', {
      duplicated: true,
      paths: ['/usr/bin/jq', '/home/u/.local/bin/jq'],
      distinctRealPaths: ['/usr/bin/jq', '/home/u/.local/bin/jq'],
    });
    const plan = planToolRepairs([dup], { systemPrefixes: ['/usr/bin/', '/bin/'] });
    // Nothing to do: a distro copy beside a user copy is coexistence, not a
    // duplicate install, so the plan is empty rather than "keep the system one".
    expect(plan.actions.filter((a) => a.kind === 'remove-duplicate')).toHaveLength(0);
    expect(plan.actions).toHaveLength(0);
  });

  /**
   * @test REQ-TOOLS-011
   * @intent 通过 npx 调用的工具没有 PATH 实体，不得产生删除动作
   * @covers AC-TOOLS-011-06
   */
  it('never plans removal for an npx-invoked tool', () => {
    const plan = planToolRepairs([
      row('@archlinter/cli', { npxInvoked: true, paths: [], distinctRealPaths: [] }),
    ]);
    expect(plan.actions).toHaveLength(0);
  });

  /**
   * @test REQ-TOOLS-011
   * @intent 一切正常的工具不产生任何动作
   * @covers AC-TOOLS-011-07
   */
  it('plans nothing when the toolchain is already clean', () => {
    const plan = planToolRepairs([row('eslint')]);
    expect(plan.actions).toHaveLength(0);
    expect(plan.clean).toBe(true);
  });
});

describe('install-tools: command behaviour', () => {
  /**
   * @test REQ-TOOLS-012
   * @intent 默认（无 --yes）只报告不修改，且必须明确说明未做任何改动
   * @covers AC-TOOLS-012-01
   */
  it('does not execute anything without --yes, and says so', async () => {
    const executed = [];
    const { code, out } = await capture(() =>
      handleInstallTools([], {
        projectRoot: '/tmp',
        languages: ['shell'],
        audit: () => [row('hadolint', { outdated: true, currency: 'outdated', latestVersion: '2.0.0' })],
        definitions: [def('hadolint')],
        run: (cmd) => {
          executed.push(cmd);
          return { status: 0 };
        },
      }),
    );
    expect(code).toBe(0);
    expect(executed).toHaveLength(0);
    expect(out.toLowerCase()).toMatch(/no changes|dry|--yes/);
  });

  /**
   * @test REQ-TOOLS-012
   * @intent 带 --yes 时执行计划中的动作
   * @covers AC-TOOLS-012-02
   */
  it('executes the planned actions with --yes', async () => {
    const executed = [];
    const { code } = await capture(() =>
      handleInstallTools(['--yes'], {
        projectRoot: '/tmp',
        languages: ['shell'],
        audit: () => [row('mypy', { available: false, currency: 'missing', installedVersion: null })],
        definitions: [def('mypy', { install: { linux: 'pip install mypy' } })],
        run: (cmd) => {
          executed.push(cmd);
          return { status: 0 };
        },
        removeFile: () => true,
      }),
    );
    expect(code).toBe(0);
    expect(executed.some((c) => c.includes('pip install mypy'))).toBe(true);
  });

  /**
   * @test REQ-TOOLS-012
   * @intent 单个动作失败不能中断其余动作；最后如实报告失败数
   * @covers AC-TOOLS-012-03
   */
  it('continues after a failing action and reports the failure', async () => {
    const executed = [];
    const { code, out } = await capture(() =>
      handleInstallTools(['--yes'], {
        projectRoot: '/tmp',
        languages: ['shell'],
        audit: () => [
          row('a', { available: false, currency: 'missing', installedVersion: null }),
          row('b', { available: false, currency: 'missing', installedVersion: null }),
        ],
        definitions: [def('a'), def('b')],
        run: (cmd) => {
          executed.push(cmd);
          return { status: cmd.includes(' a') ? 1 : 0 };
        },
      }),
    );
    expect(executed.length).toBe(2);
    // A failed repair is a non-zero exit: silence would read as success.
    expect(code).not.toBe(0);
    expect(out).toMatch(/fail/i);
  });

  /**
   * @test REQ-TOOLS-012
   * @intent 工具链已干净时直接说明，不做任何事
   * @covers AC-TOOLS-012-04
   */
  it('reports an already-clean toolchain without side effects', async () => {
    const executed = [];
    const { code, out } = await capture(() =>
      handleInstallTools(['--yes'], {
        projectRoot: '/tmp',
        languages: ['shell'],
        audit: () => [row('eslint')],
        definitions: [def('eslint')],
        run: (cmd) => {
          executed.push(cmd);
          return { status: 0 };
        },
      }),
    );
    expect(code).toBe(0);
    expect(executed).toHaveLength(0);
    expect(out).toMatch(/nothing|up to date|already|无需|已是最新/i);
  });
});

describe('install-tools: action ordering', () => {
  /**
   * @test REQ-TOOLS-014
   * @intent 同一工具既重复又过期时，升级必须作用于"保留的那份"，不能把新版本写到
   *         刚被删掉的路径上 —— 否则去重与升级互相抵消，重复原样回来
   *         （2026-11-23 实况：hadolint 去重后又出现两份）
   * @covers AC-TOOLS-014-01
   */
  it('flags an upgrade command that writes into the path it also removes', () => {
    const dupOutdated = row('hadolint', {
      outdated: true,
      currency: 'outdated',
      installedVersion: '2.14.0',
      latestVersion: '2.15.1',
      duplicated: true,
      // Second copy is the one the plan removes; the installer writes there.
      paths: ['/home/u/.npm-global/bin/hadolint', '/home/u/.local/bin/hadolint'],
      distinctRealPaths: ['/home/u/.npm-global/bin/hadolint', '/home/u/.local/bin/hadolint'],
    });
    const plan = planToolRepairs([dupOutdated], {
      definitions: [def('hadolint', { install: { linux: 'curl -sL x -o /home/u/.local/bin/hadolint' } })],
    });
    const removal = plan.actions.find((a) => a.kind === 'remove-duplicate');
    const upgrade = plan.actions.find((a) => a.kind === 'upgrade');
    expect(removal).toBeTruthy();
    expect(upgrade).toBeTruthy();
    // The installer writes to ~/.local/bin, which is exactly the copy marked for
    // removal: applying both puts a second hadolint back and the duplicate
    // survives the repair. It must be surfaced, not executed blindly.
    expect(upgrade.writesToRemovedPath).toBe(true);
  });
});
