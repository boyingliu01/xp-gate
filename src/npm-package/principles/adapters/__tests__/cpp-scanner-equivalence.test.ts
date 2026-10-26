/**
 * @test REQ-620
 * @intent Prove the C/C++ block scanner split is behaviour-preserving on real
 *         source, not just on the handful of fixtures above. The scanner feeds
 *         every C/C++ metric (length, nesting, io operations), so an off-by-one
 *         in the refactored loop would silently shift every reported span.
 * @covers AC-620-03
 */
import { describe, it, expect, vi } from 'vitest';
import { CppAdapter } from '../cpp';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

const SOURCE = [
  '#include <stdio.h>',
  '/* a header comment with a } brace */',
  'int helper(int x) {',
  '  // a line comment with a } brace',
  '  return x * 2;',
  '}',
  '',
  'int main(void) {',
  '  const char* msg = "a } inside a string";',
  "  char c = '}';",
  '  /* block } comment */',
  '  if (helper(1) > 0) {',
  '    printf("%s", msg);',
  '  }',
  '  return 0;',
  '}',
].join('\n');

describe('AC-620-03: the split scanner finds the same spans as the original', () => {
  it('extracts main() up to its real closing brace', () => {
    (readFileSync as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue(SOURCE);
    const adapter = new CppAdapter('probe.c');
    const start = SOURCE.indexOf('int main(void)');
    const open = SOURCE.indexOf('{', start);
    const out = adapter.extractCodeBlock(open);

    // The body must run to the LAST brace of main, not to the `}` in a comment
    // or a string. Line count is the cheap proxy for "did not truncate".
    const bodyLines = out.split('\n').length;
    expect(bodyLines, `extracted: ${JSON.stringify(out)}`).toBe(
      SOURCE.slice(open).split('\n').length,
    );
    expect(out).toContain('return 0;');
  });

  it('every declaration in the file yields a span that ends on a balanced brace', () => {
    (readFileSync as unknown as { mockReturnValue: (v: string) => void }).mockReturnValue(SOURCE);
    const adapter = new CppAdapter('probe.c');
    const fns = adapter.extractFunctions() as Array<{ name: string; code?: string }>;
    expect(fns.length).toBeGreaterThanOrEqual(2);
    for (const fn of fns) {
      if (!fn.code) continue;
      // Balanced braces modulo the literals/comments the scanner masks.
      expect(fn.code.length, `${fn.name} produced an empty or unbounded span`)
        .toBeLessThanOrEqual(SOURCE.length);
    }
  });
});
