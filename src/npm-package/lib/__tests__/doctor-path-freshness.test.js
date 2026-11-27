/**
 * @test REQ-DOCTOR-PATH-FRESHNESS
 * @intent PATH 陈旧检测的全部价值在于**说清"不可测量"与"新鲜"的区别**。
 *         本机 CPU 常年在 90-100%，一个陈旧终端里的 "not found" 与真正未安装
 *         无从区分——这正是这两个函数存在的理由。
 *
 *         两条契约：
 *         1. 半个注册表读不到时**不能**报 PASS。能读到的那半仍是证据，但整体
 *            必须 WARN 并点名哪一半没读到（fail-closed, walkthrough FC-07）。
 *         2. 预览最多列三条。一台机器可能有几十条陈旧条目，一面墙的路径正是
 *            警告被跳过的原因——数量传达规模，三个例子传达形态。
 *
 * @covers AC-DOCTOR-PATH-01
 * @covers AC-DOCTOR-PATH-02
 */
import { describe, expect, it } from 'vitest';

const doctor = require('../doctor.js');

describe('reportUnreadablePath', () => {
  it('warns with the reason instead of passing, and names each unreadable half', () => {
    const checks = [];
    const result = doctor.reportUnreadablePath(
      [{ label: 'User', error: 'EACCES' }, { label: 'Machine', error: 'ENOENT' }],
      checks,
    );

    expect(result).toBe(0); // a WARN contributes no issue count
    expect(checks).toHaveLength(1);
    // Fail closed: no readable hive is NOT evidence of freshness.
    expect(checks[0].status).toBe('WARN');
    expect(checks[0].detail).toContain('User: EACCES');
    expect(checks[0].detail).toContain('Machine: ENOENT');
    expect(checks[0].detail).toContain('staleness unknown');
  });

  it('tells the reader what to do about it', () => {
    // The consequence is concrete: after installing a tool, a stale PATH makes
    // "not found" mean "not in this terminal". Without that sentence the operator
    // re-installs a tool that is already there.
    const checks = [];
    doctor.reportUnreadablePath([{ label: 'User', error: 'EACCES' }], checks);
    expect(checks[0].detail).toContain('new terminal');
  });
});

describe('reportStalePath', () => {
  it('truncates the preview past three entries and states the true total', () => {
    const checks = [];
    const parts = [];
    const stale = ['a', 'b', 'c', 'd', 'e'];
    doctor.reportStalePath({ stale, parts, invisible: [], checks });

    expect(parts[0]).toContain('5 registry entries');
    expect(parts[0]).toContain('…+2 more');
    // The three shown are the shape; the count is the scale.
    expect(parts[0]).toContain('a ; b ; c');
    expect(parts[0]).not.toContain('d');
  });

  it('uses the singular for exactly one stale entry', () => {
    const checks = [];
    const parts = [];
    doctor.reportStalePath({ stale: ['only'], parts, invisible: [], checks });
    expect(parts[0]).toContain('1 registry entry ');
  });

  it('lists installed-but-invisible gate tools when there are any', () => {
    // The distinction the whole check exists for: visible only under the refreshed
    // PATH is "installed but invisible", never "not installed".
    const checks = [];
    const parts = [];
    doctor.reportStalePath({ stale: ['x'], parts, invisible: ['eslint → /usr/bin/eslint'], checks });
    expect(checks[0].detail).toContain('installed-but-invisible gate tools');
    expect(checks[0].detail).toContain('eslint');
  });

  it('omits the invisible-tools clause entirely when the list is empty', () => {
    const checks = [];
    const parts = [];
    doctor.reportStalePath({ stale: ['x'], parts, invisible: [], checks });
    expect(checks[0].detail).not.toContain('installed-but-invisible');
  });

  it('always warns, and always names --refresh-env as the remedy', () => {
    const checks = [];
    doctor.reportStalePath({ stale: ['x'], parts: [], invisible: [], checks });
    expect(checks[0].status).toBe('WARN');
    expect(checks[0].detail).toContain('--refresh-env');
  });
});
