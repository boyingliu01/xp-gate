/**
 * @test REQ-679
 * @intent `clean-code.missing-error-handling` asks "does this function handle
 *         failures?". The adapter answered only "does it contain try/catch",
 *         which is wrong for the most failure-prone code in this repo: a
 *         function that owns a child process. Node reports spawn failures
 *         through an `'error'` event, so a `try` around `spawn()` would never see
 *         them and the listener is the ONLY correct handler. Reporting such code
 *         produced a warning no correct edit could clear -- the way a rule
 *         stops meaning anything.
 * @covers AC-679-01, AC-679-02
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { TypeScriptAdapter } from '../typescript';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn() };
});

interface FnFact { name: string; ioOperations: string[]; hasTryCatch: boolean }

/** Extract the function facts for one source body. */
function factsFor(code: string): FnFact[] {
  (readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(code);
  const adapter = new TypeScriptAdapter('probe.ts');
  const fns = (adapter as unknown as { extractFunctions: () => FnFact[] }).extractFunctions();
  return fns.filter((f) => f.ioOperations.length > 0);
}

describe('error handling is not only try/catch (REQ-679)', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReset();
  });

  it('AC-679-01: an `error` event listener counts as handled', () => {
    const facts = factsFor([
      'function launch(): Promise<void> {',
      '  return new Promise((resolve) => {',
      '    const child = spawn("cmd", []);',
      '    child.on("error", (err) => resolve());',
      '  });',
      '}',
    ].join('\n'));

    expect(facts).toHaveLength(1);
    expect(facts[0].hasTryCatch).toBe(true);
  });

  it('AC-679-01: single quotes work too', () => {
    const facts = factsFor([
      'function launch(): void {',
      '  const child = spawn("cmd", []);',
      "  child.on('error', () => {});",
      '}',
    ].join('\n'));

    expect(facts[0].hasTryCatch).toBe(true);
  });

  it('AC-679-02: a spawn with no handler is still reported (anti-vacuity)', () => {
    const facts = factsFor([
      'function launch(): void {',
      '  const child = spawn("cmd", []);',
      '}',
    ].join('\n'));

    expect(facts).toHaveLength(1);
    expect(facts[0].hasTryCatch).toBe(false);
  });

  it('AC-679-02: a bare mention of the word error is not a handler', () => {
    // The listener is matched as a quoted ARGUMENT; a thrown string or a log
    // line must not qualify, or the rule would go quiet on real gaps.
    const facts = factsFor([
      'function launch(): void {',
      '  const child = spawn("cmd", []);',
      '  throw new Error("error");',
      '  console.log("on error restart");',
      '}',
    ].join('\n'));

    expect(facts[0].hasTryCatch).toBe(false);
  });
});
