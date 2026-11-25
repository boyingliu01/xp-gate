import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const manyExportsRule: Rule = {
  id: 'clean-code.many-exports',
  name: 'Many Exports Rule',
  threshold: 10,
  severity: 'warning',
  check: checkManyExports,
};

/** One export as the adapter reports it. */
interface ExportObj {
  line: number;
}

/** The part of an adapter this rule consumes. */
interface TypedAdapter {
  extractExports?: () => ExportObj[] | undefined;
}

/** The default ceiling when the config names none. */
const DEFAULT_MAX_EXPORTS = 10;

/** The exports the adapter reports, or none. */
function extractExports(adapter: unknown): ExportObj[] {
  const typed = adapter as TypedAdapter;
  return typed.extractExports?.() ?? [];
}

/**
 * Report a module that exports more than its ceiling.
 *
 * The violation is reported ONCE per file, anchored at the FIRST export: the reader needs
 * one place to start splitting, not one finding per export.
 */
/** Whether this export list is over its ceiling. */
function exceedsCeiling(exports: ExportObj[], threshold: number): boolean {
  return exports.length > threshold;
}

function checkManyExports(file: string, adapter: unknown): Violation[] {
  // Read the ACTIVE config per invocation; a module-load snapshot was #457.
  const settings = getActiveConfig().rules['clean-code']['many-exports'];
  const threshold = settings.threshold ?? DEFAULT_MAX_EXPORTS;
  const exports = extractExports(adapter);
  if (!exceedsCeiling(exports, threshold)) return [];
  return [{
    file,
    line: exports[0]?.line || 1,
    ruleId: 'clean-code.many-exports',
    message: `Module has too many exports: ${exports.length} (maximum: ${threshold}). Consider splitting into focused sub-modules.`,
    severity: (settings.severity as Severity) ?? 'warning',
  }];
}
