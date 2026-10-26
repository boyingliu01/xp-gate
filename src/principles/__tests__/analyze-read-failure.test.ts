/**
 * @test REQ-623
 * @intent A file the checker could not read must not be silently rounded down to
 *         "no violations". Before this, `analyze` caught the read failure into
 *         `result.errors` and `main()` never looked at that array, so the run
 *         exited 0 with a clean report. That is how CI's SARIF step archived a
 *         successful-looking report while its log said
 *         `Analysis failed: Could not read file: <blob>` -- a report about fewer
 *         files than were asked for, presented as a report about all of them.
 *
 *         The contract kept here: an unreadable file is RECORDED (one entry, not
 *         one per rule) and `main()` refuses to call the run clean.
 * @covers AC-623-04, AC-623-05
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, getAdapterForFile } from '../analyzer';
import { getAllRules } from '../index';

/** A directory named `*.ts`: resolves a TS adapter, then cannot be read. */
function unreadableTsPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-analyze-'));
  const asDir = path.join(dir, 'broken.ts');
  fs.mkdirSync(asDir);
  return asDir;
}

describe('AC-623-04: an unreadable file is recorded, not swallowed', () => {
  it('puts the read failure in result.errors', async () => {
    const result = await analyze([unreadableTsPath()], getAllRules(), getAdapterForFile);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('names the file that could not be read', async () => {
    const target = unreadableTsPath();
    const result = await analyze([target], getAllRules(), getAdapterForFile);
    expect(result.errors.join('\n')).toContain('broken.ts');
  });

  it('records one entry per file, not one per rule', async () => {
    // The unreadable file is touched by every enabled rule; the failure is a
    // property of the file, so the operator must not see it repeated per rule.
    const result = await analyze([unreadableTsPath()], getAllRules(), getAdapterForFile);
    expect(result.errors.length).toBe(1);
  });

  it('does not report the unreadable file as examined-and-clean', async () => {
    const result = await analyze([unreadableTsPath()], getAllRules(), getAdapterForFile);
    // No violations could have been found in a file that was never read.
    expect(result.violations).toHaveLength(0);
    // ...so the only honest signal is the error, and it must be present.
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('AC-623-05: a healthy run records no errors', () => {
  it('leaves errors empty when every file reads', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-analyze-ok-'));
    const good = path.join(dir, 'good.ts');
    fs.writeFileSync(good, 'export const value = 1;\n', 'utf8');

    const result = await analyze([good], getAllRules(), getAdapterForFile);

    expect(result.errors).toHaveLength(0);
    expect(result.summary.filesChecked).toBe(1);
  });
});
