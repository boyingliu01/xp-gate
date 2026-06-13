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

  protected createParseResult(language: string): unknown {
    return {
      content: this.fileContent,
      language,
      filePath: this.filePath,
    };
  }

  protected createCodeMatch(name: string, type: string, index: number): unknown {
    return {
      name,
      type,
      line: this.getLineNumber(index),
      code: this.extractCodeBlock(index),
    };
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

  protected fallbackCodeBlock(startPos: number, maxFallback: number): string {
    const code = this.fileContent.substring(startPos);
    return code.substring(0, Math.min(maxFallback, code.length));
  }

  /**
   * Advance brace tracker by one character. Returns updated state and signals when
   * a balanced block closes so callers can break out of their scan loop.
   */
  protected advanceBraceTracker(
    char: string,
    index: number,
    state: { inBlock: boolean; braceCount: number },
  ): { closed: boolean; endPos: number } {
    if (char === '{' && !state.inBlock) {
      state.inBlock = true;
      state.braceCount = 1;
      return { closed: false, endPos: index };
    }
    if (char === '{' && state.inBlock) {
      state.braceCount += 1;
      return { closed: false, endPos: index };
    }
    if (char === '}' && state.inBlock) {
      state.braceCount -= 1;
      if (state.braceCount === 0) {
        return { closed: true, endPos: index + 1 };
      }
    }
    return { closed: false, endPos: index };
  }

  protected extractCodeBlock(startPos: number, maxFallback: number = 100): string {
    const state = { inBlock: false, braceCount: 0 };
    let endPos = startPos;

    for (let i = startPos; i < this.fileContent.length; i++) {
      const result = this.advanceBraceTracker(this.fileContent[i], i, state);
      if (result.closed) {
        endPos = result.endPos;
        break;
      }
    }

    if (endPos > startPos) {
      return this.fileContent.substring(startPos, endPos);
    }

    return this.fallbackCodeBlock(startPos, maxFallback);
  }
}