import { BaseAdapter } from './base';
import { Adapter } from '../types';

export class TypeScriptAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.ts') || ext.endsWith('.tsx')) {
      return 'typescript';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'typescript',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    
    const fnRegex = /(export\s+)?(async\s+)?function\s+(\w+)\s*\([^)]*\)\s*[:\w\s]*{/g;
    let match;
    
    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      functionMatches.push({
        name: match[3],
        type: 'function',
        line: this.getLineNumber(match.index),
        code: this.getCodeBlock(match.index)
      });
    }
    
    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    
    const classRegex = /(export\s+)?class\s+(\w+)\s*(extends\s+[\w.]+)?\s*{/g;
    let match;
    
    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[2],
        type: 'class',
        line: this.getLineNumber(match.index),
        code: this.getCodeBlock(match.index)
      });
    }
    
    return classMatches;
  }

  countLines(): number {
    return this.fileContent.split('\n').length;
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