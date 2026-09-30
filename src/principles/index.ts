import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyze, getAdapterForFile } from './analyzer';
import { formatConsole, formatJSON, formatSARIF } from './reporter';
import { loadConfig } from './config';
import { getAllPrincipleRules } from './rules';

interface CLIOptions {
  files: string[];
  format: 'console' | 'json' | 'sarif';
  changedOnly: boolean;
  showScore: boolean;
}

const VALID_FORMATS: readonly string[] = ['json', 'console', 'sarif'] as const;

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    files: [],
    format: 'console',
    changedOnly: false,
    showScore: false
  };
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--files':
        const next = args[++i];
        if (next) options.files = next.split(' ').filter(f => f.trim());
        break;
      case '--format':
        const fmt = args[++i];
        if (fmt && VALID_FORMATS.includes(fmt)) options.format = fmt as 'json' | 'console' | 'sarif';
        break;
      case '--changed-only':
        options.changedOnly = true;
        break;
      case '--show-score':
        options.showScore = true;
        break;
      default:
        if (!args[i].startsWith('--')) options.files.push(args[i]);
    }
  }
  
  return options;
}

function getAllRules() {
  return getAllPrincipleRules();
}

export { getAllRules };

export async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);
  
  if (options.files.length === 0) {
    console.error('Usage: principles-checker --files <file1> <file2> ... [--format console|json|sarif] [--changed-only]');
    return 1;
  }
  
  await loadConfig();
  const rules = getAllRules();
  const result = await analyze(options.files, rules, getAdapterForFile);
  
  const formatters: Record<string, (r: typeof result) => string> = {
    json: formatJSON,
    sarif: formatSARIF,
    console: formatConsole,
  };
  console.log(formatters[options.format](result));
  
  return result.summary.totalViolations > 0 ? 1 : 0;
}

// Support both CJS (require.main === module) and ESM (import.meta.url) runtimes.
// npx tsx loads files via import() making require.main unreliable.
//
// The ESM branch must compare *normalized* file URLs: `file://${argv1}` yields
// `file://D:\a\b.ts` on Windows while `import.meta.url` is `file:///D:/a/b.ts`,
// so naive concatenation never matches and the CLI silently no-ops (Gate 4 then
// reports nothing and always "passes" — see #444).
export function isDirectExecution(
  argv1: string | undefined = process.argv[1],
  metaUrl: string | undefined = typeof import.meta !== 'undefined' ? import.meta.url : undefined,
): boolean {
  if (typeof require !== 'undefined' && require.main === module) {
    return true;
  }
  if (!metaUrl || !argv1) {
    return false;
  }
  // pathToFileURL handles win32 drive letters, backslashes, and percent-encoding;
  // resolve() makes a relative tsx invocation absolute before normalization.
  let candidate: string;
  try {
    candidate = pathToFileURL(resolve(argv1)).href;
  } catch {
    return false;
  }
  return metaUrl === candidate;
}

const args = process.argv.slice(2);
if (isDirectExecution()) {
  main(args)
    .then(exitCode => {
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    })
    .catch(err => {
      console.error('Analysis failed:', err.message);
      process.exit(1);
    });
}
