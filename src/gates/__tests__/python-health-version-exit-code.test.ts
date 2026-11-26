/**
 * @test REQ-PYTHON-HEALTH-VERSION-EXIT-CODE
 * @intent A tool whose `--version` FAILED must not be reported as available.
 *
 *         `versionViaExecutable` returned `versionFrom(result)` without consulting the
 *         result's status, while the sibling `versionViaInterpreter` two functions above checked
 *         `exitCode === 0`. A tool that crashed, or timed out, was therefore "available"
 *         whenever a version-looking string reached stdout or stderr -- precisely the runs
 *         whose banner says least about the tool working (review FC-02).
 *
 *         This asserts against the SOURCE because the helper is private and its caller
 *         does real process IO. That is weaker than calling it, and it is the property that
 *         matters: two functions asking the same question must answer it the same way.
 *
 * @covers AC-PYTHON-HEALTH-VERSION-EXIT-CODE-01
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = readFileSync(join(process.cwd(), 'src/gates/python-health.ts'), 'utf8');

/** The body of a named function, by brace-free line scan. */
function bodyOf(name: string): string {
  const start = SOURCE.indexOf(`function ${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = SOURCE.indexOf('\nfunction ', start + 1);
  return SOURCE.slice(start, next === -1 ? SOURCE.length : next);
}

describe('python-health version probes', () => {
  it('versionViaInterpreter refuses a non-zero exit', () => {
    expect(bodyOf('versionViaInterpreter')).toMatch(/exitCode\s*===\s*0/);
  });

  it('versionViaExecutable refuses a non-zero exit too', () => {
    const body = bodyOf('versionViaExecutable');
    expect(body).toMatch(/exitCode\s*!==\s*0/);
    expect(body).toMatch(/timedOut/);
  });
});
