import { LanguageAdapter } from './types.js';

/**
 * Base interface for all language adapters
 * Defines the contract that all language adapters must implement
 */

export abstract class BaseAdapter implements LanguageAdapter {
  abstract getFileExtensions(): string[];
  
  abstract parseAST(sourceCode: string): Promise<any>;
  
  abstract extractFunctions(ast: any): import('./types.js').FunctionInfo[];
  
  abstract extractClasses(ast: any): import('./types.js').ClassInfo[];
  
  abstract countLinesOfCode(sourceCode: string): number;
  
  abstract isComment(sourceCode: string, startLine: number, startColumn: number, endLine: number, endColumn: number): boolean;
  
  abstract getFunctionSignature(funcInfo: import('./types.js').FunctionInfo): string;
}