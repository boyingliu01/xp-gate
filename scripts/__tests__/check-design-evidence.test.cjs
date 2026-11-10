/**
 * @test REQ-DESIGN-EVIDENCE
 * @intent Prove the design-evidence checker actually rejects uncited values. A checker
 *         that never fails is worse than no checker: it turns "nobody verified" into
 *         "the tool verified it". These cases are the four real fabrications from
 *         sprint-20261110-33, replayed as fixtures.
 * @covers AC-DESIGN-EVIDENCE-01, AC-DESIGN-EVIDENCE-02, AC-DESIGN-EVIDENCE-03
 */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkFile } = require('../check-design-evidence.cjs');

function withDoc(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-evidence-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, content, 'utf8');
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('check-design-evidence', () => {
  describe('AC-DESIGN-EVIDENCE-01: rejects uncited values (the four real fabrications)', () => {
    test('fabrication 1 — invented field name in inline code', () => {
      const doc = 'The gate reports `gate6.archlintStatus === "PASS"` when config exists.\n';
      const findings = withDoc(doc, checkFile);
      assert.strictEqual(findings.length, 1, 'invented field must be flagged');
    });

    test('fabrication 2 — field list with no provenance', () => {
      const doc = [
        'The summary has these keys:',
        '',
        '```js',
        "const EXPECTED_SUMMARY_FIELDS = ['total_smells', 'files_analyzed'];",
        '```',
        '',
      ].join('\n');
      const findings = withDoc(doc, checkFile);
      assert.ok(findings.length >= 1, 'uncited constant must be flagged');
    });

    test('fabrication 4 — new field asserted as if existing', () => {
      const doc = [
        'The journal records:',
        '',
        '```js',
        'assert(report.gates.M.details.skip_kind === "missing");',
        '```',
        '',
      ].join('\n');
      const findings = withDoc(doc, checkFile);
      assert.strictEqual(findings.length, 1, 'existing-looking field must be flagged');
    });
  });

  describe('AC-DESIGN-EVIDENCE-02: accepts properly cited values', () => {
    test('file:line citation in the same paragraph', () => {
      const doc = [
        '实测 `githooks/pre-push:155`：',
        '',
        '```bash',
        "printf '%s' \"_m_details = {'skip_reason': ...}\"",
        '```',
        '',
      ].join('\n');
      assert.deepStrictEqual(withDoc(doc, checkFile), []);
    });

    test('shell command plus captured exit code', () => {
      const doc = [
        '```bash',
        '$ archlint --version',
        'archlint 0.16.0',
        '# exit=0',
        '```',
        '',
      ].join('\n');
      assert.deepStrictEqual(withDoc(doc, checkFile), []);
    });

    test('explicit new-design marker', () => {
      const doc = [
        '`details.skip_kind` 本设计新增，当前不存在。',
        '',
        '```js',
        'assert(report.gates.M.details.skip_kind === "missing");',
        '```',
        '',
      ].join('\n');
      assert.deepStrictEqual(withDoc(doc, checkFile), []);
    });

    test('explicit implementation-task marker', () => {
      const doc = [
        '这是一条实现任务，不是对现状的描述：',
        '',
        '```bash',
        'GATE_M_SKIP_KIND="missing"',
        '```',
        '',
      ].join('\n');
      assert.deepStrictEqual(withDoc(doc, checkFile), []);
    });

    test('fenced block introduced by a source file name is self-citing', () => {
      const doc = [
        '实测 `githooks/pre-commit:4376` 的判定逻辑：',
        '',
        '```bash',
        'if [ -f "$PROJECT_ROOT/.archlint.yaml" ]; then',
        '  ARCHLINT_STATUS=PASS',
        'fi',
        '```',
        '',
      ].join('\n');
      assert.deepStrictEqual(withDoc(doc, checkFile), []);
    });

    test('prose without inline code is not inspected', () => {
      const doc = 'We discussed journal.gates.M.details.skip_kind informally here.\n';
      assert.deepStrictEqual(withDoc(doc, checkFile), []);
    });
  });

  describe('AC-DESIGN-EVIDENCE-03: the checker reports WHY, not just that', () => {
    test('every finding carries a line number', () => {
      const doc = [
        '# Title',
        '',
        '```js',
        'assert(gate.archlintStatus === "PASS");',
        '```',
        '',
      ].join('\n');
      const findings = withDoc(doc, checkFile);
      assert.strictEqual(findings.length, 1);
      // 1-based line of the assertion: '# Title'(1) ''(2) '```js'(3) assert(4)
      assert.strictEqual(findings[0].line, 4, 'line number must point at the assertion');
      assert.ok(findings[0].text.includes('archlintStatus'));
    });
  });
});
