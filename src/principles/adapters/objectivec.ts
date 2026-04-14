import { BaseAdapter } from './base';
import { Adapter } from '../types';

/**
 * Objective-C Adapter
 * Supports .m (Objective-C) and .mm (Objective-C++) files
 */
export class ObjectiveCAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.m') || ext.endsWith('.mm')) {
      return 'objectivec';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'objectivec',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    
    // Match Objective-C method declarations
    // Pattern: - (returnType)methodName: (type)param ...
    const methodRegex = /[-+]\s*\([^)]+\)\s*(\w+)\s*(?::[^;{]+)?/g;
    let match;
    
    while ((match = methodRegex.exec(this.fileContent)) !== null) {
      functionMatches.push({
        name: match[1],
        type: 'method',
        line: this.getLineNumber(match.index),
        code: this.getCodeBlock(match.index)
      });
    }
    
    // Match C functions (including static inline combinations)
    const cFunctionRegex = /^(?:static\s+)?(?:inline\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{/gm;
    while ((match = cFunctionRegex.exec(this.fileContent)) !== null) {
      // Skip Objective-C method signatures that look like functions
      if (this.fileContent.substring(match.index).startsWith('-') || 
          this.fileContent.substring(match.index).startsWith('+')) {
        continue;
      }
      functionMatches.push({
        name: match[1],
        type: 'function',
        line: this.getLineNumber(match.index),
        code: this.getCodeBlock(match.index)
      });
    }
    
    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    
    // Match @implementation declarations
    const implRegex = /@implementation\s+(\w+)/g;
    let match;
    
    while ((match = implRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[1],
        type: 'implementation',
        line: this.getLineNumber(match.index),
        code: this.getCodeBlock(match.index)
      });
    }
    
    // Match @interface declarations
    const interfaceRegex = /@interface\s+(\w+)/g;
    while ((match = interfaceRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[1],
        type: 'interface',
        line: this.getLineNumber(match.index),
        code: this.getCodeBlock(match.index)
      });
    }
    
    return classMatches;
  }

  private getLineNumber(position: number): number {
    const lines = this.fileContent.substring(0, position).split('\n');
    return lines.length;
  }

  private getCodeBlock(startPos: number): string {
    let braceCount = 0;
    let inBlock = false;
    let endPos = startPos;
    
    for (let i = startPos; i < this.fileContent.length; i++) {
      const char = this.fileContent[i];
      
      if (char === '{' && !inBlock) {
        inBlock = true;
        braceCount = 1;
      } else if (char === '{' && inBlock) {
        braceCount++;
      } else if (char === '}' && inBlock) {
        braceCount--;
        if (braceCount === 0) {
          endPos = i + 1;
          break;
        }
      }
    }
    
    if (endPos > startPos) {
      return this.fileContent.substring(startPos, endPos);
    }
    
    const code = this.fileContent.substring(startPos);
    return code.substring(0, Math.min(100, code.length));
  }
}
