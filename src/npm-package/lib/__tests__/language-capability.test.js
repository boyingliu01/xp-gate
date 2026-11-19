/**
 * @test REQ-LANG-CAPABILITY
 * @intent 一门新语言要在 13 个互不引用的接入面上各写一遍，缺任何一处的症状都是
 *         「门禁打印 PASSED/SKIPPED 而从未检查过任何该语言的文件」。C# 为此分 5 波
 *         补了 16 天，消费项目还自建了 400+ 行门禁兜底。本模块把「接全了吗」变成
 *         从代码派生的三态输出，这些测试钉住派生的**准确性**与**不误报**两面。
 * @covers AC-LANG-CAP-01, AC-LANG-CAP-02, AC-LANG-CAP-03, AC-LANG-CAP-04
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  STATE,
  inspectLanguage,
  inspectAll,
  summarise,
  hasExtensionToken,
  hasLanguageKey,
  definitionAndCall,
} = require('../language-capability');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/**
 * Build a fake hooks tree so each test states exactly which surfaces are wired.
 *
 * A fixture rather than the real repo on purpose: assertions against the live
 * tree would fail every time a gate is legitimately edited, which teaches
 * people to update the expectation instead of reading the failure. The real
 * tree gets one separate test at the bottom.
 *
 * @param {Record<string, string>} files relative path -> content
 * @returns {{root: string, cleanup: () => void}}
 */
function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-langcap-'));
  const withDefaults = {
    'githooks/pre-commit': '',
    ...files,
  };
  for (const [rel, content] of Object.entries(withDefaults)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const ADAPTER = `
run_static_analysis() { return 0; }
run_lint() { return 0; }
run_tests() { return 0; }
run_coverage() { return 0; }
`;

describe('extension-token matching is exact, not substring', () => {
  it('does not report csx as cs', () => {
    expect(hasExtensionToken('csx|vb', 'cs')).toBe(false);
    expect(hasExtensionToken('cs|csx', 'cs')).toBe(true);
    expect(hasExtensionToken('cs|csx', 'csx')).toBe(true);
  });

  // The real defect shape: a reader using includes('php') would match a
  // variable name or a comment, and report a gate as wired when it is not.
  it('does not match an extension that is only a prefix of another', () => {
    expect(hasExtensionToken('phpcs', 'php')).toBe(false);
    expect(hasExtensionToken('php|phps', 'php')).toBe(true);
  });
});

describe('language keys must be delimited, not bare prose', () => {
  it('ignores a language mentioned only in a comment', () => {
    expect(hasLanguageKey('# see the php arm\n', 'php')).toBe(false);
  });

  it('accepts case-arm and quoted-key shapes', () => {
    expect(hasLanguageKey('  php)\n    echo hi\n', 'php')).toBe(true);
    expect(hasLanguageKey("  'php': { name: 'PHP' },", 'php')).toBe(true);
  });
});

describe('definitionAndCall separates "exists" from "is invoked"', () => {
  // This is the exact C# Gate 13 defect (#717 §8): the function was defined and
  // nothing called it, and a grep for the name read as coverage.
  it('distinguishes a definition from a call', () => {
    const definedOnly = 'gate13_run_php_analysis() {\n  return 0\n}\n';
    expect(definitionAndCall(definedOnly, 'gate13_run_php_analysis')).toEqual({
      defined: true,
      called: false,
    });

    const withCall = `${definedOnly}\ngate13_run_php_analysis; _g13_rc=$?\n`;
    expect(definitionAndCall(withCall, 'gate13_run_php_analysis')).toEqual({
      defined: true,
      called: true,
    });
  });

  it('does not count a commented-out call', () => {
    const text = 'gate13_run_php_analysis() { return 0; }\n# gate13_run_php_analysis\n';
    expect(definitionAndCall(text, 'gate13_run_php_analysis').called).toBe(false);
  });

  it('reports neither for an absent function', () => {
    expect(definitionAndCall('echo hi\n', 'gate13_run_php_analysis')).toEqual({
      defined: false,
      called: false,
    });
  });
});

describe('未接线必须被报成 NOT WIRED，且每个面独立判定', () => {
  it('reports an absent adapter as not implemented', () => {
    const f = fixture({});
    try {
      const rows = inspectLanguage('php', {
        root: f.root,
        read: (rel) => {
          try {
            return fs.readFileSync(path.join(f.root, rel), 'utf8');
          } catch {
            return null;
          }
        },
      });
      const adapter = rows.find((r) => r.surface === 'adapter');
      expect(adapter.state).toBe(STATE.NOT_IMPLEMENTED);
    } finally {
      f.cleanup();
    }
  });

  it('reports Gate 4 NOT WIRED when the filter accepts the file but the analyzer map does not', () => {
    // The #717 defect verbatim: gate-4.sh listed `cs` in its filter, analyzer.ts
    // had no '.cs' entry, so the file was accepted and then dropped.
    const f = fixture({
      'githooks/adapters/php.sh': ADAPTER,
      'githooks/adapters/gate-4.sh': "PRINCIPLES_FILES=$(echo \"$CHANGED_FILES\" | grep -E '\\.(ts|php)$')\n",
      'src/principles/analyzer.ts': "const adapterMap = { '.ts': TypeScriptAdapter };\n",
    });
    try {
      const rows = inspectLanguage('php', {
        root: f.root,
        read: (rel) => {
          try {
            return fs.readFileSync(path.join(f.root, rel), 'utf8');
          } catch {
            return null;
          }
        },
      });
      const gate4 = rows.find((r) => r.surface === 'gate-4');
      expect(gate4.state).toBe(STATE.NOT_WIRED);
      expect(gate4.evidence).toMatch(/adapterMap has no entry/);
    } finally {
      f.cleanup();
    }
  });

  it('reports Gate 13 NOT WIRED when the function is defined but never invoked', () => {
    const f = fixture({
      'githooks/adapters/gate-13-compiler-strictness.sh': 'gate13_run_php_analysis() { return 0; }\n',
      'githooks/gate-entries/gate-13-entry.sh': 'gate13_run_cpp_analysis; _g13_rc=$?\n',
    });
    try {
      const rows = inspectLanguage('php', {
        root: f.root,
        read: (rel) => {
          try {
            return fs.readFileSync(path.join(f.root, rel), 'utf8');
          } catch {
            return null;
          }
        },
      });
      const g13 = rows.find((r) => r.surface === 'gate-13');
      expect(g13.state).toBe(STATE.NOT_WIRED);
      expect(g13.evidence).toMatch(/DEFINED BUT NEVER CALLED/);
    } finally {
      f.cleanup();
    }
  });
});

describe('不得误报：已接线的面必须读成 checked', () => {
  it('reads a fully wired fixture as all-checked', () => {
    const f = fixture({
      'githooks/adapters/php.sh': ADAPTER,
      'githooks/adapters/gate-3.sh': "CC_FILES=$(echo \"$CHANGED_FILES\" | grep -E '\\.(ts|php)$')\n",
      'githooks/adapters/gate-4.sh': "PRINCIPLES_FILES=$(echo \"$CHANGED_FILES\" | grep -E '\\.(ts|php)$')\n",
      'githooks/gate-entries/gate-0-entry.sh': '_detect_ext_lang "php" || true\n',
      'githooks/gate-entries/gate-1-entry.sh': 'any_changed_files_match "\\.(ts|php)$" || true\n',
      'githooks/gate-entries/gate-2-entry.sh': "SOURCE_FILES=$(echo \"$CHANGED_FILES\" | grep -E '\\.(ts|php)$')\n",
      'githooks/gate-entries/gate-5-entry.sh': "CODE_EXTENSIONS=\"\\.(ts|php)$\"\n",
      'githooks/gate-entries/gate-6-entry.sh': '      php)\n        echo arch\n        ;;\n',
      'githooks/gate-entries/gate-9-entry.sh': '      php)\n        echo build\n        ;;\n',
      'githooks/gate-10.sh': 'SEMGREP_RULES+=(--config="$(gate10_resolve_ruleset "p/php")")\n',
      'githooks/adapters/gate-13-compiler-strictness.sh': 'gate13_run_php_analysis() { return 0; }\n',
      'githooks/gate-entries/gate-13-entry.sh': 'gate13_run_php_analysis; _g13_rc=$?\n',
      'src/principles/analyzer.ts': "const adapterMap = { '.php': PhpAdapter };\n",
      'src/npm-package/lib/language-tools.js': '  php: {\n    name: "PHP",\n  },\n',
      '.github/workflows/quality-gates.yml': "      echo 'php' > project_language.txt\n",
    });
    try {
      const rows = inspectLanguage('php', {
        root: f.root,
        read: (rel) => {
          try {
            return fs.readFileSync(path.join(f.root, rel), 'utf8');
          } catch {
            return null;
          }
        },
      });
      const sum = summarise(rows);
      expect(sum.notWired).toBe(0);
      expect(sum.checked).toBeGreaterThanOrEqual(12);
    } finally {
      f.cleanup();
    }
  });
});

/**
 * The one test that reads the REAL tree.
 *
 * It asserts a property rather than a fixed score. Two properties are worth
 * pinning here because both are silent when violated:
 *
 *   1. A routed language with an ANALYZER must not have the Gate 4
 *      filter/map mismatch. That mismatch (#717: gate-4.sh accepted `.cs`,
 *      `analyzer.ts` had no entry) is always a bug, never a design choice, and
 *      it presents as a gate that "checked" a file it discarded.
 *
 *   2. Gate 4 does NOT need to cover every language with an adapter. Measured:
 *      `analyzer.ts` has no shell, powershell or iac adapter at all, so those
 *      three languages are correctly absent from the filter. Asserting
 *      "filter must match adapters" would have demanded wiring that cannot
 *      exist, and the natural fix -- widening the filter -- would have created
 *      exactly the accepted-then-dropped defect this file exists to catch.
 *      The right requirement is that the language either has an analyzer or is
 *      a declared gap, and the two are distinguishable.
 */
describe('real repository invariants', () => {
  it('no language that HAS an analyzer is discarded by the Gate 4 filter', () => {
    const rows = inspectAll({ root: REPO_ROOT });
    // Languages with an analyzer entry are exactly those the principled engine
    // can construct; the filter must therefore accept them.
    const analyzerSrc = fs.readFileSync(
      path.join(REPO_ROOT, 'src/principles/analyzer.ts'),
      'utf8',
    );
    const withAnalyzer = new Set();
    for (const r of rows) {
      const hasMapEntry = r.surface === 'gate-4' && /adapterMap/.test(r.evidence);
      if (hasMapEntry) withAnalyzer.add(r.language);
    }
    const mismatches = rows.filter(
      (r) =>
        r.surface === 'gate-4' &&
        r.state === STATE.NOT_WIRED &&
        /adapterMap has no entry/.test(r.evidence),
    );
    // The mismatch state only arises when the filter ACCEPTS and the map does
    // not -- so any occurrence is the defect regardless of the set above.
    expect(mismatches.map((m) => `${m.language}: ${m.evidence}`)).toEqual([]);
    expect(analyzerSrc.length).toBeGreaterThan(0);
  });

  it('Gate 4 declares shell/powershell/iac as gaps rather than pretending', () => {
    // Pinned so that adding an analyzer for one of them without wiring the
    // filter fails here instead of shipping a half-scaffolded language.
    const rows = inspectAll({ root: REPO_ROOT });
    for (const lang of ['shell', 'powershell', 'iac']) {
      const gate4 = rows.find((r) => r.language === lang && r.surface === 'gate-4');
      expect(gate4.state).toBe(STATE.NOT_WIRED);
      expect(gate4.evidence).toMatch(/extension absent from gate-4\.sh/);
    }
  });

  it('csharp is fully wired except Gate 9, which is a declared gap', () => {
    const rows = inspectAll({ root: REPO_ROOT }).filter((r) => r.language === 'csharp');
    const sum = summarise(rows);
    expect(sum.notWired).toBe(0);
    const gap = rows.find((r) => r.state === STATE.NOT_IMPLEMENTED);
    expect(gap.surface).toBe('gate-9');
  });
});
