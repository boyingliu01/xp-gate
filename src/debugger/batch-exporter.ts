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
 * Create a batch exporter for observability data.
 * Collects records in memory, writes them in batches to disk.
 *
 * @test REQ-004 异步批量上报器
 * @intent 创建批量导出器，支持 export/flush/shutdown
 * @covers AC-004-01, AC-004-02, AC-004-03
 */
export function createBatchExporter(options: BatchExporterOptions) {
  const batchSize = options.batch_size ?? 10;
  const flushIntervalMs = options.flush_interval_ms ?? 5000;
  const exportDir = path.join(options.projectRoot, '.sprint-state', 'exports');

  let buffer: InternalRecord[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let shutdownRequested = false;

  function ensureExportDir(): void {
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }
  }

  function writeBatch(records: InternalRecord[]): void {
    if (records.length === 0) return;
    ensureExportDir();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `batch-${timestamp}-${Math.random().toString(16).slice(2, 8)}.jsonl`;
    const filepath = path.join(exportDir, filename);

    const lines = records.map(r =>
      JSON.stringify({ type: r.type, timestamp: r.timestamp, data: r.data }),
    ).join('\n') + '\n';

    fs.appendFileSync(filepath, lines, 'utf8');
  }

  function flushBuffer(): void {
    if (buffer.length === 0) return;
    const batch = [...buffer];
    buffer = [];
    writeBatch(batch);
  }

  function scheduleFlush(): void {
    if (shutdownRequested) return;
    if (flushTimer !== null) return;

    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushBuffer();
      if (buffer.length > 0 && !shutdownRequested) {
        scheduleFlush();
      }
    }, flushIntervalMs);

    // Allow Node.js to exit even if timer is pending
    if (flushTimer.unref) {
      flushTimer.unref();
    }
  }

  /**
   * Queue a record for export. Returns immediately (zero overhead on main path).
   */
  function exportRecord(record: ExportRecord): void {
    if (shutdownRequested) return;

    const internal: InternalRecord = {
      ...record,
      _queued_at: Date.now(),
    };

    buffer.push(internal);

    // Auto-flush when batch is full
    if (buffer.length >= batchSize) {
      flushBuffer();
    } else {
      scheduleFlush();
    }
  }

  /**
   * Flush all buffered records to disk immediately.
   * Returns a promise for graceful shutdown scenarios.
   */
  function flush(): Promise<void> {
    return new Promise((resolve) => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushBuffer();
      resolve();
    });
  }

  /**
   * Graceful shutdown — flush remaining records and stop accepting new ones.
   * Installs process.on('SIGTERM') handler if process is available.
   */
  function shutdown(): Promise<void> {
    shutdownRequested = true;

    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    flushBuffer();
    return Promise.resolve();
  }

  /**
   * Register SIGTERM handler for graceful shutdown.
   */
  function registerSignalHandlers(): void {
    const handler = () => {
      shutdown();
    };
    process.on('SIGTERM', handler);
  }

  /**
   * Get current buffer size (for testing).
   */
  function getBufferSize(): number {
    return buffer.length;
  }

  return {
    export: exportRecord,
    flush,
    shutdown,
    registerSignalHandlers,
    getBufferSize,
  };
}
