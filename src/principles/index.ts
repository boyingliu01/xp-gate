import { analyze, getAdapterForFile, AnalysisResult } from './analyzer';
import { formatConsole, formatJSON, formatSummary, formatSARIF } from './reporter';
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

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    files: [],
    format: 'console',
    changedOnly: false,
    showScore: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--files') {
      const filesArg = args[i + 1];
      if (filesArg) {
        options.files = filesArg.split(' ').filter(f => f.trim());
      }
      i++;
    } else if (arg === '--format') {
      const formatArg = args[i + 1];
      if (formatArg === 'json' || formatArg === 'console' || formatArg === 'sarif') {
        options.format = formatArg;
      }
      i++;
    } else if (arg === '--changed-only') {
      options.changedOnly = true;
    } else if (arg === '--show-score') {
      options.showScore = true;
    } else if (!arg.startsWith('--')) {
      options.files.push(arg);
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

export async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);
  
  if (options.files.length === 0) {
    console.error('Usage: principles-checker --files <file1> <file2> ... [--format console|json|sarif] [--changed-only]');
    return 1;
  }
  
  const config = await loadConfig();
  const rules = getAllRules();
  
  const result = await analyze(options.files, rules, getAdapterForFile);
  
  const output = options.format === 'json' 
    ? formatJSON(result)
    : options.format === 'sarif'
    ? formatSARIF(result)
    : formatConsole(result);
  
  console.log(output);
  
  if (result.summary.totalViolations > 0) {
    const hasBlocking = result.violations.some(v => 
      v.severity === 'error' || v.severity === 'warning'
    );
    if (hasBlocking) {
      return 1;
    }
  }
  
  return 0;
}

const args = process.argv.slice(2);
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