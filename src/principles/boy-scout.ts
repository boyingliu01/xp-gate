import * as fs from 'fs/promises';
import { analyze, getAdapterForFile } from './analyzer';
import { getAllRules } from './index';

interface FileClassification {
  new: string[];
  modified: string[];
  deleted: string[];
  renamed: { oldPath: string; newPath: string }[];
}

// Exported helper to get warning counts for a batch of files using the principles checker
export async function analyzeWarningsForFiles(filesInput: string | string[]): Promise<Record<string, number>> {
  const files = (typeof filesInput === 'string' ? filesInput.split(',') : filesInput)
    .flatMap(f => f.split(',').map(s => s.trim()))
    .filter(f => f);
  if (files.length === 0) {
    return {};
  }

  const rules = getAllRules();
  const result = await analyze(files, rules, getAdapterForFile);

  const fileWarnings: Record<string, number> = {};
  
  // Initialize all requested files with 0 warnings
  for (const file of files) {
    fileWarnings[file] = 0;
  }
  
  // Count violations per file
  for (const violation of result.violations) {
    // Only count warnings and errors (ignore info level)
    if (violation.severity === 'warning' || violation.severity === 'error') {
      fileWarnings[violation.file] = (fileWarnings[violation.file] || 0) + 1;
    }
  }
  
  return fileWarnings;
}

interface BaselineEntry {
  eslint?: { warnings: number; errors: number };
  principles?: { warnings: number; errors: number };
  ccn?: { warnings: number; max: number };
  totalWarnings: number;
  lastAnalyzed: string;
}

interface DeltaResult {
  file: string;
  status: 'NEW' | 'MODIFIED' | 'UNCHANGED';
  baselineWarnings: number;
  currentWarnings: number;
  delta: number;
  enforcement: 'PASS' | 'BLOCK';
  reason: string;
}

interface EnforcementResult {
  overallStatus: 'PASS' | 'BLOCK';
  violations: DeltaResult[];
  detailedReport: DeltaResult[];
  summary: {
    totalFiles: number;
    passedFiles: number;
    blockedFiles: number;
  };
}

export function classifyFiles(gitDiffLines: string[]): FileClassification {
  const result: FileClassification = {
    new: [],
    modified: [],
    deleted: [],
    renamed: []
  };

  for (const line of gitDiffLines) {
    if (!line.trim()) continue;

    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;

    const status = parts[0].trim();
    switch (status.charAt(0)) {
      case 'A':
        result.new.push(parts.slice(1).join(' '));
        break;
      case 'M':
        result.modified.push(parts.slice(1).join(' '));
        break;
      case 'D':
        result.deleted.push(parts.slice(1).join(' '));
        break;
      case 'R':
        if (parts.length >= 3) {
          result.renamed.push({
            oldPath: parts[1],
            newPath: parts[2]
          });
        }
        break;
      default:
        break;
    }
  }

  return result;
}

export async function loadBaseline(baselinePath: string): Promise<Record<string, BaselineEntry>> {
  try {
    await fs.access(baselinePath);
    const baselineContent = await fs.readFile(baselinePath, 'utf-8');
    return JSON.parse(baselineContent);
  } catch {
    return {};
  }
}

export async function saveBaseline(baselinePath: string, baseline: Record<string, BaselineEntry>): Promise<void> {
  await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2));
}

function evaluateNewFile(currentWarnings: number): Pick<DeltaResult, 'enforcement' | 'reason'> {
  if (currentWarnings > 0) {
    return {
      enforcement: 'BLOCK',
      reason: `New files must have zero warnings (currently: ${currentWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`,
    };
  }
  return { enforcement: 'PASS', reason: 'New file with zero warnings' };
}

function describeNonIncreasedDelta(delta: number, currentWarnings: number): string {
  if (delta < 0) return `Warnings decreased by ${Math.abs(delta)}`;
  if (currentWarnings === 0) return 'All warnings cleared';
  return 'No new warnings introduced';
}

function evaluateModifiedFile(
  baselineEntry: BaselineEntry | null,
  currentWarnings: number,
  baselineWarnings: number,
): Pick<DeltaResult, 'enforcement' | 'reason'> {
  if (!baselineEntry) {
    return { enforcement: 'PASS', reason: 'File added to baseline with current warning count' };
  }

  if (currentWarnings > baselineWarnings) {
    return {
      enforcement: 'BLOCK',
      reason: `Modified files cannot increase warnings (${currentWarnings} > ${baselineWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`,
    };
  }

  if (baselineWarnings <= 5 && currentWarnings > 0) {
    return {
      enforcement: 'BLOCK',
      reason: `Files with <=5 warnings must clear to zero (currently: ${currentWarnings}/${baselineWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`,
    };
  }

  return {
    enforcement: 'PASS',
    reason: describeNonIncreasedDelta(currentWarnings - baselineWarnings, currentWarnings),
  };
}

export function calculateDelta(
  baselineEntry: BaselineEntry | null,
  currentWarnings: number,
  status: 'NEW' | 'MODIFIED'
): DeltaResult {
  const baselineWarnings = baselineEntry ? baselineEntry.totalWarnings : 0;
  const delta = status === 'NEW' ? currentWarnings : currentWarnings - baselineWarnings;

  const evaluation = status === 'NEW'
    ? evaluateNewFile(currentWarnings)
    : evaluateModifiedFile(baselineEntry, currentWarnings, baselineWarnings);

  return {
    file: '',
    status,
    baselineWarnings,
    currentWarnings,
    delta,
    enforcement: evaluation.enforcement,
    reason: evaluation.reason,
  };
}

export function enforceBoyScoutRule(deltas: DeltaResult[]): EnforcementResult {
  const violations = deltas.filter(delta => delta.enforcement === 'BLOCK');
  
  let passedCount = 0;
  deltas.forEach(delta => {
    if (delta.enforcement === 'PASS') passedCount++;
  });

  return {
    overallStatus: violations.length > 0 ? 'BLOCK' : 'PASS',
    violations,
    detailedReport: deltas,
    summary: {
      totalFiles: deltas.length,
      passedFiles: passedCount,
      blockedFiles: violations.length
    }
  };
}

export async function initBaseline(files: string[]): Promise<Record<string, BaselineEntry>> {
  const currentWarnings = await analyzeWarningsForFiles(files);
  const baseline: Record<string, BaselineEntry> = {};

  for (const file of files) {
    try {
      const warningCount = currentWarnings[file] || 0;
      if (warningCount > 0) {
        baseline[file] = {
          totalWarnings: warningCount,
          lastAnalyzed: new Date().toISOString(),
        };
      }
    } catch (error: unknown) {
      console.error(`Failed to analyze file for baseline: ${file}`, error);
    }
  }

  return baseline;
}

 /**
 * Initializes baseline from current violations for the specified files
 */
async function autoInitBaseline(
  files: string[], 
  baselinePath: string
): Promise<Record<string, BaselineEntry>> {
  const currentWarnings = await analyzeWarningsForFiles(files);
  const baseline: Record<string, BaselineEntry> = {};

  for (const file of files) {
    const count = currentWarnings[file] || 0;
    if (count > 0) {
      baseline[file] = {
        totalWarnings: count,
        lastAnalyzed: new Date().toISOString(),
      };
    }
  }

  await saveBaseline(baselinePath, baseline);
  return baseline;
}

async function runInitBaselineCommand(parsed: Record<string, unknown>): Promise<number> {
  try {
    await initBaselineCommand((parsed.files ?? []) as string[]);
    console.log('Baseline initialized successfully');
    return 0;
  } catch (error: unknown) {
    console.error('Error initializing baseline:', error);
    return 1;
  }
}

export async function runEnforcementCommand(parsed: Record<string, unknown>): Promise<number> {
  try {
    const enforcementResult = await runEnforcement(
      (parsed.newFiles ?? []) as string[],
      (parsed.modifiedFiles ?? []) as string[],
      (parsed.baselinePath as string) || '.warnings-baseline.json'
    );
    console.log(JSON.stringify(enforcementResult, null, 2));
    return enforcementResult.overallStatus === 'PASS' ? 0 : 1;
  } catch (error: unknown) {
    console.error('Error during enforcement:', error);
    return 1;
  }
}

export async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  return parsed.command === 'init-baseline'
    ? runInitBaselineCommand(parsed)
    : runEnforcementCommand(parsed);
}

function splitCsvArg(raw: string | undefined): string[] {
  return raw?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
}

const ARG_HANDLERS: Record<string, (parsed: Record<string, unknown>, next: string | undefined) => boolean> = {
  '--new-files': (parsed, next) => { parsed.newFiles = splitCsvArg(next); return true; },
  '--modified-files': (parsed, next) => { parsed.modifiedFiles = splitCsvArg(next); return true; },
  '--baseline': (parsed, next) => { parsed.baselinePath = next; return true; },
  '--init-baseline': (parsed, next) => {
    parsed.command = 'init-baseline';
    parsed.files = splitCsvArg(next);
    return true;
  },
};

function parseArgs(args: string[]): Record<string, unknown> {
  const parsed: Record<string, unknown> = {
    command: null,
    newFiles: [],
    modifiedFiles: [],
    baselinePath: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      showHelp();
      process.exit(0);
    }
    const handler = ARG_HANDLERS[arg];
    if (handler && handler(parsed, args[i + 1])) {
      i++;
    }
  }

  return parsed;
}

function showHelp(): void {
  console.log(`
Usage: boy-scout <options>
Options:
  --new-files <file1,file2,...>    Specify new files to analyze
  --modified-files <file1,file2,...>    Specify modified files to analyze  
  --baseline <path>                Path to baseline file (default: .warnings-baseline.json)
  --init-baseline [file1,file2,...]    Initialize baseline with current warning counts
  --help                          Show this help message
  
Examples:
  npx tsx boy-scout.ts --new-files src/new-file.ts
  npx tsx boy-scout.ts --modified-files src/changed-file.ts --baseline my-baseline.json
  npx tsx boy-scout.ts --init-baseline src/file1.ts,src/file2.ts
`);
}

async function initBaselineCommand(files: string[]): Promise<void> {
  const baseline = await initBaseline(files);
  await saveBaseline('.warnings-baseline.json', baseline);
}

async function runEnforcement(newFiles: string[], modifiedFiles: string[], baselinePath: string): Promise<EnforcementResult> {
  const allFiles = [...newFiles.filter(f => f.trim()), ...modifiedFiles.filter(f => f.trim())];
  const currentWarnings = await analyzeWarningsForFiles(allFiles);
  
  const baseline = await loadBaseline(baselinePath);
  
  // Check for missing baseline entries for modified files
  const missingBaselineEntries: string[] = [];
  for (const file of modifiedFiles) {
    if (!baseline[file]) {
      missingBaselineEntries.push(file);
    }
  }
  
  // If there are missing baseline entries, auto-initialize them
  if (missingBaselineEntries.length > 0) {
    for (const file of missingBaselineEntries) {
      const warningCount = currentWarnings[file] || 0;
      if (warningCount > 0) {
        baseline[file] = {
          totalWarnings: warningCount,
          lastAnalyzed: new Date().toISOString(),
        };
      }
    }
    // Save the updated baseline
    await saveBaseline(baselinePath, baseline);
    console.log(`ℹ️  Auto-initialized baseline for ${missingBaselineEntries.length} files`);
  }
  
  const deltaResults: DeltaResult[] = [];

  for (const file of newFiles) {
    const warningCount = currentWarnings[file] || 0;
    const delta = calculateDelta(null, warningCount, 'NEW');
    delta.file = file;
    deltaResults.push(delta);
  }
  
  for (const file of modifiedFiles) {
    const baselineEntry = baseline[file] || null;
    const warningCount = currentWarnings[file] || 0;
    const delta = calculateDelta(baselineEntry, warningCount, 'MODIFIED');
    delta.file = file;
    deltaResults.push(delta);
  }
  
  return enforceBoyScoutRule(deltaResults);
}

if ((typeof require !== 'undefined' && require.main === module) || 
    (typeof require === 'undefined' && process.argv[1]?.includes('boy-scout'))) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}

export {
  initBaselineCommand,
  runEnforcement,
  autoInitBaseline
};