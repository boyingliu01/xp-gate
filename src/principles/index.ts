import { analyze, getAdapterForFile } from './analyzer';
import { formatConsole, formatJSON, formatSARIF } from './reporter';
import { loadConfig } from './config';
import { getAllPrincipleRules } from './rules';
import { isDirectExecution } from './direct-execution.js';

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
// The implementation lives in ./direct-execution.ts so the identical guard can be
// shared with boy-scout.ts without either module exceeding the 10-export limit.
// Re-exported here because it is part of this module's public contract (#444).
export { isDirectExecution } from './direct-execution.js';

const args = process.argv.slice(2);
if (isDirectExecution(process.argv[1], import.meta.url)) {
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
