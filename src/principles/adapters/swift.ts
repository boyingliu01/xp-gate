import { BaseAdapter } from './base';
import { Adapter } from '../types';

export class SwiftAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.swift')) {
      return 'swift';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'swift',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    const fnRegex = /func\s+(\w+)\s*\([^)]*\)/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
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