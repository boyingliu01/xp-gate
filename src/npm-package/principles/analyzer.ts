import { Rule, Violation, Adapter } from './types';
import { getActiveConfig } from './config';
import { TypeScriptAdapter } from './adapters/typescript';
import { PythonAdapter } from './adapters/python';
import { GoAdapter } from './adapters/go';
import { JavaAdapter } from './adapters/java';
import { KotlinAdapter } from './adapters/kotlin';
import { DartAdapter } from './adapters/dart';
import { SwiftAdapter } from './adapters/swift';
import { ObjectiveCAdapter } from './adapters/objectivec';
import { CppAdapter } from './adapters/cpp';
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
    '.swift': SwiftAdapter,
    '.m': ObjectiveCAdapter,
    '.mm': ObjectiveCAdapter,
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

function computeSummary(
  violations: Violation[],
  fileResults: Record<string, FileResult>,
  rulesToRun: Rule[],
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
  };
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
      violations.push(...ruleViolations);
      fileResult.violations.push(...ruleViolations);
      fileResult.ruleIds.push(rule.id);
      ruleResult.violationCount += ruleViolations.length;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Rule ${rule.id} failed on ${file}: ${msg}`);
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

  for (const file of files) {
    const adapter = resolveAdapter(file, adapterOrFactory);
    if (!adapter || adapter.detectLanguage() === 'unknown') continue;

    const fileResult: FileResult = { violations: [], ruleIds: [] };
    fileResults[file] = fileResult;

    for (const rule of rulesToRun) {
      runRuleOnFile({
        file,
        rule,
        adapter,
        violations,
        fileResult,
        ruleResult: ruleResults[rule.id],
        errors,
      });
    }
  }

  const summary = computeSummary(violations, fileResults, rulesToRun);

  return {
    violations,
    summary,
    fileResults,
    ruleResults,
    executionTimeMs: Date.now() - startTime,
    errors,
  };
}