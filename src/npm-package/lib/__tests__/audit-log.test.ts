/**
 * @test audit-log
 * @intent Verify UI gate bypass audit logging and threshold reporting
 * @covers AUDIT-LOG-001
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  appendAuditEntry,
  readAllEntries,
  countBypassesInWindow,
  exceedsBypassThreshold,
  formatRetroReport,
  type AuditEntry,
} from '../audit-log';

const TEST_DIR = join(process.cwd(), '.audit-log-test');

function baseEntry(overrides: Partial<Omit<AuditEntry, 'gate_count'>> = {}): Omit<AuditEntry, 'gate_count'> {
  return {
    timestamp: new Date().toISOString(),
    branch: 'main',
    commit: 'abc123',
    user: 'tester',
    reason: 'manual approval for test',
    bypass_type: 'ui-gates',
    ...overrides,
  };
}

describe('audit-log', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('appendAuditEntry and readAllEntries', () => {
    it('should append an entry and compute gate_count', () => {
      const first = appendAuditEntry(baseEntry(), TEST_DIR);
      const second = appendAuditEntry(baseEntry({ commit: 'def456' }), TEST_DIR);

      expect(first.gate_count).toBe(0);
      expect(second.gate_count).toBe(1);

      const entries = readAllEntries(join(TEST_DIR, '.audit-log.jsonl'));
      expect(entries).toHaveLength(2);
      expect(entries[1].commit).toBe('def456');
    });

    it('should return empty array when log file is missing or empty', () => {
      expect(readAllEntries(join(TEST_DIR, 'missing.jsonl'))).toEqual([]);
      const emptyLog = join(TEST_DIR, '.audit-log.jsonl');
      writeFileSync(emptyLog, '', 'utf8');
      expect(readAllEntries(emptyLog)).toEqual([]);
    });
  });

  describe('rolling window calculations', () => {
    it('should count only matching bypass type in rolling window', () => {
      const now = new Date();
      const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const entries: AuditEntry[] = [
        { ...baseEntry({ timestamp: now.toISOString(), bypass_type: 'ui-gates' }), gate_count: 0 },
        { ...baseEntry({ timestamp: now.toISOString(), bypass_type: 'other' }), gate_count: 0 },
        { ...baseEntry({ timestamp: old, bypass_type: 'ui-gates' }), gate_count: 0 },
      ];

      expect(countBypassesInWindow(entries, 'ui-gates')).toBe(1);
    });

    it('should report threshold exceedance', () => {
      const entries: AuditEntry[] = Array.from({ length: 4 }, (_, i) => ({
        ...baseEntry({ commit: `commit-${i}` }),
        gate_count: i,
      }));
      expect(exceedsBypassThreshold(entries, 'ui-gates')).toEqual({ exceeded: true, count: 4 });
    });
  });

  describe('formatRetroReport', () => {
    it('should include recent bypasses and threshold warning', () => {
      const entries: AuditEntry[] = Array.from({ length: 4 }, (_, i) => ({
        ...baseEntry({ reason: `reason-${i}`, branch: `branch-${i}` }),
        gate_count: i,
      }));
      const report = formatRetroReport(entries, 'ui-gates');
      expect(report).toContain('Last 30 days: 4 bypasses');
      expect(report).toContain('EXCEEDS threshold');
      expect(report).toContain('reason-3');
    });

    it('should omit recent section when no matching bypasses exist', () => {
      const report = formatRetroReport([], 'ui-gates');
      expect(report).toContain('Last 30 days: 0 bypasses');
      expect(report).not.toContain('Recent bypasses');
    });
  });
});
