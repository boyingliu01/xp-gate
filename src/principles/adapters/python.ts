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
    const fnRegex = /(async\s+)?def\s+(\w+)\s*\(([^)]*)\)\s*:/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      const code = this.getCodeBlock(match.index);
      const line = this.getLineNumber(match.index);
      functionMatches.push({
        name: match[2],
        type: match[1] ? 'async_function' : 'function',
        line,
        startLine: line,
        length: code.split('\n').length,
        params: match[3] ? match[3].split(',').filter(p => p.trim()).length : 0,
        code
      });
    }

    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const classRegex = /class\s+(\w+)(\s*\([^)]*\))?\s*:/g;
    let match;

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      const code = this.getCodeBlock(match.index);
      const line = this.getLineNumber(match.index);
      // Count methods in class body
      const methodRegex = /(?:async\s+)?def\s+\w+/g;
      const methods = code.match(methodRegex) || [];
      classMatches.push({
        name: match[1],
        type: 'class',
        line,
        startLine: line,
        length: code.split('\n').length,
        methodCount: methods.length,
        code
      });
    }

    return classMatches;
  }

  extractExports(): unknown[] {
    // Python: module-level functions and classes are considered "exports"
    const exports: unknown[] = [];
    const topLevelDefRegex = /^(?:async\s+)?def\s+(\w+)/gm;
    const topLevelClassRegex = /^class\s+(\w+)/gm;
    let match;

    while ((match = topLevelDefRegex.exec(this.fileContent)) !== null) {
      if (!match[1].startsWith('_')) {
        exports.push({ name: match[1], type: 'function', line: this.getLineNumber(match.index) });
      }
    }
    while ((match = topLevelClassRegex.exec(this.fileContent)) !== null) {
      if (!match[1].startsWith('_')) {
        exports.push({ name: match[1], type: 'class', line: this.getLineNumber(match.index) });
      }
    }
    return exports;
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
      
      if (codeLines.length > 200) break;
    }
    
    return codeLines.join('\n');
  }
}