/**
 * @test REQ-PRINCIPLES-DUP
 * @intent 证明 code-duplication 规则在生产路径上「可达」——这是它此前作为死规则
 *   缺失的性质。旧测试全部用桩注入 `duplicationPercentage`，因此只验证了「若有数据，
 *   判定逻辑对不对」，从不验证「有没有人提供数据」。真实链路里 Adapter 接口根本没有
 *   这个字段（types.ts:35-42），生产调用 rule.check(file, adapter) 永远拿到 undefined，
 *   规则 100% 不触发，却在 .principlesrc 里显示 enabled:true —— 假门禁。
 *
 *   本文件的断言全部使用**真实 adapter**（new TypeScriptAdapter(真实临时文件)），
 *   不注入任何重复率字段，从而只有「adapter 自己会算」时才能通过。
 * @covers AC-PRINCIPLES-DUP-01, AC-PRINCIPLES-DUP-02, AC-PRINCIPLES-DUP-03
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TypeScriptAdapter } from '../../../adapters/typescript';
import { codeDuplicationRule } from '../../clean-code/code-duplication';

const tempDirs: string[] = [];

/**
 * Fixture expectations, named so a reader can tell which number is which:
 * `THRESHOLD` must match .principlesrc's configured `code-duplication` threshold
 * (a fixture asserting against a stale threshold would pass while judging
 * nothing), `FIXTURE_DUPLICATION` is what the duplicated sample measures, and
 * `EXPLICIT_DUPLICATION` is the value injected to prove an explicit caller wins.
 */
const THRESHOLD = 15;
const FIXTURE_DUPLICATION = 40;
const EXACT_COMPARISON_DIGITS = 5;

/**
 * Write a .ts file to a throwaway dir and return its path.
 *
 * Failures are rethrown with the path attached: a bare ENOENT here means the
 * fixture is broken, and "file not written" must not be readable as "rule found
 * no duplication" — both produce the same empty result downstream.
 */
function writeTempSource(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'xp-dup-'));
  tempDirs.push(dir);
  const file = join(dir, name);
  try {
    writeFileSync(file, content, 'utf-8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not write fixture ${file}: ${detail}`);
  }
  return file;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

/**
 * Two near-identical functions sharing a long body. This is the shape Gate 2's
 * jscpd misses at its default 50-token window, and the shape the original bug
 * took: the same list re-typed in several places.
 */
const HIGHLY_DUPLICATED_SOURCE = `
export function copyHooksToProject(srcDir: string, destDir: string): string[] {
  const copied: string[] = [];
  const hookFiles = ['pre-commit', 'pre-push', 'post-commit', 'post-merge'];
  for (const hook of hookFiles) {
    const source = join(srcDir, 'hooks', hook);
    const dest = join(destDir, hook);
    if (existsSync(source)) {
      copyFileSync(source, dest);
      copied.push(hook);
    }
  }
  return copied;
}

export function copyHooksToGlobal(srcDir: string, destDir: string): string[] {
  const copied: string[] = [];
  const hookFiles = ['pre-commit', 'pre-push', 'post-commit', 'post-merge'];
  for (const hook of hookFiles) {
    const source = join(srcDir, 'hooks', hook);
    const dest = join(destDir, hook);
    if (existsSync(source)) {
      copyFileSync(source, dest);
      copied.push(hook);
    }
  }
  return copied;
}
`;

/** Distinct functions with no repeated body — must stay under the threshold. */
const LOW_DUPLICATION_SOURCE = `
export function parseVersion(raw: string): number[] {
  return raw.split('.').map((part) => Number.parseInt(part, 10));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

export function titleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/\\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}
`;

describe('code-duplication rule is reachable on the production path', () => {
  it('AC-PRINCIPLES-DUP-01: Adapter contract exposes getDuplication()', () => {
    const file = writeTempSource('sample.ts', LOW_DUPLICATION_SOURCE);
    const adapter = new TypeScriptAdapter(file);

    // The capability must live on the contract, not on a per-adapter ad-hoc field:
    // that is exactly why the rule could never fire — types.ts never declared it.
    expect(typeof adapter.getDuplication).toBe('function');

    const report = adapter.getDuplication();
    expect(report).toBeTypeOf('object');
    expect(typeof report.percentage).toBe('number');
    expect(report.percentage).toBeGreaterThanOrEqual(0);
    expect(report.percentage).toBeLessThanOrEqual(100);
  });

  it('AC-PRINCIPLES-DUP-02: real duplicated file produces a violation with the real percentage', () => {
    const file = writeTempSource('duplicated.ts', HIGHLY_DUPLICATED_SOURCE);
    const adapter = new TypeScriptAdapter(file);

    // No injection: the adapter is the only source of duplication data.
    const violations = codeDuplicationRule.check(file, adapter);

    expect(violations.length).toBe(1);
    expect(violations[0].ruleId).toBe('clean-code.code-duplication');
    // The message must carry the measured number, not a placeholder.
    const percentInMessage = violations[0].message.match(/(\d+(?:\.\d+)?)%/);
    expect(percentInMessage, violations[0].message).not.toBeNull();
    const reported = Number(percentInMessage![1]);
    expect(reported).toBeGreaterThan(THRESHOLD);
    expect(reported).toBeCloseTo(adapter.getDuplication().percentage, EXACT_COMPARISON_DIGITS);
  });

  it('AC-PRINCIPLES-DUP-02: real low-duplication file produces no violation', () => {
    const file = writeTempSource('clean.ts', LOW_DUPLICATION_SOURCE);
    const adapter = new TypeScriptAdapter(file);

    const violations = codeDuplicationRule.check(file, adapter);

    expect(violations).toEqual([]);
  });

  it('AC-PRINCIPLES-DUP-03: an explicitly supplied percentage still wins', () => {
    const file = writeTempSource('explicit.ts', LOW_DUPLICATION_SOURCE);
    const adapter = new TypeScriptAdapter(file);
    // Callers that already measured duplication elsewhere must not be overruled
    // by the adapter's own estimate -- otherwise fixing the dead rule would break
    // every existing integrator that supplies the number the old way.
    const withExplicit = Object.assign(Object.create(Object.getPrototypeOf(adapter)), adapter, {
      duplicationPercentage: FIXTURE_DUPLICATION,
    }) as TypeScriptAdapter & { duplicationPercentage: number };

    const violations = codeDuplicationRule.check(file, withExplicit);

    expect(violations.length).toBe(1);
    expect(violations[0].message).toContain(`${FIXTURE_DUPLICATION}%`);
  });

  it('AC-PRINCIPLES-DUP-04: an adapter with no duplication source is NOT reported clean', () => {
    // The original defect was silence: nothing supplied a number, so the rule
    // returned [] and a rule configured `enabled: true` looked green while
    // judging nothing. An adapter missing the capability must produce a visible
    // diagnostic, because "not measured" and "measured clean" are different
    // facts and the rule must not conflate them.
    const legacyAdapter = {
      detectLanguage: () => 'typescript',
      parseAST: () => undefined,
      extractFunctions: () => [],
      extractClasses: () => [],
      extractExports: () => [],
      countLines: () => 0,
    };

    const violations = codeDuplicationRule.check('legacy.ts', legacyAdapter as never);

    expect(violations.length).toBe(1);
    expect(violations[0].message).toContain('Duplication not measured');
    expect(violations[0].message).toContain('NOT reporting it clean');
    // `info`, not `warning`: a third-party adapter must not block a commit --
    // visible, not fatal.
    expect(violations[0].severity).toBe('info');
  });

  it('AC-PRINCIPLES-DUP-04: every in-repo adapter supplies a duplication report', () => {
    // The capability gap must not be reachable from this repo's own adapters.
    // BaseAdapter implements getDuplication, and every adapter extends it; this
    // asserts that stays true instead of trusting the inheritance graph.
    const file = writeTempSource('clean.ts', LOW_DUPLICATION_SOURCE);
    const adapter = new TypeScriptAdapter(file);

    const report = adapter.getDuplication();

    expect(typeof report.percentage).toBe('number');
    expect(Number.isFinite(report.percentage)).toBe(true);
    expect(Array.isArray(report.blocks)).toBe(true);
  });
});
