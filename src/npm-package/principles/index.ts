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

/**
 * Split a `--files` value into paths.
 *
 * Splits on ANY whitespace, not just spaces. `find ... | head -50` produces a
 * newline-separated list, and CI passed it quoted, so the whole blob arrived as
 * one argument. `.split(' ')` kept it whole, the path could never resolve,
 * nothing was analysed, and the run fell through to the console/empty path --
 * writing "No violations found" into a file the workflow called
 * principles.sarif (#623).
 */
function splitFileList(value: string): string[] {
  return value.split(/\s+/).filter(f => f.trim());
}

/**
 * The options that take a value, and what to do with it.
 *
 * Table-driven so adding a flag is a row rather than another `case` arm: the
 * switch this replaces carried one branch per option, which is what pushed the
 * measured complexity of the function past the Gate 3 threshold.
 */
const VALUE_OPTIONS: Record<string, (options: CLIOptions, value: string) => void> = {
  '--files': (options, value) => {
    options.files = splitFileList(value);
  },
  // An unrecognised format is ignored rather than rejected, so a typo degrades
  // to the default console output instead of an empty SARIF file.
  '--format': (options, value) => {
    if (VALID_FORMATS.includes(value)) options.format = value as CLIOptions['format'];
  },
  // Previously absent, so `--config .principlesrc` was silently filed into
  // `files` and the path was analysed as if it were source (#457).
  '--config': (options, value) => {
    options.configPath = value;
  },
};

/** The boolean flags, and the field each one sets. */
const FLAG_OPTIONS: Record<string, keyof CLIOptions> = {
  '--changed-only': 'changedOnly',
  '--show-score': 'showScore',
};

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    files: [],
    format: 'console',
    changedOnly: false,
    showScore: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    const valueOption = VALUE_OPTIONS[arg];
    if (valueOption) {
      const value = args[++i];
      if (value !== undefined) valueOption(options, value);
      continue;
    }

    const flagField = FLAG_OPTIONS[arg];
    if (flagField) {
      (options[flagField] as boolean) = true;
      continue;
    }

    // A bare path accumulates instead of being dropped.
    if (!arg.startsWith('--')) options.files.push(arg);
  }

  return options;
}

function getAllRules() {
  return getAllPrincipleRules();
}

export { getAllRules };

/**
 * Report a run that could not examine everything it was asked to.
 *
 * A file the checker could not read is not a file it found clean. Before #623,
 * `analyze` filed read failures in `result.errors` and nothing ever read that
 * array: the run exited 0 and printed a clean report, which CI's SARIF step then
 * archived. That is how `Analysis failed: Could not read file: ...` appeared in
 * the log while the step still produced a report.
 *
 * Naming the paths matters as much as the exit status -- an operator needs to
 * know WHICH files were never looked at.
 */
function reportIncomplete(errors: string[]): void {
  console.error(`Analysis incomplete: ${errors.length} file(s) could not be examined`);
  for (const err of errors) console.error(`  ${err}`);
}

/**
 * The usage error for a run that was given nothing to check.
 *
 * Returns 2, not 1. Under this module's contract exit 1 asserts "I examined
 * files and found ERROR-severity violations". A gate that sees 1 with an empty
 * report reads it as a clean pass, so returning 1 here would let a miswired hook
 * announce PASSED having checked nothing at all.
 */
const USAGE_EXIT = 2;

function usageMessage(): void {
  console.error('Usage: principles-checker --files <file1> <file2> ... [--format console|json|sarif] [--changed-only] [--config <path>]');
}

/**
 * Decide the exit status for a completed analysis.
 *
 * Split out of `main` so the status contract lives in one place and can be read
 * without following the run:
 *
 *   2 - a file could not be examined (this module's "could not examine")
 *   1 - the analysis completed and found ERROR-severity violations
 *   0 - the analysis completed and found none
 *
 * 1 is deliberately narrow. Returning 1 for any violation made info/warning
 * noise (e.g. magic-numbers `info`) look like a tool failure: Gate 4 treats a
 * non-zero exit as "checker execution failed" and downgrades itself to SKIPPED,
 * silently disabling the gate.
 */
function exitStatusFor(result: { errors: string[]; summary: { errorCount: number } }): number {
  if (result.errors.length > 0) {
    reportIncomplete(result.errors);
    return 2;
  }
  return result.summary.errorCount > 0 ? 1 : 0;
}

export async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);

  if (options.files.length === 0) {
    usageMessage();
    return USAGE_EXIT;
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

  return exitStatusFor(result);
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
