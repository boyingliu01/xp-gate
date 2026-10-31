/**
 * @test audit CLI runs at all
 * @intent The four `xp-gate audit` subcommands used to require() a .ts file, which
 *         Node cannot do, so every one of them died. This pins that they execute,
 *         that --check still FAILS on a real anomaly (so "it runs" is not mistaken
 *         for "it passes"), and that --ledger grades the file it was given.
 * @covers AC-673-01, AC-673-02, AC-673-03
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', '..', 'bin', 'xp-gate.js');
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

// The audit CLI builds a tsx child process on every call, so the first one pays
// cold-start cost; the per-test timeout has to clear that.
const TEST_TIMEOUT_MS = 200_000;
const CLI_TIMEOUT_MS = 180_000;
const SAMPLE_DURATION_MS = 1200;

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'xpg-audit-cli-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runAudit(args: string[], cwd: string): ReturnType<typeof spawnSync> {
  try {
    return spawnSync(process.execPath, [CLI, 'audit', ...args], {
      cwd,
      encoding: 'utf8',
      timeout: CLI_TIMEOUT_MS,
    });
  } catch (err) {
    // A spawn failure (missing binary, EACCES) must surface as itself, not as a
    // mysterious "status was undefined" several assertions later.
    throw new Error(`failed to run audit ${args.join(' ')}: ${(err as Error).message}`);
  }
}

function ledgerWith(rows: object[]): string {
  const file = join(dir, `ledger-${Math.random().toString(36).slice(2)}.jsonl`);
  try {
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  } catch (err) {
    throw new Error(`failed to write ledger ${file}: ${(err as Error).message}`);
  }
  return file;
}

const ATTRIBUTED = {
  timestamp: '2026-12-01T00:00:00.000Z',
  gate_id: 'gate-1',
  gate_name: 'code-quality',
  passed: true,
  issues_found: 0,
  duration_ms: SAMPLE_DURATION_MS,
  trigger: 'commit',
  commit_hash: 'abc123def456',
};

const UNATTRIBUTED = { ...ATTRIBUTED, commit_hash: '' };

describe('xp-gate audit CLI', () => {
  it('AC-673-01: --check runs the TypeScript implementation instead of dying on require()', () => {
    const ledger = ledgerWith([ATTRIBUTED]);
    const r = runAudit(['--check', '--ledger', ledger], REPO_ROOT);

    // The failure this guards: Node cannot require() a .ts file, so the command
    // printed "require is not defined in ES module scope" and exited 1 no matter
    // what the ledger held. Assert the command produced a verdict at all.
    expect(r.stderr).not.toContain('require is not defined');
    expect(r.stdout).toContain('Audit health');
    expect(r.stdout).toContain('OK: no new audit anomalies.');
    expect(r.status).toBe(0);
  }, TEST_TIMEOUT_MS);

  it('AC-673-02: an unattributed commit still fails the check', () => {
    // Anti-vacuity for AC-673-01: proving the command runs must not be mistaken
    // for proving it passes. A blank commit_hash is the exact defect the check
    // exists to catch, so it has to exit non-zero.
    const ledger = ledgerWith([ATTRIBUTED, UNATTRIBUTED]);
    const r = runAudit(['--check', '--ledger', ledger], REPO_ROOT);

    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('missing commit       : 1');
    expect(r.stderr).toContain('FAIL: 1 audit anomaly');
  }, TEST_TIMEOUT_MS);

  it('AC-673-03: --ledger grades the named file, not the cwd ledger', () => {
    // Run from a directory with no .xp-gate/ at all: without --ledger the check
    // would scan 0 entries and pass, which would make the flag look harmless
    // while testing nothing.
    const emptyCwd = mkdtempSync(join(dir, 'cwd-'));
    const ledger = ledgerWith([UNATTRIBUTED]);
    const r = runAudit(['--check', '--ledger', ledger], emptyCwd);

    expect(r.stdout).toContain('entries scanned      : 1');
    expect(r.status).not.toBe(0);
  }, TEST_TIMEOUT_MS);

  it('AC-673-03: --ledger rejects a missing file instead of scanning nothing', () => {
    const r = runAudit(['--check', '--ledger', join(dir, 'does-not-exist.jsonl')], REPO_ROOT);

    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--ledger file not found');
  }, TEST_TIMEOUT_MS);
});
