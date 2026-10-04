import { analyze, getAdapterForFile } from './analyzer';
import { formatConsole, formatJSON, formatSARIF } from './reporter';
import { loadConfig, setActiveConfig } from './config';
import { getAllPrincipleRules } from './rules';
import { isDirectExecution } from './direct-execution.js';

interface CLIOptions {
  files: string[];
  format: 'console' | 'json' | 'sarif';
  changedOnly: boolean;
  showScore: boolean;
  /** Explicit `.principlesrc` path; falls back to git-toplevel/cwd lookup. */
  configPath?: string;
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
      // Previously absent, so `--config .principlesrc` was silently filed into
      // `files` and the path was analysed as if it were source (#457).
      case '--config':
        const cfg = args[++i];
        if (cfg) options.configPath = cfg;
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
    console.error('Usage: principles-checker --files <file1> <file2> ... [--format console|json|sarif] [--changed-only] [--config <path>]');
    return 1;
  }
  
  // Install the loaded config so rules read the PROJECT's thresholds. The
  // previous `await loadConfig();` discarded the result, so `.principlesrc` was
  // parsed and thrown away while the built-in defaults were enforced (#457).
  setActiveConfig(await loadConfig(options.configPath));

  const rules = getAllRules();
  const result = await analyze(options.files, rules, getAdapterForFile);
  
  const formatters: Record<string, (r: typeof result) => string> = {
    json: formatJSON,
    sarif: formatSARIF,
    console: formatConsole,
  };
  console.log(formatters[options.format](result));
  
  // Exit 1 only for ERROR-severity violations. Returning 1 for any violation
  // made info/warning noise (e.g. magic-numbers `info`) look like a tool
  // failure: Gate 4 treats a non-zero exit as "checker execution failed" and
  // downgrades itself to SKIPPED, silently disabling the gate.
  return result.summary.errorCount > 0 ? 1 : 0;
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
      // Exit 2, not 1. Gate 4 decides by testing the exit status, and exit 1 now
      // means "the checker ran and found ERROR-severity violations". Reusing 1 for
      // a crash would make a genuine finding indistinguishable from a broken tool,
      // and the gate's `else` branch SKIPs -- releasing exactly the most serious
      // violations. 2 is this repo's existing convention for a runtime error:
      // src/gates/gate-8.ts and gate-9.ts both SKIP on exit >= 2 and treat 1 as a
      // real finding.
      process.exit(2);
    });
}
