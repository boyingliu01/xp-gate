/**
 * Latest-version resolution — the input to every "is this outdated" verdict.
 *
 * DESIGN CONSTRAINT (measured on this machine): every lookup here may hit the
 * network, and the network is unreliable here (GitHub API returned an empty body
 * twice while writing this). So the resolver must:
 *
 *   - never hang a report (bounded timeout),
 *   - never turn a lookup failure into "up to date" (unknown ≠ current),
 *   - be injectable so the audit tests never touch the network.
 *
 * The registry is chosen per tool NAME, not per language: `jscpd` is an npm
 * package whether the project is TypeScript or Shell, and `shellcheck` is never
 * an npm package at all.
 */
const { resolveLatestVersion, registryFor } = require('../tool-audit.js');

describe('tool-audit: latest version resolution', () => {
  /**
   * @test REQ-TOOLS-008
   * @intent 按工具名决定查询渠道：npm 包走 npm，其余走已知版本表
   * @covers AC-TOOLS-008-01
   */
  it('routes npm-distributed tools to the npm registry and others to the table', () => {
    expect(registryFor('jscpd')).toBe('npm');
    expect(registryFor('eslint')).toBe('npm');
    expect(registryFor('@archlinter/cli')).toBe('npm');
    expect(registryFor('shellcheck')).toBe('table');
    expect(registryFor('hadolint')).toBe('table');
    expect(registryFor('gitleaks')).toBe('table');
  });

  /**
   * @test REQ-TOOLS-008
   * @intent 查询失败必须返回 null（→ unknown），不能回落成"当前版本"显得已是最新
   * @covers AC-TOOLS-008-02
   */
  it('returns null when the lookup fails instead of assuming current', () => {
    const v = resolveLatestVersion('jscpd', {
      runNpmView: () => {
        throw new Error('ETIMEDOUT');
      },
      table: {},
    });
    expect(v).toBeNull();
  });

  /**
   * @test REQ-TOOLS-008
   * @intent npm 查询成功时返回净版本号
   * @covers AC-TOOLS-008-03
   */
  it('returns the bare version from npm', () => {
    const v = resolveLatestVersion('jscpd', { runNpmView: () => '5.4.3\n', table: {} });
    expect(v).toBe('5.4.3');
  });

  /**
   * @test REQ-TOOLS-008
   * @intent 表中没有的工具返回 null，而不是猜测
   * @covers AC-TOOLS-008-04
   */
  it('returns null for a tool with no known channel', () => {
    expect(resolveLatestVersion('mystery-tool', { runNpmView: () => null, table: {} })).toBeNull();
  });

  /**
   * @test REQ-TOOLS-008
   * @intent 表中有的工具直接取表值（离线可用）
   * @covers AC-TOOLS-008-05
   */
  it('reads a pinned version from the offline table without any network call', () => {
    let called = false;
    const v = resolveLatestVersion('shellcheck', {
      runNpmView: () => {
        called = true;
        return null;
      },
      table: { shellcheck: '0.11.0' },
    });
    expect(v).toBe('0.11.0');
    expect(called).toBe(false);
  });
});
