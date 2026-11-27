/**
 * @test REQ-GATE10-LINES
 * @intent 两道行级判断，各自守护一次**真实漏检**：
 *
 *         1. **多行 import 必须拼接**。Prettier 会把长 import 折行，单行扫描看到的
 *            就是一条不完整的语句——`from './x'` 的路径压根看不到。
 *         2. **注释后面的代码必须被扫描**。`/* eslint-disable *&#47; import real from './real'`
 *            以注释开头，整行曾被直接丢弃，而那一行上**真的有 import**——合规门禁
 *            绝不能往这个方向失败。
 *
 * @covers AC-GATE10-LINES-01
 * @covers AC-GATE10-LINES-02
 */
import { describe, expect, it } from 'vitest';
import {
  joinImportStatement,
  hasCodeAfterLeadingComment,
} from '../gate-10-lines';

describe('joinImportStatement', () => {
  it('joins an import split across lines', () => {
    const lines = [
      "import {",
      '  a,',
      "} from './a';",
    ];
    const joined = joinImportStatement(lines, 0);
    // The null assertion above does not narrow for tsc, so the value is read once.
    expect(joined?.text).toContain("from './a'");
    expect(joined?.consumed).toBe(2);
  });

  it('leaves an already-complete import alone', () => {
    // Joining it would consume the following lines for nothing.
    expect(joinImportStatement(["import a from './a';", 'const x = 1;'], 0)).toBeNull();
  });

  it('does not treat ordinary code as an import opener', () => {
    expect(joinImportStatement(['const x = 1;', 'const y = 2;'], 0)).toBeNull();
  });

  it('returns null when the statement never completes', () => {
    // Guessing here would join unrelated code.
    expect(joinImportStatement(['import {', '  a,', '  b,'], 0)).toBeNull();
  });
});

describe('hasCodeAfterLeadingComment', () => {
  it('reports real code on a line with no comment', () => {
    expect(hasCodeAfterLeadingComment('const x = 1;')).toBe(true);
  });

  it('reports nothing after a line comment', () => {
    expect(hasCodeAfterLeadingComment('// just a note')).toBe(false);
  });

  it('finds the import that follows a block comment on the same line', () => {
    // The measured miss: skipping on the raw prefix dropped a genuine import.
    expect(hasCodeAfterLeadingComment("/* note */ import real from './real';")).toBe(true);
  });

  it('reports nothing when only a comment follows the block comment', () => {
    expect(hasCodeAfterLeadingComment('/* a */ // b')).toBe(false);
  });

  it('reports nothing for an unterminated block comment', () => {
    // It runs to the end of the file, so there is no code on this line.
    expect(hasCodeAfterLeadingComment('/* never closed')).toBe(false);
  });

  it('treats a JSDoc continuation as a comment line', () => {
    expect(hasCodeAfterLeadingComment(' * text inside a doc block')).toBe(false);
  });
});
