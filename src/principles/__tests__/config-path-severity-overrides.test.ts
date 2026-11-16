/**
 * @test REQ-806
 * @intent Gate 4's blocking power is decided entirely by a rule's `severity` in
 *         `.principlesrc`, and severity was a single global value per rule. That
 *         made two legitimate needs impossible to express at once:
 *
 *           - promote a rule to `error` so production code actually blocks, and
 *           - keep the same rule advisory inside `__tests__/`, where the finding
 *             is usually a lower-value style complaint.
 *
 *         Measured on this repo with the four rules promoted to `error`:
 *         271 findings, of which 220 (81%) were in 64 test files -- so enabling
 *         production blocking would have blocked almost every test-file edit.
 *         The only escape was demoting the rule globally, which re-opens the
 *         original defect (a gate that cannot fail).
 *
 *         `overrides` adds a path-scoped severity layer. It CANNOT loosen a rule
 *         below what the project declared for production code by accident, and it
 *         never suppresses a violation -- the finding is still reported, only its
 *         severity changes for matching paths.
 * @covers AC-806-10, AC-806-11, AC-806-12, AC-806-13
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveConfig,
  loadConfig,
  resetActiveConfig,
  resolveSeverityForFile,
  setActiveConfig,
} from '../config';

let workDir: string;

// A write that fails silently would turn every assertion downstream of it into a
// test of a stale temp file, so re-raise with the path that could not be written.
function writeConfig(relPath: string, content: unknown): string {
  const full = join(workDir, relPath);
  try {
    writeFileSync(full, JSON.stringify(content, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`failed to write test config to ${full}: ${String(error)}`);
  }
  return full;
}

describe('path-scoped severity overrides (#806)', () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'principles-overrides-'));
  });

  afterEach(() => {
    resetActiveConfig();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('AC-806-10: demotes a rule only for files matching the override paths', async () => {
    const cfgPath = writeConfig('.principlesrc', {
      rules: {
        'clean-code': {
          'missing-error-handling': { enabled: true, severity: 'error' },
        },
      },
      overrides: [
        {
          paths: ['**/__tests__/**'],
          rules: { 'clean-code.missing-error-handling': 'warning' },
        },
      ],
    });
    setActiveConfig(await loadConfig(cfgPath));

    expect(
      resolveSeverityForFile('clean-code.missing-error-handling', 'src/__tests__/a.test.ts', 'error')
    ).toBe('warning');
    // Production path keeps the declared severity.
    expect(
      resolveSeverityForFile('clean-code.missing-error-handling', 'src/app/service.ts', 'error')
    ).toBe('error');
  });

  it('AC-806-11: multiple path globs and multiple rules in one override', async () => {
    const cfgPath = writeConfig('.principlesrc', {
      overrides: [
        {
          paths: ['**/__tests__/**', '**/*.test.ts', '**/*.spec.ts'],
          rules: {
            'clean-code.missing-error-handling': 'warning',
            'clean-code.code-duplication': 'warning',
          },
        },
      ],
    });
    setActiveConfig(await loadConfig(cfgPath));

    for (const file of ['src/__tests__/x.ts', 'src/a.test.ts', 'src/b.spec.ts']) {
      expect(resolveSeverityForFile('clean-code.missing-error-handling', file, 'error')).toBe(
        'warning'
      );
    }
    expect(
      resolveSeverityForFile('clean-code.missing-error-handling', 'src/prod/x.ts', 'error')
    ).toBe('error');
  });

  it('AC-806-12: does not promote a rule above its configured severity', async () => {
    // An override may only relax. If a later override says "error" for a path
    // whose rule is declared "warning", the declaration wins -- otherwise a
    // stray glob could turn an advisory rule into a blocker.
    const cfgPath = writeConfig('.principlesrc', {
      rules: {
        'clean-code': { 'long-function': { enabled: true, severity: 'warning' } },
      },
      overrides: [
        { paths: ['**/__tests__/**'], rules: { 'clean-code.long-function': 'error' } },
      ],
    });
    setActiveConfig(await loadConfig(cfgPath));

    expect(resolveSeverityForFile('clean-code.long-function', 'src/__tests__/a.ts', 'warning')).toBe(
      'warning'
    );
  });

  it('AC-806-13: normalises Windows separators and absolute paths', async () => {
    const cfgPath = writeConfig('.principlesrc', {
      overrides: [
        { paths: ['**/__tests__/**'], rules: { 'clean-code.code-duplication': 'warning' } },
      ],
    });
    setActiveConfig(await loadConfig(cfgPath));

    // Gate 4 receives native paths on Windows; the glob is written POSIX-style.
    expect(
      resolveSeverityForFile(
        'clean-code.code-duplication',
        'C:\\repo\\src\\__tests__\\a.ts',
        'error'
      )
    ).toBe('warning');
    expect(
      resolveSeverityForFile('clean-code.code-duplication', 'C:/repo/src/__tests__/a.ts', 'error')
    ).toBe('warning');
  });

  it('AC-806-13: ignores malformed overrides instead of crashing the gate', async () => {
    const cfgPath = writeConfig('.principlesrc', {
      overrides: [
        { paths: 'not-an-array', rules: { 'clean-code.long-function': 'warning' } },
        { paths: ['**/*.ts'] },
        { rules: { 'clean-code.long-function': 'warning' } },
        { paths: ['**/*.ts'], rules: { 'clean-code.long-function': 'not-a-severity' } },
      ],
    });
    // Must not throw: a config typo may not take Gate 4 down.
    await expect(loadConfig(cfgPath)).resolves.toBeDefined();
    setActiveConfig(await loadConfig(cfgPath));
    expect(resolveSeverityForFile('clean-code.long-function', 'src/a.ts', 'error')).toBe('error');
  });

  it('AC-806-10: the shipped config keeps production blocking and test files advisory', async () => {
    // Pins the actual repository decision: four rules block production code,
    // and the two that dominate test files are advisory there. If someone
    // removes the overrides, test edits start blocking and this fails first.
    // Explicit path, no process.chdir: vitest workers forbid chdir, and the
    // repo's own config is what this asserts.
    const repoConfig = join(__dirname, '..', '..', '..', '.principlesrc');
    setActiveConfig(await loadConfig(repoConfig));

    expect(getActiveConfig().overrides?.length ?? 0).toBeGreaterThan(0);
    expect(
      resolveSeverityForFile('clean-code.missing-error-handling', 'src/app/prod.ts', 'error')
    ).toBe('error');
    expect(
      resolveSeverityForFile('clean-code.missing-error-handling', 'src/app/__tests__/a.test.ts', 'error')
    ).toBe('warning');
  });
});
