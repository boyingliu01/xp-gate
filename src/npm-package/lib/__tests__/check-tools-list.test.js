/**
 * `xp-gate check-tools` must answer three questions in ONE list:
 * completeness (is anything missing), validity (does it actually run) and
 * uniqueness (is there exactly one copy), plus currency (is it the latest).
 *
 * Before this change the command answered none of them reliably:
 *   - it only walked languages detected in the current project, so a cross-
 *     language tool (jscpd, checkov) that was broken never appeared;
 *   - validity was an exit-code check, which reported `psscriptanalyzer` as
 *     available while `Invoke-ScriptAnalyzer` did not exist (measured);
 *   - duplicates were invisible: two byte-identical hadolint binaries and an
 *     old archlint shadowing a newer npm install both passed unnoticed.
 *
 * These tests drive the command through its handler with an injected audit so
 * they never touch the network or the real toolchain.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleCheckTools } = require('../language-tools.js');
const { capture, auditRow: row, tmpProject, writeFixture } = require('./tool-audit-fixtures.js');

describe('check-tools: the list itself', () => {
  /**
   * @test REQ-TOOLS-010
   * @intent 清单必须包含跨语言 CLI 工具，不能只看项目语言
   * @covers AC-TOOLS-010-01
   */
  it('lists cross-language CLI tools even when no language uses them', async () => {
    const dir = tmpProject();
    writeFixture(dir, 'package.json', '{}');
    const rows = [row('eslint'), row('jscpd'), row('checkov')];
    const { code, out } = await capture(() =>
      handleCheckTools(['--json', '--flat'], { projectRoot: dir, audit: () => rows }),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out);
    const names = parsed.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['jscpd', 'checkov']));
  });

  /**
   * @test REQ-TOOLS-010
   * @intent 有效性：探针无输出判为不可用并给出原因（psscriptanalyzer 实况）
   * @covers AC-TOOLS-010-02
   */
  it('reports an empty-output probe as unavailable WITH a reason', async () => {
    const dir = tmpProject();
    const rows = [
      row('psscriptanalyzer', {
        available: false,
        version: null,
        installedVersion: null,
        currency: 'missing',
        validityReason: 'probe printed no output (empty output cannot prove availability)',
        optional: true,
      }),
    ];
    const { out } = await capture(() =>
      handleCheckTools(['--json', '--flat'], { projectRoot: dir, audit: () => rows, languages: [] }),
    );
    const t = JSON.parse(out).tools.find((x) => x.name === 'psscriptanalyzer');
    expect(t.status).toBe('missing');
    expect(t.reason).toMatch(/no output/i);
  });

  /**
   * @test REQ-TOOLS-010
   * @intent 唯一性：重复安装必须在清单里显式标出，并列出全部副本
   * @covers AC-TOOLS-010-03
   */
  it('marks a tool installed twice and lists every copy', async () => {
    const dir = tmpProject();
    const rows = [
      row('hadolint', {
        duplicated: true,
        paths: ['/home/u/.local/bin/hadolint', '/home/u/.npm-global/bin/hadolint'],
        distinctRealPaths: ['/home/u/.local/bin/hadolint', '/home/u/.npm-global/bin/hadolint'],
      }),
    ];
    const { out } = await capture(() =>
      handleCheckTools(['--json', '--flat'], { projectRoot: dir, audit: () => rows, languages: [] }),
    );
    const t = JSON.parse(out).tools.find((x) => x.name === 'hadolint');
    expect(t.duplicated).toBe(true);
    expect(t.paths).toHaveLength(2);
  });

  /**
   * @test REQ-TOOLS-010
   * @intent 汇总必须同时给出缺失/重复/过期/未知四类计数，且 complete 只在全清时为真
   * @covers AC-TOOLS-010-04
   */
  it('summarizes every problem category and withholds complete until all are clear', async () => {
    const dir = tmpProject();
    const rows = [
      row('ok1'),
      row('dup1', { duplicated: true }),
      row('old1', { outdated: true, currency: 'outdated', latestVersion: '2.0.0' }),
      row('gone1', { available: false, currency: 'missing', installedVersion: null }),
      row('unk1', { currency: 'unknown', outdated: null, latestVersion: null }),
    ];
    const { out } = await capture(() =>
      handleCheckTools(['--json', '--flat'], { projectRoot: dir, audit: () => rows, languages: [] }),
    );
    const s = JSON.parse(out).summary;
    expect(s.missing).toBe(1);
    expect(s.duplicated).toBe(1);
    expect(s.outdated).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.complete).toBe(false);
  });

  /**
   * @test REQ-TOOLS-010
   * @intent 非 JSON 输出也要能同时看出三类问题，不能只打"available/missing"
   * @covers AC-TOOLS-010-05
   */
  it('prints duplicates and outdated versions in human output too', async () => {
    const dir = tmpProject();
    const rows = [
      row('hadolint', {
        outdated: true,
        currency: 'outdated',
        installedVersion: '2.14.0',
        latestVersion: '2.15.1',
        duplicated: true,
        paths: ['/a/hadolint', '/b/hadolint'],
        distinctRealPaths: ['/a/hadolint', '/b/hadolint'],
      }),
    ];
    const { out } = await capture(() =>
      handleCheckTools([], { projectRoot: dir, audit: () => rows, languages: [] }),
    );
    expect(out).toMatch(/2\.14\.0/);
    expect(out).toMatch(/2\.15\.1/);
    expect(out.toLowerCase()).toMatch(/duplicate|重复/);
  });

  /**
   * @test REQ-TOOLS-010
   * @intent 可选的缺失工具不应让命令以失败退出，但必须仍然列出
   * @covers AC-TOOLS-010-06
   */
  it('does not fail the command for a missing OPTIONAL tool, but still lists it', async () => {
    const dir = tmpProject();
    const rows = [row('terraform', { available: false, currency: 'missing', installedVersion: null, optional: true })];
    const { code, out } = await capture(() =>
      handleCheckTools(['--json', '--flat'], { projectRoot: dir, audit: () => rows, languages: [] }),
    );
    expect(code).toBe(0);
    expect(JSON.parse(out).tools).toHaveLength(1);
  });
});
