import fs from 'fs/promises';
import path from 'path';

interface BaselineEntry {
  eslint?: { warnings: number; errors: number };
  principles?: { warnings: number; errors: number };
  ccn?: { warnings: number; max: number };
  totalWarnings: number;
  lastAnalyzed: string;
}

interface BaselineStorageConfig {
  maxSize?: number;
  timeoutMs?: number;
  batchSize?: number;
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
    } catch (error) {
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
      if (typeof entry.totalWarnings !== 'number' || entry.totalWarnings < 0) {
        throw new Error(`Invalid totalWarnings value for file ${file}: ${entry.totalWarnings}`);
      }

      if (typeof entry.lastAnalyzed !== 'string') {
        throw new Error(`Missing or invalid lastAnalyzed timestamp for file ${file}`);
      }

      if (entry.eslint) {
        if (typeof entry.eslint.warnings !== 'number' || typeof entry.eslint.errors !== 'number') {
          throw new Error(`Invalid eslint properties for file ${file}`);
        }
      }

      if (entry.principles) {
        if (typeof entry.principles.warnings !== 'number' || typeof entry.principles.errors !== 'number') {
          throw new Error(`Invalid principles properties for file ${file}`);
        }
      }

      if (entry.ccn) {
        if (typeof entry.ccn.warnings !== 'number' || typeof entry.ccn.max !== 'number') {
          throw new Error(`Invalid ccn properties for file ${file}`);
        }
      }
    }

    return true;
  }

  filterToIncludeOnlyFilesWithWarnings(baseline: Record<string, BaselineEntry>, minWarningCount: number = 1): Record<string, BaselineEntry> {
    const filtered: Record<string, BaselineEntry> = {};
    
    for (const [file, entry] of Object.entries(baseline)) {
      if (entry.totalWarnings >= minWarningCount) {
        filtered[file] = entry;
      }
    }
    
    return filtered;
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
      if (item.counts.totalWarnings) {
        totalWarnings = item.counts.totalWarnings;
      }
      
      baseline[item.file] = {
        ...(item.counts.eslint && { eslint: item.counts.eslint }),
        ...(item.counts.principles && { principles: item.counts.principles }),
        ...(item.counts.ccn && { ccn: item.counts.ccn }),
        totalWarnings,
        lastAnalyzed: new Date().toISOString()
      };
    }
    
    return baseline;
  }

  getSummaryStatistics(baseline: Record<string, BaselineEntry>) {
    let totalFiles = 0;
    let totalWarnings = 0;
    const toolStats: { eslint?: { totalWarnings: number; totalErrors: number }; principles?: { totalWarnings: number; totalErrors: number }; ccn?: { totalWarnings: number; totalMax: number } } = {};
    
    for (const entry of Object.values(baseline)) {
      totalFiles++;
      totalWarnings += entry.totalWarnings;
      
      if (entry.eslint) {
        const eslintStats = toolStats.eslint || { totalWarnings: 0, totalErrors: 0 };
        eslintStats.totalWarnings += entry.eslint.warnings;
        eslintStats.totalErrors += entry.eslint.errors;
        toolStats.eslint = eslintStats;
      }
      
      if (entry.principles) {
        const principlesStats = toolStats.principles || { totalWarnings: 0, totalErrors: 0 };
        principlesStats.totalWarnings += entry.principles.warnings;
        principlesStats.totalErrors += entry.principles.errors;
        toolStats.principles = principlesStats;
      }
      
      if (entry.ccn) {
        const ccnStats = toolStats.ccn || { totalWarnings: 0, totalMax: 0 };
        ccnStats.totalWarnings += entry.ccn.warnings;
        ccnStats.totalMax += entry.ccn.max;
        toolStats.ccn = ccnStats;
      }
    }
    
    return {
      totalFiles,
      totalWarnings,
      averageWarningsPerFile: totalFiles > 0 ? totalWarnings / totalFiles : 0,
      ...toolStats
    };
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
            if (counts.totalWarnings !== undefined) totalWarnings = counts.totalWarnings;

            const baselineEntry: BaselineEntry = {
              ...(counts.eslint && { eslint: counts.eslint }),
              ...(counts.principles && { principles: counts.principles }),
              ...(counts.ccn && { ccn: counts.ccn }),
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

        const rejectedPromises = promiseResults.filter(r => r.status === 'rejected') as Array<{ status: 'rejected'; reason: any }>;
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
  type BaselineStorageConfig
};

export type { BaselineEntry as BaselineEntryInterface };