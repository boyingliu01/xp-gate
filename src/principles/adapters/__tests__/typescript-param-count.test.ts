/**
 * @test REQ-TYPESCRIPT-PARAM-COUNT
 * @intent `countParams` must not treat a comma INSIDE a literal or a nested group as a
 *         parameter separator.
 *
 *         `deepensParamNesting` returns true for a quote without opening a state, which
 *         three reviewers read as "a comma inside a string is counted". It is not: the
 *         text reaching `countParams` has already been scanned by `readParenGroup`, so a
 *         quoted run is one opaque item. The behaviour was right and the COMMENT was
 *         misleading, which is why the cases below matter -- they make the behaviour
 *         checkable, so the next reader does not have to re-derive it from the diff.
 *
 * @covers AC-TYPESCRIPT-PARAM-COUNT-01
 */

import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TypeScriptAdapter } from '../typescript';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { require('node:fs').rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** The paramCount the adapter reports for the first function in `source`. */
function paramCountOf(source: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'ts-param-'));
  dirs.push(dir);
  const file = join(dir, 'f.ts');
  try {
    writeFileSync(file, source);
  } catch (err) {
    // A fixture that was never written would make the test pass over a file the adapter
    // cannot read -- the fail-open shape the production code is being fixed for.
    throw new Error(`cannot write the fixture: ${String(err)}`);
  }
  const fns = new TypeScriptAdapter(file).extractFunctions() as Array<{ paramCount: number }>;
  return fns[0].paramCount;
}

describe('TypeScript adapter param counting', () => {
  it('ignores commas inside a string default', () => {
    expect(paramCountOf('export function f(a: string = "1,2,3", b: number) { return 1; }')).toBe(2);
  });

  it('ignores commas inside an array default', () => {
    expect(paramCountOf('export function f(a = [1, 2], b: number) { return 1; }')).toBe(2);
  });

  it('ignores commas inside an object default', () => {
    expect(paramCountOf('export function f(a = { x: 1, y: 2 }, b: number) { return 1; }')).toBe(2);
  });

  it('counts an arrow function default as ONE parameter', () => {
    // `(x, y) => x + y` is a single value, so the list is `cb` and `d`.
    expect(paramCountOf('export function f(cb = (x, y) => x + y, d: number) { return 1; }')).toBe(2);
  });

  it('counts plain parameters normally', () => {
    expect(paramCountOf('export function f(a: string, b: number, c: boolean) { return 1; }')).toBe(3);
    expect(paramCountOf('export function f() { return 1; }')).toBe(0);
  });
});
