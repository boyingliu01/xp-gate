// @no-test-required: pure re-export barrel with no logic of its own; its contract is covered by rules/__tests__/index.test.ts, which asserts every re-exported rule name resolves to an object with id + check().
/**
 * Named re-exports of every rule object.
 *
 * Split out of `./index` because that module exceeded the `many-exports`
 * threshold once the architecture rules landed. The barrel's consumer contract
 * (see `rules/__tests__/index.test.ts`) is unchanged -- `index.ts` re-exports
 * this module wholesale, so `import { srpRule } from '.../rules'` still works.
 */
export { longFunctionRule } from './clean-code/long-function';
export { largeFileRule } from './clean-code/large-file';
export { magicNumbersRule } from './clean-code/magic-numbers';
export { godClassRule } from './clean-code/god-class';
export { deepNestingRule } from './clean-code/deep-nesting';
export { tooManyParamsRule } from './clean-code/too-many-params';
export { missingErrorHandlingRule } from './clean-code/missing-error-handling';
export { unusedImportsRule } from './clean-code/unused-imports';
export { codeDuplicationRule } from './clean-code/code-duplication';
export { manyExportsRule } from './clean-code/many-exports';
export { srpRule } from './solid/srp';
export { ocpRule } from './solid/ocp';
export { lspRule } from './solid/lsp';
export { ispRule } from './solid/isp';
export { dipRule } from './solid/dip';
export { archNamingRules } from './arch/naming';
export { archDependencyRules } from './arch/dependency';
