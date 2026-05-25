import { readFileSync } from 'fs';
import { extname } from 'path';
import { Adapter } from '../types';

export abstract class BaseAdapter implements Adapter {
  protected readonly filePath: string;
  protected readonly fileContent: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.fileContent = this.readFileContent(filePath);
  }

  detectLanguage(): string {
    const extension = extname(this.filePath).toLowerCase();
    
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.java': 'java',
      '.kt': 'kotlin',
      '.dart': 'dart',
      '.swift': 'swift',
    };

    return languageMap[extension] || 'unknown';
  }

  abstract parseAST(): unknown;
  abstract extractFunctions(): unknown[];
  abstract extractClasses(): unknown[];

  extractExports(): unknown[] {
    return [];
  }

  countLines(): number {
    return this.fileContent.split('\n').length;
  }

  protected readFileContent(filePath: string): string {
    try {
      return readFileSync(filePath, 'utf-8');
    } catch {
      throw new Error(`Could not read file: ${filePath}`);
    }
  }

  protected getLineNumber(position: number): number {
    return this.fileContent.substring(0, position).split('\n').length;
  }

  protected extractCodeBlock(startPos: number, maxFallback: number = 100): string {
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
    return code.substring(0, Math.min(maxFallback, code.length));
  }
}