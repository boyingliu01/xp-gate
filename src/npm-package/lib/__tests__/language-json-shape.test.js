/**
 * @test REQ-LANG-JSON-SHAPE
 * @intent `check-tools --json` 和 `detect-languages --json` 的输出形状是**契约**：
 *         调用方按它解析，而且它已经坏过一次（#468）。
 *
 *         最重要的一条：`check-tools --json` 的**顶层按语言名分组**，每个值是那个
 *         语言的工具列表。审计新增的事实（重复、时效、跨语言工具）只能**并列**
 *         在 `summary` / `crossLanguage` 里，不能替换旧形状。
 *
 * @covers AC-LANG-JSON-SHAPE-01
 * @covers AC-LANG-JSON-SHAPE-02
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tools = require('../language-tools.js');

describe('toolEntry', () => {
  it('derives status from the row rather than copying a field', () => {
    // A row carrying its own `status` must not be trusted over `available`; the two
    // could disagree, and this is the one place the JSON shape is decided.
    const entry = tools.toolEntry({ name: 'ruff', available: true, status: 'missing' });
    expect(entry.status).toBe('available');
  });

  it('leaves reason undefined rather than omitting the key', () => {
    // A stable key is easier for consumers than an occasionally-present one.
    const entry = tools.toolEntry({ name: 'ruff', available: true });
    expect('reason' in entry).toBe(true);
    expect(entry.reason).toBeUndefined();
  });

  it('carries the audit facts a consumer needs', () => {
    const entry = tools.toolEntry({
      name: 'jq', available: true, optional: false, version: '1.7',
      gates: [3], duplicated: true, paths: ['/a', '/b'], outdated: true,
      latestVersion: '1.8', currency: 'stale', validityReason: 'odd',
    });
    expect(entry).toMatchObject({
      name: 'jq', status: 'available', version: '1.7', duplicated: true, outdated: true,
      latestVersion: '1.8', currency: 'stale', reason: 'odd',
    });
  });
});

describe('buildDetectionResult', () => {
  it('keys tools by language and keeps the language list intact', () => {
    const result = tools.buildDetectionResult(
      ['python', 'shell'],
      { python: ['pyproject.toml'] },
      {
        python: [{ tool: { name: 'ruff', optional: false }, status: 'missing', version: null }],
      },
    );
    expect(result.languages).toEqual(['python', 'shell']);
    expect(result.configFiles).toEqual({ python: ['pyproject.toml'] });
    expect(result.tools.python).toEqual([
      { name: 'ruff', status: 'missing', optional: false, version: null },
    ]);
    // A detected language with no tool entry is simply absent from `tools`; the
    // language list is the authority on what was detected.
    expect(result.tools.shell).toBeUndefined();
  });
});

describe('printAuditJson', () => {
  let out;

  beforeEach(() => {
    out = [];
    vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups by language at the top level, preserving the #468 contract', () => {
    tools.printAuditJson(
      [
        { name: 'ruff', available: true, languages: ['python'] },
        { name: 'shellcheck', available: false, languages: ['shell'] },
      ],
      { total: 2 },
      [],
    );
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed.python).toHaveLength(1);
    expect(parsed.python[0].name).toBe('ruff');
    expect(parsed.shell[0].name).toBe('shellcheck');
    // The audit fields are ADDITIVE: absent unless asked for.
    expect(parsed.summary).toBeUndefined();
  });

  it('puts a language-less tool in a cross-language group, not nowhere', () => {
    tools.printAuditJson([{ name: 'jscpd', available: true, languages: [] }], {}, []);
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed['(cross-language)']).toHaveLength(1);
    expect(parsed['(cross-language)'][0].name).toBe('jscpd');
  });

  it('omits an empty cross-language group so the shape stays comparable', () => {
    // An always-present empty group would add a key that callers compare exactly.
    tools.printAuditJson([{ name: 'ruff', available: true, languages: ['python'] }], {}, []);
    const parsed = JSON.parse(out.join('\n'));
    expect(parsed['(cross-language)']).toBeUndefined();
  });

  it('adds summary only when --audit is asked for', () => {
    tools.printAuditJson(
      [{ name: 'ruff', available: true, languages: ['python'] }],
      { total: 1, missing: 0 },
      ['--audit'],
    );
    expect(JSON.parse(out.join('\n')).summary).toEqual({ total: 1, missing: 0 });
  });
});
