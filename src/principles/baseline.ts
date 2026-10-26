import fs from 'fs/promises';

interface BaselineEntry {
  eslint?: { warnings: number; errors: number };
  principles?: { warnings: number; errors: number };
  ccn?: { warnings: number; max: number };
  ruff?: { warnings: number; errors: number };
  golangci?: { warnings: number; errors: number };
  shellcheck?: { warnings: number; errors: number };
  totalWarnings: number;
  lastAnalyzed: string;
}

interface BaselineStorageConfig {
  maxSize?: number;
  timeoutMs?: number;
  batchSize?: number;
}

type ToolValidator = (entry: BaselineEntry, file: string) => void;

/** The per-tool counters a baseline entry can carry, in report order. */
const TOOL_KEYS = ['eslint', 'principles', 'ccn', 'ruff', 'golangci', 'shellcheck'] as const;
type ToolKey = typeof TOOL_KEYS[number];

/**
 * Build one baseline entry from a file's per-tool counts.
 *
 * `createFromFiles` and `initializeWithAnalyzer` each carried this six-`if`
 * accumulator plus its six-spread object literal verbatim (#620). Beyond the
 * duplication, the copy-paste is what made both methods read as CCN 15-18: the
 * complexity was not in what they did, it was in how many tools they listed.
 *
 * The two copies differed in ONE way, and this function keeps the stricter
 * reading: an explicit `totalWarnings` wins when it is a number (including 0).
 * `createFromFiles` tested truthiness, so a deliberate `totalWarnings: 0` was
 * silently replaced by the sum -- the one case where the caller was trying to
 * override a stale per-tool count.
 */
function buildEntry(counts: Partial<BaselineEntry>): BaselineEntry {
  const entry: Partial<Record<ToolKey, unknown>> = {};
  let summed = 0;
  for (const key of TOOL_KEYS) {
    const tool = counts[key];
    if (!tool) continue;
    entry[key] = tool;
    summed += tool.warnings;
  }
  const totalWarnings = typeof counts.totalWarnings === 'number' ? counts.totalWarnings : summed;
  return {
    ...entry,
    totalWarnings,
    lastAnalyzed: new Date().toISOString(),
  } as BaselineEntry;
}

function computeSummaryStats(baseline: Record<string, BaselineEntry>) {
  let totalFiles = 0;
  let totalWarnings = 0;
  const toolStats: Record<string, { totalWarnings: number; totalErrors: number }> = {};
  let ccnTotalWarnings = 0;
  let ccnTotalMax = 0;

  for (const entry of Object.values(baseline)) {
    totalFiles++;
    totalWarnings += entry.totalWarnings;
    aggregateTool(toolStats, entry);
    if (entry.ccn) {
      ccnTotalWarnings += entry.ccn.warnings;
      ccnTotalMax += entry.ccn.max;
    }
  }

  if (ccnTotalWarnings > 0 || ccnTotalMax > 0) {
    toolStats.ccn = { totalWarnings: ccnTotalWarnings, totalErrors: 0, totalMax: ccnTotalMax } as unknown as { totalWarnings: number; totalErrors: number };
  }

  return {
    totalFiles,
    totalWarnings,
    averageWarningsPerFile: totalFiles > 0 ? totalWarnings / totalFiles : 0,
    ...toolStats,
  };
}

/** Tools whose counts are summed, and which shape their counter has. */
const AGGREGATED_TOOLS = ['eslint', 'principles', 'ruff', 'golangci', 'shellcheck'] as const;

function toolCounters(entry: BaselineEntry, key: typeof AGGREGATED_TOOLS[number]): { warnings: number; errors: number } {
  const tool = entry[key];
  if (!tool) return { warnings: 0, errors: 0 };
  return { warnings: tool.warnings, errors: tool.errors };
}

function aggregateTool(
  stats: Record<string, { totalWarnings: number; totalErrors: number }>,
  entry: BaselineEntry,
): void {
  for (const key of AGGREGATED_TOOLS) {
    const { warnings, errors } = toolCounters(entry, key);
    if (warnings <= 0 && errors <= 0) continue;
    const running = stats[key] ?? { totalWarnings: 0, totalErrors: 0 };
    stats[key] = {
      totalWarnings: running.totalWarnings + warnings,
      totalErrors: running.totalErrors + errors,
    };
  }
}

function validateNumber(
  entry: BaselineEntry,
  tool: string,
  file: string,
  props: string[],
): void {
  const obj = entry[tool as keyof BaselineEntry];
  if (!obj || typeof obj !== 'object') return;
  for (const prop of props) {
    if (typeof (obj as Record<string, unknown>)[prop] !== 'number') {
      throw new Error(`Invalid ${tool} properties for file ${file}`);
    }
  }
}

const ENTRY_VALIDATORS: ToolValidator[] = [
  e => validateNumber(e, 'eslint', '', ['warnings', 'errors']),
  e => validateNumber(e, 'principles', '', ['warnings', 'errors']),
  e => validateNumber(e, 'ccn', '', ['warnings', 'max']),
  e => validateNumber(e, 'ruff', '', ['warnings', 'errors']),
  e => validateNumber(e, 'golangci', '', ['warnings', 'errors']),
  e => validateNumber(e, 'shellcheck', '', ['warnings', 'errors']),
];

function validateEntry(file: string, entry: BaselineEntry): void {
  if (typeof entry.totalWarnings !== 'number' || entry.totalWarnings < 0) {
    throw new Error(`Invalid totalWarnings value for file ${file}: ${entry.totalWarnings}`);
  }
  if (typeof entry.lastAnalyzed !== 'string') {
    throw new Error(`Missing or invalid lastAnalyzed timestamp for file ${file}`);
  }
  for (const validator of ENTRY_VALIDATORS) {
    validator(entry, file);
  }
}

function filterBaselineWarnings(baseline: Record<string, BaselineEntry>, minWarningCount: number = 1): Record<string, BaselineEntry> {
  const filtered: Record<string, BaselineEntry> = {};
  for (const [file, entry] of Object.entries(baseline)) {
    if (entry.totalWarnings >= minWarningCount) {
      filtered[file] = entry;
    }
  }
  return filtered;
}

class BaselineStorage {
  private config: BaselineStorageConfig = {
    maxSize: 10000,
    timeoutMs: 300000, // 5 minutes
    batchSize: 50
  };

  constructor(config?: BaselineStorageConfig) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  async load(baselinePath: string): Promise<Record<string, BaselineEntry>> {
    try {
      await fs.access(baselinePath);
      const baselineContent = await fs.readFile(baselinePath, 'utf-8');
      return JSON.parse(baselineContent);
    } catch {
      return {};
    }
  }

  async save(baselinePath: string, baseline: Record<string, BaselineEntry>): Promise<void> {
    await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2));
  }

  validate(baseline: Record<string, BaselineEntry>): boolean {
    if (Object.keys(baseline).length > this.config.maxSize!) {
      throw new Error(`Baseline exceeds maximum size of ${this.config.maxSize} files`);
    }
    for (const [file, entry] of Object.entries(baseline)) {
      validateEntry(file, entry);
    }
    return true;
  }

  async createFromFiles(warningData: Array<{ file: string; counts: Partial<BaselineEntry> }>): Promise<Record<string, BaselineEntry>> {
    const baseline: Record<string, BaselineEntry> = {};
    for (const item of warningData) {
      baseline[item.file] = buildEntry(item.counts);
    }
    return baseline;
  }

  getSummaryStatistics(baseline: Record<string, BaselineEntry>) {
    return computeSummaryStats(baseline);
  }

  async initializeWithAnalyzer(
    files: string[],
    warningCountFunction: (file: string) => Promise<Partial<BaselineEntry>>,
    onProgress?: (progress: { current: number; total: number; completed: string[] }) => void
  ): Promise<Record<string, BaselineEntry>> {
    if (files.length > this.config.maxSize!) {
      throw new Error(`Trying to initialize baseline with ${files.length} files, which exceeds the maximum of ${this.config.maxSize}`);
    }

    const baseline: Record<string, BaselineEntry> = {};
    const totalFiles = files.length;
    const completed: string[] = [];

    const timeoutPromise = new Promise<Record<string, BaselineEntry>>((_, reject) => {
      setTimeout(() => reject(new Error('Baseline initialization timed out')), this.config.timeoutMs);
    });

    const processBatches = async () => {
      for (let i = 0; i < files.length; i += this.config.batchSize!) {
        const batch = files.slice(i, i + this.config.batchSize!);

        const promiseResults = await Promise.allSettled(
          batch.map(async (file) => {
            const counts = await warningCountFunction(file);
            baseline[file] = buildEntry(counts);
            completed.push(file);

            if (onProgress) {
              onProgress({
                current: completed.length,
                total: totalFiles,
                completed: [...completed]
              });
            }
          })
        );

        const rejectedPromises = promiseResults.filter(r => r.status === 'rejected') as Array<{ status: 'rejected'; reason: unknown }>;
        if (rejectedPromises.length > 0) {
          console.error('Some files failed to analyze:', rejectedPromises.map(r => r.reason));
        }
      }

      return baseline;
    };

    return Promise.race([processBatches(), timeoutPromise]);
  }
}

export {
  BaselineEntry,
  BaselineStorage,
  filterBaselineWarnings,
  type BaselineStorageConfig
};

