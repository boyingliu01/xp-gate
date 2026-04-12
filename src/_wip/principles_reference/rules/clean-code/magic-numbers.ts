import { Rule, Violation, LanguageAdapter } from '../../types';

/**
 * Checks for hardcoded numbers that aren't in the excluded list
 */
export class MagicNumbersRule implements Rule {
  id = 'clean-code.magic-numbers';
  name = 'Magic Numbers';
  description = 'Code should not contain non-semantic hardcoded numbers';
  severity = 'warning';
  threshold = 0; // Not used for this rule
  category = 'Design' as const;

  // Numbers that are considered safe to use (don't trigger the rule)
  private readonly SAFE_NUMBERS = new Set([0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024]);

  check(fileContent: string, fileName: string, ast: any, adapter: LanguageAdapter): Violation[] {
    const violations: Violation[] = [];
    
    try {
      // Simple regex pattern for numeric literals - this would be expanded in a real implementation
      // This pattern captures integers, floats, hex, octal, scientific notation etc.
      const numberPattern = /\b(-?\d+(\.\d+)?(e[+-]?\d+)?)\b/g;
      
      let match;
      while ((match = numberPattern.exec(fileContent)) !== null) {
        const fullMatch = match[1]; // The captured number
        const lineNumber = fileContent.substring(0, match.index).split('\n').length;
        const columnNumber = match.index - fileContent.lastIndexOf('\n', match.index);
        
        // Parse the number
        const numericValue = parseFloat(fullMatch);
        
        // Check if this is a "safe" number (excluded from the rule)
        if (this.SAFE_NUMBERS.has(numericValue)) {
          continue;
        }
        
        // Skip if this number appears to be in a comment or string context
        if (adapter.isComment(fileContent, lineNumber, columnNumber, lineNumber, columnNumber + fullMatch.length)) {
          continue;
        }
        
        // Create violation
        const violation: Violation = {
          ruleId: this.id,
          ruleName: this.name,
          file: fileName,
          line: lineNumber,
          column: columnNumber,
          message: `Magic number ${fullMatch} detected (not in safe list)`,
          severity: this.severity,
          category: this.category,
          snippet: fileContent.split('\n')[lineNumber - 1]?.trim() || ''
        };
        
        violations.push(violation);
      }
    } catch (error) {
      console.warn(`Error checking for magic numbers in ${fileName}:`, error);
    }
    
    return violations;
  }
}