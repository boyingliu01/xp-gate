/**
 * @test REQ-PHP-ADAPTER
 * @intent PHP was wired through the gates in b304f8f7, and Gate 4 looked covered:
 *         gate-4.sh's PRINCIPLES_FILES regex accepts `.php`, `getAdapterForFile`
 *         returns a PhpAdapter, and the analyzer reports "Files checked: 1". All
 *         of that is true and none of it means the file was examined.
 *
 *         Measured on this tree before the fix: the same five-level nesting
 *         written as `Same.ts` produced
 *             ERROR clean-code.deep-nesting "deeplyNested" 5 levels (max 4)
 *         while `Legacy.php` produced
 *             "No violations found"
 *
 *         The cause was that `PhpAdapter.extractFunctions()` returned matches
 *         from `createCodeMatch()`, which supplies only {name, type, line, code}.
 *         The rules read `nestingDepth`, `paramCount`, `length` and
 *         `hasTryCatch`, so three of them could never fire on PHP. This is the
 *         #446 shape the csharp adapter's own comment warns about: a missing
 *         field is invisible, because the rule simply finds nothing to report.
 *
 *         These assertions pin the fields, not the adapter's internals: what
 *         matters is that a PHP function the rules would flag is reported.
 * @covers AC-PHP-ADAPTER-01 AC-PHP-ADAPTER-02 AC-PHP-ADAPTER-03
 *
 * Mock-first per src/principles/AGENTS.md: inline fixture, no separate files.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';
import { PhpAdapter } from '../adapters/php';
import { getAdapterForFile } from '../analyzer';

/** Build the adapter over an inline source string. */
function adapterFor(source: string, filePath = 'Probe.php'): PhpAdapter {
  (readFileSync as Mock).mockReturnValue(source);
  return new PhpAdapter(filePath);
}

/** The five-level nesting that `deep-nesting` must flag at threshold 4. */
const DEEP_FN = `<?php
namespace Acme;

class Legacy
{
    public function deeplyNested($a, $b, $c, $d, $e, $f)
    {
        if ($a > 1) {
            if ($a > 2) {
                if ($a > 3) {
                    if ($a > 4) {
                        if ($a > 5) {
                            return 1;
                        }
                    }
                }
            }
        }
        return 0;
    }
}
`;

interface Extracted {
  name: string;
  nestingDepth?: number;
  paramCount?: number;
  length?: number;
  hasTryCatch?: boolean;
  line?: number;
}

function extract(source: string): Extracted[] {
  return adapterFor(source).extractFunctions() as Extracted[];
}

describe('PhpAdapter — fields the Gate 4 rules read (AC-PHP-ADAPTER-01)', () => {
  it('is reachable from the analyzer for .php and .phtml', () => {
    (readFileSync as Mock).mockReturnValue('<?php class A {}');
    const php = getAdapterForFile('A.php');
    const phtml = getAdapterForFile('A.phtml');
    expect(php).toBeInstanceOf(PhpAdapter);
    expect(phtml).toBeInstanceOf(PhpAdapter);
    // Reachability alone is what PHP already had while checking nothing; assert
    // the factory returns a distinct, correctly-typed adapter per extension too.
    expect((php as PhpAdapter).detectLanguage()).toBe('php');
    expect((phtml as PhpAdapter).detectLanguage()).toBe('php');
    expect(php).not.toBe(phtml);
  });

  it('reports nestingDepth for a deeply nested method', () => {
    const [fn] = extract(DEEP_FN);
    expect(fn.name).toBe('deeplyNested');
    // Five nested `if` plus the method body's own level.
    expect(fn.nestingDepth).toBeGreaterThan(4);
  });

  it('reports paramCount so too-many-params can fire', () => {
    const [fn] = extract(DEEP_FN);
    expect(fn.paramCount).toBe(6);
  });

  it('reports a body length in lines', () => {
    const [fn] = extract(DEEP_FN);
    expect(fn.length).toBeGreaterThan(10);
  });

  it('reports hasTryCatch for a method that catches', () => {
    const [fn] = extract(`<?php
class A
{
    public function guard()
    {
        try {
            $this->run();
        } catch (\\RuntimeException $e) {
            return null;
        }
        return 1;
    }
}
`);
    expect(fn.hasTryCatch).toBe(true);
  });

  it('reports hasTryCatch=false for a method with no catch', () => {
    const [fn] = extract(`<?php
class A
{
    public function plain()
    {
        return 1;
    }
}
`);
    expect(fn.hasTryCatch).toBe(false);
  });
});

describe('PhpAdapter — nesting is measured on the body, not the file (AC-PHP-ADAPTER-02)', () => {
  it('a flat method stays under the threshold even in a deeply nested file', () => {
    // The class body and the method body contribute levels; a flat method must
    // not inherit depth from its neighbours. This is the anti-vacuity guard: a
    // naive "count braces in the file" implementation passes the test above and
    // fails this one.
    const [fn] = extract(`<?php
class Outer
{
    public function deep($a)
    {
        if ($a) { if ($a) { if ($a) { if ($a) { if ($a) { return 1; } } } } }
        return 0;
    }

    public function flat()
    {
        return 1;
    }
}
`);
    const flat = extract(`<?php
class Outer
{
    public function deep($a)
    {
        if ($a) { if ($a) { if ($a) { if ($a) { if ($a) { return 1; } } } } }
        return 0;
    }

    public function flat()
    {
        return 1;
    }
}
`).find(f => f.name === 'flat')!;
    expect(flat.nestingDepth).toBeLessThanOrEqual(2);
    // ... while the neighbour IS deep, so the two are measured independently.
    expect(fn.nestingDepth).toBeGreaterThan(4);
  });

  it('braces inside strings and comments do not inflate the depth', () => {
    const [fn] = extract(`<?php
class A
{
    public function noisy()
    {
        $s = '{{{{{{';
        // }}}}}}
        return $s;
    }
}
`);
    expect(fn.nestingDepth).toBeLessThanOrEqual(2);
  });
});

describe('PhpAdapter — the verdict reaches the rule (AC-PHP-ADAPTER-03)', () => {
  it('deep-nesting reports on the PHP source', async () => {
    // The end-to-end claim: the rule the user relies on actually fires. Asserting
    // only on adapter fields would leave "the rule still finds nothing" untested.
    const { deepNestingRule } = await import('../rules/clean-code/deep-nesting');
    const adapter = adapterFor(DEEP_FN);
    const violations = deepNestingRule.check('Probe.php', adapter);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain('deep nesting');
    expect(violations[0].ruleId).toBe('clean-code.deep-nesting');
  });

  it('too-many-params reports on the PHP source', async () => {
    // The rule's threshold is 7, so the fixture must exceed it: a 6-parameter
    // method asserts nothing about this rule and would have read as a broken
    // adapter rather than a mis-sized fixture.
    const { tooManyParamsRule } = await import('../rules/clean-code/too-many-params');
    const wide = `<?php
class Wide
{
    public function many($a, $b, $c, $d, $e, $f, $g, $h)
    {
        return $a;
    }
}
`;
    const violations = tooManyParamsRule.check('Wide.php', adapterFor(wide));
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain('8');
  });
});

describe('PhpAdapter — commas inside a default value are not separators (AC-PHP-ADAPTER-04)', () => {
  // Found by code review after the first fix, and confirmed by measurement: a
  // scanner that tracks only parentheses counts the commas inside a short-array
  // literal as parameters. `shortArray($a = [1,2], $b = [3,4])` reported 4.
  // The rule's threshold is 7, so two such defaults in a three-parameter method
  // would fire `too-many-params` on correct code -- a false block, which is the
  // expensive direction.
  it('counts a short-array default as one parameter', () => {
    const [fn] = extract(`<?php
class A
{
    public function shortArray($a = [1,2], $b = [3,4])
    {
        return $a;
    }
}
`);
    expect(fn.paramCount).toBe(2);
  });

  it('counts a nested array default as one parameter', () => {
    const [fn] = extract(`<?php
class A
{
    public function nested($a = ['k' => ['x' => 1, 'y' => 2]], $b)
    {
        return $a;
    }
}
`);
    expect(fn.paramCount).toBe(2);
  });

  it('still counts commas inside a nested call correctly', () => {
    // Parentheses were already tracked; this pins that the fix did not break them.
    const [fn] = extract(`<?php
class A
{
    public function calls($a = bar(1,2), $b)
    {
        return $a;
    }
}
`);
    expect(fn.paramCount).toBe(2);
  });

  it('counts a plain two-parameter list', () => {
    const [fn] = extract(`<?php
class A
{
    public function plain($a, $b)
    {
        return $a;
    }
}
`);
    expect(fn.paramCount).toBe(2);
  });
});

describe('PhpAdapter — error handling must exist in code, not in a string (AC-PHP-ADAPTER-05)', () => {
  // Also found by review: hasTryCatch read the RAW body, so a method whose only
  // `try {` was inside a string literal reported error handling it did not have.
  // missing-error-handling consumes this field, so the rule stayed silent on a
  // method that genuinely lacks a catch.
  it('does not credit a try/catch that only appears inside a string', () => {
    const [fn] = extract(`<?php
class B
{
    public function fake()
    {
        $s = 'try { x } catch (E $e) { }';
        return $s;
    }
}
`);
    expect(fn.hasTryCatch).toBe(false);
  });

  it('does not credit a try/catch that only appears in a comment', () => {
    const [fn] = extract(`<?php
class B
{
    public function commented()
    {
        // try { x } catch (E $e) { }
        return 1;
    }
}
`);
    expect(fn.hasTryCatch).toBe(false);
  });

  it('still credits a real try/catch', () => {
    const [fn] = extract(`<?php
class B
{
    public function real()
    {
        try {
            $this->run();
        } catch (\\RuntimeException $e) {
            return null;
        }
        return 1;
    }
}
`);
    expect(fn.hasTryCatch).toBe(true);
  });
});

describe('PhpAdapter — heredoc/nowdoc content is not code (AC-PHP-ADAPTER-06)', () => {
  // The technical reviewer corrected a claim I had written in the adapter's own
  // doc comment: un-stripped heredoc text does not merely UNDER-count, it
  // OVER-counts. Measured before the fix:
  //
  //   function heredocBraces() { $sql = <<<SQL  { { { { {  SQL; ... }
  //     -> nestingDepth 6, on a method with no nesting at all
  //   function heredocTry() { $s = <<<TXT  try { x } catch (E $e) { }  TXT; ... }
  //     -> hasTryCatch true, with no try/catch in code
  //
  // Both are false positives, which is the direction that produces a wrong BLOCK:
  // a SQL template or an inline CSS/JS block becomes "deep nesting", and
  // deep-nesting has a threshold of 4.
  it('does not count braces inside a heredoc', () => {
    const [fn] = extract(`<?php
class H
{
    public function sqlTemplate()
    {
        $sql = <<<SQL
        { { { { {
        SQL;
        return $sql;
    }
}
`);
    expect(fn.nestingDepth).toBeLessThanOrEqual(2);
  });

  it('does not credit a try/catch that only appears inside a heredoc', () => {
    const [fn] = extract(`<?php
class H
{
    public function heredocTry()
    {
        $s = <<<TXT
        try { something } catch (E $e) { }
        TXT;
        return $s;
    }
}
`);
    expect(fn.hasTryCatch).toBe(false);
  });

  it('does not count braces inside a nowdoc', () => {
    const [fn] = extract(`<?php
class H
{
    public function nowdoc()
    {
        $s = <<<'TXT'
        { { { { {
        TXT;
        return $s;
    }
}
`);
    expect(fn.nestingDepth).toBeLessThanOrEqual(2);
  });

  it('still measures code after a heredoc ends', () => {
    // Anti-vacuity: a stripper that blanks to end-of-file would pass every case
    // above and silently disable the rules for the rest of the method.
    const [fn] = extract(`<?php
class H
{
    public function afterHeredoc($a)
    {
        $s = <<<TXT
        { { {
        TXT;
        if ($a) { if ($a) { if ($a) { if ($a) { if ($a) { return 1; } } } } }
        return 0;
    }
}
`);
    expect(fn.nestingDepth).toBeGreaterThan(4);
  });
});
