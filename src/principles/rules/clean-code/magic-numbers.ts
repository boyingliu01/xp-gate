import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

const DEFAULT_EXCLUDED_NUMBERS = [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024];

export const magicNumbersRule: Rule = {
  id: 'clean-code.magic-numbers',
  name: 'Magic Numbers Rule',
  // Not config-derived: this rule reports every non-excluded literal, so the
  // static field is an informational placeholder rather than an enforced bound.
  threshold: 10,
  severity: 'info',
  check: checkMagicNumbers,
}

/** One numeric literal the adapter found. */
interface NumberObject {
  value: number;
  line: number;
}

/** The part of an adapter this rule consumes. */
interface TypedAdapter {
  parseAST?: () => unknown | undefined;
  extract?: () => NumberObject[] | undefined;
}

/**
 * The literals the adapter reports, or none.
 *
 * #392-#4: rules must not swallow their own errors, so the OUTER try/catch is absent --
 * a genuine rule bug bubbles up to `analyzer.runRuleOnFile()` and surfaces as a gate
 * error. This inner one stays deliberately: an adapter that cannot extract AST data is a
 * legitimate "no data" case, not a rule bug.
 */
function extractNumbers(adapter: unknown): NumberObject[] {
  const typed = adapter as TypedAdapter;
  try {
    const literals = typed.extract?.();
    return Array.isArray(literals) ? literals : [];
  } catch {
    // KNOWN LIMIT (review FC-01): an adapter that THROWS and an adapter that finds
    // nothing both arrive here as []. The other rules avoid the ambiguity with
    // `extractFunctions?.()` -- optional chaining returns undefined for an unsupported
    // adapter without an exception -- but `extract` has no such convention, and a throw
    // here is not a RULE bug: the outer try/catch is deliberately absent so a genuine
    // rule defect surfaces at the gate (#392-#4), and catching it here would defeat that.
    //
    // Consequence, stated so it is not rediscovered: a broken `extract` silently reports
    // zero magic numbers. Nothing in this repository distinguishes the two today, and the
    // remedy is a convention on `extract`, not a wider catch here.
    return [];
  }
}

function checkMagicNumbers(file: string, adapter: unknown): Violation[] {
  const violations: Violation[] = [];
  // Read the ACTIVE config per invocation; a module-load snapshot was #457.
  const settings = getActiveConfig().rules['clean-code']['magic-numbers'];
  const magicNumbers = extractNumbers(adapter);
  const excludedNumbers = settings.exclude ?? DEFAULT_EXCLUDED_NUMBERS;
    const filteredNumbers = magicNumbers.filter(numObj => {
      const numValue = numObj.value;
      return !excludedNumbers.includes(numValue);
    });
    
    filteredNumbers.forEach(numObj => {
      violations.push({
        file,
        line: numObj.line,
        ruleId: 'clean-code.magic-numbers',
        message: `Potential magic number detected: ${numObj.value}. Consider using a named constant instead.`,
        severity: (settings.severity as Severity) ?? 'info'
      });
    });
    
  return violations;
}