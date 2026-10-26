/**
 * @test REQ-620
 * @intent Prove the block-comment masking defect before fixing it. The masker's
 *         contract is to preserve offsets and newlines so that `lineOf()` and
 *         every line-numbered violation stays correct. A block comment
 *         containing a newline is currently collapsed, shifting every later
 *         line number up -- which silently mislabels every violation that
 *         follows a multi-line comment in the file.
 * @covers AC-620-02
 */
import { describe, it, expect, vi } from 'vitest';
import { TypeScriptAdapter } from '../typescript';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

function mask(src: string): string {
  (readFileSync as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue(src);
  const adapter = new TypeScriptAdapter('probe.ts');
  return (adapter as unknown as { maskedSource: string }).maskedSource;
}

describe('AC-620-02: a multi-line block comment must not shift later line numbers', () => {
  it('keeps the newline inside a block comment', () => {
    const src = '/* a\nb */\nconst keep = 1;';
    const out = mask(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });

  it('keeps the line count when the block comment spans three lines', () => {
    const src = '/* one\ntwo\nthree */\nconst keep = 1;\nconst also = 2;';
    const out = mask(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).toContain('const keep = 1;');
    expect(out).toContain('const also = 2;');
  });

  it('reports a function line number that matches the physical source', () => {
    // The function starts on physical line 4; a collapsed block comment would
    // make the adapter report line 2.
    const src = ['/* a', 'b', 'c */', 'function target() {', '  return 1;', '}'].join('\n');
    (readFileSync as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue(src);
    const adapter = new TypeScriptAdapter('probe.ts');
    const fns = adapter.extractFunctions() as Array<{ name: string; line: number }>;
    const target = fns.find((f) => f.name === 'target');
    expect(target).toBeDefined();
    expect(target!.line).toBe(4);
  });
});
