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
    return this.createParseResult('swift');
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    const fnRegex = /func\s+(\w+)\s*\([^)]*\)/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      functionMatches.push(this.createCodeMatch(match[1], 'function', match.index));
    }

    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const classRegex = /class\s+(\w+)/g;
    let match;

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push(this.createCodeMatch(match[1], 'class', match.index));
    }

    return classMatches;
  }
}