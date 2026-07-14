/**
 * @test REQ-002 Token 差分采集器
 * @intent 验证 sprint-state-io 共享读写函数的正确性
 * @covers AC-002-01
 * @note Sprint E: 委托给 SprintStateManager
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readSprintState, writeSprintState, SprintState } from '../sprint-state-io';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprint-state-io-test-'));
  fs.mkdirSync(path.join(tmpDir, '.sprint-state'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('sprint-state-io', () => {
  describe('readSprintState', () => {
    it('should return null when sprint-state.json does not exist', () => {
      const result = readSprintState(tmpDir);
      expect(result).toBeNull();
    });

    it('should return null when sprint-state.json is malformed', () => {
      const sf = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      fs.writeFileSync(sf, 'not-json', 'utf8');
      const result = readSprintState(tmpDir);
      expect(result).toBeNull();
    });

    it('should read valid sprint state', () => {
      const state: SprintState = {
        _schema_version: 1,
        id: 'test-sprint',
        task_description: 'Test',
        phase: 2,
        status: 'in_progress',
        started_at: '2026-01-01T00:00:00Z',
      };
      const sf = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      fs.writeFileSync(sf, JSON.stringify(state), 'utf8');
      const result = readSprintState(tmpDir);
      expect(result).toEqual(state);
    });

    it('should read state with phase_history', () => {
      const state: SprintState = {
        _schema_version: 1,
        id: 'test-sprint',
        task_description: 'Test',
        phase: 3,
        status: 'in_progress',
        started_at: '2026-01-01T00:00:00Z',
        phase_history: [
          { phase: 2, phase_name: 'DESIGN', status: 'completed', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
          { phase: 3, phase_name: 'BUILD', status: 'in_progress', started_at: '2026-01-01T01:00:00Z' },
        ],
        metrics: { tokens_phase_2: 100, tokens_phase_3: 200 },
      };
      const sf = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      fs.writeFileSync(sf, JSON.stringify(state), 'utf8');
      const result = readSprintState(tmpDir);
      expect(result).toEqual(state);
      expect(result?.phase_history).toHaveLength(2);
    });
  });

  describe('writeSprintState', () => {
    it('should write sprint state to sprint-state.json', () => {
      const state: SprintState = { id: 'test-sprint', phase: 1 };
      writeSprintState(tmpDir, state);
      const sf = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const raw = fs.readFileSync(sf, 'utf8');
      expect(JSON.parse(raw)).toEqual(state);
    });

    it('should write pretty-printed JSON', () => {
      const state: SprintState = { id: 'test-sprint', phase: 2 };
      writeSprintState(tmpDir, state);
      const sf = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const raw = fs.readFileSync(sf, 'utf8');
      expect(raw).toContain('\n');
      expect(raw).toContain('  ');
    });

    it('should overwrite existing sprint state', () => {
      const state1: SprintState = { id: 'sprint-1', phase: 0 };
      writeSprintState(tmpDir, state1);
      const state2: SprintState = { id: 'sprint-2', phase: 5 };
      writeSprintState(tmpDir, state2);
      const sf = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const raw = fs.readFileSync(sf, 'utf8');
      expect(JSON.parse(raw)).toEqual(state2);
    });

    it('should preserve metrics when writing', () => {
      const state: SprintState = {
        id: 'test-sprint',
        phase: 2,
        metrics: { tokens_total: 500, custom_metric: 'value' },
      };
      writeSprintState(tmpDir, state);
      const sf = path.join(tmpDir, '.sprint-state', 'sprint-state.json');
      const raw = fs.readFileSync(sf, 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.metrics.tokens_total).toBe(500);
      expect(parsed.metrics.custom_metric).toBe('value');
    });
  });
});
