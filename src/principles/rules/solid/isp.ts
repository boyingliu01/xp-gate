import { Rule, Violation } from '../../types';
import { getActiveConfig } from '../../config';
import { severityOf } from '../function-source';

/** One interface as an adapter reports it, with the fields this rule reads. */
interface InspectedInterface {
  name?: string;
  line?: number;
  methodCount?: number;
}

/** The adapter surface this rule needs. */
interface InterfaceSource {
  extractInterfaces?: () => InspectedInterface[];
}

/**
 * The interfaces an adapter reports, or none when it cannot report any.
 *
 * A null adapter is not a source file; the rule calls this unconditionally, so it
 * answers "none" rather than throwing.
 */
function extractInterfaces(adapter: unknown): InspectedInterface[] {
  const source = (adapter ?? {}) as InterfaceSource;
  return source.extractInterfaces?.() || [];
}

/**
 * Whether this interface exceeds the configured method budget.
 *
 * The count is defaulted to 0 rather than tested for truthiness: an interface the
 * adapter measured as `0` must be compared as 0, and an absent field means the adapter
 * could not measure it -- neither is a violation, and both say so explicitly here.
 */
function exceedsBudget(iface: InspectedInterface, maxMethods: number): boolean {
  return (iface.methodCount ?? 0) > maxMethods;
}

/**
 * Describe an over-budget interface.
 *
 * The advice is part of the message because the remedy is not obvious: an interface
 * with eleven methods can be legitimate, and the rule is asking the reader to consider
 * splitting by CLIENT rather than by topic.
 */
function describeViolation(
  file: string,
  iface: InspectedInterface,
  maxMethods: number,
  severity: Violation['severity'],
): Violation {
  return {
    file,
    line: iface.line ?? 1,
    ruleId: 'solid.isp',
    message: `Interface "${iface.name}" has too many methods: ${iface.methodCount ?? 0} `
      + `(maximum: ${maxMethods}). Consider splitting into focused interfaces.`,
    severity,
  };
}

export const ispRule: Rule = {
  id: 'solid.isp',
  name: 'Interface Segregation Principle Rule',
  threshold: 10,
  severity: 'info',
  check: (file: string, adapter: unknown): Violation[] => {
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['solid']['isp'];
    const maxMethods = settings.methodThreshold ?? 10;
    const severity = severityOf(settings.severity, 'info');
    return extractInterfaces(adapter)
      .filter((iface) => exceedsBudget(iface, maxMethods))
      .map((iface) => describeViolation(file, iface, maxMethods, severity));
  }
};
