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

function aggregateTool(stats: Record<string, { totalWarnings: number; totalErrors: number }>, entry: BaselineEntry) {
  const tools: Array<{ key: string; warnings: number; errors: number }> = [
    { key: 'eslint', warnings: entry.eslint?.warnings ?? 0, errors: entry.eslint?.errors ?? 0 },
    { key: 'principles', warnings: entry.principles?.warnings ?? 0, errors: entry.principles?.errors ?? 0 },
    { key: 'ruff', warnings: entry.ruff?.warnings ?? 0, errors: entry.ruff?.errors ?? 0 },
    { key: 'golangci', warnings: entry.golangci?.warnings ?? 0, errors: entry.golangci?.errors ?? 0 },
    { key: 'shellcheck', warnings: entry.shellcheck?.warnings ?? 0, errors: entry.shellcheck?.errors ?? 0 },
  ];
  for (const t of tools) {
    if (t.warnings > 0 || t.errors > 0) {
      stats[t.key] = { totalWarnings: (stats[t.key]?.totalWarnings || 0) + t.warnings, totalErrors: (stats[t.key]?.totalErrors || 0) + t.errors };
    }
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
      let totalWarnings = 0;
      
      if (item.counts.eslint?.warnings) {
        totalWarnings += item.counts.eslint.warnings;
      }
      if (item.counts.principles?.warnings) {
        totalWarnings += item.counts.principles.warnings;
      }
      if (item.counts.ccn?.warnings) {
        totalWarnings += item.counts.ccn.warnings;
      }
      if (item.counts.ruff?.warnings) {
        totalWarnings += item.counts.ruff.warnings;
      }
      if (item.counts.golangci?.warnings) {
        totalWarnings += item.counts.golangci.warnings;
      }
      if (item.counts.shellcheck?.warnings) {
        totalWarnings += item.counts.shellcheck.warnings;
      }
      if (item.counts.totalWarnings) {
        totalWarnings = item.counts.totalWarnings;
      }
      
      baseline[item.file] = {
        ...(item.counts.eslint && { eslint: item.counts.eslint }),
        ...(item.counts.principles && { principles: item.counts.principles }),
        ...(item.counts.ccn && { ccn: item.counts.ccn }),
        ...(item.counts.ruff && { ruff: item.counts.ruff }),
        ...(item.counts.golangci && { golangci: item.counts.golangci }),
        ...(item.counts.shellcheck && { shellcheck: item.counts.shellcheck }),
        totalWarnings,
        lastAnalyzed: new Date().toISOString()
      };
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
            
            let totalWarnings = 0;
            if (counts.eslint?.warnings) totalWarnings += counts.eslint.warnings;
            if (counts.principles?.warnings) totalWarnings += counts.principles.warnings;
            if (counts.ccn?.warnings) totalWarnings += counts.ccn.warnings;
            if (counts.ruff?.warnings) totalWarnings += counts.ruff.warnings;
            if (counts.golangci?.warnings) totalWarnings += counts.golangci.warnings;
            if (counts.shellcheck?.warnings) totalWarnings += counts.shellcheck.warnings;
            if (counts.totalWarnings !== undefined) totalWarnings = counts.totalWarnings;

            const baselineEntry: BaselineEntry = {
              ...(counts.eslint && { eslint: counts.eslint }),
              ...(counts.principles && { principles: counts.principles }),
              ...(counts.ccn && { ccn: counts.ccn }),
              ...(counts.ruff && { ruff: counts.ruff }),
              ...(counts.golangci && { golangci: counts.golangci }),
              ...(counts.shellcheck && { shellcheck: counts.shellcheck }),
              totalWarnings,
              lastAnalyzed: new Date().toISOString()
            };

            baseline[file] = baselineEntry;
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

