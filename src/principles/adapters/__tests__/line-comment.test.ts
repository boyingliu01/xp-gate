/**
 * @test REQ-ADAPTER-LINECOMMENT
 * @intent `//` 行注释的扫描被 C++ 和 C# 两个词法器共享。它的契约只有一条，但错了
 *         会让**后面整个文件都不再被分析**：
 *
 *         它必须在换行符**之前**停下，且**不消费**换行符。消费了换行符，行号计数
 *         就会少一行，后续所有行号偏移；停错了地方，注释内容会被当成代码。
 *
 * @covers AC-ADAPTER-LINECOMMENT-01
 * @covers AC-ADAPTER-LINECOMMENT-02
 */
import { describe, expect, it } from 'vitest';
import { skipLineComment } from '../line-comment';

describe('skipLineComment', () => {
  it('stops at the newline without consuming it', () => {
    // "// note\ncode" -- from index 0 the comment is 7 characters, and the newline
    // at index 7 is left for the caller.
    const content = '// note\ncode';
    expect(skipLineComment(content, 0)).toBe(7);
    expect(content[skipLineComment(content, 0)]).toBe('\n');
  });

  it('returns the remaining length when the comment runs to end of file', () => {
    // A file that ends inside a comment must not read past its own end.
    const content = 'int x; // trailing';
    const start = content.indexOf('//');
    expect(skipLineComment(content, start)).toBe(content.length - start);
  });

  it('consumes nothing for an empty line comment', () => {
    // "//\n" -- the two slashes are the comment; the scan from the first slash stops
    // at the newline after them.
    expect(skipLineComment('//\n', 0)).toBe(2);
  });

  it('counts a single-line file with no newline at all', () => {
    expect(skipLineComment('//', 0)).toBe(2);
    expect(skipLineComment('', 0)).toBe(0);
  });

  it('starts from the given index, not from zero', () => {
    // The lexer calls it mid-line, so an implementation that always scanned from 0
    // would report the wrong length for every comment that is not at the line start.
    const content = 'x = 1; // tail\n';
    const start = content.indexOf('//');
    expect(skipLineComment(content, start)).toBe(7);
  });
});
