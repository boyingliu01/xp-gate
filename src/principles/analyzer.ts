import { Rule, Violation, Adapter } from './types';
import { loadConfig } from './config';
import { TypeScriptAdapter } from './adapters/typescript';
import { PythonAdapter } from './adapters/python';
import { GoAdapter } from './adapters/go';
import { JavaAdapter } from './adapters/java';
import { KotlinAdapter } from './adapters/kotlin';
import { DartAdapter } from './adapters/dart';
import { SwiftAdapter } from './adapters/swift';
import { extname } from 'path';

export { Violation } from './types';
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

export type AdapterFactory = (filePath: string) => Adapter;

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
  };
  
  const AdapterClass = adapterMap[ext];
  if (!AdapterClass) {
    return null;
  }
  
  return new AdapterClass(filePath);
}

export async function analyze(
  files: string[],
  rules: Rule[],
  adapterOrFactory: Adapter | AdapterFactory,
  options?: AnalysisOptions
): Promise<AnalysisResult> {
  const startTime = Date.now();
  const config = await loadConfig();
  const errors: string[] = [];
  
  const violations: Violation[] = [];
  const fileResults: Record<string, FileResult> = {};
  const ruleResults: Record<string, RuleResult> = {};
  
  const enabledRules = options?.enabledRules ?? rules.map(r => r.id);
  const rulesToRun = rules.filter(r => enabledRules.includes(r.id));
  
  for (const rule of rulesToRun) {
    ruleResults[rule.id] = {
      violationCount: 0,
      filesChecked: 0
    };
  }
  
  for (const file of files) {
    let adapter: Adapter;
    
    if (typeof adapterOrFactory === 'function') {
      adapter = adapterOrFactory(file);
    } else {
      adapter = adapterOrFactory;
    }
    
    const language = adapter.detectLanguage();
    
    if (language === 'unknown') {
      continue;
    }
    
    fileResults[file] = {
      violations: [],
      ruleIds: []
    };
    
    for (const rule of rulesToRun) {
      ruleResults[rule.id].filesChecked++;
      
      try {
        const ruleViolations = rule.check(file, adapter);
        
        if (ruleViolations.length > 0) {
          violations.push(...ruleViolations);
          fileResults[file].violations.push(...ruleViolations);
          fileResults[file].ruleIds.push(rule.id);
          ruleResults[rule.id].violationCount += ruleViolations.length;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Rule ${rule.id} failed on ${file}: ${errorMsg}`);
      }
    }
  }
  
  const endTime = Date.now();
  
  const summary: AnalysisSummary = {
    totalViolations: violations.length,
    errorCount: violations.filter(v => v.severity === 'error').length,
    warningCount: violations.filter(v => v.severity === 'warning').length,
    infoCount: violations.filter(v => v.severity === 'info').length,
    filesChecked: Object.keys(fileResults).length,
    rulesRun: rulesToRun.length
  };
  
  return {
    violations,
    summary,
    fileResults,
    ruleResults,
    executionTimeMs: endTime - startTime,
    errors
  };
}