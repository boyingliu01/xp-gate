import { Rule, Violation, Severity } from '../../types';
import { getActiveConfig } from '../../config';

/** One import as the adapter reports it. */
interface ImportFacts {
  name?: string;
  line?: number;
  used?: boolean;
  type?: string;
}

/**
 * An import is unused when nothing references it. A `import type` is exempt: it
 * is erased at compile time, so an unused type import is not dead code in the
 * shipped output.
 */
function isUnusedValueImport(imp: ImportFacts): boolean {
  return !imp.used && imp.type !== 'type';
}

export const unusedImportsRule: Rule = {
  id: 'clean-code.unused-imports',
  name: 'Unused Imports Rule',
  threshold: 1,
  severity: 'info',
  check: (file: string, adapter: unknown): Violation[] => {
    // Read the ACTIVE config per invocation; a module-load snapshot was #457.
    const settings = getActiveConfig().rules['clean-code']['unused-imports'];
    const severity = (settings.severity as Severity) ?? 'info';

    const imports = (adapter as { imports?: ImportFacts[] }).imports || [];
    return imports
      .filter(isUnusedValueImport)
      .map((imp) => ({
        file,
        line: imp.line ?? 1,
        ruleId: 'clean-code.unused-imports',
        message: `Unused import "${imp.name}" - consider removing`,
        severity,
      }));
  }
};
