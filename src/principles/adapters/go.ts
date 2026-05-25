import { BaseAdapter } from './base';
import { Adapter } from '../types';

export class GoAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.go')) {
      return 'go';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'go',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    const fnRegex = /func\s+(\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\([^)]*\)\s*({)?/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      functionMatches.push({
        name: match[2],
        type: match[1] ? 'method' : 'function',
        receiver: match[1] ? match[1].trim() : null,
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    return functionMatches;
  }

  extractClasses(): unknown[] {
    const structMatches = [];
    const structRegex = /type\s+(\w+)\s+struct\s*{/g;
    let match;

    while ((match = structRegex.exec(this.fileContent)) !== null) {
      structMatches.push({
        name: match[1],
        type: 'struct',
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    return structMatches;
  }
}