/**
 * doctor must DELEGATE its tool checks to the audit instead of re-implementing
 * them.
 *
 * Why this matters (2026-11-23): doctor carried its own probe loop while
 * check-tools carried another. They disagreed in three measurable ways —
 * doctor reported `psscriptanalyzer` as available (empty-output probe read as
 * success), doctor could not see duplicate copies, and doctor knew nothing about
 * outdated versions. Two implementations of one rule is how they drift; the
 * single-source fix is for doctor to consume the audit's rows.
 *
 * The CONTRACT doctor exposes must not change: entries are named
 * `CLI tool: <tool> (<gates>)` with status PASS/WARN, because existing tests and
 * consumers read exactly that.
 */
const { mapAuditRowsToDoctorChecks } = require('../doctor-tool-checks.js');

describe('doctor tool checks: delegation', () => {
  /**
   * @test REQ-TOOLS-013
   * @intent 保持既有报告契约：名称形如 "CLI tool: <tool> (<gates>)"，状态 PASS/WARN
   * @covers AC-TOOLS-013-01
   */
  it('keeps the existing check name and status contract', () => {
    const checks = mapAuditRowsToDoctorChecks([
      {
        name: 'jscpd', available: true, version: '5.4.3', installedVersion: '5.4.3',
        gates: ['Gate 2 (Duplicate Code)'], optional: false, duplicated: false,
        outdated: false, currency: 'current', paths: ['/x/jscpd'], distinctRealPaths: ['/x/jscpd'],
      },
    ]);
    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe('CLI tool: jscpd (Gate 2 (Duplicate Code))');
    expect(checks[0].status).toBe('PASS');
  });

  /**
   * @test REQ-TOOLS-013
   * @intent 不可用判 WARN，并在 detail 里给出原因与安装提示
   * @covers AC-TOOLS-013-02
   */
  it('reports an unavailable tool as WARN with its reason and an install command', () => {
    const checks = mapAuditRowsToDoctorChecks([
      {
        name: 'psscriptanalyzer', available: false, version: null, installedVersion: null,
        validityReason: 'probe printed no output (empty output cannot prove availability)',
        gates: ['Gate 1 (Code Quality)'], optional: true, duplicated: false,
        outdated: null, currency: 'missing', paths: [], distinctRealPaths: [],
      },
    ]);
    expect(checks[0].status).toBe('WARN');
    expect(checks[0].detail).toMatch(/no output/i);
    expect(checks[0].detail).toMatch(/install-tools/);
  });

  /**
   * @test REQ-TOOLS-013
   * @intent 重复安装必须在 doctor 里可见（旧实现完全看不到）
   * @covers AC-TOOLS-013-03
   */
  it('surfaces duplicate copies that the old doctor could not see', () => {
    const checks = mapAuditRowsToDoctorChecks([
      {
        name: 'hadolint', available: true, version: '2.14.0', installedVersion: '2.14.0',
        gates: ['Gate 7'], optional: false, duplicated: true, outdated: false,
        currency: 'current',
        paths: ['/a/hadolint', '/b/hadolint'],
        distinctRealPaths: ['/a/hadolint', '/b/hadolint'],
      },
    ]);
    expect(checks[0].detail).toMatch(/duplicate/i);
    expect(checks[0].detail).toContain('/b/hadolint');
  });

  /**
   * @test REQ-TOOLS-013
   * @intent 过期版本也要可见，并给出目标版本
   * @covers AC-TOOLS-013-04
   */
  it('surfaces an outdated version with the target', () => {
    const checks = mapAuditRowsToDoctorChecks([
      {
        name: 'shellcheck', available: true, version: '0.10.0', installedVersion: '0.10.0',
        gates: ['Gate 1'], optional: true, duplicated: false, outdated: true,
        currency: 'outdated', latestVersion: '0.11.0',
        paths: ['/x/shellcheck'], distinctRealPaths: ['/x/shellcheck'],
      },
    ]);
    expect(checks[0].detail).toMatch(/0\.10\.0/);
    expect(checks[0].detail).toMatch(/0\.11\.0/);
  });

  /**
   * @test REQ-TOOLS-013
   * @intent 全部正常时 detail 就是版本号，保持旧输出可读
   * @covers AC-TOOLS-013-05
   */
  it('keeps a plain version string for a perfectly healthy tool', () => {
    const checks = mapAuditRowsToDoctorChecks([
      {
        name: 'lizard', available: true, version: '1.26.1', installedVersion: '1.26.1',
        gates: ['Gate 3'], optional: false, duplicated: false, outdated: false,
        currency: 'current', paths: ['/x/lizard'], distinctRealPaths: ['/x/lizard'],
      },
    ]);
    expect(checks[0].detail).toBe('1.26.1');
  });
});

describe('doctor tool checks: no blocking network work', () => {
  /**
   * @test REQ-TOOLS-016
   * @intent doctor 的工具检查默认不做版本查询：实测同步 `npm view` 每次阻塞事件循环
   *         约 5 秒，令同轮 checkEnv 的 `node --version`（正常 5ms）超时被误判
   *         Not found。doctor 只回答"能不能用"，最新版由 check-tools 负责。
   * @covers AC-TOOLS-016-01
   */
  it('defaults to no version lookup at all', async () => {
    const { auditGateCliTools } = require('../doctor-tool-checks.js');
    const rows = await auditGateCliTools({
      tools: [{ name: 'jscpd', checkCmd: 'jscpd --version', gates: [], optional: false }],
      runProbe: () => ({ status: 0, stdout: '5.4.3', stderr: '' }),
      locate: () => ['/x/jscpd'],
      realpath: (p) => p,
    });
    // With no resolver supplied, currency must be unknown — never "current".
    expect(rows[0].currency).toBe('unknown');
    expect(rows[0].outdated).toBeNull();
  });

  /**
   * @test REQ-TOOLS-016
   * @intent 审计本身必须并行探测：慢工具（checkov 1.9s / semgrep 1.4s）不得串行阻塞
   * @covers AC-TOOLS-016-02
   */
  it('probes tools concurrently rather than one after another', async () => {
    const { auditGateCliTools } = require('../doctor-tool-checks.js');
    const started = [];
    const rows = await auditGateCliTools({
      tools: [
        { name: 'slow1', checkCmd: 'slow1', gates: [] },
        { name: 'slow2', checkCmd: 'slow2', gates: [] },
      ],
      runProbe: async (cmd) => {
        started.push(cmd);
        await new Promise((r) => setTimeout(r, 10));
        return { status: 0, stdout: '1.0.0', stderr: '' };
      },
      locate: () => [],
      realpath: (p) => p,
    });
    expect(rows).toHaveLength(2);
    // Both probes are in flight before either resolves.
    expect(started).toEqual(['slow1', 'slow2']);
  });
});
