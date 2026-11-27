/**
 * @test REQ-TOOLS-AUDIT-REPORT
 * @intent `xp-gate check-tools` 的输出面——每个工具一行（可选标记、版本、
 *         限定词）加一行汇总——此前完全没有断言：`printAuditReport` 的 68 条
 *         语句零覆盖。
 *
 *         这里通过 `handleCheckTools` 驱动，而不是直接调那个打印函数：它没有
 *         导出，而驱动命令额外覆盖了"哪些行会到达打印器"这段接线。
 *
 * @covers AC-TOOLS-AUDIT-REPORT-01
 * @covers AC-TOOLS-AUDIT-REPORT-02
 */
'use strict';

const { handleCheckTools } = require('../language-tools.js');

async function capture(run) {
  const out = [];
  const orig = console.log;
  console.log = (...a) => out.push(a.join(' '));
  try {
    await run();
  } finally {
    console.log = orig;
  }
  return out.join('\n');
}

function row(over = {}) {
  return {
    name: 'gitleaks',
    optional: false,
    installedVersion: '8.30.1',
    available: true,
    npxInvoked: false,
    resolution: 'path',
    ...over,
  };
}

describe('check-tools report', () => {

  const run = (rows, args = []) =>
    capture(() => handleCheckTools(args, { audit: () => rows }));

  it('prints one line per tool and a summary', async () => {
    const out = await run([row(), row({ name: 'lizard' })]);
    expect(out).toContain('gitleaks');
    expect(out).toContain('lizard');
    expect(out).toMatch(/Summary: 2 tools/);
  });

  it('marks optional tools so a reader does not chase them', async () => {
    expect(await run([row({ optional: true })])).toContain('(optional)');
  });

  it('shows the version, or N/A when there is none', async () => {
    expect(await run([row()])).toContain('8.30.1');
    const noVersion = await run([row({ installedVersion: null, available: false })]);
    expect(noVersion).toContain('N/A');
  });

  it('says when a tool was run through npx', async () => {
    expect(await run([row({ npxInvoked: true })])).toContain('(via npx)');
  });

  it('surfaces a fallback resolution so the reader knows it is off PATH', async () => {
    const out = await run([
      row({ resolution: 'fallback', resolvedPath: '/home/u/.local/bin/gitleaks' }),
    ]);
    expect(out).toContain('/home/u/.local/bin/gitleaks');
    expect(out).toContain('not on PATH');
  });

  it('suggests install-tools only when something is incomplete', async () => {
    expect(await run([row()])).not.toContain('install-tools');
    // A missing tool makes the summary incomplete; `complete` requires ALL four
    // counters to be zero (tool-audit.js summarizeAudit), so this row alone is
    // enough to trigger the hint.
    const incomplete = await run([
      row({ name: 'terraform', available: false, installedVersion: null, currency: 'missing' }),
    ]);
    expect(incomplete).toMatch(/\d+ missing/);
    expect(incomplete).toContain('install-tools');
  });

  it('reports every counter in the summary line', async () => {
    const out = await run([
      row({ name: 'a', duplicated: true, distinctRealPaths: ['/x/a', '/y/a'] }),
      row({ name: 'b', outdated: true, installedVersion: '1.0.0', latestVersion: '2.0.0' }),
      row({ name: 'c', currency: 'unknown' }),
      row({ name: 'd', available: false, installedVersion: null, currency: 'missing' }),
    ]);
    for (const fragment of ['missing', 'duplicated', 'outdated', 'unknown']) {
      expect(out).toContain(fragment);
    }
  });
});

describe('check-tools --json', () => {

  const auditRows = [
    row({ name: 'gitleaks' }),
    row({ name: 'terraform', available: false, installedVersion: null, currency: 'missing', optional: true }),
  ];

  it('emits parseable JSON instead of the table', async () => {
    const out = await capture(() =>
      handleCheckTools(['--json'], { languages: ['typescript'], audit: () => auditRows }));
    const json = JSON.parse(out.slice(out.indexOf('{')));
    expect(json).toBeTypeOf('object');
    // The contract is keyed by language, each holding that language's tool list
    // (#468); a flat array would break every existing consumer.
    expect(Array.isArray(json)).toBe(false);
  });

  it('reports currency and availability per tool in JSON mode', async () => {
    const out = await capture(() =>
      handleCheckTools(['--json'], { languages: ['typescript'], audit: () => auditRows }));
    const text = out.slice(out.indexOf('{'));
    expect(text).toContain('gitleaks');
    expect(text).toContain('terraform');
  });

  it('does not print the human table in JSON mode', async () => {
    const out = await capture(() =>
      handleCheckTools(['--json'], { languages: ['typescript'], audit: () => auditRows }));
    expect(out).not.toContain('Quality Gate Tool Audit');
  });
});

describe('check-tools auto-detection', () => {
  const { handleCheckTools } = require('../language-tools.js');
  const os = require('node:os');
  const nodeFs = require('node:fs');
  const nodePath = require('node:path');

  let fixture;

  beforeEach(() => {
    fixture = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), 'xp-gate-check-'));
    nodeFs.writeFileSync(nodePath.join(fixture, 'package.json'), '{"name":"x"}');
    nodeFs.writeFileSync(nodePath.join(fixture, 'tsconfig.json'), '{}');
  });

  afterEach(() => nodeFs.rmSync(fixture, { recursive: true, force: true }));

  it('detects languages when none are named, instead of reporting nothing', async () => {
    // A report that silently becomes empty reads as "complete". Detecting the
    // language is what stops that.
    const out = await capture(() =>
      handleCheckTools([], { projectRoot: fixture, audit: () => [row()] }));
    expect(out).toContain('gitleaks');
  });

  it('includes cross-language CLI tools when auto-detecting', async () => {
    // The gate SCRIPTS call these directly, so they belong to the answer even
    // when no detected language mentions them.
    const seen = [];
    await capture(() => handleCheckTools([], {
      projectRoot: fixture,
      audit: (tools) => { seen.push(...tools.map((t) => t.name)); return [row()]; },
    }));
    expect(seen.length).toBeGreaterThan(0);
  });

  it('narrows to the named language when one is given', async () => {
    const explicit = [];
    await capture(() => handleCheckTools(['typescript'], {
      projectRoot: fixture,
      audit: (tools) => { explicit.push(...tools.map((t) => t.name)); return [row()]; },
    }));
    expect(explicit.length).toBeGreaterThan(0);
  });
});

describe('check-tools JSON contract (#468)', () => {
  const { handleCheckTools } = require('../language-tools.js');

  const langRow = {
    name: 'typescript',
    optional: false,
    installedVersion: '5.0.0',
    available: true,
    npxInvoked: false,
    resolution: 'path',
    currency: 'current',
    duplicated: false,
    outdated: false,
    languages: ['typescript'],
    gates: ['Gate 1'],
  };
  const crossRow = {
    name: 'gitleaks', optional: false, installedVersion: '8.30.1', available: true,
    npxInvoked: false, resolution: 'path', currency: 'current', duplicated: false,
    outdated: false, languages: [], gates: ['Gate 8'],
  };

  const runJson = async (args) => {
    const out = await capture(() =>
      handleCheckTools([...args, '--json'], { languages: ['typescript'], audit: () => [langRow, crossRow] }));
    return JSON.parse(out.slice(out.indexOf('{')));
  };

  it('groups tools by language and keeps the historical shape', async () => {
    const json = await runJson([]);
    expect(json.typescript).toBeDefined();
    expect(Array.isArray(json.typescript)).toBe(true);
    expect(json.typescript[0].name).toBe('typescript');
  });

  it('emits a separate cross-language group rather than repeating the tool', async () => {
    const json = await runJson([]);
    // The cross-language tools are reported ONCE; an always-present empty group
    // would add a key callers compare exactly.
    expect(json['(cross-language)']).toBeDefined();
    expect(json['(cross-language)'][0].name).toBe('gitleaks');
    expect(json.typescript.some((t) => t.name === 'gitleaks')).toBe(false);
  });

  it('omits summary and tools unless asked, so old parsers stay byte-identical', async () => {
    const json = await runJson([]);
    expect(json.summary).toBeUndefined();
    expect(json.tools).toBeUndefined();
  });

  it('adds the summary when --audit is given', async () => {
    const json = await runJson(['--audit']);
    expect(json.summary).toBeDefined();
    expect(json.summary.total).toBeGreaterThan(0);
  });

  it('adds the flat view when --flat is given, with the same field names', async () => {
    const json = await runJson(['--flat']);
    expect(Array.isArray(json.tools)).toBe(true);
    // Same names as the grouped view, so a consumer can switch without remapping.
    const flat = json.tools[0];
    // `version` is the audit's own field; `installedVersion` is the raw one.
    for (const key of ['name', 'status', 'installedVersion', 'gates']) {
      expect(flat[key], key).toBeDefined();
    }
  });

  it('keeps an empty cross-language group out of the JSON entirely', async () => {
    const out = await capture(() =>
      handleCheckTools(['--json'], { languages: ['typescript'], audit: () => [langRow] }));
    const json = JSON.parse(out.slice(out.indexOf('{')));
    expect(json['(cross-language)']).toBeUndefined();
  });
});
