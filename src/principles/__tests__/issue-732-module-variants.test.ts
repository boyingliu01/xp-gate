/**
 * @test REQ-732-L2 the principles engine selects the four module variants
 * @intent #732 was fixed once on the OUTSIDE of this engine and the user still
 *         saw Gate 4 report `✅ PASSED` with 0 files checked on a real project
 *         with 36 `.mjs` files.
 *
 *         The reason is that "does Gate 4 see the file" is answered in TWO
 *         independent places, and only the outer one was fixed:
 *
 *           1. `githooks/lib/file-classifier.sh` decides which paths reach the
 *              gate. Fixed in 0.38.79.0 — a shell `grep -E` filter.
 *           2. THIS engine decides which of those paths it can analyse, via
 *              `adapterMap` in `analyzer.ts` and `languageMap` in
 *              `adapters/base.ts`. Both still listed only ts/tsx/js/jsx.
 *           3. `analyzer.ts` then discards any adapter whose
 *              `detectLanguage()` returns 'unknown'.
 *
 *         Measured before this fix, against real files on disk:
 *
 *           tool.js   -> javascript
 *           tool.ts   -> typescript
 *           tool.mjs  -> NULL
 *           tool.cjs  -> NULL
 *           tool.mts  -> NULL
 *           tool.cts  -> NULL
 *
 *         So a `.mjs` file passed step 1, was dropped at step 2, and Gate 4
 *         reported a clean PASS over code it never read — "not checked" rendered
 *         as "passed", the defect family this codebase keeps rediscovering.
 *
 *         Both inner maps must be fixed TOGETHER: fixing adapterMap alone still
 *         loses the file at the `detectLanguage() === 'unknown'` gate, and
 *         fixing languageMap alone never reaches it because adapterMap returns
 *         null first. Each is asserted separately below so a partial fix fails
 *         for the right reason.
 * @covers AC-732-07 getAdapterForFile resolves mjs/cjs/mts/cts
 * @covers AC-732-08 detectLanguage names them instead of 'unknown'
 * @covers AC-732-09 a .mjs file is analysed exactly like the equivalent .js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAdapterForFile } from '../analyzer';

let dir: string;

const SOURCE = `export function f() {
  var unused = 1;
  return unused;
}
`;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'req732l2-'));
  for (const ext of ['js', 'ts', 'mjs', 'cjs', 'mts', 'cts']) {
    fs.writeFileSync(path.join(dir, `tool.${ext}`), SOURCE);
  }
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const MODULE_EXTS = ['mjs', 'cjs', 'mts', 'cts'];

describe('#732 layer 2: the principles engine resolves .mjs/.cjs/.mts/.cts', () => {
  it('AC-732-07: getAdapterForFile returns an adapter for the four module variants', () => {
    for (const ext of MODULE_EXTS) {
      const adapter = getAdapterForFile(path.join(dir, `tool.${ext}`));
      expect(adapter, `.${ext} produced no adapter`).not.toBeNull();
    }
  });

  it('AC-732-08: detectLanguage names them, it does not fall through to unknown', () => {
    // The second gate. `analyzer.ts` drops any adapter whose language is
    // 'unknown', so an adapter that exists but cannot name itself is just as
    // invisible as no adapter at all -- and that is the failure mode a
    // half-fix would leave behind.
    const expected: Record<string, string> = {
      mjs: 'javascript',
      cjs: 'javascript',
      mts: 'typescript',
      cts: 'typescript',
    };
    for (const ext of MODULE_EXTS) {
      const adapter = getAdapterForFile(path.join(dir, `tool.${ext}`));
      expect(adapter, `.${ext} produced no adapter`).not.toBeNull();
      expect(adapter!.detectLanguage(), `.${ext}`).toBe(expected[ext]);
    }
  });

  it('AC-732-09: a .mjs file resolves the same way the equivalent .js does', () => {
    // The issue's own suggested regression test: same fixture content, two
    // names, assert the outcome is identical. This is the assertion that would
    // have caught the partial fix, because it compares a working path to a
    // broken one instead of asserting against a hardcoded expectation.
    const js = getAdapterForFile(path.join(dir, 'tool.js'));
    const mjs = getAdapterForFile(path.join(dir, 'tool.mjs'));
    expect(js).not.toBeNull();
    expect(mjs).not.toBeNull();
    expect(mjs!.constructor.name).toBe(js!.constructor.name);
    expect(mjs!.detectLanguage()).toBe(js!.detectLanguage());
  });
});
