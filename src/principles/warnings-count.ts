import { analyze, getAdapterForFile } from './analyzer';
import { getAllRules } from './index';

/** Severity levels that count against the Boy Scout budget. `info` does not. */
const COUNTED_SEVERITIES = new Set(['warning', 'error']);

/**
 * The file list from either a comma string or an array of comma strings.
 *
 * Both shapes occur: the CLI passes `--new-files a.ts,b.ts` as one string, and a caller
 * may pass the array. Splitting both means the caller need not know which.
 */
function normalizeFileList(filesInput: string | string[]): string[] {
  const raw = typeof filesInput === 'string' ? filesInput.split(',') : filesInput;
  return raw.flatMap((f) => f.split(',').map((s) => s.trim())).filter(Boolean);
}

export async function analyzeWarningsForFiles(filesInput: string | string[]): Promise<Record<string, number>> {
  const files = normalizeFileList(filesInput);
  if (files.length === 0) return {};

  const result = await analyze(files, getAllRules(), getAdapterForFile);
  return countByFile(files, result.violations);
}

/**
 * The counted violations, per file, with every REQUESTED file present.
 *
 * Every requested file starts at 0 because a CLEAN file must appear in the map -- without
 * that, a caller cannot tell "no warnings" from "not analysed", which is the difference
 * the Boy Scout budget depends on.
 */
function countByFile(files: string[], violations: Array<{ severity: string; file: string }>): Record<string, number> {
  const fileWarnings: Record<string, number> = {};
  for (const file of files) fileWarnings[file] = 0;
  for (const violation of violations) {
    if (!COUNTED_SEVERITIES.has(violation.severity)) continue;
    fileWarnings[violation.file] = (fileWarnings[violation.file] || 0) + 1;
  }
  return fileWarnings;
}

export { normalizeFileList };
