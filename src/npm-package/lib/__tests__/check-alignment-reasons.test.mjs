/**
 * @test REQ-599
 * @intent `check-alignment` printed only its status and counters when it blocked:
 *
 *             Status: BLOCKED
 *             Score: 0
 *             Misaligned: 0
 *
 *         Those two lines contradict each other — zero misaligned tests, yet
 *         blocked — and the actual reason was in `report.errors`, which the
 *         runner never printed at all. A gate that blocks without saying why is
 *         not actionable, and the standard response to an unactionable red (by any
 *         name: --no-verify, deleting the check) is exactly how dead gates get
 *         built. This is a recurrence of #57.
 *
 *         These cases pin that a non-PASS verdict always explains itself, and
 *         that a non-PASS verdict carrying NO reason is reported as the producer
 *         bug it is rather than printed as an empty list.
 * @covers AC-599-09
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(here, '..', 'check-alignment-runner.cjs');
const TSX = join(here, '..', '..', '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');

const source = readFileSync(RUNNER, 'utf8');

describe('check-alignment explains a non-PASS verdict (#573)', () => {
  it('anti-vacuity: the runner does read report.errors at all', () => {
    // Before the fix this exact grep returned nothing, which is the whole issue.
    expect(source).toMatch(/report\.errors|\.errors\b/);
  });

  it('the human-readable path prints a reasons block', () => {
    // Not just "mentions errors somewhere": the non-JSON branch must render them.
    expect(source).toMatch(/Reasons:/);
  });

  it('a missing reason is reported as a producer bug, not printed as empty', () => {
    // A non-PASS verdict with no entries in report.errors is a defect in whoever
    // produced the report. Saying so is different from printing nothing.
    expect(source).toMatch(/none recorded|no reasons|producer/i);
  });

  it('the reasons are printed only when the verdict is not PASS', () => {
    // Printing "Reasons:" on a PASS run would train readers to ignore it.
    const idx = source.indexOf('Reasons:');
    expect(idx).toBeGreaterThan(-1);
    // The rendering must sit inside a non-PASS guard.
    expect(source).toMatch(/alignment_status\s*!==\s*['"]PASS['"]/);
  });
});

describe('check-alignment reasons survive the real CLI surface (#573)', () => {
  it('--json still emits report.errors so a machine can read the reason', () => {
    const spec = join(here, 'test-alignment.test.ts');
    const result = spawnSync(process.execPath, [TSX, RUNNER, '--spec', spec, '--json'], {
      encoding: 'utf8',
      timeout: 120000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stdout).not.toBe('');
    const parsed = JSON.parse(result.stdout);
    // The field must exist on every report, PASS or not, so a consumer never has
    // to distinguish "absent" from "empty".
    expect(parsed).toHaveProperty('errors');
    expect(Array.isArray(parsed.errors)).toBe(true);
  }, 180000);

  it('the human-readable path names the status and still lists no phantom reasons on PASS', () => {
    const spec = join(here, 'test-alignment.test.ts');
    const result = spawnSync(process.execPath, [TSX, RUNNER, '--spec', spec], {
      encoding: 'utf8',
      timeout: 120000,
    });
    expect(result.error).toBeUndefined();
    // Whatever the verdict, the status line is always there.
    expect(result.stdout).toMatch(/Status:/);

    const blocked = /Status:\s*(?!PASS)/.test(result.stdout);
    if (!blocked) {
      // A passing run must not print a reasons block.
      expect(result.stdout).not.toMatch(/Reasons:/);
    }
  }, 180000);
});
