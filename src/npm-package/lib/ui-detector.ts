import { execSync } from 'child_process';

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
  const diffOutput = execSync(`git diff --name-only ${baseBranch}..HEAD`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

  if (diffOutput === '') {
    return [];
  }

  return diffOutput
    .split('\n')
    .filter((f) => f.length > 0)
    .map(parseRenamedFile);
}

export function parseRenamedFile(file: string): string {
  return file.includes('→') ? file.split('→')[1].trim() : file;
}

export function collectUiMatches(files: string[]): UiDetectionResult {
  const matchedFiles: string[] = [];
  const matchedRules = new Set<string>();

  for (const filePath of files) {
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
