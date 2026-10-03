/**
 * @test REQ-457
 * @intent `.principlesrc` must actually change what Gate 4 enforces. The rule
 *         modules used to snapshot config at module load, so a project's
 *         threshold was silently ignored and the checker enforced the built-in
 *         default instead -- a fail-open gate.
 * @covers AC-457-01, AC-457-02, AC-457-03, AC-457-04, AC-457-05, AC-457-06, AC-457-07
 *
 * The pre-existing `config.test.ts` asserted only `expect(config).toBeDefined()`
 * for `loadConfig`, which is why the defect survived: the loader returned the
 * right object while nothing consumed it.
 *
 * These tests assert the *end-to-end* effect (an enforcement threshold changes),
 * not merely that a function returns a value.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveConfig,
  getDefaultConfig,
  loadConfig,
  resetActiveConfig,
  setActiveConfig,
} from '../config';
import { getAllRules } from '../index';
import type { Adapter, Violation } from '../types';

const tempDirs: string[] = [];

/** Built-in default for large-file, per config.ts. */
const DEFAULT_LARGE_FILE_THRESHOLD = 1150;
/** A threshold far below the default, so a short stub violates it. */
const TIGHT_THRESHOLD = 10;
/** A threshold far above any stub, so nothing violates it. */
const LOOSE_THRESHOLD = 100000;
/** The line count our adapter stub reports. */
const STUB_LINE_COUNT = 50;
/** A small override for long-function, distinct from its default of 50. */
const SHORT_THRESHOLD = 12;
/** Built-in default for solid.srp's methodThreshold. */
const DEFAULT_SRP_METHOD_THRESHOLD = 15;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xpgate-457-'));
  tempDirs.push(dir);
  return dir;
}

/** Write a `.principlesrc` fixture into a temp dir and return its path. */
function writeConfig(dir: string, contents: string): string {
  const configPath = join(dir, '.principlesrc');
  try {
    writeFileSync(configPath, contents, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not write fixture ${configPath}: ${detail}`);
  }
  return configPath;
}

/** A `.principlesrc` that sets one numeric threshold for one rule. */
function thresholdConfig(ruleId: string, threshold: number): string {
  const rule = { [ruleId]: { threshold } };
  return JSON.stringify({ rules: { 'clean-code': rule } });
}

/** A `.principlesrc` that sets one array-valued key for one rule. */
function arrayConfig(ruleId: string, key: string, values: number[]): string {
  const rule = { [ruleId]: { [key]: values } };
  return JSON.stringify({ rules: { 'clean-code': rule } });
}

/** Minimal adapter stub: reports a fixed line count so large-file is decidable. */
function adapterReportingLines(totalLines: number): Adapter {
  return {
    detectLanguage: () => 'typescript',
    parseAST: () => ({}),
    extractFunctions: () => [],
    extractClasses: () => [],
    extractExports: () => [],
    countLines: () => totalLines,
  };
}

/** Run the real large-file rule against a stub reporting `lines` lines. */
function checkLargeFile(lines: number): Violation[] {
  const rule = getAllRules().find(candidate => candidate.id === 'clean-code.large-file');
  if (!rule) throw new Error('clean-code.large-file rule is not registered');
  return rule.check('sample.ts', adapterReportingLines(lines));
}

afterEach(() => {
  resetActiveConfig();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

beforeEach(() => {
  resetActiveConfig();
});

describe('#457 .principlesrc actually changes enforcement', () => {
  it('AC-457-01: getActiveConfig/setActiveConfig expose the effective config', () => {
    const custom = getDefaultConfig();
    custom.rules['clean-code']['large-file'].threshold = TIGHT_THRESHOLD;
    setActiveConfig(custom);
    expect(getActiveConfig().rules['clean-code']['large-file'].threshold).toBe(TIGHT_THRESHOLD);
  });

  it('AC-457-01: resetActiveConfig restores the built-in defaults', () => {
    const custom = getDefaultConfig();
    custom.rules['clean-code']['large-file'].threshold = TIGHT_THRESHOLD;
    setActiveConfig(custom);
    resetActiveConfig();
    expect(getActiveConfig().rules['clean-code']['large-file'].threshold).toBe(
      DEFAULT_LARGE_FILE_THRESHOLD
    );
  });

  it('AC-457-01: getDefaultConfig returns a fresh copy each call', () => {
    // Regression guard: hoisting the defaults to module constants made
    // getDefaultConfig() hand out SHARED objects, so one caller's mutation
    // corrupted the defaults for every later caller in the process.
    const first = getDefaultConfig();
    first.rules['clean-code']['large-file'].threshold = TIGHT_THRESHOLD;
    first.rules['clean-code']['magic-numbers'].exclude = [0];

    const second = getDefaultConfig();
    expect(second.rules['clean-code']['large-file'].threshold).toBe(
      DEFAULT_LARGE_FILE_THRESHOLD
    );
    expect(second.rules['clean-code']['magic-numbers'].exclude).toContain(1024);
  });

  it('AC-457-02: the large-file rule honours the ACTIVE threshold, not the default', () => {
    // This is the defect's core: the module captured the default at import
    // time, so a lower project threshold had no effect.
    const strict = getDefaultConfig();
    strict.rules['clean-code']['large-file'].threshold = TIGHT_THRESHOLD;
    setActiveConfig(strict);

    // Below the default (1150) but above the configured 10.
    const violations = checkLargeFile(STUB_LINE_COUNT);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain(String(TIGHT_THRESHOLD));
  });

  it('AC-457-02: raising the threshold suppresses violations the default would report', () => {
    const relaxed = getDefaultConfig();
    relaxed.rules['clean-code']['large-file'].threshold = LOOSE_THRESHOLD;
    setActiveConfig(relaxed);

    expect(checkLargeFile(STUB_LINE_COUNT)).toHaveLength(0);
  });

  it('AC-457-04: `enabled: false` disables a rule (previously ignored everywhere)', () => {
    const disabled = getDefaultConfig();
    disabled.rules['clean-code']['large-file'].enabled = false;
    setActiveConfig(disabled);

    expect(checkLargeFile(STUB_LINE_COUNT)).toHaveLength(0);
  });

  it('AC-457-06: loadConfig reads a config from an explicit path', async () => {
    const configPath = writeConfig(makeTempDir(), thresholdConfig('large-file', 300));

    const config = await loadConfig(configPath);
    expect(config.rules['clean-code']['large-file'].threshold).toBe(300);
    // Unspecified fields keep their defaults (deep merge, not replacement).
    expect(config.rules['clean-code']['large-file'].severity).toBe('warning');
    expect(config.rules['clean-code']['long-function'].threshold).toBe(50);
  });

  it('AC-457-05: a partial override preserves the untouched rule group', async () => {
    // Regression guard: a shallow group-level spread would drop `solid`
    // entirely when the file only mentions `clean-code`.
    const raw = thresholdConfig('long-function', SHORT_THRESHOLD);
    const config = await loadConfig(writeConfig(makeTempDir(), raw));

    expect(config.rules['solid']['srp'].methodThreshold).toBe(DEFAULT_SRP_METHOD_THRESHOLD);
    expect(config.rules['solid']['dip'].enabled).toBe(true);
  });

  it('AC-457-05: an array override replaces rather than concatenates', async () => {
    const raw = arrayConfig('magic-numbers', 'exclude', [0, 1]);
    const config = await loadConfig(writeConfig(makeTempDir(), raw));

    expect(config.rules['clean-code']['magic-numbers'].exclude).toEqual([0, 1]);
  });

  it('AC-457-07: a malformed config falls back to defaults without throwing', async () => {
    const config = await loadConfig(writeConfig(makeTempDir(), '{ this is not json'));

    expect(config.rules['clean-code']['large-file'].threshold).toBe(DEFAULT_LARGE_FILE_THRESHOLD);
  });

  it('AC-457-07: a missing config path falls back to defaults without throwing', async () => {
    const config = await loadConfig(join(makeTempDir(), 'does-not-exist.json'));

    expect(config.rules['clean-code']['large-file'].threshold).toBe(DEFAULT_LARGE_FILE_THRESHOLD);
  });

  it('AC-457-07: a type-mismatched value keeps the default instead of poisoning it', async () => {
    const bad = thresholdConfig('large-file', 'not-a-number' as unknown as number);
    const config = await loadConfig(writeConfig(makeTempDir(), bad));

    expect(config.rules['clean-code']['large-file'].threshold).toBe(DEFAULT_LARGE_FILE_THRESHOLD);
  });

  it('AC-457-04: config read from disk is what the rule then enforces', async () => {
    // The end-to-end contract: load -> activate -> enforce.
    const configPath = writeConfig(makeTempDir(), thresholdConfig('large-file', 5));
    setActiveConfig(await loadConfig(configPath));

    expect(checkLargeFile(STUB_LINE_COUNT).length).toBeGreaterThan(0);
  });
});