/**
 * @test REQ-AUDIT-SKIP-DISTINGUISHABLE
 * @intent The audit journal could not tell PASS from SKIP, and both counted as
 *         a pass.
 *
 *         record_gate_audit received the gate's real status as its third
 *         argument and threw it away:
 *
 *             local gate_result="true"
 *             if [ "$passed" != "PASS" ] && [ "$passed" != "SKIP" ]; then
 *               gate_result="false"
 *             fi
 *
 *         So every SKIP row was written as passed=true. aggregateByGate then
 *         computes pass_pct as passed/total, which means a gate that skipped
 *         every single time reported a 100% pass rate while never having checked
 *         anything.
 *
 *         Measured: a deselected gate-11 wrote `"passed":true` with nothing else
 *         distinguishing it from a real pass.
 *
 *         The fix keeps `passed` exactly as it was — it answers "did this gate
 *         block?", which is still the right question for the retry streak, whose
 *         awk reads `"passed":false`. What is added is the status the gate
 *         actually reached, so a consumer can tell the three states apart.
 *
 * @covers AC-AUDIT-SKIP-01 AC-AUDIT-SKIP-02
 */

import { describe, it, expect } from 'vitest';
import { aggregateByGate } from '../gate-audit.js';
import type { GateAuditEntry } from '../gate-audit.js';

function entry(over: Partial<GateAuditEntry>): GateAuditEntry {
  return {
    timestamp: '2026-11-18T00:00:00.000Z',
    gate_id: 'gate-1',
    gate_name: 'lint',
    passed: true,
    issues_found: 0,
    duration_ms: 10,
    trigger: 'commit',
    repo_path: '/repo',
    commit_hash: 'abc',
    ...over,
  } as GateAuditEntry;
}

describe('REQ-AUDIT-SKIP-DISTINGUISHABLE', () => {
  it('AC-AUDIT-SKIP-01: a SKIP row is distinguishable from a PASS row', () => {
    // Both rows have passed=true -- that is the existing, deliberate schema.
    const rows: GateAuditEntry[] = [
      entry({ gate_status: 'PASS' }),
      entry({ gate_status: 'SKIP' }),
    ];

    const buckets = aggregateByGate(rows);
    const b = buckets.get('gate-1');
    expect(b).toBeDefined();
    // The status must survive into the aggregate; without it these two rows are
    // byte-identical as far as any consumer is concerned.
    expect(b?.skipped).toBe(1);
    expect(b?.verified).toBe(1);
  });

  it('AC-AUDIT-SKIP-02: a gate that only ever skips does not look like a gate that passes', () => {
    const rows: GateAuditEntry[] = [
      entry({ gate_id: 'gate-11', gate_status: 'SKIP' }),
      entry({ gate_id: 'gate-11', gate_status: 'SKIP' }),
      entry({ gate_id: 'gate-11', gate_status: 'SKIP' }),
    ];

    const b = aggregateByGate(rows).get('gate-11');
    // verified counts only rows where something was actually evaluated.
    expect(b?.verified).toBe(0);
    expect(b?.skipped).toBe(3);
    // The old metric must still read 100% -- it answers a different question,
    // and changing it here would silently move every historical number.
    expect(b?.passed).toBe(3);
  });
});
