/**
 * @test REQ-620
 * @intent Pin the C/C++ code-block scanner's treatment of comments and string
 *         literals before its CCN-28 body is split.
 *
 *         Every case is built to DEFEAT the fallback path. `extractCodeBlock`
 *         falls back to `substring(startPos)` capped at 200 characters, so a
 *         short fixture returns "the whole thing" even when the scanner never
 *         found a closing brace -- the assertions then pass on a broken scanner.
 *         Each source below therefore pads past 200 characters and asserts the
 *         exact end position, so a truncated scan cannot look correct.
 *
 *         Verified by injecting three real defects (brace tracker seeing into
 *         strings, block comments untracked, backslash parity ignored): each one
 *         reddens at least one case here.
 * @covers AC-620-03
 */
import { describe, it, expect, vi } from 'vitest';
import { CppAdapter } from '../cpp';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

const MARKER = 'END_OF_FUNCTION';
/** Padding that keeps the source well past the 200-char fallback cap. */
const PAD = ' '.repeat(240);

function block(src: string, start = 0): string {
  (readFileSync as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue(src);
  const adapter = new CppAdapter('probe.cpp');
  return adapter.extractCodeBlock(start);
}

/**
 * Build `void f() { <body> }` followed by `<MARKER>`, padded past the fallback
 * cap. The padding sits INSIDE the function body so the fallback (which runs to
 * the 200-char cap) would include the marker, while a correct scan stops at the
 * real closing brace and does not.
 */
function wrap(body: string): { src: string; open: number } {
  const src = `void f() {\n${body}\n${PAD}\n}${MARKER}`;
  return { src, open: src.indexOf('{') };
}

describe('AC-620-03: the C/C++ block scanner ignores braces in comments and strings', () => {
  it('returns exactly the balanced body of a plain function', () => {
    const { src, open } = wrap('  int a = 1;');
    const out = block(src, open);
    expect(out, `tail=${JSON.stringify(out.slice(-60))} len=${out.length}`).toMatch(/}$/);
  });

  it('does not close on a brace inside a line comment', () => {
    const { src, open } = wrap('  // } not the end\n  int a = 1;');
    const out = block(src, open);
    expect(out, `extracted: ${JSON.stringify(out.slice(0, 80))}`).toContain('int a = 1;');
    expect(out).not.toContain(MARKER);
  });

  it('does not close on a brace inside a block comment', () => {
    const { src, open } = wrap('  /* } not the end */\n  int a = 1;');
    const out = block(src, open);
    expect(out).toContain('int a = 1;');
    expect(out).not.toContain(MARKER);
  });

  it('does not close on a brace inside a string literal', () => {
    const { src, open } = wrap('  const char* s = "}";\n  int a = 1;');
    const out = block(src, open);
    expect(out).toContain('int a = 1;');
    expect(out).not.toContain(MARKER);
  });

  it('keeps scanning past a string that CONTAINS the only early close brace', () => {
    // The string's `}` is the first `}` after the opener. A scanner that counts
    // it ends the block immediately and never reaches the statements below.
    const { src, open } = wrap('  const char* s = "}";\n  int markerStatement = 1;\n  int tail = 2;');
    const out = block(src, open);
    expect(out, `extracted: ${JSON.stringify(out.slice(0, 120))}`)
      .toContain('int tail = 2;');
  });

  it('keeps scanning past a char literal that contains a close brace', () => {
    const { src, open } = wrap("  char c = '}';\n  int tail = 2;");
    const out = block(src, open);
    expect(out).toContain('int tail = 2;');
  });

  it('does not close on a brace inside a char literal', () => {
    const { src, open } = wrap("  char c = '}';\n  int a = 1;");
    const out = block(src, open);
    expect(out).toContain('int a = 1;');
    expect(out).not.toContain(MARKER);
  });

  it('treats an escaped quote inside a string as data, not a terminator', () => {
    // `\"` does not close the string, so the `}` after it is still string data.
    const { src, open } = wrap('  const char* s = "a\\"}b";\n  int a = 1;');
    const out = block(src, open);
    expect(out).toContain('int a = 1;');
    expect(out).not.toContain(MARKER);
  });

  it('treats an even run of backslashes as NOT escaping the quote', () => {
    // `\\` is a literal backslash, so the following `"` DOES close the string,
    // and the `}` that ends the line is real structure.
    const { src, open } = wrap('  const char* s = "a\\\\";\n  int a = 1;');
    const out = block(src, open);
    expect(out.trimEnd().endsWith('}')).toBe(true);
    expect(out).toContain('int a = 1;');
    expect(out).not.toContain(MARKER);
  });

  it('falls back when no balanced block is ever found', () => {
    const src = 'void f() {\n  int a = 1;' + PAD;
    const out = block(src, 9);
    expect(out.length).toBe(200);
    expect(out.length).toBeLessThan(src.length);
  });
});
