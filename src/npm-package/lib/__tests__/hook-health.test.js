/**
 * @test REQ-546 hook health: line endings and bash parseability
 * @intent Verify doctor can tell a hook that merely EXISTS from a hook git can
 *         actually run. #546: a pre-commit rewritten with CRLF line endings
 *         failed every commit while `xp-gate doctor` reported it healthy,
 *         because the check only asked whether the file was there.
 * @covers AC-05, AC-08
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const { inspectHookFile } = require('../hook-health');

let TMP_DIR;

beforeAll(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-health-'));
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

function write(name, content) {
  const p = path.join(TMP_DIR, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('inspectHookFile', () => {
  test('a healthy LF hook reports ok', () => {
    const p = write('good.sh', '#!/bin/bash\nfoo() {\n  echo hi\n}\nfoo\n');
    const r = inspectHookFile(p);
    expect(r.ok).toBe(true);
    expect(r.crlfLines).toBe(0);
    expect(r.problems).toEqual([]);
  });

  test('an all-CRLF hook is reported with a CRLF count', () => {
    const p = write('crlf.sh', '#!/bin/bash\r\nfoo() {\r\n  echo hi\r\n}\r\nfoo\r\n');
    const r = inspectHookFile(p);
    expect(r.ok).toBe(false);
    expect(r.crlfLines).toBe(5);
    expect(r.problems.join(' ')).toMatch(/CRLF/);
  });

  test('a single stray CRLF is enough to fail', () => {
    // One bad line is all bash needs to choke on, and it is the case an
    // "is the file mostly fine" heuristic would wave through.
    const p = write('one.sh', '#!/bin/bash\necho one\necho two\r\necho three\n');
    const r = inspectHookFile(p);
    expect(r.ok).toBe(false);
    expect(r.crlfLines).toBe(1);
  });

  test('CRLF in the middle of a multi-line construct is flagged', () => {
    // The exact shape from #546: the \r lands inside a construct bash is
    // mid-way through parsing, so the reported line number drifts far from
    // the real cause.
    const p = write('mid.sh', 'case "$x" in\r\n  a) echo a ;;\r\nesac\n');
    const r = inspectHookFile(p);
    expect(r.ok).toBe(false);
    expect(r.crlfLines).toBe(2);
  });

  test('a syntax error with clean line endings is reported as unparseable', () => {
    const p = write('bad.sh', '#!/bin/bash\nif [ 1 -eq 1 ]; then\n  echo x\n');
    const r = inspectHookFile(p);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/not parseable|syntax/i);
  });

  test('a binary-looking file does not crash the inspector', () => {
    const p = path.join(TMP_DIR, 'bin.sh');
    fs.writeFileSync(p, Buffer.from([0x00, 0xff, 0xfe, 0x0a]));
    expect(() => inspectHookFile(p)).not.toThrow();
  });

  test('a missing file reports missing rather than throwing', () => {
    const r = inspectHookFile(path.join(TMP_DIR, 'nope.sh'));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/missing/i);
  });
});
