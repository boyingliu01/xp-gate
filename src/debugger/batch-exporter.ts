/**
 * Batch exporter — async batch export of observability data to disk.
 * Zero overhead on main execution path when disabled.
 *
 * @test REQ-004 异步批量上报器
 * @intent 后台批量导出可观测性数据，零开销异步写入
 * @covers AC-004-01, AC-004-02, AC-004-03, AC-004-04, AC-004-05, AC-004-06
 */

import fs from 'node:fs';
import path from 'node:path';

export interface BatchExporterOptions {
  projectRoot: string;
  batch_size?: number;
  flush_interval_ms?: number;
}

export interface ExportRecord {
  type: 'span' | 'token_delta' | 'trace';
  timestamp: string;
  data: Record<string, unknown>;
}

interface InternalRecord {
  type: 'span' | 'token_delta' | 'trace';
  timestamp: string;
  data: Record<string, unknown>;
  _queued_at: number;
}

/**
 * All mutable exporter state in one object.
 *
 * This used to be four `let` bindings captured by seven nested closures inside
 * `createBatchExporter`, which Gate 3 scored as a single function of CCN 16 — the
 * tool counts every branch reachable in one function, and closures do not divide
 * it up. Threading the state explicitly lets every operation live at module
 * scope, where each is small enough to read on its own and to test directly.
 */
interface ExporterState {
  buffer: InternalRecord[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  shutdownRequested: boolean;
  readonly batchSize: number;
  readonly flushIntervalMs: number;
  readonly exportDir: string;
}

function createExportDir(projectRoot: string): string {
  return path.join(projectRoot, '.sprint-state', 'exports');
}

/** One JSONL line per record; the private bookkeeping field is dropped. */
function toJsonLines(records: InternalRecord[]): string {
  return records.map((r) =>
    JSON.stringify({ type: r.type, timestamp: r.timestamp, data: r.data }),
  ).join('\n') + '\n';
}

/**
 * Write one batch of records to disk.
 *
 * Disk failure must not propagate: this runs on the observability path, and a
 * full disk turning into an exception would break the sprint operation that was
 * merely being *observed*. The record is dropped and the failure reported, which
 * matches the exporter's contract of "zero overhead on the main path".
 */
function writeBatch(state: ExporterState, records: InternalRecord[]): void {
  if (records.length === 0) return;
  try {
    if (!fs.existsSync(state.exportDir)) {
      fs.mkdirSync(state.exportDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `batch-${stamp}-${Math.random().toString(16).slice(2, 8)}.jsonl`;
    fs.appendFileSync(path.join(state.exportDir, filename), toJsonLines(records), 'utf8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[batch-exporter] dropped ${records.length} record(s): ${detail}\n`);
  }
}

function flushBuffer(state: ExporterState): void {
  if (state.buffer.length === 0) return;
  const batch = [...state.buffer];
  state.buffer = [];
  writeBatch(state, batch);
}

/** Cancel a pending timer, if any. */
function cancelTimer(state: ExporterState): void {
  if (state.flushTimer === null) return;
  clearTimeout(state.flushTimer);
  state.flushTimer = null;
}

function canSchedule(state: ExporterState): boolean {
  return !state.shutdownRequested && state.flushTimer === null;
}

function armTimer(state: ExporterState): void {
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    flushBuffer(state);
    if (state.buffer.length > 0 && !state.shutdownRequested) {
      scheduleFlush(state);
    }
  }, state.flushIntervalMs);

  // Allow Node.js to exit even if a timer is pending.
  if (state.flushTimer.unref) {
    state.flushTimer.unref();
  }
}

function scheduleFlush(state: ExporterState): void {
  if (!canSchedule(state)) return;
  armTimer(state);
}

function exportRecord(state: ExporterState, record: ExportRecord): void {
  if (state.shutdownRequested) return;

  state.buffer.push({ ...record, _queued_at: Date.now() });

  // Auto-flush when the batch is full, otherwise arm the timer.
  if (state.buffer.length >= state.batchSize) {
    flushBuffer(state);
  } else {
    scheduleFlush(state);
  }
}

/** Stop the timer and write whatever is buffered. */
function drain(state: ExporterState): void {
  cancelTimer(state);
  flushBuffer(state);
}

/**
 * Create a batch exporter for observability data.
 * Collects records in memory, writes them in batches to disk.
 *
 * @test REQ-004 异步批量上报器
 * @intent 创建批量导出器，支持 export/flush/shutdown
 * @covers AC-004-01, AC-004-02, AC-004-03
 */
export function createBatchExporter(options: BatchExporterOptions) {
  const state: ExporterState = {
    buffer: [],
    flushTimer: null,
    shutdownRequested: false,
    batchSize: options.batch_size ?? 10,
    flushIntervalMs: options.flush_interval_ms ?? 5000,
    exportDir: createExportDir(options.projectRoot),
  };

  return {
    export: (record: ExportRecord): void => exportRecord(state, record),
    flush: (): Promise<void> => {
      drain(state);
      return Promise.resolve();
    },
    shutdown: (): Promise<void> => {
      state.shutdownRequested = true;
      drain(state);
      return Promise.resolve();
    },
    /**
     * Register SIGTERM handler for graceful shutdown. Mirrors `shutdown`, so a
     * signalled process also stops accepting new records before draining.
     */
    registerSignalHandlers: (): void => {
      process.on('SIGTERM', () => {
        state.shutdownRequested = true;
        drain(state);
      });
    },
    /**
     * Get current buffer size (for testing).
     */
    getBufferSize: (): number => state.buffer.length,
  };
}
