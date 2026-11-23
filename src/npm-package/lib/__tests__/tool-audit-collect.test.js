/**
 * check-tools must report the COMPLETE tool set, not just the languages the
 * current project happens to use.
 *
 * The gap this pins (2026-11-23): `check-tools` in this repo printed 8 entries —
 * the tools of the four detected languages — while doctor probed a different set
 * of 8 cross-language CLI tools (jscpd, checkov, ...). Neither command could see
 * the union, so a broken jscpd was invisible to `check-tools` and a broken
 * eslint invisible to `doctor`. "Complete" has to mean the union, deduplicated,
 * because the same tool can appear in both lists (semgrep: Gate 10 and Python).
 */
const os = require('os');
const fs = require('fs');
const path = require('path');

const { collectGateTools, auditAllTools } = require('../tool-audit.js');

/** Minimal LANGUAGE_REGISTRY-shaped fixture. */
const REGISTRY = {
  typescript: {
    name: 'TypeScript/JavaScript',
    tools: [{ name: 'eslint', checkCmd: 'eslint --version', optional: false, gates: ['Gate 1'] }],
  },
  python: {
    name: 'Python',
    tools: [
      // Same tool as the cross-language list, listed per-language too.
      { name: 'semgrep', checkCmd: 'semgrep --version', optional: false, gates: ['Gate 10'] },
      { name: 'mypy', checkCmd: 'mypy --version', optional: false, gates: ['Gate 1'] },
    ],
  },
};

const CLI_TOOLS = [
  { tool: 'semgrep', checkCmd: 'semgrep --version', gates: ['Gate 10 (SAST)'] },
  { tool: 'jscpd', checkCmd: 'jscpd --version', gates: ['Gate 2 (Duplicate Code)'] },
];

describe('collectGateTools: completeness', () => {
  /**
   * @test REQ-TOOLS-005
   * @intent 清单必须同时包含跨语言 CLI 工具与语言工具，不能只取其一
   * @covers AC-TOOLS-005-01
   */
  it('includes both the cross-language CLI tools and the language tools', () => {
    const tools = collectGateTools({
      registry: REGISTRY,
      cliTools: CLI_TOOLS,
      languages: ['typescript', 'python'],
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('jscpd'); // cross-language only
    expect(names).toContain('eslint'); // language only
    expect(names).toContain('mypy'); // language only
  });

  /**
   * @test REQ-TOOLS-005
   * @intent 同一工具在两处出现只能算一个，且门禁标签合并
   * @covers AC-TOOLS-005-02
   */
  it('deduplicates a tool that appears in both lists and merges its gates', () => {
    const tools = collectGateTools({
      registry: REGISTRY,
      cliTools: CLI_TOOLS,
      languages: ['typescript', 'python'],
    });
    const semgrep = tools.filter((t) => t.name === 'semgrep');
    expect(semgrep).toHaveLength(1);
    expect(semgrep[0].gates.join(' ')).toContain('Gate 10');
  });

  /**
   * @test REQ-TOOLS-005
   * @intent 指定语言时只取该语言工具，但跨语言 CLI 工具仍必须包含
   * @covers AC-TOOLS-005-03
   */
  it('filters by language but never drops the cross-language tools', () => {
    const tools = collectGateTools({
      registry: REGISTRY,
      cliTools: CLI_TOOLS,
      languages: ['typescript'],
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('eslint');
    expect(names).not.toContain('mypy');
    expect(names).toContain('jscpd');
  });

  /**
   * @test REQ-TOOLS-005
   * @intent 必须能取全量（不受项目语言限制），否则"完备性"无从判起
   * @covers AC-TOOLS-005-04
   */
  it('can list every registered tool when no language filter is given', () => {
    const tools = collectGateTools({ registry: REGISTRY, cliTools: CLI_TOOLS, languages: null });
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['eslint', 'mypy', 'semgrep', 'jscpd']));
  });
});

describe('auditAllTools: produces a list, never throws', () => {
  /**
   * @test REQ-TOOLS-006
   * @intent 每个工具都产出一条审计记录；单个探针失败不能中断整份清单
   * @covers AC-TOOLS-006-01
   */
  it('returns one row per tool even when one probe throws', () => {
    const rows = auditAllTools(
      [
        { name: 'ok-tool', checkCmd: 'ok-tool --version' },
        { name: 'boom', checkCmd: 'boom --version' },
      ],
      {
        runProbe: (cmd) => {
          if (String(cmd).startsWith('boom')) throw new Error('kaboom');
          return { status: 0, stdout: '1.2.3', stderr: '' };
        },
        locate: () => ['/usr/bin/x'],
        realpath: (p) => p,
        resolveLatest: () => null,
      },
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.name === 'boom').validityReason).toContain('kaboom');
  });

  /**
   * @test REQ-TOOLS-006
   * @intent resolveLatest 抛异常时该工具记为 unknown，不能让整份报告失败
   * @covers AC-TOOLS-006-02
   */
  it('treats a failing version lookup as unknown, not as an exception', () => {
    const rows = auditAllTools([{ name: 'x', checkCmd: 'x --version' }], {
      runProbe: () => ({ status: 0, stdout: '1.0.0', stderr: '' }),
      locate: () => ['/usr/bin/x'],
      realpath: (p) => p,
      resolveLatest: () => {
        throw new Error('registry unreachable');
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe('unknown');
  });
});

describe('collectGateTools: installer travels with the tool', () => {
  /**
   * @test REQ-TOOLS-009
   * @intent 收集器必须保留 install 字段，否则 install-tools 会对有安装命令的工具报
   *         "no installer known"（shellcheck 实况）
   * @covers AC-TOOLS-009-01
   */
  it('keeps the install command from the registry entry', () => {
    const registry = {
      shell: {
        name: 'Shell',
        tools: [{
          name: 'shellcheck',
          checkCmd: 'shellcheck --version',
          optional: true,
          gates: ['Gate 1'],
          install: { linux: 'apt-get install shellcheck' },
        }],
      },
    };
    const tools = collectGateTools({ registry, cliTools: [], languages: ['shell'] });
    expect(tools[0].install).toEqual({ linux: 'apt-get install shellcheck' });
  });

  /**
   * @test REQ-TOOLS-009
   * @intent 跨语言 CLI 工具的安装命令也要保留（doctor 用同一份表）
   * @covers AC-TOOLS-009-02
   */
  it('keeps the install command from a cross-language CLI entry', () => {
    const tools = collectGateTools({
      registry: {},
      cliTools: [{ tool: 'jscpd', checkCmd: 'jscpd --version', gates: [], install: { linux: 'npm install -g jscpd' } }],
      languages: null,
    });
    expect(tools.find((t) => t.name === 'jscpd').install).toEqual({ linux: 'npm install -g jscpd' });
  });
});
