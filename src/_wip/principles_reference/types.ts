/**
 * Clean Code & SOLID Principles Checker
 * Type definitions for the analysis engine.
 * 
 * This file contains all the type definitions for rules, violations,
 * adapters, and configuration objects used throughout the system.
 */

export interface Rule {
  /**
   * Unique identifier for the rule
   */
  id: string;
  
  /**
   * Human-readable name of the rule
   */
  name: string;
  
  /**
   * Explanation of what the rule checks for
   */
  description: string;
  
  /**
   * Severity level: error, warning, or info
   */
  severity: 'error' | 'warning' | 'info';
  
  /**
   * Threshold value for the rule (varies by rule type)
   */
  threshold: number;
  
  /**
   * Category of the principle this rule enforces
   */
  category: 'SOLID' | 'Naming' | 'Complexity' | 'Coupling' | 'Documentation' | 'Design';
  
  /**
   * Method to check if this rule is violated in the given file
   */
  check(fileContent: string, fileName: string, ast: any, adapter: LanguageAdapter): Violation[];
}

export interface Violation {
  /**
   * The ID of the rule that was violated
   */
  ruleId: string;
  
  /**
   * The name of the rule that was violated
   */
  ruleName: string;
  
  /**
   * Path to the file where the violation occurred
   */
  file: string;
  
  /**
   * Line number where the violation occurred (1-indexed)
   */
  line: number;
  
  /**
   * Column number where the violation occurred (1-indexed)
   */
  column?: number;
  
  /**
   * Explanation of the violation
   */
  message: string;
  
  /**
   * Severity level of the violation
   */
  severity: 'error' | 'warning' | 'info';
  
  /**
   * Category of the principle that was violated
   */
  category: 'SOLID' | 'Naming' | 'Complexity' | 'Coupling' | 'Documentation' | 'Design';
  
  /**
   * Specific code snippet that caused the violation
   */
  snippet?: string;
}

export interface Config {
  /**
   * Thresholds for different types of checks
   */
  thresholds: {
    /**
     * Maximum number of parameters allowed in a function/method
     */
    maxParams: number;
    /**
     * Maximum lines of code allowed in a function/method
     */
    maxLinesOfCode: number;
    /**
     * Maximum Cyclomatic Complexity allowed in a function/method
     */
    maxCyclomaticComplexity: number;
    /**
     * Maximum number of classes allowed in a file
     */
    maxClassesPerFile: number;
    /**
     * Maximum number of methods allowed per class
     */
    maxMethodsPerClass: number;
    /**
     * Maximum nesting depth allowed in functions/methods
     */
    maxNestingDepth: number;
    /**
     * Minimum length for identifiers (for non-getter/setter methods)
     */
    minIdentifierLength: number;
    /**
     * Maximum number of instance variables per class
     */
    maxInstanceVariables: number;
    /**
     * Maximum number of literals per function
     */
    maxLiteralsPerFunction: number;
  };
  
  /**
   * Whether to enable specific categories of checks
   */
  enabledRules: {
    complexity: boolean;
    coupling: boolean;
    naming: boolean;
    solid: boolean;
    documentation: boolean;
  };
  
  /**
   * Which file extensions to analyze
   */
  fileExtensions: string[];
  
  /**
   * Additional directories to exclude from analysis
   */
  excludePatterns: string[];
}

export interface LanguageAdapter {
  /**
   * Returns file extensions this adapter supports
   */
  getFileExtensions(): string[];
  
  /**
   * Parses the source code and returns an abstract syntax tree (AST)
   */
  parseAST(sourceCode: string): Promise<any>;
  
  /**
   * Extracts function/method definitions from the AST
   */
  extractFunctions(ast: any): FunctionInfo[];
  
  /**
   * Extracts class definitions from the AST
   */
  extractClasses(ast: any): ClassInfo[];
  
  /**
   * Counts lines of code in the source, excluding comments and blank lines
   */
  countLinesOfCode(sourceCode: string): number;
  
  /**
   * Checks if the given text in the source code is within a comment
   */
  isComment(sourceCode: string, startLine: number, startColumn: number, endLine: number, endColumn: number): boolean;
  
  /**
   * Gets the function signature for displaying in reports
   */
  getFunctionSignature(funcInfo: FunctionInfo): string;
}

export interface FunctionInfo {
  /**
   * Function name
   */
  name: string;
  
  /**
   * Starting line number (1-indexed)
   */
  startLine: number;
  
  /**
   * Ending line number (1-indexed)
   */
  endLine: number;
  
  /**
   * Parameters of the function
   */
  parameters: ParameterInfo[];
  
  /**
   * Nesting depth of the function (how many levels deep in blocks it is)
   */
  nestingDepth: number;
  
  /**
   * Cyclomatic complexity score (McCabe complexity)
   */
  complexity: number;
  
  /**
   * Number of non-comment, non-blank lines in the function
   */
  linesOfCode: number;
  
  /**
   * Actual source code of the function
   */
  sourceCode: string;
  
  /**
   * Additional metadata that might be relevant for analysis
   */
  metadata?: {
    [key: string]: any;
  };
}

export interface ParameterInfo {
  /**
   * Parameter name
   */
  name: string;
  
  /**
   * Parameter type (if available in language)
   */
  type?: string;
  
  /**
   * Whether it's optional (if language supports it)
   */
  optional?: boolean;
}

export interface ClassInfo {
  /**
   * Class name
   */
  name: string;
  
  /**
   * Methods defined in this class
   */
  methods: FunctionInfo[];
  
  /**
   * Name of parent class if this class inherits from another
   */
  superClass?: string;
  
  /**
   * Interfaces implemented by this class
   */
  implements?: string[];
  
  /**
   * Fields and properties in the class
   */
  fields: FieldInfo[];
  
  /**
   * Starting line number (1-indexed)
   */
  startLine: number;
  
  /**
   * Ending line number (1-indexed)
   */
  endLine: number;
  
  /**
   * Actual source code of the class
   */
  sourceCode: string;
  
  /**
   * Additional metadata that might be relevant for analysis
   */
  metadata?: {
    [key: string]: any;
  };
}

export interface FieldInfo {
  /**
   * Field name
   */
  name: string;
  
  /**
   * Field type (if available in language)
   */
  type?: string;
  
  /**
   * Visibility of the field (public, private, protected, etc.)
   */
  visibility: 'public' | 'private' | 'protected';
  
  /**
   * Starting line number (1-indexed)
   */
  startLine: number;
  
  /**
   * Ending line number (1-indexed)
   */
  endLine: number;
}

export interface AnalysisResult {
  /**
   * List of files analyzed
   */
  analyzedFiles: string[];
  
  /**
   * List of violations found across all files
   */
  violations: Violation[];
  
  /**
   * Runtime statistics like analysis time, etc.
   */
  stats?: AnalysisStats;
}

export interface AnalysisStats {
  /**
   * Total time taken for analysis in milliseconds
   */
  executionTime: number;
  
  /**
   * Number of files analyzed
   */
  filesProcessed: number;
  
  /**
   * Number of functions analyzed
   */
  functionsAnalyzed: number;
  
  /**
   * Number of classes analyzed
   */
  classesAnalyzed: number;
  
  /**
   * Average lines of code per function
   */
  avgLinesPerFunction: number;
}