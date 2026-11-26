/**
 * @test REQ-ANALYSE-HOOK-STRUCTURE-BINDINGS
 * @intent Every name a script references must be DECLARED in that script.
 *
 *         Commit f62ff5a8 deleted `const BANNER = ...` while `findRuleAbove` kept using it.
 *         `node --check` passed and the script still ran, because the line is only reached
 *         for a hook whose file contains a Gate 13 section -- so a ReferenceError sat
 *         waiting for the first such repository. The walkthrough found it by reading the
 *         diff (review FC-01); nothing in the toolchain would have.
 *
 *         This is a narrow, honest check: it looks for upper-case bare identifiers used
 *         but never DECLARED in the file, which is the shape that broke, and it does not
 *         pretend to be a full scope analysis.
 *
 * @covers AC-ANALYSE-HOOK-STRUCTURE-BINDINGS-01
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, '..', 'analyse-hook-structure.cjs');

describe('analyse-hook-structure.cjs bindings', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');

  it('declares BANNER, which findRuleAbove uses', () => {
    // The regular expression must exist as a DECLARATION, not merely appear in a comment.
    expect(source).toMatch(/^const BANNER = /m);
    expect(source).toMatch(/BANNER\.test\(/);
  });

  it('has no upper-case identifier used by a test() call without a declaration', () => {
    // The narrow shape that broke: `SOMETHING.test(...)` where SOMETHING is never declared.
    const used = new Set(
      Array.from(source.matchAll(/\b([A-Z][A-Z0-9_]{2,})\.test\(/g), (m) => m[1]),
    );
    for (const name of used) {
      const declared = new RegExp(`^(?:const|let|var)\\s+${name}\\b`, 'm').test(source);
      expect(declared, `${name} is used but never declared`).toBe(true);
    }
  });
});
