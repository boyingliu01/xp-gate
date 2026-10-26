/**
 * @test REQ-620
 * @intent Pin the behaviour of the literal/comment masker before it is
 *         refactored. The masker is a four-state character scanner (line
 *         comment, block comment, regex literal, string/template) whose output
 *         feeds EVERY metric the rule set reads: a masking mistake changes
 *         reported nesting depth, function length and body text for the whole
 *         adapter. These cases are the safety net for the CCN-36 split, so they
 *         assert observable masking outcomes (offsets preserved, literals
 *         blanked, structure kept) rather than any internal helper shape.
 * @covers AC-620-01
 *
 * Masking contract (from the function's own docblock):
 *   - every comment / string / template / regex literal becomes spaces
 *   - offsets and newlines are preserved exactly (length and line count equal)
 *   - everything else is left byte-identical
 */
import { describe, it, expect, vi } from 'vitest';
import { TypeScriptAdapter } from '../typescript';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

/** Mask a source string by round-tripping it through the adapter's parser. */
function mask(src: string): string {
  (readFileSync as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue(src);
  const adapter = new TypeScriptAdapter('probe.ts');
  const ast = adapter.parseAST() as { masked?: string };
  // The adapter exposes the masked source through a getter on the instance.
  const masked = (adapter as unknown as { maskedSource?: string }).maskedSource;
  return masked ?? ast.masked ?? '';
}

describe('AC-620-01: literal masking keeps offsets and blanks exactly the non-code', () => {
  const cases: Array<[string, string]> = [
    ['line comment', 'const a = 1; // hidden\nconst b = 2;'],
    ['block comment', 'const a = 1; /* hidden\nstill hidden */ const b = 2;'],
    ['single-quoted string', "const s = 'hidden text';"],
    ['double-quoted string', 'const s = "hidden text";'],
    ['template literal', 'const s = `hidden ${x} text`;'],
    ['regex literal', 'const re = /hid+den/g;'],
    ['escaped quote in string', "const s = 'it\\'s hidden';"],
  ];

  for (const [label, src] of cases) {
    it(`preserves length and line count for a ${label}`, () => {
      const out = mask(src);
      expect(out.length).toBe(src.length);
      expect(out.split('\n').length).toBe(src.split('\n').length);
    });
  }

  it('blanks a line comment but keeps the code before it', () => {
    const out = mask('const a = 1; // hidden');
    expect(out).toContain('const a = 1;');
    expect(out).not.toContain('hidden');
  });

  it('blanks a block comment across lines without eating the newline', () => {
    const src = '/* a\nb */\nconst keep = 1;';
    const out = mask(src);
    expect(out).not.toContain('a\nb');
    expect(out.split('\n').length).toBe(3);
    expect(out).toContain('const keep = 1;');
  });

  it('blanks string contents and keeps the code around them', () => {
    const out = mask('const s = "hidden"; const n = 42;');
    expect(out).not.toContain('hidden');
    expect(out).toContain('const s =');
    expect(out).toContain('const n = 42;');
  });

  it('blanks a template literal including its interpolations', () => {
    const out = mask('const s = `before ${x} after`;');
    expect(out).not.toContain('before');
    expect(out).not.toContain('after');
    expect(out).toContain('const s =');
  });

  it('does not treat a division slash as the start of a regex literal', () => {
    // `a / b` is division: the slash must not swallow the rest of the line.
    const out = mask('const r = a / b; const keep = 1;');
    expect(out).toContain('const keep = 1;');
    expect(out).toContain('a / b');
  });

  it('leaves code with no literals byte-identical', () => {
    const src = 'function f(a, b) {\n  return a + b;\n}';
    expect(mask(src)).toBe(src);
  });
});
