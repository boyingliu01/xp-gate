// @no-test-required: Re-exports and registry — tested via gate-m integration + pre-push Gate M
export type {
  MutationFileReport,
  MutationRunResult,
  MutationRunOutcome,
  RunMutationOptions,
  MutationRunner,
} from './types';

export { registerRunner, resolveRunner, runnerRegistry } from './types';

export { StrykerRunner } from './stryker-runner';
export { MutmutRunner } from './mutmut-runner';
export { GoMutantRunner } from './go-mutant-runner';

import { StrykerRunner } from './stryker-runner';
import { MutmutRunner } from './mutmut-runner';
import { GoMutantRunner } from './go-mutant-runner';
import { registerRunner } from './types';

/** Auto-register all known runners. */
export function registerAllRunners(): void {
  registerRunner(new StrykerRunner());
  registerRunner(new MutmutRunner());
  registerRunner(new GoMutantRunner());
}
