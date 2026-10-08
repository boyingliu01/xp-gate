import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

export const largeFileRule: Rule = {
  id: 'clean-code.large-file',
  name: 'Large File Rule',
  // Static field mirrors the built-in default. The ENFORCED value comes from
  // getActiveConfig() inside check(), so `.principlesrc` is honoured (#457).
  threshold: 1150,
  severity: 'warning',
  check: (file: string, adapter: unknown): Violation[] => {
    const violations: Violation[] = [];
    // Read the ACTIVE config per invocation. Snapshotting it at module load was
    // #457: a project's `.principlesrc` threshold was parsed but never applied.
    const settings = getActiveConfig().rules['clean-code']['large-file'];
    const threshold = settings.threshold ?? 500;

    try {
      interface TypedAdapter {
        countLines?: (file: string) => number | undefined;
      }
      const typedAdapter = adapter as TypedAdapter;
      const lineCount = typedAdapter.countLines?.(file) ?? 0;

      if (lineCount > threshold) {
        violations.push({
          file,
          line: 1,
          ruleId: 'clean-code.large-file',
          message: `File is too large: ${lineCount} lines (maximum: ${threshold})`,
          severity: (settings.severity as Severity) ?? 'warning'
        });
      }
    } catch { }

    return violations;
  }
};