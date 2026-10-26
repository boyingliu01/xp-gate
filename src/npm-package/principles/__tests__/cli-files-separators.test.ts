/**
 * @test REQ-623
 * @intent `--files` must accept the shapes a shell actually produces. CI passed
 *         `--files "$SRC_FILES"` -- one argument containing newline-separated
 *         paths -- and parseArgs split on spaces only, so the whole blob became
 *         a single impossible path. The run then had nothing to analyse and fell
 *         through to the console/empty path, writing "✓ No violations found"
 *         into a file named principles.sarif. The step exited 0, so for months
 *         the GitHub Security tab received a text file where SARIF was expected.
 *
 *         These tests pin the separator handling, not one call site: a fix that
 *         only changes the workflow leaves the next caller to hit the same trap.
 * @covers AC-623-01, AC-623-02, AC-623-03
 */

import { describe, it, expect } from 'vitest';
import { parseArgs } from '../index';

describe('AC-623-01: --files separates on any whitespace, not just spaces', () => {
  it('splits a newline-separated list (the CI shape)', () => {
    const opts = parseArgs(['--files', 'a.ts\nb.ts\nc.ts']);
    expect(opts.files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('splits a space-separated list', () => {
    const opts = parseArgs(['--files', 'a.ts b.ts']);
    expect(opts.files).toEqual(['a.ts', 'b.ts']);
  });

  it('splits a tab-separated list', () => {
    const opts = parseArgs(['--files', 'a.ts\tb.ts']);
    expect(opts.files).toEqual(['a.ts', 'b.ts']);
  });

  it('drops the blank entries a trailing separators leave behind', () => {
    const opts = parseArgs(['--files', 'a.ts\n\nb.ts\n']);
    expect(opts.files).toEqual(['a.ts', 'b.ts']);
  });

  it('keeps a single path intact', () => {
    const opts = parseArgs(['--files', 'src/one.ts']);
    expect(opts.files).toEqual(['src/one.ts']);
  });
});

describe('AC-623-02: a flag after --files is still parsed', () => {
  it('reads --format sarif that follows a multi-line --files value', () => {
    const opts = parseArgs(['--files', 'a.ts\nb.ts', '--format', 'sarif']);
    expect(opts.format).toBe('sarif');
    expect(opts.files).toEqual(['a.ts', 'b.ts']);
  });

  it('reads --format when it comes before --files', () => {
    const opts = parseArgs(['--format', 'sarif', '--files', 'a.ts\nb.ts']);
    expect(opts.format).toBe('sarif');
  });
});

describe('AC-623-03: positional paths still accumulate', () => {
  it('collects bare paths given without --files', () => {
    const opts = parseArgs(['a.ts', 'b.ts']);
    expect(opts.files).toEqual(['a.ts', 'b.ts']);
  });

  it('accepts --files alongside positional paths', () => {
    const opts = parseArgs(['--files', 'a.ts\nb.ts', 'c.ts']);
    expect(opts.files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});
