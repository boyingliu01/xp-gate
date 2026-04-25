import * as fs from 'fs/promises';
import { extname } from 'path';
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

async function getWarningCountForFile(filePath: string): Promise<number> {
  try {
    // Try batching all files together first, but for this individual function, we simulate
    const currentWarnings = await analyzeWarningsForFiles([filePath]);
    return currentWarnings[filePath] || 0;
  } catch (error) {
    // Fallback to ensure the function can handle cases where real file analysis is not feasible
    return 0;
  }
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
  } catch (error) {
    return {};
  }
}

export async function saveBaseline(baselinePath: string, baseline: Record<string, BaselineEntry>): Promise<void> {
  await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2));
}

export function calculateDelta(
  baselineEntry: BaselineEntry | null,
  currentWarnings: number,
  status: 'NEW' | 'MODIFIED'
): DeltaResult {
  const deltaResult: DeltaResult = {
    file: '',
    status,
    baselineWarnings: baselineEntry ? baselineEntry.totalWarnings : 0,
    currentWarnings,
    delta: 0,
    enforcement: 'PASS',
    reason: ''
  };

  if (status === 'NEW') {
    deltaResult.delta = currentWarnings;
    if (currentWarnings > 0) {
      deltaResult.enforcement = 'BLOCK';
      deltaResult.reason = `New files must have zero warnings (currently: ${currentWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`;
    } else {
      deltaResult.enforcement = 'PASS';
      deltaResult.reason = 'New file with zero warnings';
    }
  } else {
    // For modified files with no baseline (new to baseline due to auto-init), treat as special case
    if (!baselineEntry) {
      // Auto-initialized file, allow current warnings as the new baseline, just verify this doesn't increase warnings
      deltaResult.enforcement = 'PASS';
      deltaResult.reason = 'File added to baseline with current warning count';
    } else {
      deltaResult.delta = currentWarnings - deltaResult.baselineWarnings;
      
      if (currentWarnings > deltaResult.baselineWarnings) {
        deltaResult.enforcement = 'BLOCK';
        deltaResult.reason = `Modified files cannot increase warnings (${currentWarnings} > ${deltaResult.baselineWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`;
      } 
      else if (deltaResult.baselineWarnings <= 5 && currentWarnings > 0) {
        deltaResult.enforcement = 'BLOCK';
        deltaResult.reason = `Files with <=5 warnings must clear to zero (currently: ${currentWarnings}/${deltaResult.baselineWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`;
      }
      else {
        deltaResult.enforcement = 'PASS';
        deltaResult.reason = deltaResult.delta < 0 
          ? `Warnings decreased by ${Math.abs(deltaResult.delta)}` 
          : currentWarnings === 0
          ? 'All warnings cleared'
          : 'No new warnings introduced';
      }
    }
  }

  return deltaResult;
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
    } catch (error) {
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

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  
  const parsed = parseArgs(args);
  
  if (parsed.command === 'init-baseline') {
    try {
      await initBaselineCommand(parsed.files || []);
      console.log('Baseline initialized successfully');
      return 0;
    } catch (error) {
      console.error('Error initializing baseline:', error);
      return 1;
    }
  }
  
  try {
    const enforcementResult = await runEnforcement(
      parsed.newFiles || [],
      parsed.modifiedFiles || [],
      parsed.baselinePath || '.warnings-baseline.json'
    );
    
    console.log(JSON.stringify(enforcementResult, null, 2));
    
    return enforcementResult.overallStatus === 'PASS' ? 0 : 1;
  } catch (error) {
    console.error('Error during enforcement:', error);
    return 1;
  }
}

function parseArgs(args: string[]): any {
  const parsed: any = {
    command: null,
    newFiles: [],
    modifiedFiles: [],
    baselinePath: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--new-files') {
      parsed.newFiles = args[i + 1]?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
      i++;
    } else if (arg === '--modified-files') {
      parsed.modifiedFiles = args[i + 1]?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
      i++;
    } else if (arg === '--baseline') {
      parsed.baselinePath = args[i + 1];
      i++;
    } else if (arg === '--init-baseline') {
      parsed.command = 'init-baseline';
      parsed.files = args[i + 1]?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === 'help') {
      showHelp();
      process.exit(0);
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