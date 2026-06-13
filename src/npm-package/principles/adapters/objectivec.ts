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
    const methodRegex = /[-+]\s*\([^)]+\)\s*(\w+)\s*(?::[^;{]+)?/g;
    let match;

    while ((match = methodRegex.exec(this.fileContent)) !== null) {
      functionMatches.push({
        name: match[1],
        type: 'method',
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    const cFunctionRegex = /^(?:static\s+)?(?:inline\s+)?(?:\w+\s+)+(\w+)\s*\([^)]*\)\s*\{/gm;
    while ((match = cFunctionRegex.exec(this.fileContent)) !== null) {
      if (this.fileContent.substring(match.index).startsWith('-') ||
          this.fileContent.substring(match.index).startsWith('+')) {
        continue;
      }
      functionMatches.push({
        name: match[1],
        type: 'function',
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const implRegex = /@implementation\s+(\w+)/g;
    let match;

    while ((match = implRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[1],
        type: 'implementation',
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    const interfaceRegex = /@interface\s+(\w+)/g;
    while ((match = interfaceRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[1],
        type: 'interface',
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    return classMatches;
  }
}
