import { BaseAdapter } from './base';
import { Adapter } from '../types';

export class PythonAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.py')) {
      return 'python';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'python',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    
    const fnRegex = /(async\s+)?def\s+(\w+)\s*\([^)]*\)\s*:/g;
    let match;
    
    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      functionMatches.push({
        name: match[2],
        type: match[1] ? 'async_function' : 'function',
        line: this.getLineNumber(match.index),
        code: this.getCodeBlock(match.index)
      });
    }
    
    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    
    const classRegex = /class\s+(\w+)(\s*\([^)]*\))?\s*:/g;
    let match;
    
    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[1],
        type: 'class',
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
    const lines = this.fileContent.split('\n');
    const startLine = this.getLineNumber(startPos) - 1;
    
    const codeLines = [];
    let indentLevel = -1;
    
    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      
      if (i === startLine) {
        indentLevel = line.search(/\S/);
        codeLines.push(line);
      } else {
        const currentIndent = line.search(/\S/);
        
        if (line.trim() === '' || currentIndent > indentLevel) {
          codeLines.push(line);
        } else if (currentIndent >= 0 && currentIndent <= indentLevel) {
          break;
        }
      }
      
      if (codeLines.length > 50) break;
    }
    
    return codeLines.join('\n');
  }
}