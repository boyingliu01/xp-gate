import { Rule, Violation, LanguageAdapter } from '../../types';

/**
 * Checks if files exceed 500 lines of code
 */
export class LargeFileRule implements Rule {
  id = 'clean-code.large-file';
  name = 'Large File';
  description = 'Files should not exceed 500 lines of code';
  severity = 'warning';
  threshold = 500;
  category = 'Complexity' as const;

  check(fileContent: string, fileName: string, ast: any, adapter: LanguageAdapter): Violation[] {
    const violations: Violation[] = [];
    
    try {
      // Count actual lines of code (excluding blank lines and comments)
      const linesOfCode = adapter.countLinesOfCode(fileContent);
      
      if (linesOfCode > this.threshold) {
        const violation: Violation = {
          ruleId: this.id,
          ruleName: this.name,
          file: fileName,
          line: 1, // Report at the beginning of the file
          message: `File has ${linesOfCode} lines of code, exceeding the ${this.threshold} line limit`,
          severity: this.severity,
          category: this.category,
          snippet: fileContent.split('\n').slice(0, 5).join('\n') + '\n...' // Show first 5 lines as snippet
        };
        
        violations.push(violation);
      }
    } catch (error) {
      console.warn(`Error checking file size in ${fileName}:`, error);
    }
    
    return violations;
  }
}