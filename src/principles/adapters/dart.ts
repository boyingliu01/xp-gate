import { BaseAdapter } from './base';
import { Adapter } from '../types';

export class DartAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.dart')) {
      return 'dart';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'dart',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    const fnRegex = /(async\s+)?[\w<>]+\s+(\w+)\s*\([^)]*\)\s*(async\s*)?\s*{/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      if (match[2] !== 'class' && match[2] !== 'interface' && match[2] !== 'abstract') {
        functionMatches.push({
          name: match[2],
          type: match[1] ? 'async_function' : 'function',
          line: this.getLineNumber(match.index),
          code: this.extractCodeBlock(match.index)
        });
      }
    }

    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const classRegex = /(abstract\s+)?class\s+(\w+)\s*(extends\s+\w+)?\s*(with\s+[\w,\s]+)?\s*(implements\s+[\w,\s]+)?\s*{/g;
    let match;

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[2],
        type: match[1] ? 'abstract_class' : 'class',
        line: this.getLineNumber(match.index),
        code: this.extractCodeBlock(match.index)
      });
    }

    return classMatches;
  }
}