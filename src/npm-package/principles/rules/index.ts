import { Rule } from '../types';
import { longFunctionRule } from './clean-code/long-function';
import { largeFileRule } from './clean-code/large-file';
import { magicNumbersRule } from './clean-code/magic-numbers';
import { godClassRule } from './clean-code/god-class';
import { deepNestingRule } from './clean-code/deep-nesting';
import { tooManyParamsRule } from './clean-code/too-many-params';
import { missingErrorHandlingRule } from './clean-code/missing-error-handling';
import { unusedImportsRule } from './clean-code/unused-imports';
import { codeDuplicationRule } from './clean-code/code-duplication';
import { manyExportsRule } from './clean-code/many-exports';
import { srpRule } from './solid/srp';
import { ocpRule } from './solid/ocp';
import { lspRule } from './solid/lsp';
import { ispRule } from './solid/isp';
import { dipRule } from './solid/dip';
import { archNamingRules } from './arch/naming';
import { archDependencyRules } from './arch/dependency';

// The individual rule objects are re-exported from `./exports` so that this
// module stays a pure aggregator. Both halves are part of the module's public
// surface: `GET /rules` consumers import the named rules, while the engine
// imports only the arrays below.
export * from './exports';

const CLEAN_CODE_RULES: Rule[] = [
  longFunctionRule,
  largeFileRule,
  magicNumbersRule,
  godClassRule,
  deepNestingRule,
  tooManyParamsRule,
  missingErrorHandlingRule,
  unusedImportsRule,
  codeDuplicationRule,
  manyExportsRule,
];

const SOLID_RULES: Rule[] = [srpRule, ocpRule, lspRule, ispRule, dipRule];

/** Architecture rules: package naming (#694) + dependency direction (#699). */
const ARCH_RULES: Rule[] = archNamingRules.concat(archDependencyRules);

export function getAllPrincipleRules(): Rule[] {
  return [...CLEAN_CODE_RULES, ...SOLID_RULES, ...ARCH_RULES];
}

export function getCleanCodeRules(): Rule[] {
  return [...CLEAN_CODE_RULES];
}

export function getSolidRules(): Rule[] {
  return [...SOLID_RULES];
}
