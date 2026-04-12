import fs from 'fs/promises';
import path from 'path';
import { Config, AnalysisResult, Violation, LanguageAdapter, FunctionInfo, ClassInfo } from './types.js';
import * as typescriptAdapter from './adapters/typescript.js';
import * as pythonAdapter from './adapters/python.js';
import * as goAdapter from './adapters/go.js';
import * as javaAdapter from './adapters/java.js';
import * as kotlinAdapter from './adapters/kotlin.js';
import * as dartAdapter from './adapters/dart.js';
import * as swiftAdapter from './adapters/swift.js';
import { loadRules } from '../rules/index.js';

/**
 * Clean Code & SOLID Principles Checker
 * Analysis engine that orchestrates scanning code for principle violations.
 * 
 * This module handles: 
 * - Loading language-appropriate adapters
 * - Loading and applying rules
 * - Coordinating the scanning of multiple files
 */

// Map file extensions to their respective adapters
const adapters: { [key: string]: LanguageAdapter } = {
  '.ts': typescriptAdapter,
  '.tsx': typescriptAdapter,
  '.js': typescriptAdapter, // Use TS adapter for JS since it can handle both
  '.jsx': typescriptAdapter,
  '.py': pythonAdapter,
  '.go': goAdapter,
  '.java': javaAdapter,
  '.kt': kotlinAdapter,
  '.dart': dartAdapter,
  '.swift': swiftAdapter
};

/**
 * Analyzes the provided files with the given configuration
 * @param files An array of file paths to analyze
 * @param config Configuration object with thresholds and settings
 * @returns Analysis result with violations and statistics
 */
export async function analyzeProject(files: string[], config: Config): Promise<Violation[]> {
  const startTime = Date.now();
  const allViolations: Violation[] = [];
  
  for (const filePath of files) {
    // Check if file should be excluded based on config patterns
    if (shouldExcludeFile(filePath, config.excludePatterns)) {
      continue;
    }
    
    // Validate file extension
    const ext = path.extname(filePath);
    if (!config.fileExtensions.includes(ext)) {
      continue;
    }
    
    try {
      // Check if file exists
      await fs.access(filePath);
      
      // Get the source content
      const sourceCode = await fs.readFile(filePath, 'utf8');
      
      if (!sourceCode.trim()) {
        continue; // Skip empty files
      }

      // Identify and get the appropriate adapter for this file
      const adapter = adapters[ext];
      if (!adapter) {
        console.warn(`[WARN] No adapter for file extension: ${ext}, skipping file: ${filePath}`);
        continue;
      }

      // Parse the AST for this code using the appropriate adapter
      const ast = await adapter.parseAST(sourceCode);
      
      // Get rules and apply them to the file
      const rules = await loadRules(config);
      
      // Apply all applicable rules to the source to check for violations
      for (const rule of rules) {
        if (config.enabledRules.complexity && rule.category === 'Complexity' ||
            config.enabledRules.coupling && rule.category === 'Coupling' ||
            config.enabledRules.naming && rule.category === 'Naming' ||
            config.enabledRules.solid && rule.category === 'SOLID' ||
            config.enabledRules.documentation && rule.category === 'Documentation') {
          
          const violations = rule.check(sourceCode, filePath, ast, adapter);
          allViolations.push(...violations);
        }
      }
      
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        console.warn(`[WARN] File not found: ${filePath}`);
      } else {
        console.error(`[ERROR] Error processing file ${filePath}: ${err.message}`);
      }
    }
  }
  
  const endTime = Date.now();
  
  // Add stats to the result if needed
  // For now, we're just returning violations
  
  return allViolations;
}

/**
 * Determines if a file should be excluded based on the exclude patterns
 * @param filePath Path to the file
 * @param excludePatterns Patterns to match for exclusion
 */
function shouldExcludeFile(filePath: string, excludePatterns: string[]): boolean {
  for (const pattern of excludePatterns) {
    if (filePath.includes(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Analyzes the AST of a single file to get function/class info needed by rules
 */
export async function analyzeFileContent(sourceCode: string, filePath: string, adapter: LanguageAdapter): Promise<{ functions: FunctionInfo[], classes: ClassInfo[] }> {
  const ast = await adapter.parseAST(sourceCode);
  
  const functions = adapter.extractFunctions(ast);
  const classes = adapter.extractClasses(ast);
  
  return { functions, classes };
}