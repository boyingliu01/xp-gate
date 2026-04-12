import { Rule, Violation, LanguageAdapter } from '../../types';

/**
 * Checks for missing try-catch blocks around IO or external API operations
 */
export class MissingErrorHandlingRule implements Rule {
  id = 'clean-code.missing-error-handling';
  name = 'Missing Error Handling';
  description = 'IO or external API operations must be wrapped in try-catch blocks';
  severity = 'warning';
  threshold = 0; // Not used for this rule
  category = 'Design' as const;

  check(fileContent: string, fileName: string, ast: any, adapter: LanguageAdapter): Violation[] {
    const violations: Violation[] = [];
    
    try {
      // This would use AST patterns to find potential IO/external API calls that should be in try-catch
      // For now, simulate using keywords common in IO/external operations
      const ioOperations = [
        /\bfetch\b/,        // HTTP fetch calls
        /\bXMLHttpRequest\b/,  // HTTP operations  
        /\bfetchJson\b/,
        /\baxios\.get\b/,
        /\baxios\.post\b/,
        /\baxios\b/,       // Axios calls
        /\bhttpClient\b/,  // General HTTP client calls
        /\bdb\.insert\b/,
        /\bdb\.update\b/,
        /\bdb\.delete\b/,  // Database operations
        /\bstorage\.get\b/,
        /\blocalStorage\b/,  // Storage operations
        /\bfs\.|\breadFileSync|\bwriteFileSync\b/, // File system operations
        /\bopen\(|\bread\(|\fwrite\(|\fclose\(/, // Low-level file operations
        /\bconnect\(/,      // Network connections
        /\bwrite\{|read\{/ // Object-oriented I/O methods
      ];

      const functions = adapter.extractFunctions(ast);

      for (const func of functions) {
        // Skip functions that already have try-catch blocks
        if (func.sourceCode.includes('try') && func.sourceCode.includes('catch')) {
          continue;
        }

        // Check if function code contains any IO operations
        for (const ioPattern of ioOperations) {
          if (ioPattern.test(func.sourceCode)) {
            const violation: Violation = {
              ruleId: this.id,
              ruleName: this.name,
              file: fileName,
              line: func.startLine,
              message: `Function "${func.name}" performs potentially dangerous IO/extern API operation without try-catch error handling`,
              severity: this.severity,
              category: this.category,
              snippet: func.sourceCode.split('\n').slice(0, 3).join('\n') + '...'
            };

            violations.push(violation);
            break; // Only add one violation per function even with multiple IO ops
          }
        }
      }

    } catch (error) {
      console.warn(`Error checking error handling in ${fileName}:`, error);
    }
    
    return violations;
  }
}