import { BaseAdapter } from './base';
import { Adapter } from '../types';

export class JavaAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.java')) {
      return 'java';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'java',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const methodMatches = [];
    const methodRegex = /(public|private|protected|static|final|synchronized|native)\s+[\w<>[\]]+\s+(\w+)\s*\([^)]*\)\s*(throws\s+[\w,\s]+)?\s*{/g;
    let match;

    while ((match = methodRegex.exec(this.fileContent)) !== null) {
      methodMatches.push({
        name: match[2],
        type: 'method',
        modifiers: match[1].split(' ').filter(m => m.trim()),
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    return methodMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const classRegex = /(public|private|protected)?\s*(abstract|final|static)?\s*class\s+(\w+)\s*(extends\s+\w+)?\s*(implements\s+[\w,\s]+)?\s*{/g;
    let match;

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[3],
        type: 'class',
        modifiers: [match[1], match[2]].filter(m => m && m.trim()),
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    return classMatches;
  }
}