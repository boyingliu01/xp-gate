/**
 * @test REQ-AUDIT-ATTRIBUTION xp-gate doctor surfaces gate-telemetry anomalies
 * @intent The two audit bugs (epoch-sized durations, commits attributed to their
 *         parent) leave fingerprints in .xp-gate/audit.jsonl. CI cannot see a
 *         gitignored ledger, so doctor must warn locally on NEW anomalies while
 *         grandfathering the historical rows that cannot be re-measured.
 * @covers AUDIT-001-11
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// doctor.js is CommonJS; import the whole module namespace.
const doctor = require('../doctor.js');

function repoWithLedger(rows) {
  const root = mkdtempSync(join(tmpdir(), 'xp-gate-ledger-'));
  mkdirSync(join(root, '.xp-gate'), { recursive: true });
  const nl = String.fromCharCode(10);
  writeFileSync(join(root, '.xp-gate', 'audit.jsonl'), rows.map((r) => JSON.stringify(r)).join(nl) + nl);
  return root;
}

describe('doctor audit-ledger health (P0 telemetry)', () => {
  it('@covers AUDIT-001-11 a fresh clean ledger passes', () => {
    const future = '2030-01-01T00:00:00.000Z';
    const root = repoWithLedger([
      { timestamp: future, gate_id: 'gate-1', duration_ms: 100, commit_hash: 'abc', passed: true, issues_found: 0 },
    ]);
    const { checks, issues } = doctor.diagnoseAuditLedger({ repoRoot: root });
    expect(issues).toBe(0);
    expect(checks[0].status).toBe('PASS');
    rmSync(root, { recursive: true, force: true });
  });

  it('@covers AUDIT-001-11 new epoch/blank-commit rows raise a WARN, grandfather old ones', () => {
    const future = '2030-01-01T00:00:00.000Z';
    const old = '2020-01-01T00:00:00.000Z';
    const root = repoWithLedger([
      // grandfathered — both anomalies, but before the fix date
      { timestamp: old, gate_id: 'gate-1', duration_ms: 1750000000000, commit_hash: '', passed: true, issues_found: 0 },
      // NEW anomalies — must be counted
      { timestamp: future, gate_id: 'gate-2', duration_ms: 1750000000000, commit_hash: 'abc', passed: true, issues_found: 0 },
      { timestamp: future, gate_id: 'gate-3', duration_ms: 100, commit_hash: '', passed: true, issues_found: 0 },
    ]);
    const { checks, issues } = doctor.diagnoseAuditLedger({ repoRoot: root });
    expect(issues).toBe(0); // WARN, not a blocking issue count
    expect(checks[0].status).toBe('WARN');
    expect(checks[0].detail).toContain('2 anomalies');
    rmSync(root, { recursive: true, force: true });
  });

  it('@covers AUDIT-001-11 no ledger is a SKIP, not a failure', () => {
    const root = mkdtempSync(join(tmpdir(), 'xp-gate-ledger-empty-'));
    const { checks, issues } = doctor.diagnoseAuditLedger({ repoRoot: root });
    expect(issues).toBe(0);
    expect(checks[0].status).toBe('SKIP');
    rmSync(root, { recursive: true, force: true });
  });
});
