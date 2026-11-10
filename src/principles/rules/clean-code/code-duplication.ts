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
 *
 * If neither is available the caller passes `duplicationUnavailable` back to
 * us so the rule can say so out loud; silently judging nothing is the defect
 * this rule was rebuilt to remove, not an acceptable fallback.
 */
function resolveDuplicationPercentage(
  adapter: unknown,
): { percentage: number } | { unavailable: string } {
  const supplier = adapter as {
    duplicationPercentage?: number;
    getDuplication?: () => DuplicationReport;
  };

  if (typeof supplier.duplicationPercentage === 'number') {
    return { percentage: supplier.duplicationPercentage };
  }
  if (typeof supplier.getDuplication === 'function') {
    return { percentage: supplier.getDuplication().percentage };
  }
  return {
    unavailable:
      'adapter supplies neither duplicationPercentage nor getDuplication()',
  };
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

    const resolved = resolveDuplicationPercentage(adapter);

    // A capability gap is reported, never swallowed. Returning [] here is
    // exactly how this rule spent its whole life looking enabled while fireing
    // nothing (REQ-PRINCIPLES-DUP): silence and "measured clean" were
    // indistinguishable. `info`, not `warning`, because a third-party adapter
    // can trigger it and it must not block a commit — but it IS visible, and
    // `xp-gate gate-coverage` can therefore surface it.
    if ('unavailable' in resolved) {
      violations.push({
        file,
        line: 1,
        ruleId: 'clean-code.code-duplication',
        message: `Duplication not measured: ${resolved.unavailable}. The rule cannot judge this file, so it is NOT reporting it clean — implement getDuplication() on the adapter.`,
        severity: 'info',
      });
      return violations;
    }

    if (resolved.percentage > (settings.threshold ?? 0)) {
      violations.push({
        file,
        line: 1,
        ruleId: 'clean-code.code-duplication',
        message: `Code duplication detected: ${formatPercentage(resolved.percentage)}% (threshold: ${settings.threshold}%). Consider refactoring duplicated code.`,
        severity: (settings.severity as Severity) ?? 'warning'
      });
    }

    return violations;
  }
};
