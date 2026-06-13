import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

function parseArgs(): { filesPattern: string; source: 'local' | 'ci' } {
  const args = process.argv.slice(2);
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

async function scanFiles(dir: string, results: string[], basePath: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(basePath, fullPath);

    if (entry.isDirectory()) {
      await scanFiles(fullPath, results, basePath);
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }
}

async function getSourceFiles(pattern: string): Promise<string[]> {
  const baseDir = process.cwd();
  const allFiles: string[] = [];

  const patternParts = pattern.split('/');
  const baseSearchDir = path.join(baseDir, patternParts[0]);

  await scanFiles(baseSearchDir, allFiles, baseDir);

  return allFiles.filter(file => {
    return (
      file.endsWith('.ts') &&
      !file.endsWith('.d.ts') &&
      !file.endsWith('.test.ts') &&
      !file.includes('/__tests__/') &&
      !file.includes('/adapters/')
    );
  });
}

async function runStryker(): Promise<void> {
  console.log('Running Stryker mutation testing...');
  try {
    const { stdout, stderr } = await execAsync('npx stryker run', {
      cwd: process.cwd(),
      timeout: 600000
    });
    console.log(stdout);
    if (stderr) {
      console.error(stderr);
    }
  } catch {
    console.log('Stryker finished (possible threshold violations).');
  }
}

async function parseStrykerReport(reportPath: string): Promise<StrykerReport> {
  const reportContent = await fs.readFile(reportPath, 'utf-8');
  return JSON.parse(reportContent) as StrykerReport;
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

async function saveBaseline(baseline: MutationBaseline, outputPath: string): Promise<void> {
  await fs.writeFile(outputPath, JSON.stringify(baseline, null, 2));
}

async function main(): Promise<void> {
  const { filesPattern, source } = parseArgs();

  console.log(`Scanning source files with pattern: ${filesPattern}`);
  const sourceFiles = await getSourceFiles(filesPattern);
  console.log(`Found ${sourceFiles.length} source files`);

  await runStryker();

  const reportPath = path.join(process.cwd(), 'reports', 'mutation', 'report.json');
  console.log(`Parsing Stryker report: ${reportPath}`);

  const report = await parseStrykerReport(reportPath);
  const baseline = buildBaseline(report, sourceFiles, source);

  const outputPath = path.join(process.cwd(), '.mutation-baseline.json');
  await saveBaseline(baseline, outputPath);

  console.log(`Mutation baseline saved to ${outputPath}`);
  console.log(`Total files: ${Object.keys(baseline.scores).length}`);
  console.log(`Average score: ${
    Object.values(baseline.scores).reduce((sum, e) => sum + e.score, 0) /
    (Object.keys(baseline.scores).length || 1)
  }%`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Failed to initialize mutation baseline: ${message}`);
  process.exit(1);
});
