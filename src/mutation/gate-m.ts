import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import {
  GateMOptions,
  GateMResult,
  GateMStatus,
  MutationBaseline,
  MutationScore,
  StrykerReport,
  FileThreshold,
  ScoreEvaluation,
  TestIntentCheckResult
} from './types';
import { detectAITestCharacteristics } from './detect-ai-test';

const DEFAULT_THRESHOLD = 60;
const CRITICAL_PATH_THRESHOLD = 80;
const STRYKER_REPORT_PATH = '.stryker-report.json';
const STRYKER_CONFIG = 'stryker.prepush.conf.json';

type ArgHandler = (options: GateMOptions, args: string[], i: number) => void;

const ARG_HANDLERS: Record<string, ArgHandler> = {
  '--changed-files': parseChangedFiles,
  '--baseline': parseBaseline,
  '--critical-paths': parseCriticalPaths,
  '--timeout': parseTimeout
};

function parseArgs(args: string[]): GateMOptions {
  const options: GateMOptions = {
    changedFiles: [],
    baselinePath: '.mutation-baseline.json',
    criticalPathsPath: '.mutation-critical-paths',
    timeoutMs: 120000
  };

  for (let i = 0; i < args.length; i++) {
    const handler = ARG_HANDLERS[args[i]];
    if (handler) {
      handler(options, args, i);
    }
  }

  return options;
}

function parseChangedFiles(options: GateMOptions, args: string[], i: number): void {
  const next = args[++i];
  if (next) {
    options.changedFiles = next.split(',').map(f => f.trim()).filter(Boolean);
  }
}

function parseBaseline(options: GateMOptions, args: string[], i: number): void {
  const next = args[++i];
  if (next) options.baselinePath = next;
}

function parseCriticalPaths(options: GateMOptions, args: string[], i: number): void {
  const next = args[++i];
  if (next) options.criticalPathsPath = next;
}

function parseTimeout(options: GateMOptions, args: string[], i: number): void {
  const next = args[++i];
  if (next) options.timeoutMs = parseInt(next, 10);
}

function filterSourceFiles(files: string[]): string[] {
  return files.filter(file => {
    if (!file.endsWith('.ts')) return false;
    if (file.endsWith('.test.ts')) return false;
    if (file.endsWith('.d.ts')) return false;
    if (file.includes('/adapters/')) return false;
    return true;
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findTestFile(sourceFile: string): Promise<string | null> {
  const testFile1 = sourceFile.replace(/\.ts$/, '.test.ts');
  if (await fileExists(testFile1)) return testFile1;

  const dir = path.dirname(sourceFile);
  const basename = path.basename(sourceFile, '.ts');
  const testFile2 = path.join(dir, '__tests__', `${basename}.test.ts`);
  if (await fileExists(testFile2)) return testFile2;

  return null;
}

async function checkTestIntents(
  sourceFiles: string[]
): Promise<TestIntentCheckResult[]> {
  const results: TestIntentCheckResult[] = [];

  for (const sourceFile of sourceFiles) {
    const testFile = await findTestFile(sourceFile);
    if (!testFile) {
      results.push({
        sourceFile,
        testFile: null,
        hasTestAnnotation: false,
        hasIntentAnnotation: false,
        hasCoversAnnotation: false,
        missingAnnotations: ['@test', '@intent', '@covers']
      });
      continue;
    }

    const detection = await detectAITestCharacteristics(testFile);
    const missingAnnotations: string[] = [];
    if (!detection.annotations.hasTest) missingAnnotations.push('@test');
    if (!detection.annotations.hasIntent) missingAnnotations.push('@intent');
    if (!detection.annotations.hasCovers) missingAnnotations.push('@covers');

    results.push({
      sourceFile,
      testFile,
      hasTestAnnotation: detection.annotations.hasTest,
      hasIntentAnnotation: detection.annotations.hasIntent,
      hasCoversAnnotation: detection.annotations.hasCovers,
      missingAnnotations
    });
  }

  return results;
}

async function loadCriticalPaths(configPath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        regexStr += '.*';
        i += 2;
      } else {
        regexStr += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      regexStr += '[^/]';
      i++;
    } else if ('.[]{}()|^$+\\'.includes(c)) {
      regexStr += '\\' + c;
      i++;
    } else {
      regexStr += c;
      i++;
    }
  }
  return new RegExp(`^${regexStr}$`);
}

function isCriticalPath(file: string, patterns: string[]): boolean {
  return patterns.some(pattern => globToRegex(pattern).test(file));
}

async function loadBaseline(baselinePath: string): Promise<MutationBaseline | null> {
  try {
    const content = await fs.readFile(baselinePath, 'utf-8');
    const parsed = JSON.parse(content) as MutationBaseline;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.scores === 'object' &&
      parsed.scores !== null
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function determineThresholds(
  sourceFiles: string[],
  criticalPaths: string[]
): Promise<FileThreshold[]> {
  const thresholds: FileThreshold[] = [];

  for (const file of sourceFiles) {
    const testFile = await findTestFile(file);
    let explicitThreshold: number | undefined;
    if (testFile) {
      const detection = await detectAITestCharacteristics(testFile);
      explicitThreshold = detection.explicitThreshold;
    }

    const isCritical = isCriticalPath(file, criticalPaths);
    const threshold = explicitThreshold !== undefined
      ? explicitThreshold
      : isCritical
        ? CRITICAL_PATH_THRESHOLD
        : DEFAULT_THRESHOLD;

    thresholds.push({
      file,
      threshold,
      isCriticalPath: isCritical,
      explicitThreshold
    });
  }

  return thresholds;
}

function runStryker(
  files: string[],
  timeoutMs: number
): Promise<{ report: StrykerReport | null; timedOut: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = [
      'stryker',
      'run',
      '--config',
      STRYKER_CONFIG,
      ...files.flatMap(f => ['--mutate', f])
    ];

    const child = spawn('npx', args, {
      stdio: 'pipe',
      shell: false
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeoutMs);

    child.on('close', async (code) => {
      clearTimeout(timeoutId);

      if (code === null) {
        resolve({ report: null, timedOut: true });
        return;
      }

      const report = await parseStrykerReport(STRYKER_REPORT_PATH);
      resolve({ report, timedOut: false, error: code !== 0 ? stderr || stdout : undefined });
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({ report: null, timedOut: false, error: err.message });
    });
  });
}

async function parseStrykerReport(reportPath: string): Promise<StrykerReport | null> {
  try {
    const content = await fs.readFile(reportPath, 'utf-8');
    const parsed = JSON.parse(content);
    return parseReportObject(parsed);
  } catch {
    return null;
  }
}

function parseReportObject(parsed: Record<string, unknown>): StrykerReport {
  const report: StrykerReport = {
    mutationScore: asNumber(parsed.mutationScore),
    nrOfMutants: asNumber(parsed.nrOfMutants),
    nrOfKilledMutants: asNumber(parsed.nrOfKilledMutants),
    nrOfSurvivedMutants: asNumber(parsed.nrOfSurvivedMutants),
  };

  if (parsed.files && typeof parsed.files === 'object') {
    report.files = parseFilesObject(parsed.files as Record<string, Record<string, unknown>>);
  }

  return report;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function parseFilesObject(
  filesObj: Record<string, Record<string, unknown>>
): Record<string, { mutationScore: number; nrOfMutants: number; nrOfKilledMutants: number; nrOfSurvivedMutants: number }> {
  const files: Record<string, { mutationScore: number; nrOfMutants: number; nrOfKilledMutants: number; nrOfSurvivedMutants: number }> = {};
  for (const [file, data] of Object.entries(filesObj)) {
    files[file] = {
      mutationScore: asNumber(data.mutationScore),
      nrOfMutants: asNumber(data.nrOfMutants),
      nrOfKilledMutants: asNumber(data.nrOfKilledMutants),
      nrOfSurvivedMutants: asNumber(data.nrOfSurvivedMutants),
    };
  }
  return files;
}

function evaluateScores(
  report: StrykerReport,
  thresholds: FileThreshold[],
  baseline: MutationBaseline | null
): { evaluations: ScoreEvaluation[]; blocked: boolean; messages: string[] } {
  const evaluations: ScoreEvaluation[] = [];
  const messages: string[] = [];
  let blocked = false;

  for (const ft of thresholds) {
    const result = evaluateFileThreshold(ft, report, baseline);
    evaluations.push(result.evaluation);
    if (!result.evaluation.passed) blocked = true;
    messages.push(result.message);
  }

  return { evaluations, blocked, messages };
}

function evaluateFileThreshold(
  ft: FileThreshold,
  report: StrykerReport,
  baseline: MutationBaseline | null
): { evaluation: ScoreEvaluation; message: string } {
  const fileReport = report.files
    ? Object.entries(report.files).find(([key]) => key === ft.file)?.[1]
    : undefined;

  const score = fileReport?.mutationScore ?? report.mutationScore;
  const baselineScore = baseline?.scores[ft.file]?.score;

  let effectiveThreshold = ft.threshold;
  if (baselineScore !== undefined && score < baselineScore) {
    effectiveThreshold = Math.max(effectiveThreshold, baselineScore);
  }

  const passed = score >= effectiveThreshold;
  const isRegression = baselineScore !== undefined && score < baselineScore;

  const evaluation: ScoreEvaluation = {
    file: ft.file,
    score,
    threshold: effectiveThreshold,
    baselineScore,
    passed,
    isRegression
  };

  const message = buildScoreMessage({ file: ft.file, score, effectiveThreshold, baselineScore, passed, isRegression });

  return { evaluation, message };
}

interface ScoreMessageParams {
  file: string;
  score: number;
  effectiveThreshold: number;
  baselineScore: number | undefined;
  passed: boolean;
  isRegression: boolean;
}

function buildScoreMessage(params: ScoreMessageParams): string {
  const { file, score, effectiveThreshold, baselineScore, passed, isRegression } = params;
  if (!passed) {
    if (isRegression && baselineScore !== undefined) {
      return `BLOCK ${file}: mutation score ${score.toFixed(1)}% < baseline ${baselineScore.toFixed(1)}% (was ${effectiveThreshold}% threshold)`;
    }
    return `BLOCK ${file}: mutation score ${score.toFixed(1)}% < threshold ${effectiveThreshold}%`;
  }
  return `PASS ${file}: mutation score ${score.toFixed(1)}% >= ${effectiveThreshold}%${baselineScore !== undefined ? ` (baseline: ${baselineScore.toFixed(1)}%)` : ''}`;
}

function buildResult(
  status: GateMStatus,
  filesChecked: number,
  scores: Record<string, MutationScore>,
  warnings: string[],
  errors: string[]
): GateMResult {
  return {
    exitCode: status === 'block' ? 1 : 0,
    status,
    filesChecked,
    scores,
    warnings,
    errors
  };
}

export async function runGateM(options: GateMOptions): Promise<GateMResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const sourceFiles = filterSourceFiles(options.changedFiles);

  if (sourceFiles.length === 0) {
    return buildResult('skip', 0, {}, warnings, errors);
  }

  collectTestIntentWarnings(sourceFiles, warnings);

  const thresholds = await determineThresholdsWithLogging(options, sourceFiles);
  const baseline = await loadBaselineWithLogging(options.baselinePath);

  const strykerResult = await runStryker(sourceFiles, options.timeoutMs);
  const timeoutResult = handleTimeout(strykerResult, options, sourceFiles, warnings, errors);
  if (timeoutResult) return timeoutResult;

  const errorResult = handleStrykerError(strykerResult, sourceFiles, warnings, errors);
  if (errorResult) return errorResult;

  const reportResult = handleMissingReport(strykerResult, sourceFiles, warnings, errors);
  if (reportResult) return reportResult;

  const evalResult = evaluateAndReport(strykerResult.report, thresholds, baseline);

  if (evalResult.blocked) {
    return buildResult('block', sourceFiles.length, evalResult.scores, warnings, errors);
  }

  return buildResult('pass', sourceFiles.length, evalResult.scores, warnings, errors);
}

function collectTestIntentWarnings(sourceFiles: string[], warnings: string[]): void {
  checkTestIntents(sourceFiles).then((results) => {
    for (const result of results) {
      if (result.missingAnnotations.length > 0) {
        const testFileInfo = result.testFile ? ` (${result.testFile})` : ' (no test file found)';
        warnings.push(
          `Warning: ${result.sourceFile}${testFileInfo} missing annotations: ${result.missingAnnotations.join(', ')}`
        );
      }
    }
  });
}

async function determineThresholdsWithLogging(
  options: GateMOptions,
  sourceFiles: string[]
): Promise<FileThreshold[]> {
  const criticalPaths = await loadCriticalPaths(options.criticalPathsPath);
  const thresholds = await determineThresholds(sourceFiles, criticalPaths);

  for (const ft of thresholds) {
    const level = ft.isCriticalPath ? 'critical path' : 'default';
    const thresholdSource = ft.explicitThreshold !== undefined
      ? 'explicit annotation'
      : ft.isCriticalPath
        ? 'critical path config'
        : 'default';
    console.log(`  ${ft.file}: threshold=${ft.threshold}% (${level}, ${thresholdSource})`);
  }

  return thresholds;
}

async function loadBaselineWithLogging(baselinePath: string): Promise<MutationBaseline | null> {
  const baseline = await loadBaseline(baselinePath);
  if (baseline) {
    console.log(`  Loaded baseline from ${baselinePath} (${Object.keys(baseline.scores).length} files)`);
  }
  return baseline;
}

function handleTimeout(
  strykerResult: { report: StrykerReport | null; timedOut: boolean; error?: string },
  options: GateMOptions,
  sourceFiles: string[],
  warnings: string[],
  errors: string[]
): GateMResult | null {
  if (!strykerResult.timedOut) return null;

  warnings.push(
    `Mutation testing timed out (>${options.timeoutMs}ms). Push allowed. Run 'npm run test:mutation' locally for full report.`
  );
  return buildResult('timeout', sourceFiles.length, {}, warnings, errors);
}

function handleStrykerError(
  strykerResult: { report: StrykerReport | null; timedOut: boolean; error?: string },
  sourceFiles: string[],
  warnings: string[],
  errors: string[]
): GateMResult | null {
  if (!strykerResult.error || strykerResult.report) return null;

  errors.push(`Stryker failed: ${strykerResult.error}`);
  return buildResult('block', sourceFiles.length, {}, warnings, errors);
}

function handleMissingReport(
  strykerResult: { report: StrykerReport | null; timedOut: boolean; error?: string },
  sourceFiles: string[],
  warnings: string[],
  errors: string[]
): GateMResult | null {
  if (strykerResult.report) return null;

  errors.push('Stryker report not found or invalid.');
  return buildResult('block', sourceFiles.length, {}, warnings, errors);
}

function evaluateAndReport(
  report: StrykerReport | null,
  thresholds: FileThreshold[],
  baseline: MutationBaseline | null
): { scores: Record<string, MutationScore>; blocked: boolean; messages: string[] } {
  if (!report) {
    return { scores: {}, blocked: true, messages: ['Stryker report unavailable'] };
  }
  const scores: Record<string, MutationScore> = {};

  if (report.files) {
    for (const [file, data] of Object.entries(report.files)) {
      scores[file] = {
        score: data.mutationScore,
        mutants: data.nrOfMutants,
        killed: data.nrOfKilledMutants,
        survived: data.nrOfSurvivedMutants
      };
    }
  }

  const evalResult = evaluateScores(report, thresholds, baseline);

  for (const msg of evalResult.messages) {
    console.log(`  ${msg}`);
  }

  return { scores, blocked: evalResult.blocked, messages: evalResult.messages.filter(Boolean) };
}

export async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);

  if (options.changedFiles.length === 0) {
    console.error('Usage: npx tsx src/mutation/gate-m.ts --changed-files "file1.ts,file2.ts" [--baseline <path>] [--critical-paths <path>]');
    return 1;
  }

  console.log(`Gate M: Mutation Testing`);
  console.log(`  Changed files: ${options.changedFiles.length}`);
  console.log(`  Baseline: ${options.baselinePath}`);
  console.log(`  Critical paths: ${options.criticalPathsPath}`);
  console.log(`  Timeout: ${options.timeoutMs}ms`);

  const result = await runGateM(options);

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of result.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.error(`  ✗ ${error}`);
    }
  }

  const statusIcon = result.status === 'pass' ? '✓' :
    result.status === 'skip' ? '⊘' :
    result.status === 'timeout' ? '⏱' : '✗';

  console.log(`\n${statusIcon} Gate M ${result.status.toUpperCase()} (${result.filesChecked} files checked)`);

  return result.exitCode;
}

const args = process.argv.slice(2);
if (typeof require !== 'undefined' && require.main === module) {
  main(args)
    .then(exitCode => {
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    })
    .catch(err => {
      console.error('Gate M failed:', err.message);
      process.exit(1);
    });
}
// trigger Gate M
