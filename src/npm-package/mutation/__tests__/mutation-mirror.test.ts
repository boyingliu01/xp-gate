/**
 * @test #544 - the shipped mutation module stays a mirror of the source module
 * @intent src/npm-package/mutation/ is published to npm ("mutation/" is in the
 *         package `files` list) but has no automated mirror check, unlike the
 *         hooks and adapters which check-hook-mirror.sh diffs. It IS maintained
 *         as a byte-identical copy today, so a fix applied only to src/mutation/
 *         would ship stale code to every consumer -- exactly the v0.27.3 failure
 *         (#542) where a mirror-only fix was rolled back at publish. This guard
 *         makes that class of drift red instead of silent, and it is what caught
 *         the hardcoded zero counts still living in the package copy.
 * @covers REQ-MUT-001 AC-001
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// This file lives at src/mutation/__tests__/, so the repo root is three levels
// up (unlike scripts/__tests__/, which is two).
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'src', 'mutation');
const PKG = path.join(ROOT, 'src', 'npm-package', 'mutation');

/** Files that must be identical in both trees. */
const MIRRORED = ['gate-m.ts', 'update-baseline.ts', 'types.ts', 'detect-ai-test.ts', 'init-baseline.ts', 'stryker-types.ts'];

describe('src/npm-package/mutation mirrors src/mutation', () => {
  it.each(MIRRORED)('%s is byte-identical in both trees', (file) => {
    const a = fs.readFileSync(path.join(SRC, file), 'utf8');
    const b = fs.readFileSync(path.join(PKG, file), 'utf8');
    expect(b, `${file} has drifted: edit src/mutation/${file} and copy it over`).toBe(a);
  });

  it('the mirror list is non-empty and every entry exists (anti-vacuity)', () => {
    expect(MIRRORED.length).toBeGreaterThan(3);
    for (const f of MIRRORED) {
      expect(fs.existsSync(path.join(SRC, f)), `missing source ${f}`).toBe(true);
      expect(fs.existsSync(path.join(PKG, f)), `missing mirror ${f}`).toBe(true);
    }
  });

  it('the package copy carries the #544 fix, not the zero-filling original', () => {
    // Anchor on the defect itself so this cannot pass with a stale-but-identical
    // pair of pre-fix files.
    const shipped = fs.readFileSync(path.join(PKG, 'gate-m.ts'), 'utf8');
    expect(shipped).not.toContain('mutants: 0, killed: 0, survived: 0');
    expect(shipped).toContain('MutantCounts');
  });
});
