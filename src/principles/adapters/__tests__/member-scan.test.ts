/**
 * @test member-scan
 * @intent `countTopLevelMembers` decides what `solid.srp` and `clean-code.god-class`
 *         grade, so a wrong count grades classes against an invented number. It
 *         counts by brace depth rather than by the character before the name,
 *         because `{ helper(1); }` (a call) and `{ async run() { ... }` (a
 *         member) look identical from the left. Input is the MASKED class body,
 *         with comments already blanked.
 * @covers AC-680-01, AC-680-02
 */
import { describe, it, expect } from 'vitest';
import { claimMember, countTopLevelMembers } from '../member-scan';

describe('countTopLevelMembers', () => {
  it('AC-680-01: declares members only, not calls inside method bodies', () => {
    const body = [
      '{',
      '  run(): void { if (existsSync("p")) { helper(1); } }',
      '  stop(): void { return this.halt(); }',
      '}',
    ].join('\n');

    expect(countTopLevelMembers(body)).toEqual(['run', 'stop']);
  });

  it('AC-680-01: control keywords are not members', () => {
    const body = '{ if (x) { } for (;;) { } }';
    expect(countTopLevelMembers(body)).toEqual([]);
  });

  it('AC-680-02: modifiers and accessors are stripped to the name', () => {
    const body = [
      '{',
      '  private async load(): Promise<void> { }',
      '  get size(): number { return 0; }',
      '  static *items(): void { }',
      '}',
    ].join('\n');

    const names = countTopLevelMembers(body);
    expect(names).toContain('load');
    expect(names).toContain('size');
    expect(names).toContain('items');
  });

  it('AC-680-02: a class with no members counts zero (anti-vacuity)', () => {
    expect(countTopLevelMembers('{ }')).toEqual([]);
  });
});

describe('claimMember', () => {
  it('AC-680-01: the same name@offset is claimed once', () => {
    const seen = new Set<string>();
    expect(claimMember(seen, 'run', 10)).toBe(true);
    expect(claimMember(seen, 'run', 10)).toBe(false);
  });

  it('AC-680-02: same name at a different offset is a different declaration', () => {
    const seen = new Set<string>();
    expect(claimMember(seen, 'run', 10)).toBe(true);
    expect(claimMember(seen, 'run', 99)).toBe(true);
  });
});
