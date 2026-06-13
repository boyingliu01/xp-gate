import { BaseAdapter } from './base';
import { Adapter } from '../types';

export class KotlinAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.kt') || ext.endsWith('.kts')) {
      return 'kotlin';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'kotlin',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    const fnRegex = /(suspend\s+)?fun\s+(\w+)\s*\([^)]*\)\s*(:\s*[\w<>?]+)?\s*{/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      functionMatches.push({
        name: match[2],
        type: match[1] ? 'suspend_function' : 'function',
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const classRegex = /class\s+(\w+)/g;
    let match;

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[1],
        type: 'class',
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    return classMatches;
  }
}