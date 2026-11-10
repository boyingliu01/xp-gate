/**
 * @test REQ-PRINCIPLES-DUP
 * @intent 直接测 measureDuplication 这个算法本身。它是 Phase 4 那条规则的唯一数据
 *   来源，所以「它算得对」必须独立于规则、独立于某个具体语言 adapter 地被证明。
 *   抽成纯函数（而不是留在 BaseAdapter 里）的收益就在这里：下面每个断言只喂字符串，
 *   不需要临时文件、不需要构造 adapter。
 *
 *   重点覆盖三类**排除规则**——它们才是这个测量能不能被信任的关键。一个把
 *   「每个函数都以 } 结尾」也算成重复的实现，报出的百分比会让规则变成噪声，
 *   然后被所有人关掉。
 * @covers AC-PRINCIPLES-DUP-01, AC-PRINCIPLES-DUP-02
 */
import { describe, it, expect } from 'vitest';
import { measureDuplication } from '../duplication';

/** Two byte-identical function bodies: unambiguously duplicated. */
const COPIED_FUNCTION_BODY = `function copyHooks(src, dest) {
  const files = ['pre-commit', 'pre-push'];
  for (const f of files) {
    write(join(dest, f), read(join(src, f)));
  }
  return files;
}`;

describe('measureDuplication', () => {
  it('reports a percentage and blocks for a file that copies a function body', () => {
    const source = `${COPIED_FUNCTION_BODY}\n\n${COPIED_FUNCTION_BODY}\n`;

    const report = measureDuplication(source);

    expect(report.percentage).toBeGreaterThan(0);
    expect(report.blocks.length).toBeGreaterThan(0);
    const [first] = report.blocks;
    expect(first.startLine).toBeGreaterThanOrEqual(1);
    expect(first.endLine).toBeGreaterThanOrEqual(first.startLine);
    expect(first.snippet.length).toBeGreaterThan(0);
    // Longest region first: the report must lead with the block worth extracting.
    expect(first.endLine - first.startLine).toBeGreaterThanOrEqual(
      report.blocks[report.blocks.length - 1].endLine -
        report.blocks[report.blocks.length - 1].startLine,
    );
  });

  it('stays at zero for distinct functions that merely share punctuation', () => {
    // Every function here ends with `}` and most contain `return`. If those lines
    // counted, ordinary code would score near 100% and the rule would be noise.
    const source = `function alpha(a) {
  return a + 1;
}
function beta(b) {
  return b * 2;
}
function gamma(c) {
  const out = c - 3;
  return out;
}
function delta(d) {
  const tmp = d / 4;
  return tmp;
}
`;

    expect(measureDuplication(source).percentage).toBe(0);
  });

  it('ignores a repeated comment header', () => {
    const header = `// Copyright 2026
// SPDX-License-Identifier: MIT
// Generated file, do not edit`;
    const source = `${header}
function one(x) {
  const y = x + 1;
  return y;
}
${header}
function two(z) {
  const w = z - 2;
  return w;
}
`;

    expect(measureDuplication(source).percentage).toBe(0);
  });

  it('returns zero for a file too short to contain a repeated window', () => {
    expect(measureDuplication('const a = 1;\nconst b = 2;\n').percentage).toBe(0);
    expect(measureDuplication('').percentage).toBe(0);
  });

  it('never reports more than 100% and keeps blocks inside the file', () => {
    const source = `${COPIED_FUNCTION_BODY}\n${COPIED_FUNCTION_BODY}\n${COPIED_FUNCTION_BODY}\n`;
    const lineCount = source.split('\n').length;

    const report = measureDuplication(source);

    expect(report.percentage).toBeLessThanOrEqual(100);
    for (const block of report.blocks) {
      expect(block.startLine).toBeGreaterThanOrEqual(1);
      expect(block.endLine).toBeLessThanOrEqual(lineCount);
    }
  });

  it('ignores indentation differences when matching windows', () => {
    const flat = `const a = 1;
const b = 2;
const c = 3;`;
    const indented = flat
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');

    // Same code, different indentation: still the same duplicated region.
    expect(measureDuplication(`${flat}\n${indented}\n`).percentage).toBeGreaterThan(0);
  });
});
