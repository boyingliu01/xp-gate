/**
 * @test REQ-452
 * @intent 验证 .warnings-baseline.json 里每一条基线都仍对应"该文件当前确有告警"，
 *         否则它就是一份幽灵额度（Gate 6 允许告警数上升而无人报警）
 * @covers AC-452-15
 *
 * Why this is a property and not a snapshot: an entry is the Boy Scout Rule's
 * budget for one file. `pruneBaselineEntries` (#452) drops entries whose FILE has
 * disappeared, which is the wrong key -- a file that stayed and had its warnings
 * fixed keeps a budget of N forever, and the next edit that adds N warnings is
 * "within baseline". That is not a hypothetical: the #457 branch recorded
 * `config.ts: 1` and `config-enforcement.test.ts: 2` when those files carried
 * warnings, then removed the warnings and left the entries behind (walkthrough
 * FC-13).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeWarningsForFiles } from '../boy-scout';

const REPO_ROOT = process.cwd();
const BASELINE = join(REPO_ROOT, '.warnings-baseline.json');

interface BaselineEntry {
  totalWarnings: number;
  lastAnalyzed: string;
}

function readBaseline(): Record<string, BaselineEntry> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch (err) {
    // A missing or corrupt baseline is a fixture failure, not a property failure:
    // without this the suite reports "cannot read properties of undefined".
    throw new Error(`Cannot read the warnings baseline at ${BASELINE}: ${String(err)}`);
  }
  const entries = raw as Record<string, unknown>;
  // The on-disk shape has no wrapper object (boy-scout reads the top level as the
  // file map); assert that here so a format change fails this test rather than
  // scanning zero entries and passing.
  expect(Object.keys(entries).length, 'the baseline must not be empty').toBeGreaterThan(0);
  return entries as Record<string, BaselineEntry>;
}

describe('the warnings baseline budgets only warnings that exist', () => {
  it('AC-452-15: no entry grants a budget to a file that currently has zero warnings', async () => {
    const baseline = readBaseline();
    const files = Object.keys(baseline);
    const current = await analyzeWarningsForFiles(files);
    const phantom = files.filter((file) => (current[file] ?? 0) === 0);

    expect(
      phantom,
      `These files carry a baseline budget but have no warnings today: ${phantom.join(', ')}. ` +
        'Delete their entries -- an unused budget is permission to add warnings later.',
    ).toEqual([]);
  });

  it('AC-452-15: no entry overstates the count it tracks', async () => {
    const baseline = readBaseline();
    const files = Object.keys(baseline);
    const current = await analyzeWarningsForFiles(files);
    // A count above today's total is the same defect in a milder form: the extra
    // margin is a budget nobody granted.
    for (const file of files) {
      expect(
        baseline[file].totalWarnings,
        `${file} baseline is above its current warning count`,
      ).toBeLessThanOrEqual(current[file] ?? 0);
    }
  });
});
