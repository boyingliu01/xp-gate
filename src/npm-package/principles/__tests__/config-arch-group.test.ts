/**
 * @test REQ-726
 * @intent 新增 `arch` 配置分组不得破坏既有用户配置。老项目的 .principlesrc 只写了
 *         clean-code / solid 两个键，加载后 arch 必须取默认值而不是报错或变 undefined,
 *         否则升级即崩，用户不会去读变更日志。
 * @covers AC-COMPAT-01 AC-COMPAT-02
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig } from '../config';

/** Chosen to differ from every built-in default, so "it came from the file" is provable. */
const CUSTOM_LONG_FUNCTION_THRESHOLD = 80;
/** Likewise: no built-in large-file threshold is 900. */
const CUSTOM_LARGE_FILE_THRESHOLD = 900;

const dirs: string[] = [];

/** Write a `.principlesrc` in a throwaway directory and return its path. */
function configWith(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'xp-gate-arch-cfg-'));
  dirs.push(dir);
  const file = join(dir, '.principlesrc');
  try {
    writeFileSync(file, JSON.stringify(contents), 'utf-8');
  } catch (error) {
    throw new Error(`failed to write fixture .principlesrc: ${String(error)}`);
  }
  return file;
}

// Fixtures are built as named step-wise objects rather than deep inline literals:
// the `deep-nesting` rule counts every brace, so a 4-level config literal nested
// inside a call reads as 5 levels.
const LONG_FUNCTION_OVERRIDE = { threshold: CUSTOM_LONG_FUNCTION_THRESHOLD };
const LEGACY_ONLY_RULES = { 'clean-code': { 'long-function': LONG_FUNCTION_OVERRIDE } };

const UTIL_SERVICE_OVERRIDE = { severity: 'info' };
const PARTIAL_ARCH_RULES = { arch: { 'util-service': UTIL_SERVICE_OVERRIDE } };

const LARGE_FILE_OVERRIDE = { threshold: CUSTOM_LARGE_FILE_THRESHOLD };
const MISSPELT_GROUP_RULES = {
  archx: { whatever: { severity: 'error' } },
  'clean-code': { 'large-file': LARGE_FILE_OVERRIDE },
};

/** A config that only touches a pre-existing group, as an old user's file would. */
function legacyOnlyConfig(): string {
  return configWith({ rules: LEGACY_ONLY_RULES });
}

/** A config whose only arch entry is `util-service`. */
function partialArchConfig(): string {
  return configWith({ rules: PARTIAL_ARCH_RULES });
}

/** A config with a misspelt group name plus one real clean-code override. */
function typoGroupConfig(): string {
  return configWith({ rules: MISSPELT_GROUP_RULES });
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('AC-COMPAT-01 — 老配置（无 arch 键）照样工作', () => {
  it('只含 clean-code / solid 时，arch 分组取默认值且不报错', async () => {
    const config = await loadConfig(legacyOnlyConfig());

    // The two pre-existing groups keep behaving as before...
    expect(config.rules['clean-code']['long-function'].threshold)
      .toBe(CUSTOM_LONG_FUNCTION_THRESHOLD);
    expect(config.rules['solid'].srp).toBeDefined();
    // ...and the new group is fully populated from defaults.
    expect(config.rules.arch.controller.severity).toBe('error');
    expect(config.rules.arch['util-service'].severity).toBe('warning');
  });

  it('arch 分组存在但只写了一条时，其余仍取默认值', async () => {
    const config = await loadConfig(partialArchConfig());

    expect(config.rules.arch['util-service'].severity).toBe('info');
    // Siblings are NOT wiped by the partial block -- that fail-open shape is
    // what mergeGroup exists to prevent.
    expect(config.rules.arch.controller.severity).toBe('error');
    expect(config.rules.arch['dto-layering'].severity).toBe('error');
  });
});

describe('AC-COMPAT-02 — 未知分组不崩溃也不吞掉已知分组', () => {
  it('拼错的分组名（archx）不影响 clean-code / solid / arch 的加载', async () => {
    const config = await loadConfig(typoGroupConfig());

    // The known groups still load...
    expect(config.rules['clean-code']['large-file'].threshold)
      .toBe(CUSTOM_LARGE_FILE_THRESHOLD);
    expect(config.rules.arch.controller.severity).toBe('error');
    // ...and the typo does not become a real group.
    expect((config.rules as Record<string, unknown>).archx).toBeUndefined();
  });
});
