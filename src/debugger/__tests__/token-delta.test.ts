import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { recordTokenDelta, getTotalTokens, getTokenHistory } from '../token-delta';

/**
 * @test REQ-002 Token 差分采集器
 * @intent 验证 token 差分采集、sprint 边界重置、历史记录
 * @covers AC-002-01, AC-002-02, AC-002-03, AC-002-04, AC-002-05
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-delta-test-'));
  fs.mkdirSync(path.join(tmpDir, '.sprint-state'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeState(sprintId: string, phase?: number): void {
  const state = {
    id: sprintId,
    phase: phase ?? -1,
    status: 'running',
    metrics: {},
  };
  fs.writeFileSync(
    path.join(tmpDir, '.sprint-state', 'sprint-state.json'),
    JSON.stringify(state, null, 2),
  );
}

describe('recordTokenDelta', () => {
  it('records token usage for the first call (no delta)', () => {
    writeState('sprint-001');
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 1000,
      outputTokens: 500,
      phase: 0,
    });

    const total = getTotalTokens({ projectRoot: tmpDir });
    expect(total).not.toBeNull();
    expect(total!.input_tokens).toBe(1000);
    expect(total!.output_tokens).toBe(500);
    expect(total!.total_tokens).toBe(1500);
  });

  it('calculates delta from previous record', () => {
    writeState('sprint-001');
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 1000,
      outputTokens: 500,
      phase: 0,
    });

    // Second call — cumulative tokens
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 2500,
      outputTokens: 1200,
      phase: 1,
    });

    const history = getTokenHistory({ projectRoot: tmpDir });
    expect(history).toHaveLength(2);

    // Second record should have delta
    const second = history[1];
    expect(second.delta_input).toBe(1500); // 2500 - 1000
    expect(second.delta_output).toBe(700); // 1200 - 500
    expect(second.delta_total).toBe(2200);
  });

  it('records cache tokens', () => {
    writeState('sprint-001');
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
    });

    const total = getTotalTokens({ projectRoot: tmpDir });
    expect(total!.cache_read_tokens).toBe(200);
    expect(total!.cache_write_tokens).toBe(100);
  });

  it('resets delta when sprint_id changes', () => {
    // Sprint 1
    writeState('sprint-001');
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 5000,
      outputTokens: 2000,
    });

    // New sprint
    writeState('sprint-002');
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 1000,
      outputTokens: 500,
    });

    const history = getTokenHistory({ projectRoot: tmpDir });
    const sprint2Records = history.filter(r => r.sprint_id === 'sprint-002');

    // First record of new sprint should have delta = total (no previous)
    expect(sprint2Records[0].delta_input).toBe(1000);
    expect(sprint2Records[0].delta_output).toBe(500);
  });

  it('does nothing when sprint state is missing', () => {
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 1000,
      outputTokens: 500,
    });

    const total = getTotalTokens({ projectRoot: tmpDir });
    expect(total).toBeNull();
  });

  it('persists to sprint state metrics', () => {
    writeState('sprint-001');
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 1000,
      outputTokens: 500,
      phase: 2,
    });

    const state = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.sprint-state', 'sprint-state.json'), 'utf8'),
    );
    expect(state.metrics.tokens_total).toBe(1500);
    expect(state.metrics.tokens_phase_2).toBe(1500);
  });
});

describe('getTotalTokens', () => {
  it('returns null for empty sprint', () => {
    writeState('sprint-001');
    const total = getTotalTokens({ projectRoot: tmpDir });
    expect(total).toBeNull();
  });

  it('returns latest token totals', () => {
    writeState('sprint-001');
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 1000,
      outputTokens: 500,
    });
    recordTokenDelta({
      projectRoot: tmpDir,
      inputTokens: 2000,
      outputTokens: 1000,
    });

    const total = getTotalTokens({ projectRoot: tmpDir });
    expect(total!.input_tokens).toBe(2000);
    expect(total!.output_tokens).toBe(1000);
    expect(total!.total_tokens).toBe(3000);
  });
});

describe('getTokenHistory', () => {
  it('returns empty array for new sprint', () => {
    writeState('sprint-001');
    const history = getTokenHistory({ projectRoot: tmpDir });
    expect(history).toEqual([]);
  });

  it('returns all records for current sprint', () => {
    writeState('sprint-001');
    recordTokenDelta({ projectRoot: tmpDir, inputTokens: 1000, outputTokens: 500, phase: 0 });
    recordTokenDelta({ projectRoot: tmpDir, inputTokens: 2000, outputTokens: 1000, phase: 1 });

    const history = getTokenHistory({ projectRoot: tmpDir });
    expect(history).toHaveLength(2);
    expect(history[0].phase).toBe(0);
    expect(history[1].phase).toBe(1);
  });
});
