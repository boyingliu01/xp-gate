import { spawnSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface UiDetectionResult {
  isUiSprint: boolean;
  matchedFiles: string[];
  matchedRules: string[];
}

const TEMPLATE_EXTENSIONS = ['.njk', '.html', '.ejs', '.hbs'];
const COMPONENT_EXTENSIONS = ['.tsx', '.vue', '.svelte', '.jsx'];
const STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less'];
const UI_PATH_PATTERNS = [
  'views/',
  'templates/',
  'components/',
  'pages/',
  'src/views/',
  'src/components/',
  'src/pages/',
];

// Default built-in exclusions — always ignored regardless of .ui-gate-ignore
const UI_GATE_DEFAULT_EXCLUSIONS = [
  '**/node_modules/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/coverage/**',
  '**/dist/**',
  '**/build/**',
];

/**
 * Check if a file path matches any glob pattern in the exclusions list.
 * Simplified glob matching: ** → wildcard, * → single segment wildcard.
 */
export function isExcluded(filePath: string, exclusions: string[]): boolean {
  const normalized = filePath.toLowerCase();
  for (const pattern of exclusions) {
    const p = pattern.toLowerCase().replace(/\*\*/g, '_STARSTAR_').replace(/\*/g, '_STAR_');
    if (matchGlob(normalized, p)) return true;
  }
  return false;
}

function matchGlob(filePath: string, pattern: string): boolean {
  // Escape literal dots first, then replace placeholders with regex
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/_STARSTAR_/g, '.*')
    .replace(/_STAR_/g, '[^/]*');
  const re = new RegExp(`^${regex}$`);
  return re.test(filePath);
}

/**
 * Load .ui-gate-ignore file from repo root.
 * Returns array of glob patterns (one per line), excluding comments and empty lines.
 */
export function loadUiGateIgnore(repoRoot: string = process.cwd()): string[] {
  const ignorePath = join(repoRoot, '.ui-gate-ignore');
  if (!existsSync(ignorePath)) return [];
  const content = readFileSync(ignorePath, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

/**
 * Full exclusion list: default exclusions + .ui-gate-ignore patterns.
 */
function getFullExclusions(repoRoot?: string): string[] {
  return [...UI_GATE_DEFAULT_EXCLUSIONS, ...loadUiGateIgnore(repoRoot)];
}

function runGitDiff(baseBranch: string): string {
  const result = spawnSync(
    'git',
    ['diff', '--name-only', `${baseBranch}..HEAD`],
    { stdio: ['pipe', 'pipe', 'pipe'], shell: false, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim();
    throw new Error(stderr || `git diff exited with status ${result.status}`);
  }
  return String(result.stdout ?? '').trim();
}

export function detectUiSprint(baseBranch: string = 'main'): UiDetectionResult {
  try {
    const files = getChangedFiles(baseBranch);
    if (files.length === 0) {
      return { isUiSprint: false, matchedFiles: [], matchedRules: [] };
    }
    return collectUiMatches(files);
  } catch {
    return { isUiSprint: false, matchedFiles: [], matchedRules: [] };
  }
}

export function getChangedFiles(baseBranch: string): string[] {
  const diffOutput = runGitDiff(baseBranch);
  if (diffOutput === '') return [];
  return diffOutput
    .split('\n')
    .filter((f: string) => f.length > 0)
    .map(parseRenamedFile);
}

export function parseRenamedFile(file: string): string {
  return file.includes('→') ? file.split('→')[1].trim() : file;
}

export function collectUiMatches(files: string[], repoRoot?: string): UiDetectionResult {
  const exclusions = getFullExclusions(repoRoot);
  const matchedFiles: string[] = [];
  const matchedRules = new Set<string>();

  for (const filePath of files) {
    if (isExcluded(filePath, exclusions)) continue;
    const rules = getFileMatchRules(filePath);
    if (rules.length > 0) {
      matchedFiles.push(filePath);
      rules.forEach((r) => matchedRules.add(r));
    }
  }

  return {
    isUiSprint: matchedFiles.length > 0,
    matchedFiles,
    matchedRules: Array.from(matchedRules),
  };
}

export function getFileMatchRules(filePath: string): string[] {
  const ext = getFileExtension(filePath);
  const normalizedPath = filePath.toLowerCase();

  if (TEMPLATE_EXTENSIONS.includes(ext)) {
    return [`template-${ext}`];
  }

  if (COMPONENT_EXTENSIONS.includes(ext) && hasUiPathPattern(normalizedPath)) {
    return [`component-${ext}`];
  }

  if (STYLE_EXTENSIONS.includes(ext) && hasUiPathPattern(normalizedPath)) {
    return [`style-${ext}`];
  }

  return [];
}

export function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  return lastDot >= 0 ? filePath.slice(lastDot) : '';
}

export function hasUiPathPattern(normalizedPath: string): boolean {
  return UI_PATH_PATTERNS.some((pattern) => normalizedPath.includes(pattern));
}

// ─── CLI Entry Point ────────────────────────────────────────────────

if (require.main === module) {
  runCli();
}

function runCli(): void {
  const args = process.argv.slice(2);
  const repoRoot = process.cwd();

  if (args.includes('--push-mode')) {
    runPushMode(repoRoot);
  } else if (args.includes('--check-branch')) {
    runCheckBranch(repoRoot);
  } else {
    runDefault(repoRoot);
  }
}

function runPushMode(repoRoot: string): void {
  let input = '';
  if (process.stdin.isTTY) {
    // If args has --from-stdin but no TTY input, try reading file list from args
    const filesIdx = process.argv.indexOf('--files');
    if (filesIdx !== -1 && process.argv[filesIdx + 1]) {
      input = process.argv[filesIdx + 1];
      processOutput(input, repoRoot);
      return;
    }
    input = '';
  } else {
    const chunks: string[] = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
    process.stdin.on('end', () => {
      input = chunks.join('').trim();
      processOutput(input, repoRoot);
    });
    return; // async — wait for stdin end
  }
  processOutput(input, repoRoot);
}

function processOutput(input: string, repoRoot: string): void {
  const files = input
    .split('\n')
    .map(parseRenamedFile)
    .filter((f) => f.length > 0);
  const result = collectUiMatches(files, repoRoot);
   
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.isUiSprint ? 0 : 1);
}

function runCheckBranch(_repoRoot: string): void {
  const result = detectUiSprint('HEAD');
   
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.isUiSprint ? 0 : 1);
}

function runDefault(_repoRoot: string): void {
  const result = detectUiSprint();
   
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.isUiSprint ? 0 : 1);
}
