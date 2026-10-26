/**
 * @test REQ-620
 * @intent Pin mergeRule's mistyped-override handling, which had NO coverage
 *         before this change: nothing asserted the warning text or the
 *         keep-the-default outcome for a bad .principlesrc value. That gap
 *         meant the four per-key loops could be consolidated into one guarded
 *         loop without any test noticing, so these tests are what makes the
 *         consolidation verifiable rather than merely plausible.
 *
 *         Two properties per key category:
 *           1. a correctly-typed override is applied;
 *           2. a mistyped one is REJECTED and the default survives, with a
 *              warning naming the rule and the key.
 *         Property 2 is the one with teeth: silently accepting a bad value
 *         would let a project believe it tightened a gate.
 *
 *         .principlesrc is JSON (config.ts parses it with JSON.parse), so the
 *         fixtures are JSON objects rather than YAML text.
 * @covers AC-620-05
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, getDefaultConfig } from '../config';

let tmpDirs: string[] = [];
let warnings: string[];

beforeEach(() => {
  tmpDirs = [];
  warnings = [];
  // config.ts reports through process.stderr.write, not console.warn, so the
  // spy has to sit on the stream. (Mocking console.warn instead silently
  // captured nothing and made every "must warn" assertion look like a bug.)
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    warnings.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function warnText(): string {
  return warnings.join('\n');
}

/** Default value of one key on `clean-code.long-function`. */
function defaultFor(key: string): unknown {
  const rule = getDefaultConfig().rules['clean-code']['long-function'] as unknown as Record<string, unknown>;
  return rule[key];
}

/** Write a .principlesrc from RAW JSON text and load it unchanged. */
async function loadRaw(jsonText: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-cfg-'));
  tmpDirs.push(dir);
  const cfgPath = path.join(dir, '.principlesrc');
  fs.writeFileSync(cfgPath, jsonText, 'utf8');
  return loadConfig(cfgPath);
}

/** Write a .principlesrc overriding `clean-code.long-function` and load it. */
async function loadWithRule(overrides: Record<string, unknown>) {
  return loadRaw(JSON.stringify({ rules: { 'clean-code': { 'long-function': overrides } } }));
}

describe('AC-620-05: a mistyped rule override keeps the default and warns', () => {
  it('accepts a well-typed numeric override (threshold)', async () => {
    const merged = await loadWithRule({ threshold: 12 });
    expect(merged.rules['clean-code']['long-function'].threshold).toBe(12);
    expect(warnText()).not.toMatch(/threshold/);
  });

  it('rejects a non-numeric threshold and keeps the default', async () => {
    const merged = await loadWithRule({ threshold: 'not-a-number' });
    expect(merged.rules['clean-code']['long-function'].threshold).toBe(defaultFor('threshold'));
    expect(warnText()).toMatch(/threshold/);
  });

  it('rejects a non-finite threshold and keeps the default', async () => {
    // A guard that only checks `typeof value === 'number'` would accept these
    // and compare every function against NaN (or Infinity, which nothing ever
    // exceeds -- silently disabling the rule).
    //
    // These literals have to be written as raw JSON TEXT: JSON.stringify turns
    // NaN and Infinity into `null`, so handing them to the object-based helper
    // would inject null and the test would pass against a broken guard. That
    // exact mistake made the first version of this test vacuous.
    const fallback = defaultFor('threshold');
    for (const literal of ['1e999', '-1e999']) {
      warnings = [];
      const merged = await loadRaw(
        `{"rules":{"clean-code":{"long-function":{"threshold":${literal}}}}}`,
      );
      expect(merged.rules['clean-code']['long-function'].threshold).toBe(fallback);
      expect(warnText()).toMatch(/threshold/);
    }
  });

  it('accepts a well-typed array override (exclude)', async () => {
    const merged = await loadWithRule({ exclude: ['**/skip.ts'] });
    expect(merged.rules['clean-code']['long-function'].exclude).toEqual(['**/skip.ts']);
  });

  it('rejects a scalar where an array is expected and keeps the default', async () => {
    const merged = await loadWithRule({ exclude: '**/skip.ts' });
    expect(merged.rules['clean-code']['long-function'].exclude).toEqual(defaultFor('exclude'));
    expect(warnText()).toMatch(/exclude/);
  });

  it('copies the accepted array instead of aliasing the parsed one', async () => {
    // mergeRule spreads array candidates; sharing the reference would let a
    // later mutation of the caller's array leak into the active config.
    const source = ['**/skip.ts'];
    const merged = await loadWithRule({ exclude: source });
    expect(merged.rules['clean-code']['long-function'].exclude).not.toBe(source);
    expect(merged.rules['clean-code']['long-function'].exclude).toEqual(source);
  });

  it('accepts a well-typed enum override (severity)', async () => {
    const merged = await loadWithRule({ severity: 'error' });
    expect(merged.rules['clean-code']['long-function'].severity).toBe('error');
  });

  it('rejects an out-of-vocabulary severity and keeps the default', async () => {
    // The dangerous case: a project writes a severity it believes is blocking
    // but misspells it. Silently keeping the default would let that belief stand.
    const merged = await loadWithRule({ severity: 'fatal' });
    expect(merged.rules['clean-code']['long-function'].severity).toBe(defaultFor('severity'));
    expect(warnText()).toMatch(/severity/);
  });

  it('rejects a non-boolean enabled flag and keeps the default', async () => {
    const merged = await loadWithRule({ enabled: 'yes' });
    expect(typeof merged.rules['clean-code']['long-function'].enabled).toBe('boolean');
    expect(warnText()).toMatch(/enabled/);
  });

  it('names the offending rule and key in the warning', async () => {
    await loadWithRule({ severity: 'fatal' });
    expect(warnText()).toContain('long-function');
    expect(warnText()).toContain('severity');
  });
});
