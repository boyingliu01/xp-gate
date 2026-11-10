import { Rule, Violation, Severity, DuplicationReport } from '../../types';
import { getActiveConfig } from '../../config';

/**
 * Resolve the duplication percentage to judge, in priority order:
 *
 *  1. `duplicationPercentage` supplied by the caller — a caller that measured
 *     duplication elsewhere (a token-level clone detector, a cached report) must
 *     not be silently overruled.
 *  2. `getDuplication()` on the adapter — the production path. Before this
 *     existed nothing supplied (1) either, so the rule never fired at all
 *     (REQ-PRINCIPLES-DUP).
 *  3. `undefined` — an adapter that offers neither cannot be judged. Returning
 *     undefined rather than 0 keeps "not measured" distinguishable from
 *     "measured clean"; callers that cannot measure did not measure zero.
 */
function resolveDuplicationPercentage(adapter: unknown): number | undefined {
  const supplier = adapter as {
    duplicationPercentage?: number;
    getDuplication?: () => DuplicationReport;
  };

  if (typeof supplier.duplicationPercentage === 'number') {
    return supplier.duplicationPercentage;
  }
  if (typeof supplier.getDuplication === 'function') {
    return supplier.getDuplication().percentage;
  }
  return undefined;
}

/** Format a percentage so a small non-zero value never prints as "0%". */
function formatPercentage(value: number): string {
  if (value > 0 && value < 1) return value.toFixed(2);
  return String(Math.round(value * 10) / 10);
}

export const codeDuplicationRule: Rule = {
  id: 'clean-code.code-duplication',
  name: 'Code Duplication Rule',
  threshold: 15,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['code-duplication'];

    const duplicationPercentage = resolveDuplicationPercentage(adapter);

    if (duplicationPercentage && duplicationPercentage > (settings.threshold ?? 0)) {
      violations.push({
        file,
        line: 1,
        ruleId: 'clean-code.code-duplication',
        message: `Code duplication detected: ${formatPercentage(duplicationPercentage)}% (threshold: ${settings.threshold}%). Consider refactoring duplicated code.`,
        severity: (settings.severity as Severity) ?? 'warning'
      });
    }

    return violations;
  }
};
