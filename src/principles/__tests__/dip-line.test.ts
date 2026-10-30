/**
 * @test REQ-626
 * @intent The DIP rule reported the CLASS DECLARATION line for every instantiation
 *         violation. A 200-line class with one `new Foo()` on line 187 therefore
 *         pointed the developer at line 1 -- the message named the right file and
 *         the wrong place, which is the least useful combination: it looks
 *         actionable and is not.
 *
 *         The adapter reports only where a class begins; the position of the `new`
 *         expression inside the body is the rule's own information to compute. The
 *         offset of the match within the class body is added to the class's
 *         starting line, including newlines, because a match may span
 *         `new Foo(\n  arg,\n)`.
 *
 *         Two behaviours worth pinning because they are easy to get wrong in the
 *         other direction:
 *           - an adapter that cannot report a line (0) must keep 0, not fall back
 *             to 1 or to the file's first line -- a fabricated line 1 reads as a
 *             real location;
 *           - exempt classes (factories, builders, the configured allow-list) must
 *             still be skipped, since the line fix touches the iteration.
 * @covers AC-670-27, AC-670-28
 */
import { describe, it, expect } from 'vitest';
import { dipRule } from '../rules/solid/dip';
import type { Adapter } from '../types';

/** Minimal adapter stub: `extractClasses` is all the DIP rule consumes. */
function adapterWith(code: string, line: number): Adapter {
  return {
    extractClasses: () => [{ code, line }],
  } as unknown as Adapter;
}

describe('solid.dip reports the instantiation line, not the class line (#626)', () => {
  it('AC-670-27: points at the `new` expression inside the class body', () => {
    // Class starts at line 10; the instantiation is on the 5th line of the body,
    // i.e. source line 14.
    const body = [
      'class Svc {',            // body line 0 -> source 10
      '  private dep: Dep;',    // 1 -> 11
      '',                       // 2 -> 12
      '  constructor() {',      // 3 -> 13
      '    this.dep = new RealDep();', // 4 -> 14
      '  }',
      '}',
    ].join('\n');

    const violations = dipRule.check('src/svc.ts', adapterWith(body, 10));
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleId).toBe('solid.dip');
    expect(violations[0].message).toContain('new RealDep()');
    // The defect: this used to be 10 (the class line).
    expect(violations[0].line).toBe(14);
  });

  it('AC-670-28: a multi-line `new` counts the newline it spans, and an unknown class line stays 0', () => {
    const body = [
      'class Svc {',
      '  constructor() {',
      '    this.dep = new RealDep(',
      '      one,',
      '      two,',
      '    );',
      '  }',
      '}',
    ].join('\n');

    const violations = dipRule.check('src/svc.ts', adapterWith(body, 30));
    // `new RealDep(` opens on body line 2 -> source 32; the following arguments do
    // not move the reported location.
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(32);

    // No known class line -> 0, never a fabricated 1.
    const unknown = dipRule.check('src/svc.ts', adapterWith('class S { x = new Foo(); }', 0));
    expect(unknown).toHaveLength(1);
    expect(unknown[0].line).toBe(0);

    // An exempt class is still skipped (factories/builders are how the DIP smell is
    // legitimately avoided).
    const exempt = dipRule.check('src/svc.ts', adapterWith('class S { f = new WidgetFactory(); }', 5));
    expect(exempt).toHaveLength(0);
  });
});
