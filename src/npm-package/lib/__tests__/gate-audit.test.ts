/**
 * @test Gate Audit Logger
 * @intent Verify JSONL audit logging for quality gate executions
 * @covers AUDIT-001-01, AUDIT-001-02, AUDIT-001-03, AUDIT-001-04, AUDIT-001-05, AUDIT-001-06
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  appendAuditEntry,
  readTailEntries,
  computeStats,
  rotateIfNeeded,
  type GateAuditEntry,
} from '../gate-audit';

const TEST_DIR = join(process.cwd(), '.xp-gate-test');

function makeEntry(overrides: Partial<GateAuditEntry> = {}): GateAuditEntry {
  return {
    timestamp: new Date().toISOString(),
    gate_id: 'gate-1',
    gate_name: 'code-quality',
    passed: true,
    issues_found: 0,
    duration_ms: 100,
    trigger: 'commit',
    repo_path: TEST_DIR,
    commit_hash: 'abc123',
    ...overrides,
  };
}

describe('gate-audit', () => {
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

  describe('appendAuditEntry', () => {
    it('should create .xp-gate/ directory on first write', () => {
      const repoRoot = join(TEST_DIR, 'new-project');
      appendAuditEntry(makeEntry({ repo_path: repoRoot }), repoRoot);
      expect(existsSync(join(repoRoot, '.xp-gate'))).toBe(true);
    });

    it('should write valid JSONL', () => {
      const repoRoot = join(TEST_DIR, 'jsonl-test');
      const entry = makeEntry({ repo_path: repoRoot, gate_id: 'gate-2', gate_name: 'dup-code' });
      appendAuditEntry(entry, repoRoot);

      const logPath = join(repoRoot, '.xp-gate', 'audit.jsonl');
      expect(existsSync(logPath)).toBe(true);

      const content = readFileSync(logPath, 'utf8').trim();
      const parsed = JSON.parse(content) as GateAuditEntry;
      expect(parsed.gate_id).toBe('gate-2');
      expect(parsed.gate_name).toBe('dup-code');
      expect(typeof parsed.timestamp).toBe('string');
    });

    it('should append multiple entries as separate lines', () => {
      const repoRoot = join(TEST_DIR, 'multi-test');
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-1' }), repoRoot);
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-2' }), repoRoot);

      const logPath = join(repoRoot, '.xp-gate', 'audit.jsonl');
      const lines = readFileSync(logPath, 'utf8').trim().split('\n');
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]).gate_id).toBe('gate-1');
      expect(JSON.parse(lines[1]).gate_id).toBe('gate-2');
    });

    it('should never throw even when filesystem is broken', () => {
      const badPath = '/nonexistent/path/that/cannot/exist/for/real';
      expect(() => appendAuditEntry(makeEntry({ repo_path: badPath }), badPath)).not.toThrow();
    });
  });

  describe('readTailEntries', () => {
    it('should return last N entries', () => {
      const repoRoot = join(TEST_DIR, 'tail-test');
      for (let i = 1; i <= 30; i++) {
        appendAuditEntry(
          makeEntry({ repo_path: repoRoot, gate_id: `gate-${i % 3}`, duration_ms: i * 10 }),
          repoRoot,
        );
      }

      const tail = readTailEntries(5, repoRoot);
      expect(tail.length).toBe(5);
      expect(tail[0].duration_ms).toBe(260);
      expect(tail[4].duration_ms).toBe(300);
    });

    it('should return empty array when log does not exist', () => {
      const result = readTailEntries(10, join(TEST_DIR, 'empty-project'));
      expect(result).toEqual([]);
    });

    it('should default to 20 entries', () => {
      const repoRoot = join(TEST_DIR, 'default-tail');
      for (let i = 0; i < 50; i++) {
        appendAuditEntry(makeEntry({ repo_path: repoRoot, duration_ms: i }), repoRoot);
      }
      const tail = readTailEntries(undefined, repoRoot);
      expect(tail.length).toBe(20);
    });
  });

  describe('computeStats', () => {
    it('should aggregate per-gate statistics correctly', () => {
      const repoRoot = join(TEST_DIR, 'stats-test');
      // gate-1: 3 runs, 2 passed, durations 100+200+300
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-1', passed: true, duration_ms: 100 }), repoRoot);
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-1', passed: true, duration_ms: 200 }), repoRoot);
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-1', passed: false, duration_ms: 300 }), repoRoot);
      // gate-2: 2 runs, 2 passed
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-2', passed: true, duration_ms: 50 }), repoRoot);
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-2', passed: true, duration_ms: 150 }), repoRoot);

      const stats = computeStats(repoRoot);
      expect(stats.length).toBe(2);

      const g1 = stats.find(s => s.gate_id === 'gate-1')!;
      expect(g1.pass_pct).toBe('66.7%');
      expect(g1.avg_ms).toBe(200);

      const g2 = stats.find(s => s.gate_id === 'gate-2')!;
      expect(g2.pass_pct).toBe('100.0%');
      expect(g2.avg_ms).toBe(100);
    });

    it('should return empty array when no log exists', () => {
      const result = computeStats(join(TEST_DIR, 'no-stats'));
      expect(result).toEqual([]);
    });

    it('should calculate avg_issues correctly', () => {
      const repoRoot = join(TEST_DIR, 'issues-test');
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-3', issues_found: 5 }), repoRoot);
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-3', issues_found: 3 }), repoRoot);
      appendAuditEntry(makeEntry({ repo_path: repoRoot, gate_id: 'gate-3', issues_found: 0 }), repoRoot);

      const stats = computeStats(repoRoot);
      expect(stats[0].avg_issues).toBe(2.67);
    });
  });

  describe('rotateIfNeeded', () => {
    it('should not rotate when file is under 10MB', () => {
      const logPath = join(TEST_DIR, 'small-log', '.xp-gate', 'audit.jsonl');
      mkdirSync(join(TEST_DIR, 'small-log', '.xp-gate'), { recursive: true });
      writeFileSync(logPath, 'small content', 'utf8');

      rotateIfNeeded(logPath);
      expect(existsSync(logPath)).toBe(true);
      expect(existsSync(`${logPath}.1`)).toBe(false);
    });

    it('should rotate when file exceeds 10MB', () => {
      const logPath = join(TEST_DIR, 'big-log', '.xp-gate', 'audit.jsonl');
      mkdirSync(join(TEST_DIR, 'big-log', '.xp-gate'), { recursive: true });

      // Write > 10MB of data
      const bigContent = 'x'.repeat(10 * 1024 * 1024 + 100);
      writeFileSync(logPath, bigContent, 'utf8');

      rotateIfNeeded(logPath);
      expect(existsSync(`${logPath}.1`)).toBe(true);
    });

    it('should keep max 3 archives', () => {
      const logPath = join(TEST_DIR, 'archive-test', '.xp-gate', 'audit.jsonl');
      mkdirSync(join(TEST_DIR, 'archive-test', '.xp-gate'), { recursive: true });
      const bigContent = 'x'.repeat(10 * 1024 * 1024 + 100);

      // Create 3 rotations
      for (let i = 0; i < 3; i++) {
        writeFileSync(logPath, `${bigContent} round ${i}`, 'utf8');
        rotateIfNeeded(logPath);
      }

      // Should have .1, .2, .3 but NOT .4
      expect(existsSync(`${logPath}.1`)).toBe(true);
      expect(existsSync(`${logPath}.2`)).toBe(true);
      expect(existsSync(`${logPath}.3`)).toBe(true);
      expect(existsSync(`${logPath}.4`)).toBe(false);
    });
  });
});
