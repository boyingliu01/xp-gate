import { BaseAdapter } from './base';
import { Adapter } from '../types';

export class CppAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.cpp') || ext.endsWith('.cxx') || ext.endsWith('.cc') ||
        ext.endsWith('.c') || ext.endsWith('.hpp') || ext.endsWith('.h')) {
      return 'cpp';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return {
      content: this.fileContent,
      language: 'cpp',
      filePath: this.filePath
    };
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    
    const fnRegex = /(\w+[\s*]+)+([\w:]+[:]+)?([~]?\w+)\s*\([^)]*\)\s*(const\s*)?\s*(override\s*)?\s*(final\s*)?\s*(noexcept\s*)?\s*(->\s*[\w<>:&*\s]+)?\s*[{;]/g;
    let match;
    
    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      const funcName = match[3] || 'unknown';
      const fullName = match[2] ? match[2] + funcName : funcName;
      
      functionMatches.push({
        name: fullName.replace(/::$/, ''),
        type: 'function',
        line: this.getLineNumber(match.index),
        code: this.getCodeBlock(match.index)
      });
    }
    
    const constructorRegex = /([\w:]+)\s*\([^)]*\)\s*:\s*[\w_]+\s*\([^)]*\)/g;
    while ((match = constructorRegex.exec(this.fileContent)) !== null) {
      const constructorName = match[1];
      const className = constructorName.split('::').pop();
      
      functionMatches.push({
        name: constructorName,
        type: 'constructor',
        line: this.getLineNumber(match.index),
        code: this.getCodeBlock(match.index)
      });
    }
    
    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    
    const classRegex = /\b(class|struct)\s+(\w+)\s*(:\s*(public|protected|private)\s+[\w:]+)?\s*\{/g;
    let match;
    
    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push({
        name: match[2],
        type: match[1],
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
    let inString = false;
    let stringChar = '';
    let inComment = false;
    
    for (let i = startPos; i < this.fileContent.length; i++) {
      const char = this.fileContent[i];
      const nextChar = this.fileContent[i + 1] || '';
      
      if (!inString && !inComment) {
        if (char === '/' && nextChar === '/') {
          while (i < this.fileContent.length && this.fileContent[i] !== '\n') {
            i++;
          }
          continue;
        }
        if (char === '/' && nextChar === '*') {
          inComment = true;
          i++;
          continue;
        }
      } else if (inComment) {
        if (char === '*' && nextChar === '/') {
          inComment = false;
          i++;
        }
        continue;
      }
      
      if (!inComment) {
        if (!inString && (char === '"' || char === "'")) {
          inString = true;
          stringChar = char;
        } else if (inString && char === stringChar) {
          let backslashCount = 0;
          let j = i - 1;
          while (j >= 0 && this.fileContent[j] === '\\') {
            backslashCount++;
            j--;
          }
          if (backslashCount % 2 === 0) {
            inString = false;
          }
        }
      }
      
      if (!inString && !inComment) {
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
    }
    
    if (endPos > startPos) {
      return this.fileContent.substring(startPos, endPos);
    }
    
    const code = this.fileContent.substring(startPos);
    return code.substring(0, Math.min(200, code.length)); 
  }
}
