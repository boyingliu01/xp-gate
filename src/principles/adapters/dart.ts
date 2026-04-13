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
          code: this.getCodeBlock(match.index)
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