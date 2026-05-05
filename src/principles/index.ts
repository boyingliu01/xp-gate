import { analyze, getAdapterForFile } from './analyzer';
import { formatConsole, formatJSON, formatSARIF } from './reporter';
import { loadConfig } from './config';
import { longFunctionRule } from './rules/clean-code/long-function';
import { largeFileRule } from './rules/clean-code/large-file';
import { magicNumbersRule } from './rules/clean-code/magic-numbers';
import { godClassRule } from './rules/clean-code/god-class';
import { deepNestingRule } from './rules/clean-code/deep-nesting';
import { tooManyParamsRule } from './rules/clean-code/too-many-params';
import { missingErrorHandlingRule } from './rules/clean-code/missing-error-handling';
import { unusedImportsRule } from './rules/clean-code/unused-imports';
import { codeDuplicationRule } from './rules/clean-code/code-duplication';
import { srpRule } from './rules/solid/srp';
import { ocpRule } from './rules/solid/ocp';
import { lspRule } from './rules/solid/lsp';
import { ispRule } from './rules/solid/isp';
import { dipRule } from './rules/solid/dip';

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
  return [
    longFunctionRule,
    largeFileRule,
    magicNumbersRule,
    godClassRule,
    deepNestingRule,
    tooManyParamsRule,
    missingErrorHandlingRule,
    unusedImportsRule,
    codeDuplicationRule,
    srpRule,
    ocpRule,
    lspRule,
    ispRule,
    dipRule
  ];
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

const args = process.argv.slice(2);
if (typeof require !== 'undefined' && require.main === module) {
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