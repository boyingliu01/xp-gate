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