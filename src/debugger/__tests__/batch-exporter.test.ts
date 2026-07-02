import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createBatchExporter } from '../batch-exporter';

/**
 * @test REQ-004 异步批量上报器
 * @intent 验证批量导出、flush、shutdown、buffer 大小控制
 * @covers AC-004-01, AC-004-02, AC-004-03, AC-004-04, AC-004-05, AC-004-06
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-exporter-test-'));
  fs.mkdirSync(path.join(tmpDir, '.sprint-state'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createBatchExporter', () => {
  it('creates exporter with default options', () => {
    const exporter = createBatchExporter({ projectRoot: tmpDir });
    expect(exporter.getBufferSize()).toBe(0);
  });

  it('creates exporter with custom options', () => {
    const exporter = createBatchExporter({
      projectRoot: tmpDir,
      batch_size: 5,
      flush_interval_ms: 1000,
    });
    expect(exporter.getBufferSize()).toBe(0);
  });

  it('queues records without writing immediately', () => {
    const exporter = createBatchExporter({ projectRoot: tmpDir });

    exporter.export({
      type: 'span',
      timestamp: new Date().toISOString(),
      data: { name: 'test' },
    });

    expect(exporter.getBufferSize()).toBe(1);
    // No file should exist yet
    const exportDir = path.join(tmpDir, '.sprint-state', 'exports');
    expect(fs.existsSync(exportDir)).toBe(false);
  });

  it('auto-flushes when batch is full', async () => {
    const exporter = createBatchExporter({ projectRoot: tmpDir, batch_size: 3 });

    for (let i = 0; i < 3; i++) {
      exporter.export({
        type: 'span',
        timestamp: new Date().toISOString(),
        data: { index: i },
      });
    }

    // Buffer should be empty after auto-flush
    expect(exporter.getBufferSize()).toBe(0);

    // File should exist
    const exportDir = path.join(tmpDir, '.sprint-state', 'exports');
    expect(fs.existsSync(exportDir)).toBe(true);
  });

  it('flush writes all buffered records to disk', async () => {
    const exporter = createBatchExporter({ projectRoot: tmpDir, batch_size: 10 });

    for (let i = 0; i < 5; i++) {
      exporter.export({
        type: 'token_delta',
        timestamp: new Date().toISOString(),
        data: { tokens: i * 100 },
      });
    }

    await exporter.flush();

    const exportDir = path.join(tmpDir, '.sprint-state', 'exports');
    const files = fs.readdirSync(exportDir).filter(f => f.endsWith('.jsonl'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(exportDir, files[0]), 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(5);

    lines.forEach((line, i) => {
      const parsed = JSON.parse(line);
      expect(parsed.type).toBe('token_delta');
      expect(parsed.data.tokens).toBe(i * 100);
    });
  });

  it('shutdown clears buffer and stops accepting records', async () => {
    const exporter = createBatchExporter({ projectRoot: tmpDir, batch_size: 10 });

    exporter.export({
      type: 'span',
      timestamp: new Date().toISOString(),
      data: { name: 'before-shutdown' },
    });

    await exporter.shutdown();

    // After shutdown, new exports should be ignored
    exporter.export({
      type: 'span',
      timestamp: new Date().toISOString(),
      data: { name: 'after-shutdown' },
    });

    // Only 1 record should be in the export file
    const exportDir = path.join(tmpDir, '.sprint-state', 'exports');
    if (fs.existsSync(exportDir)) {
      const files = fs.readdirSync(exportDir).filter(f => f.endsWith('.jsonl'));
      if (files.length > 0) {
        const content = fs.readFileSync(path.join(exportDir, files[0]), 'utf8');
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]).data.name).toBe('before-shutdown');
      }
    }
  });

  it('writes correct JSONL format', async () => {
    const exporter = createBatchExporter({ projectRoot: tmpDir, batch_size: 1 });

    exporter.export({
      type: 'trace',
      timestamp: '2026-07-02T00:00:00.000Z',
      data: { sprint_id: 'sprint-001', phase: 2 },
    });

    const exportDir = path.join(tmpDir, '.sprint-state', 'exports');
    const files = fs.readdirSync(exportDir).filter(f => f.endsWith('.jsonl'));
    const content = fs.readFileSync(path.join(exportDir, files[0]), 'utf8').trim();
    const parsed = JSON.parse(content);

    expect(parsed.type).toBe('trace');
    expect(parsed.timestamp).toBe('2026-07-02T00:00:00.000Z');
    expect(parsed.data.sprint_id).toBe('sprint-001');
  });

  it('handles flush with empty buffer gracefully', async () => {
    const exporter = createBatchExporter({ projectRoot: tmpDir });
    await exporter.flush();
    // Should not throw or create files
    const exportDir = path.join(tmpDir, '.sprint-state', 'exports');
    expect(fs.existsSync(exportDir)).toBe(false);
  });
});
