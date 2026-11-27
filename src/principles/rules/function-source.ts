/**
 * Helpers the per-function rules share.
 *
 * Every rule in `rules/clean-code/` reads the same adapter surface and reports the
 * same shape, and each one carried its own copy of the type assertion, the fallback
 * line, and the severity read. Three copies of "which line does this violation point
 * at" is three chances for one rule to report a different position than the others
 * for the same function -- and a suppression written against one line number then
 * misses the other rules.
 */

import { Severity } from '../types';

/** One function as an adapter reports it, with the fields the rules read. */
export interface InspectedFunction {
  name?: string;
  startLine?: number;
  line?: number;
  paramCount?: number;
  ioOperations?: string[];
  hasTryCatch?: boolean;
}

/** The adapter surface the rules need; anything narrower is not a source file. */
export interface FunctionSource {
  extractFunctions?: () => InspectedFunction[];
}

/** The functions an adapter reports, or none when it cannot report any. */
export function extractFunctions(adapter: unknown): InspectedFunction[] {
  // A null or undefined adapter is not a source file. Every rule calls this
  // unconditionally, so it must answer "none" rather than throw.
  const source = (adapter ?? {}) as FunctionSource;
  return source.extractFunctions?.() || [];
}

/**
 * The line a violation for `func` points at.
 *
 * `startLine` and `line` are both emitted, by different adapters, and neither is
 * guaranteed. 1 is the honest fallback: a violation with no position cannot be
 * suppressed by a line-based ignore, so it stays visible rather than being lost.
 *
 * @param {InspectedFunction} func
 * @returns {number}
 */
export function violationLineOf(func: InspectedFunction): number {
  return func.startLine ?? func.line ?? 1;
}

/**
 * The severity a rule should report, honouring a project override.
 *
 * Read from the ACTIVE config per invocation: a module-load snapshot ignored every
 * override applied after import (#457).
 *
 * @param configured the `severity` field of the rule's active settings
 * @param fallback the rule's own default
 */
export function severityOf(configured: unknown, fallback: Severity): Severity {
  return (configured as Severity) ?? fallback;
}
