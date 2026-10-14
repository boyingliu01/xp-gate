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
export { GremlinsRunner } from './gremlins-runner';
export { GoMutantRunner } from './go-mutant-runner';
export { PitestRunner } from './pitest-runner';

import { StrykerRunner } from './stryker-runner';
import { MutmutRunner } from './mutmut-runner';
import { GremlinsRunner } from './gremlins-runner';
import { GoMutantRunner } from './go-mutant-runner';
import { PitestRunner } from './pitest-runner';
import { registerRunner } from './types';

/** Auto-register all known runners. */
export function registerAllRunners(): void {
  registerRunner(new StrykerRunner());
  // Registration order decides the `py` winner (resolveRunner returns the
  // FIRST runner whose extensions include the ext). pytest-gremlins is
  // registered before mutmut deliberately (#410): it is natively
  // cross-platform, so when both are installed it is the better default —
  // mutmut stays reachable via its own runner on Unix-only setups.
  registerRunner(new GremlinsRunner());
  registerRunner(new MutmutRunner());
  registerRunner(new GoMutantRunner());
  registerRunner(new PitestRunner());
}
