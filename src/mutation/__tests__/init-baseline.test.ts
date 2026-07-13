/**
 * @test init-baseline.ts - Mutation Baseline Initialization
 * @intent Verify argument parsing, score calculation, baseline construction,
 *         and source file filtering logic used by the init-baseline CLI script.
 * @covers REQ-MUT-002 AC-001, AC-002, AC-003, AC-004
 */

import { describe, it, expect } from 'vitest';

// ─── Inline copies of pure functions from init-baseline.ts ───────────────────
// The module runs main() on import, so we cannot import it directly.
// These are faithful copies of the pure logic for unit testing.
// See gate-m.test.ts for the same pattern used in this project.

interface MutantStatus {
  id: string;
  mutatorName: string;
  replacement: string;
  location: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  status: string;
}

interface StrykerFileReport {
  source: string;
  mutants: MutantStatus[];
}

interface StrykerReport {
  schemaVersion: string;
  thresholds: {
    high: number;
    low: number;
    break: number | null;
  };
  files: Record<string, StrykerFileReport>;
}

interface MutationScoreEntry {
  score: number;
  mutants: number;
  killed: number;
  survived: number;
}

interface MutationBaseline {
  version: string;
  generatedAt: string;
  source: 'local' | 'ci';
  scores: Record<string, MutationScoreEntry>;
}

function parseArgs(args: string[]): { filesPattern: string; source: 'local' | 'ci' } {
  let filesPattern = 'src/**/*.ts';
  let source: 'local' | 'ci' = 'local';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--files' && args[i + 1]) {
      filesPattern = args[i + 1];
      i++;
    }
    if (args[i] === '--source' && args[i + 1]) {
      source = args[i + 1] as 'local' | 'ci';
      i++;
    }
  }

  return { filesPattern, source };
}

function calculateScore(entry: StrykerFileReport): MutationScoreEntry {
  const total = entry.mutants.length;
  const killed = entry.mutants.filter(m => m.status === 'Killed').length;
  const survived = entry.mutants.filter(m => m.status === 'Survived').length;

  return {
    score: total > 0 ? parseFloat(((killed / total) * 100).toFixed(1)) : 100,
    mutants: total,
    killed,
    survived
  };
}

function buildBaseline(
  report: StrykerReport,
  sourceFiles: string[],
  source: 'local' | 'ci'
): MutationBaseline {
  const scores: Record<string, MutationScoreEntry> = {};

  for (const [filePath, fileReport] of Object.entries(report.files)) {
    const relativePath = filePath.replace(/^\//, '');
    if (sourceFiles.includes(relativePath) || sourceFiles.some(sf => relativePath.endsWith(sf))) {
      scores[relativePath] = calculateScore(fileReport);
    }
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    source,
    scores
  };
}

function isSourceFile(file: string): boolean {
  return (
    file.endsWith('.ts') &&
    !file.endsWith('.d.ts') &&
    !file.endsWith('.test.ts') &&
    !file.includes('/__tests__/') &&
    !file.includes('/adapters/')
  );
}

// ─── Helper factories ────────────────────────────────────────────────────────

function makeMutant(status: string, id = '0'): MutantStatus {
  return {
    id,
    mutatorName: 'BlockMutator',
    replacement: '{}',
    location: {
      start: { line: 1, column: 0 },
      end: { line: 1, column: 10 }
    },
    status
  };
}

function makeFileReport(mutants: MutantStatus[]): StrykerFileReport {
  return { source: 'const x = 1;', mutants };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('returns defaults when no arguments provided', () => {
    const result = parseArgs([]);
    expect(result.filesPattern).toBe('src/**/*.ts');
    expect(result.source).toBe('local');
  });

  it('parses --files flag', () => {
    const result = parseArgs(['--files', 'lib/**/*.ts']);
    expect(result.filesPattern).toBe('lib/**/*.ts');
    expect(result.source).toBe('local');
  });

  it('parses --source flag', () => {
    const result = parseArgs(['--source', 'ci']);
    expect(result.filesPattern).toBe('src/**/*.ts');
    expect(result.source).toBe('ci');
  });

  it('parses both --files and --source flags', () => {
    const result = parseArgs(['--files', 'app/**/*.ts', '--source', 'ci']);
    expect(result.filesPattern).toBe('app/**/*.ts');
    expect(result.source).toBe('ci');
  });

  it('ignores --files without a following value', () => {
    const result = parseArgs(['--files']);
    expect(result.filesPattern).toBe('src/**/*.ts');
  });

  it('ignores unknown flags', () => {
    const result = parseArgs(['--verbose', '--dry-run']);
    expect(result.filesPattern).toBe('src/**/*.ts');
    expect(result.source).toBe('local');
  });
});

describe('calculateScore', () => {
  it('returns 100 score when no mutants exist', () => {
    const entry = makeFileReport([]);
    const result = calculateScore(entry);
    expect(result.score).toBe(100);
    expect(result.mutants).toBe(0);
    expect(result.killed).toBe(0);
    expect(result.survived).toBe(0);
  });

  it('calculates score from killed and total mutants', () => {
    const entry = makeFileReport([
      makeMutant('Killed', '0'),
      makeMutant('Killed', '1'),
      makeMutant('Survived', '2'),
      makeMutant('Survived', '3')
    ]);
    const result = calculateScore(entry);
    expect(result.mutants).toBe(4);
    expect(result.killed).toBe(2);
    expect(result.survived).toBe(2);
    expect(result.score).toBe(50);
  });

  it('returns 100 score when all mutants are killed', () => {
    const entry = makeFileReport([
      makeMutant('Killed', '0'),
      makeMutant('Killed', '1'),
      makeMutant('Killed', '2')
    ]);
    const result = calculateScore(entry);
    expect(result.score).toBe(100);
    expect(result.killed).toBe(3);
    expect(result.survived).toBe(0);
  });

  it('returns 0 score when all mutants survived', () => {
    const entry = makeFileReport([
      makeMutant('Survived', '0'),
      makeMutant('Survived', '1')
    ]);
    const result = calculateScore(entry);
    expect(result.score).toBe(0);
    expect(result.killed).toBe(0);
    expect(result.survived).toBe(2);
  });

  it('ignores non-Killed/Survived statuses in killed/survived counts', () => {
    const entry = makeFileReport([
      makeMutant('Killed', '0'),
      makeMutant('NoCoverage', '1'),
      makeMutant('RuntimeError', '2'),
      makeMutant('Survived', '3')
    ]);
    const result = calculateScore(entry);
    expect(result.mutants).toBe(4);
    expect(result.killed).toBe(1);
    expect(result.survived).toBe(1);
    expect(result.score).toBe(25);
  });

  it('rounds score to one decimal place', () => {
    const entry = makeFileReport([
      makeMutant('Killed', '0'),
      makeMutant('Killed', '1'),
      makeMutant('Survived', '2')
    ]);
    const result = calculateScore(entry);
    // 2/3 * 100 = 66.666... → 66.7
    expect(result.score).toBe(66.7);
  });
});

describe('buildBaseline', () => {
  const emptyReport: StrykerReport = {
    schemaVersion: '1.0',
    thresholds: { high: 80, low: 60, break: null },
    files: {}
  };

  it('returns empty scores when report has no files', () => {
    const baseline = buildBaseline(emptyReport, [], 'local');
    expect(baseline.version).toBe('1.0');
    expect(baseline.source).toBe('local');
    expect(baseline.scores).toEqual({});
    expect(baseline.generatedAt).toBeDefined();
  });

  it('includes only source files in baseline scores', () => {
    const report: StrykerReport = {
      schemaVersion: '1.0',
      thresholds: { high: 80, low: 60, break: null },
      files: {
        'src/auth.ts': makeFileReport([makeMutant('Killed', '0')]),
        'src/utils.ts': makeFileReport([makeMutant('Survived', '0')]),
        'dist/bundle.js': makeFileReport([makeMutant('Killed', '0')])
      }
    };
    const sourceFiles = ['src/auth.ts', 'src/utils.ts'];
    const baseline = buildBaseline(report, sourceFiles, 'ci');
    expect(Object.keys(baseline.scores)).toHaveLength(2);
    expect(baseline.scores['src/auth.ts']).toBeDefined();
    expect(baseline.scores['src/utils.ts']).toBeDefined();
    expect(baseline.scores['dist/bundle.js']).toBeUndefined();
    expect(baseline.source).toBe('ci');
  });

  it('strips leading slash from file paths', () => {
    const report: StrykerReport = {
      schemaVersion: '1.0',
      thresholds: { high: 80, low: 60, break: null },
      files: {
        '/src/auth.ts': makeFileReport([makeMutant('Killed', '0')])
      }
    };
    const sourceFiles = ['src/auth.ts'];
    const baseline = buildBaseline(report, sourceFiles, 'local');
    expect(baseline.scores['src/auth.ts']).toBeDefined();
  });

  it('matches files by suffix when exact match fails', () => {
    const report: StrykerReport = {
      schemaVersion: '1.0',
      thresholds: { high: 80, low: 60, break: null },
      files: {
        'packages/core/src/auth.ts': makeFileReport([makeMutant('Killed', '0')])
      }
    };
    const sourceFiles = ['src/auth.ts'];
    const baseline = buildBaseline(report, sourceFiles, 'local');
    expect(baseline.scores['packages/core/src/auth.ts']).toBeDefined();
  });

  it('sets generatedAt to a valid ISO date string', () => {
    const baseline = buildBaseline(emptyReport, [], 'local');
    const parsed = new Date(baseline.generatedAt);
    expect(parsed.toISOString()).toBe(baseline.generatedAt);
  });
});

describe('isSourceFile (getSourceFiles filter predicate)', () => {
  it('accepts regular .ts files', () => {
    expect(isSourceFile('src/auth.ts')).toBe(true);
    expect(isSourceFile('src/utils/helper.ts')).toBe(true);
  });

  it('rejects .d.ts declaration files', () => {
    expect(isSourceFile('src/types.d.ts')).toBe(false);
    expect(isSourceFile('src/global.d.ts')).toBe(false);
  });

  it('rejects .test.ts files', () => {
    expect(isSourceFile('src/auth.test.ts')).toBe(false);
    expect(isSourceFile('src/utils/helper.test.ts')).toBe(false);
  });

  it('rejects files in __tests__ directories', () => {
    expect(isSourceFile('src/__tests__/auth.test.ts')).toBe(false);
    expect(isSourceFile('src/__tests__/helpers.ts')).toBe(false);
  });

  it('rejects files in adapters directories', () => {
    expect(isSourceFile('githooks/adapters/typescript.sh')).toBe(false);
    expect(isSourceFile('src/adapters/go.ts')).toBe(false);
  });

  it('rejects non-.ts files', () => {
    expect(isSourceFile('src/index.js')).toBe(false);
    expect(isSourceFile('src/style.css')).toBe(false);
    expect(isSourceFile('README.md')).toBe(false);
  });
});
