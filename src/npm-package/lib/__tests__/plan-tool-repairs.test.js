/**
 * @test REQ-TOOLS-PLAN
 * @intent `planToolRepairs`（64 条连续未覆盖语句）决定 `install-tools` 要做什么：
 *         安装缺失的、升级过期的、去掉用户自装的重复副本。
 *
 *         它有一条安全属性必须钉死：**系统包与用户副本并存不是重复**。apt 装的
 *         jq 和 ~/.local/bin 里更新的 jq 同时存在时，删掉任何一个都不是修复——
 *         前者会带走依赖，后者是用户特意装的。只把 USER-owned 的多余副本算作
 *         可去重复。
 *
 * @covers AC-TOOLS-PLAN-01
 * @covers AC-TOOLS-PLAN-02
 */
'use strict';

const { planToolRepairs } = require('../language-tools.js');

const DEF = { name: 'gitleaks', install: { linux: 'go install gitleaks' } };
const OPTS = { definitions: [DEF], platform: 'linux', systemPrefixes: ['/usr/', '/opt/'] };

function row(over = {}) {
  return {
    name: 'gitleaks',
    optional: false,
    available: true,
    installedVersion: '1.0.0',
    latestVersion: '1.0.0',
    currency: 'current',
    duplicated: false,
    outdated: false,
    npxInvoked: false,
    resolution: 'path',
    distinctRealPaths: ['/home/u/.local/bin/gitleaks'],
    ...over,
  };
}

describe('planToolRepairs', () => {
  it('is clean when nothing needs doing', () => {
    expect(planToolRepairs([row()], OPTS)).toEqual({ actions: [], clean: true });
  });

  it('plans an install for a missing required tool', () => {
    const { actions } = planToolRepairs(
      [row({ available: false, installedVersion: null, currency: 'missing' })], OPTS);
    expect(actions).toEqual([expect.objectContaining({ kind: 'install', tool: 'gitleaks' })]);
  });

  it('skips a missing OPTIONAL tool instead of installing it', () => {
    const { actions } = planToolRepairs(
      [row({ available: false, installedVersion: null, currency: 'missing', optional: true })], OPTS);
    expect(actions[0].kind).toBe('skip-optional');
  });

  it('plans an upgrade for an outdated tool', () => {
    const { actions } = planToolRepairs(
      [row({ outdated: true, latestVersion: '2.0.0' })], OPTS);
    expect(actions[0]).toMatchObject({ kind: 'upgrade', tool: 'gitleaks', to: '2.0.0' });
  });

  it('ignores a row that was run through npx', () => {
    // npx is not an installation: there is nothing on disk to repair.
    expect(planToolRepairs([row({ npxInvoked: true, available: false })], OPTS).actions).toEqual([]);
  });

  it('removes a duplicated USER copy and keeps one', () => {
    const { actions } = planToolRepairs([row({
      duplicated: true,
      distinctRealPaths: ['/home/u/.local/bin/gitleaks', '/home/u/bin/gitleaks'],
    })], OPTS);
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain('keep');
    expect(kinds).toContain('remove-duplicate');
  });

  it('does NOT treat a system copy plus a user copy as a duplicate', () => {
    // The rule that matters: /usr/bin/jq + ~/.local/bin/jq is coexistence, and
    // removing either is not a fix.
    const { actions } = planToolRepairs([row({
      duplicated: true,
      distinctRealPaths: ['/usr/bin/gitleaks', '/home/u/.local/bin/gitleaks'],
    })], OPTS);
    expect(actions.some((a) => a.kind === 'remove-duplicate')).toBe(false);
  });

  it('flags an upgrade whose installer writes to the path it just removed', () => {
    // The hadolint shape: remove ~/.local/bin/hadolint, then run an installer
    // that writes to that exact path -- the duplicate comes straight back.
    // The list order decides which copy is KEPT (the first). Putting the path the
    // installer writes to SECOND makes it the one slated for removal, which is
    // exactly the self-cancelling shape.
    const def = { name: 'hadolint', install: { linux: 'cp bin/hadolint /home/u/.local/bin/hadolint' } };
    const { actions } = planToolRepairs([row({
      name: 'hadolint',
      duplicated: true,
      outdated: true,
      latestVersion: '2.0.0',
      distinctRealPaths: ['/home/u/bin/hadolint', '/home/u/.local/bin/hadolint'],
    })], { ...OPTS, definitions: [def] });
    const upgrade = actions.find((a) => a.kind === 'upgrade');
    expect(upgrade).toBeDefined();
    expect(upgrade.writesToRemovedPath).toBe(true);
  });

  it('survives a duplicated row that carries no path list', () => {
    // A caller assembling rows by hand can produce this; planning must not throw.
    expect(() => planToolRepairs([row({ duplicated: true, distinctRealPaths: undefined })], OPTS))
      .not.toThrow();
  });
});
