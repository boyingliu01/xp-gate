/**
 * @test REQ-001 OTel GenAI 语义规范类型定义
 * @intent 验证 EvolutionLogger.appendSessionSnapshot 的正确性
 * @covers AC-001-01
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createEvolutionLogger } from '../evolution-logger';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-logger-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createEvolutionLogger', () => {
  it('returns an EvolutionLogger with the given log file path', () => {
    const logPath = path.join(tmpDir, 'evolution-log.md');
    const logger = createEvolutionLogger(logPath);
    expect(logger).toBeDefined();
    expect(logger.logPath).toBe(logPath);
  });
});

describe('EvolutionLogger.appendSessionSnapshot', () => {
  it('appends session_id to evolution log', () => {
    const logPath = path.join(tmpDir, 'evolution-log.md');
    const logger = createEvolutionLogger(logPath);
    logger.appendSessionSnapshot({ session_id: 'ses_abc123' });
    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toContain('session_id');
    expect(content).toContain('ses_abc123');
  });

  it('appends phase_timeline to evolution log', () => {
    const logPath = path.join(tmpDir, 'evolution-log.md');
    const logger = createEvolutionLogger(logPath);
    logger.appendSessionSnapshot({
      session_id: 'ses_abc123',
      phase_timeline: ['THINK', 'PLAN', 'BUILD'],
    });
    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toContain('phase_timeline');
    expect(content).toContain('THINK');
    expect(content).toContain('PLAN');
    expect(content).toContain('BUILD');
  });

  it('appends token_snapshots to evolution log', () => {
    const logPath = path.join(tmpDir, 'evolution-log.md');
    const logger = createEvolutionLogger(logPath);
    logger.appendSessionSnapshot({
      session_id: 'ses_abc123',
      token_snapshots: [
        { phase: '0', tokens: 15000 },
        { phase: '1', tokens: 32000 },
      ],
    });
    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toContain('token_snapshots');
    expect(content).toContain('15000');
    expect(content).toContain('32000');
  });

  it('appends multiple snapshots cumulatively (append-only)', () => {
    const logPath = path.join(tmpDir, 'evolution-log.md');
    const logger = createEvolutionLogger(logPath);
    logger.appendSessionSnapshot({ session_id: 'ses_001' });
    logger.appendSessionSnapshot({ session_id: 'ses_002' });
    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toContain('ses_001');
    expect(content).toContain('ses_002');
    const entries = content.split('session_id:').filter(Boolean);
    expect(entries.length).toBe(2);
  });

  it('handles empty snapshot gracefully', () => {
    const logPath = path.join(tmpDir, 'evolution-log.md');
    const logger = createEvolutionLogger(logPath);
    logger.appendSessionSnapshot({ session_id: 'ses_empty' });
    const content = fs.readFileSync(logPath, 'utf8');
    expect(content).toContain('ses_empty');
  });
});
