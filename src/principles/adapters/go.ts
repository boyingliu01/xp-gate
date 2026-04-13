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
        code: this.getCodeBlock(match.index)
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
        code: this.getCodeBlock(match.index)
      });
    }
    
    return structMatches;
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