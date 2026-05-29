import { execSync } from 'child_process';

/**
 * Interface representing the result of UI sprint detection.
 */
export interface UiDetectionResult {
  /** Whether the changes constitute a UI sprint */
  isUiSprint: boolean;
  /** List of files that triggered the UI detection */
  matchedFiles: string[];
  /** List of rules that matched */
  matchedRules: string[];
}

/**
 * Template file extensions (trigger independently, no path check needed)
 */
const TEMPLATE_EXTENSIONS = ['.njk', '.html', '.ejs', '.hbs'];

/**
 * Component file extensions (require path check)
 */
const COMPONENT_EXTENSIONS = ['.tsx', '.vue', '.svelte', '.jsx'];

/**
 * Style file extensions (require path check)
 */
const STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less'];

/**
 * Required path patterns for component/style files to trigger UI detection
 */
const UI_PATH_PATTERNS = [
  'views/',
  'templates/',
  'components/',
  'pages/',
  'src/views/',
  'src/components/',
  'src/pages/',
];

/**
 * Detects if current sprint contains UI-related changes based on git diff.
 * 
 * @param baseBranch - The base branch to compare against (default: 'main')
 * @returns UiDetectionResult with detection status, matched files, and matched rules
 */
export function detectUiSprint(baseBranch: string = 'main'): UiDetectionResult {
  try {
    // Run git diff to get changed files
    const diffOutput = execSync(`git diff --name-only ${baseBranch}..HEAD`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Empty diff - fast path
    if (diffOutput === '') {
      return {
        isUiSprint: false,
        matchedFiles: [],
        matchedRules: [],
      };
    }

    const matchedFiles: string[] = [];
    const matchedRules: string[] = [];

    // Parse git diff output (handles renamed files: "old → new")
    const files = diffOutput.split('\n').filter((f) => f.length > 0);

    for (const file of files) {
      // Handle renamed files - extract the new path (right side of " → ")
      const filePath = file.includes('→') 
        ? file.split('→')[1].trim() 
        : file;

      const result = checkFileUiRelevance(filePath);
      if (result.matched) {
        matchedFiles.push(filePath);
        for (const rule of result.rules) {
          if (!matchedRules.includes(rule)) {
            matchedRules.push(rule);
          }
        }
      }
    }

    return {
      isUiSprint: matchedFiles.length > 0,
      matchedFiles,
      matchedRules,
    };
  } catch {
    // If git is unavailable or execSync fails, return safe default
    return {
      isUiSprint: false,
      matchedFiles: [],
      matchedRules: [],
    };
  }
}

/**
 * Internal function to check if a file matches UI-related rules.
 * @param filePath - The file path to check
 * @returns Object with matched flag and array of matching rule IDs
 */
function checkFileUiRelevance(filePath: string): { matched: boolean; rules: string[] } {
  const rules: string[] = [];
  const normalizedPath = filePath.toLowerCase();

  // Check template files (trigger independently, no path check needed)
  for (const ext of TEMPLATE_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      rules.push(`template-${ext}`);
      return { matched: true, rules };
    }
  }

  // Check component files (require path check)
  for (const ext of COMPONENT_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      if (hasUiPathPattern(normalizedPath)) {
        rules.push(`component-${ext}`);
        return { matched: true, rules };
      }
    }
  }

  // Check style files (same path requirement as components)
  for (const ext of STYLE_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      if (hasUiPathPattern(normalizedPath)) {
        rules.push(`style-${ext}`);
        return { matched: true, rules };
      }
    }
  }

  return { matched: false, rules: [] };
}

/**
 * Checks if the file path contains any UI-related directory patterns.
 * @param normalizedPath - Lowercase normalized path
 * @returns true if path contains UI directory patterns
 */
function hasUiPathPattern(normalizedPath: string): boolean {
  for (const pattern of UI_PATH_PATTERNS) {
    if (normalizedPath.includes(pattern)) {
      return true;
    }
  }
  return false;
}
