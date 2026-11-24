/**
 * @test REQ-GATE-RUNNER-JSCPD
 * @intent `classifyJscpdRun` 决定 Gate 2 的结论：clean / duplicates / no_files /
 *         error。它此前 75 条语句未覆盖，而这四种结论的区分正是 Gate 2 曾经
 *         假通过的地方——"扫了但我没看懂"被当成"干净"。
 *
 *         每一条返回路径都单独钉住，尤其是：
 *           - 退出码非 0 优先于任何文本解释（工具崩了不能叫"没文件"）；
 *           - 克隆数 > 0 优先于 "analyzed no files"；
 *           - 完全不认识的输出算 clean 而不是 no_files（把未来格式当 SKIP
 *             等于对所有项目关掉这道门禁）。
 *
 * @covers AC-GATE-RUNNER-JSCPD-01
 */
'use strict';

const { classifyJscpdRun } = require('../gate-runner.js');

describe('classifyJscpdRun', () => {
  it('treats a non-zero exit as an error before reading the text', () => {
    expect(classifyJscpdRun(1, 'Found 0 clones')).toBe('error');
    expect(classifyJscpdRun(1, '')).toBe('error');
  });

  it('treats a missing exit code as an error', () => {
    expect(classifyJscpdRun(undefined, 'Found 0 clones')).toBe('error');
    expect(classifyJscpdRun('0', 'Found 0 clones')).toBe('error');
  });

  it('reports duplicates when clones were found', () => {
    expect(classifyJscpdRun(0, 'Found 3 clones')).toBe('duplicates');
    expect(classifyJscpdRun(0, 'Found 1 duplicate')).toBe('duplicates');
  });

  it('reports no_files when zero clones and jscpd says it analyzed nothing', () => {
    expect(classifyJscpdRun(0, 'Found 0 clones\nAnalyzed no files')).toBe('no_files');
  });

  it('reports no_files when the summary table scanned zero files', () => {
    expect(classifyJscpdRun(0, 'Found 0 clones\n| Total: | 0 |')).toBe('no_files');
  });

  it('reports clean when zero clones were found in real files', () => {
    expect(classifyJscpdRun(0, 'Found 0 clones\n| Total: | 42 |')).toBe('clean');
  });

  it('treats unrecognised non-empty output as clean, not no_files', () => {
    // A future jscpd format must not silently disable the gate everywhere.
    expect(classifyJscpdRun(0, 'some new report format nobody parsed')).toBe('clean');
  });

  it('treats output containing only a timing line as no_files', () => {
    expect(classifyJscpdRun(0, 'time: 1.234s')).toBe('no_files');
    expect(classifyJscpdRun(0, '\n\n')).toBe('no_files');
  });

  it('ignores a non-string output instead of throwing', () => {
    expect(classifyJscpdRun(0, null)).toBe('no_files');
    expect(classifyJscpdRun(0, undefined)).toBe('no_files');
  });
});
