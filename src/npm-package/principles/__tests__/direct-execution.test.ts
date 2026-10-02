/**
 * @test REQ-DSH-012
 * @intent 验证 CLI 入口的直接执行判据在 Windows 路径下成立：`isDirectExecution()`
 *         必须用 pathToFileURL() 规范化路径，而不是字符串拼接 `file://${argv[1]}`，
 *         否则 win32 下 `file://D:\a\b.ts` 与 `import.meta.url`（`file:///D:/a/b.ts`）
 *         永不相等，Gate 4 永远静默通过（缺陷 #444）
 * @covers AC-DSH-012-01
 */

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { isDirectExecution } from '../index';

describe('isDirectExecution (Gate 4 CLI entry detection)', () => {
  describe('Windows paths (#444)', () => {
    it('matches a backslash Windows argv[1] against its import.meta.url', () => {
      const argv1 = 'D:\\projects\\xp-gate\\src\\principles\\index.ts';
      const metaUrl = pathToFileURL(argv1).href;

      expect(isDirectExecution(argv1, metaUrl)).toBe(true);
    });

    it('matches a forward-slash Windows argv[1]', () => {
      const argv1 = 'D:/projects/xp-gate/src/principles/index.ts';
      const metaUrl = pathToFileURL(argv1).href;

      expect(isDirectExecution(argv1, metaUrl)).toBe(true);
    });

    it('does NOT rely on naive file:// string concatenation', () => {
      // The pre-fix implementation built `file://${argv1}`, which on Windows
      // yields `file://D:\…` and can never equal the normalized metaUrl.
      const argv1 = 'D:\\projects\\xp-gate\\src\\principles\\index.ts';
      const naive = `file://${argv1}`;
      const metaUrl = pathToFileURL(argv1).href;

      expect(naive).not.toBe(metaUrl);
      expect(isDirectExecution(argv1, metaUrl)).toBe(true);
    });
  });

  describe('POSIX paths (no regression)', () => {
    it('matches a POSIX argv[1] against its import.meta.url', () => {
      const argv1 = '/home/u/xp-gate/src/principles/index.ts';
      const metaUrl = pathToFileURL(argv1).href;

      expect(isDirectExecution(argv1, metaUrl)).toBe(true);
    });
  });

  describe('negative cases', () => {
    it('returns false when imported as a module (different file)', () => {
      const argv1 = 'D:\\projects\\xp-gate\\src\\principles\\index.ts';
      const metaUrl = pathToFileURL(
        'D:\\projects\\xp-gate\\src\\principles\\analyzer.ts',
      ).href;

      expect(isDirectExecution(argv1, metaUrl)).toBe(false);
    });

    it('returns false when argv[1] is missing', () => {
      expect(isDirectExecution(undefined, 'file:///x/y.ts')).toBe(false);
    });

    it('returns false when there is no import.meta.url (CJS without require.main)', () => {
      expect(isDirectExecution('D:\\a\\b.ts', undefined)).toBe(false);
    });

    it('does not match on a mere suffix collision', () => {
      const argv1 = 'D:\\projects\\xp-gate\\index.ts';
      const metaUrl = pathToFileURL('D:\\other\\xp-gate\\index.ts').href;

      expect(isDirectExecution(argv1, metaUrl)).toBe(false);
    });
  });
  describe('relative argv[1] (tsx passes the resolved path)', () => {
    it('resolves a relative argv[1] before comparing', () => {
      const rel = 'src/principles/index.ts';
      const abs = resolve(process.cwd(), rel);
      const metaUrl = pathToFileURL(abs).href;

      expect(isDirectExecution(rel, metaUrl)).toBe(true);
    });
  });

  /**
   * @test REQ-DSH-017
   * @intent 验证 boy-scout 的旧判据 `argv[1].includes('boy-scout')` 被替换后：
   *         子串撞名不再误触发（误报方向），且 argv[1] 不含文件名的真实调用
   *         （CI 下的路径）能正确触发（漏报方向，缺陷 #453）
   * @covers AC-DSH-017-01
   */
  describe('substring matching is not used (#453)', () => {
    const SELF = pathToFileURL(resolve('src/principles/boy-scout.ts')).href;

    it('is false for an unrelated path that merely contains the name', () => {
      // `includes('boy-scout')` was true here, wrongly starting the CLI.
      const decoy = resolve('tmp/boy-scout-notes/run.ts');
      expect(isDirectExecution(decoy, SELF)).toBe(false);
    });

    it('is true for the real script even when argv[1] does not repeat the name', () => {
      // CI shape: the runner is argv[1]; only URL comparison against this
      // module's own URL identifies the entry point. The old guard no-oped
      // here, so the CLI printed nothing and the stdout assertion failed.
      const abs = resolve('src/principles/boy-scout.ts');
      expect(isDirectExecution(abs, SELF)).toBe(true);
    });

    it('is false when argv[1] is a different file in the same directory', () => {
      const sibling = resolve('src/principles/boy-scout.test.ts');
      expect(isDirectExecution(sibling, SELF)).toBe(false);
    });

    it('has no default metaUrl -- import.meta.url must come from the caller', () => {
      // `import.meta.url` is evaluated where it is WRITTEN. If this function
      // defaulted metaUrl to its own import.meta.url, every caller would compare
      // against direct-execution.ts and always get false, which is exactly the
      // silent no-op (#453) it was written to remove. Calling with one argument
      // must therefore not accidentally report "direct execution".
      const oneArg = isDirectExecution as unknown as (a?: string) => boolean;
      expect(oneArg(resolve('src/principles/boy-scout.ts'))).toBe(false);
    });
  });
});
