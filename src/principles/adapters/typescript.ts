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
        code: this.extractCodeBlock(match.index)
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
        code: this.extractCodeBlock(match.index)
      });
    }

    return classMatches;
  }

  countLines(): number {
    return this.fileContent.split('\n').length;
  }

  extractExports(): unknown[] {
    const exportMatches = [];
    const exportRegex = /^(export\s+(default\s+)?(async\s+)?(function|const|class|let|var|type|interface|enum)\s+\w+)/gm;
    let match;

    while ((match = exportRegex.exec(this.fileContent)) !== null) {
      exportMatches.push({
        name: match[0],
        type: 'export',
        line: this.getLineNumber(match.index)
      });
    }

    const reExportRegex = /^export\s*{/gm;
    let reMatch;
    while ((reMatch = reExportRegex.exec(this.fileContent)) !== null) {
      exportMatches.push({
        name: reMatch[0],
        type: 're-export',
        line: this.getLineNumber(reMatch.index)
      });
    }

    return exportMatches;
  }
}