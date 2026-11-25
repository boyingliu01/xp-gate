import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const largeFileRule: Rule = {
  id: 'clean-code.large-file',
  name: 'Large File Rule',
  // Static field mirrors the built-in default. The ENFORCED value comes from
  // getActiveConfig() inside check(), so `.principlesrc` is honoured (#457).
  threshold: 1150,
  severity: 'warning',
  check: checkLargeFile,
};

/** The part of an adapter this rule consumes. */
interface TypedAdapter {
  countLines?: (file: string) => number | undefined;
}

/** The default ceiling when the config names none. */
const DEFAULT_MAX_LINES = 500;

/**
 * Report a file over its line ceiling.
 *
 * A `countLines` that returns nothing is treated as 0 lines rather than as an error: an
 * adapter that cannot count has no evidence AGAINST the file, and inventing a violation
 * from a missing measurement is the defect this gate exists to prevent.
 */
function checkLargeFile(file: string, adapter: unknown): Violation[] {
  // Read the ACTIVE config per invocation. Snapshotting it at module load was #457:
  // a project's `.principlesrc` threshold was parsed but never applied.
  const settings = getActiveConfig().rules['clean-code']['large-file'];
  const threshold = settings.threshold ?? DEFAULT_MAX_LINES;
  const lineCount = (adapter as TypedAdapter).countLines?.(file) ?? 0;
  if (lineCount <= threshold) return [];
  return [{
    file,
    line: 1,
    ruleId: 'clean-code.large-file',
    message: `File is too large: ${lineCount} lines (maximum: ${threshold})`,
    severity: (settings.severity as Severity) ?? 'warning',
  }];
}