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
        code: this.getCodeBlock(match.index)
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