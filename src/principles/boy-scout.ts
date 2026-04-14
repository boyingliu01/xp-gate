import fs from 'fs/promises';
import path from 'path';

interface FileClassification {
  new: string[];
  modified: string[];
  deleted: string[];
  renamed: { oldPath: string; newPath: string }[];
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
      deltaResult.reason = 'New files must have zero warnings (Boy Scout Rule)';
    } else {
      deltaResult.enforcement = 'PASS';
      deltaResult.reason = 'New file with zero warnings';
    }
  } else {
    deltaResult.delta = currentWarnings - deltaResult.baselineWarnings;
    
    if (currentWarnings > deltaResult.baselineWarnings) {
      deltaResult.enforcement = 'BLOCK';
      deltaResult.reason = 'Modified files cannot introduce new warnings (Boy Scout Rule)';
    } 
    else if (deltaResult.baselineWarnings <= 5 && currentWarnings > 0) {
      deltaResult.enforcement = 'BLOCK';
      deltaResult.reason = `Files with <=5 warnings must clear to zero (currently: ${currentWarnings}/${deltaResult.baselineWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`;
    }
    else {
      deltaResult.enforcement = 'PASS';
      deltaResult.reason = deltaResult.delta < 0 
        ? 'Warnings decreased from previous baseline' 
        : 'No new warnings introduced and file already had more than 5 warnings';
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
  const baseline: Record<string, BaselineEntry> = {};

  for (const file of files) {
    try {
      const warningCount = await getWarningCountForFile(file);
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

async function getWarningCountForFile(filePath: string): Promise<number> {
  const ext = path.extname(filePath);
  
  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let warningCount = 0;
      for (const line of content.split('\n')) {
        if (line.includes('console.log(') || line.includes('// TODO:') || line.includes('var ')) {
          warningCount++;
        }
      }
      return warningCount;
    } catch (error) {
      return 0;
    }
  }
  
  return 0;
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
      parsed.newFiles = args[i + 1]?.split(',') || [];
      i++;
    } else if (arg === '--modified-files') {
      parsed.modifiedFiles = args[i + 1]?.split(',') || [];
      i++;
    } else if (arg === '--baseline') {
      parsed.baselinePath = args[i + 1];
      i++;
    } else if (arg === '--init-baseline') {
      parsed.command = 'init-baseline';
      parsed.files = args[i + 1]?.split(',') || [];
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
  const baseline = await loadBaseline(baselinePath);
  
  const deltaResults: DeltaResult[] = [];

  for (const file of newFiles) {
    const warningCount = await getWarningCountForFile(file);
    const delta = calculateDelta(null, warningCount, 'NEW');
    delta.file = file;
    deltaResults.push(delta);
  }
  
  for (const file of modifiedFiles) {
    const baselineEntry = baseline[file] || null;
    const warningCount = await getWarningCountForFile(file);
    const delta = calculateDelta(baselineEntry, warningCount, 'MODIFIED');
    delta.file = file;
    deltaResults.push(delta);
  }
  
  return enforceBoyScoutRule(deltaResults);
}

if (require.main === module) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}

export {
  initBaselineCommand,
  runEnforcement
};