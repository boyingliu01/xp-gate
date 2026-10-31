/**
 * @test position-analysis
 * @intent The extraction regexes match `name(` for both a method declaration and
 *         a call. `isCallPosition` is what tells them apart -- without it
 *         `if (existsSync(p))` is extracted as a method named existsSync and
 *         produces a warning no real edit can clear.
 * @covers AC-674-01
 */
import { describe, it, expect } from 'vitest';
import { isCallPosition } from '../position-analysis';

describe('position-analysis', () => {
  it('AC-674-01: detects an identifier in call position', () => {
    const src = 'if (existsSync(path)) {';
    expect(isCallPosition(src, src.indexOf('existsSync'))).toBe(true);
    // A second call in a list is also call position.
    const list = 'foo(a, bar(b))';
    expect(isCallPosition(list, list.indexOf('bar'))).toBe(true);
  });

  it('AC-674-01: a declaration at line start is not call position (anti-vacuity)', () => {
    const src = '\n  method(a: number): void {';
    expect(isCallPosition(src, src.indexOf('method'))).toBe(false);
    // Same for a method following a closing brace.
    const after = '  }\n  another(): void {';
    expect(isCallPosition(after, after.indexOf('another'))).toBe(false);
  });
});
