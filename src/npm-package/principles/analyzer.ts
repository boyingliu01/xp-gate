import { Rule, Violation, Adapter } from './types';
import { getActiveConfig, resolveSeverityForFile } from './config';
import { TypeScriptAdapter } from './adapters/typescript';
import { PythonAdapter } from './adapters/python';
import { GoAdapter } from './adapters/go';
import { JavaAdapter } from './adapters/java';
import { KotlinAdapter } from './adapters/kotlin';
import { DartAdapter } from './adapters/dart';
import { PhpAdapter } from './adapters/php';
import { SwiftAdapter } from './adapters/swift';
import { ObjectiveCAdapter } from './adapters/objectivec';
import { CppAdapter } from './adapters/cpp';
import { CSharpAdapter } from './adapters/csharp';
import { extname } from 'path';

export type { Violation } from './types';
export interface AnalysisOptions {
  enabledRules?: string[];
}

export interface FileResult {
  violations: Violation[];
  ruleIds: string[];
}

export interface RuleResult {
  violationCount: number;
  filesChecked: number;
}

export interface AnalysisSummary {
  totalViolations: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  filesChecked: number;
  rulesRun: number;
  /**
   * Languages whose files were counted in `filesChecked` but which NO rule can
   * actually examine — the adapter makes them detectable, not analysable.
   *
   * This exists because "no violations found" was being printed for files no
   * rule can read. Measured: a Go file with 6-level nesting reported
   * `✓ No violations found / Files checked: 1 / Rules run: 21`, while the same
   * shape in TypeScript is caught. Without this field a reader cannot tell a
   * clean file from an unexamined one, which is the defect family AGENTS.md
   * names most often: "not checked" must never be indistinguishable from
   * "passed".
   *
   * Empty means every file in the run was genuinely analysable — the output then
   * claims exactly what it did.
   */
  unanalysedLanguages: string[];
}

export interface AnalysisResult {
  violations: Violation[];
  summary: AnalysisSummary;
  fileResults: Record<string, FileResult>;
  ruleResults: Record<string, RuleResult>;
  executionTimeMs: number;
  errors: string[];
}

export type AdapterFactory = (filePath: string) => Adapter | null;

export function getAdapterForFile(filePath: string): Adapter | null {
  const ext = extname(filePath).toLowerCase();
  
  const adapterMap: Record<string, new (filePath: string) => Adapter> = {
    '.ts': TypeScriptAdapter,
    '.tsx': TypeScriptAdapter,
    '.js': TypeScriptAdapter,
    '.jsx': TypeScriptAdapter,
    '.py': PythonAdapter,
    '.go': GoAdapter,
    '.java': JavaAdapter,
    '.kt': KotlinAdapter,
    '.kts': KotlinAdapter,
    '.dart': DartAdapter,
    // #731: the same #717 shape, caught by the capability test rather than by a
    // review -- widening gate-4.sh's filter to accept .php without this entry
    // would have produced "Gate 4 ran and inspected nothing".
    '.php': PhpAdapter,
    '.phtml': PhpAdapter,
    '.swift': SwiftAdapter,
    '.m': ObjectiveCAdapter,
    '.mm': ObjectiveCAdapter,
    // #717: without this entry `getAdapterForFile('A.cs')` returned null while
    // gate-4.sh had already accepted the file, so Gate 4 inspected no C# at all.
    '.cs': CSharpAdapter,
    '.csx': CSharpAdapter,
    '.cpp': CppAdapter,
    '.cxx': CppAdapter,
    '.cc': CppAdapter,
    '.c': CppAdapter,
    '.hpp': CppAdapter,
    '.h': CppAdapter,
  };
  
  const AdapterClass = adapterMap[ext];
  if (!AdapterClass) {
    return null;
  }
  
  return new AdapterClass(filePath);
}

function resolveAdapter(
  file: string,
  adapterOrFactory: Adapter | AdapterFactory,
): Adapter | null {
  if (typeof adapterOrFactory === 'function') {
    return adapterOrFactory(file);
  }
  return adapterOrFactory;
}

/**
 * Record, once per language, that this adapter cannot actually examine its own
 * files — it makes the language detectable, not analysable.
 *
 * Split out of analyze() so the bookkeeping does not raise that function's
 * cyclomatic complexity. The gate's output then says which languages were not
 * checked instead of printing "✓ No violations found" over them.
 */
function recordUnanalysed(adapter: Adapter, into: string[]): void {
  if (adapter.declaresRuleCoverage) return;
  const lang = adapter.detectLanguage();
  if (!into.includes(lang)) into.push(lang);
}

/**
 * Run every enabled rule against one file, accumulating into the shared result
 * maps.
 *
 * Split out of analyze() for the same reason recordUnanalysed is: keeping the
 * per-file, per-rule loop inline pushed analyze past the clean-code.long-function
 * limit (56 lines against a maximum of 50), and that is a real signal -- the outer
 * function is about orchestration, this is about one file.
 */
function runRulesOnFile(context: {
  file: string;
  adapter: Adapter;
  rules: Rule[];
  violations: Violation[];
  fileResult: FileResult;
  ruleResults: Record<string, RuleResult>;
  errors: string[];
}): void {
  for (const rule of context.rules) {
    runRuleOnFile({
      file: context.file,
      rule,
      adapter: context.adapter,
      violations: context.violations,
      fileResult: context.fileResult,
      ruleResult: context.ruleResults[rule.id],
      errors: context.errors,
    });
  }
}

function computeSummary(
  violations: Violation[],
  fileResults: Record<string, FileResult>,
  rulesToRun: Rule[],
  unanalysedLanguages: string[],
): AnalysisSummary {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const v of violations) {
    if (v.severity === 'error') errorCount++;
    else if (v.severity === 'warning') warningCount++;
    else infoCount++;
  }
  return {
    totalViolations: violations.length,
    errorCount,
    warningCount,
    infoCount,
    filesChecked: Object.keys(fileResults).length,
    rulesRun: rulesToRun.length,
    unanalysedLanguages,
  };
}

/**
 * Apply path-scoped severity overrides (#806) to one rule's violations.
 *
 * Applied centrally so no rule has to know about overrides and a new rule cannot
 * forget to honour them. Only the SEVERITY is remapped -- the violation is kept,
 * so "reported but advisory" stays distinguishable from "nothing found".
 *
 * Pulled out of runRuleOnFile to keep that function under the Gate 3 ratchet: the
 * loop pushed it to CCN 8 against a recorded baseline of 6.
 */
function applySeverityOverrides(
  ruleId: string,
  filePath: string,
  ruleViolations: Violation[]
): void {
  for (const violation of ruleViolations) {
    violation.severity = resolveSeverityForFile(
      ruleId,
      violation.file || filePath,
      violation.severity
    ) as Violation['severity'];
  }
}

function runRuleOnFile(ctx: RunRuleContext): void {
  const { file, rule, adapter, violations, fileResult, ruleResult, errors } = ctx;
  // Honour `enabled: false` from `.principlesrc`. Nothing read this flag before
  // #457, so a project could not turn a rule off.
  //
  // Checked BEFORE `filesChecked++`: a rule that never ran must not report that it
  // examined a file, or the per-rule stats claim coverage the rule did not perform.
  if (!isRuleEnabled(rule.id)) return;
  ruleResult.filesChecked++;
  try {
    const ruleViolations = rule.check(file, adapter);
    if (ruleViolations.length > 0) {
      applySeverityOverrides(rule.id, file, ruleViolations);
      violations.push(...ruleViolations);
      fileResult.violations.push(...ruleViolations);
      fileResult.ruleIds.push(rule.id);
      ruleResult.violationCount += ruleViolations.length;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A file that cannot be READ failed for every rule that touched it, so the
    // same message would arrive once per rule. Dedupe to one entry per file: the
    // caller acts on "this file was not examined", not on how many rules noticed.
    const entry = `Rule ${rule.id} failed on ${file}: ${msg}`;
    if (!errors.includes(entry)) errors.push(entry);
  }
}

/**
 * Whether `ruleId` (e.g. `clean-code.large-file`) is enabled in the active
 * config. Unknown or malformed entries default to enabled: a config typo must
 * not silently disable a gate.
 */
function isRuleEnabled(ruleId: string): boolean {
  const separator = ruleId.indexOf('.');
  if (separator <= 0) return true;
  const group = ruleId.slice(0, separator);
  const name = ruleId.slice(separator + 1);
  const rules = getActiveConfig().rules as Record<string, Record<string, { enabled?: boolean }>>;
  const settings = rules[group]?.[name];
  return settings?.enabled !== false;
}

interface RunRuleContext {
  file: string;
  rule: Rule;
  adapter: Adapter;
  violations: Violation[];
  fileResult: FileResult;
  ruleResult: RuleResult;
  errors: string[];
}

/**
 * Resolve the adapter for one path, reporting rather than throwing on failure.
 *
 * Resolving and probing an adapter can itself READ the file (adapters parse on
 * construction), so an unreadable path throws here -- before any rule runs and
 * outside runRuleOnFile's guard. Recorded as an error rather than allowed to
 * abort the whole run: one bad path must not hide the findings for the good
 * ones, but it must never be invisible either (#623).
 *
 * @returns the adapter, or null when the file cannot be examined at all
 */
function resolveAdapterReporting(
  file: string,
  adapterOrFactory: Adapter | AdapterFactory,
  errors: string[],
): Adapter | null {
  try {
    const adapter = resolveAdapter(file, adapterOrFactory);
    if (!adapter || adapter.detectLanguage() === 'unknown') return null;
    return adapter;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // One entry per file: the failure belongs to the file, not to however many
    // rules happened to touch it.
    if (!errors.includes(msg)) errors.push(msg);
    return null;
  }
}

export async function analyze(
  files: string[],
  rules: Rule[],
  adapterOrFactory: Adapter | AdapterFactory,
  options?: AnalysisOptions
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const violations: Violation[] = [];
  const fileResults: Record<string, FileResult> = {};
  const ruleResults: Record<string, RuleResult> = {};

  const enabledRules = options?.enabledRules ?? rules.map(r => r.id);
  const rulesToRun = rules.filter(r => enabledRules.includes(r.id));

  for (const rule of rulesToRun) {
    ruleResults[rule.id] = { violationCount: 0, filesChecked: 0 };
  }

  // Languages an adapter merely makes DETECTABLE: counted in filesChecked, read by
  // no rule. See recordUnanalysed for why this is collected separately.
  const unanalysedLanguages: string[] = [];

  for (const file of files) {
    const adapter = resolveAdapterReporting(file, adapterOrFactory, errors);
    if (!adapter) continue;

    recordUnanalysed(adapter, unanalysedLanguages);
    const fileResult: FileResult = { violations: [], ruleIds: [] };
    fileResults[file] = fileResult;
    runRulesOnFile({ file, adapter, rules: rulesToRun, violations, fileResult, ruleResults, errors });
  }

  const summary = computeSummary(violations, fileResults, rulesToRun, unanalysedLanguages);

  return {
    violations,
    summary,
    fileResults,
    ruleResults,
    executionTimeMs: Date.now() - startTime,
    errors,
  };
}