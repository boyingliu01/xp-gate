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

  countLines(): number {
    return this.fileContent.split('\n').length;
  }

  protected readFileContent(filePath: string): string {
    try {
      return readFileSync(filePath, 'utf-8');
    } catch (error) {
      throw new Error(`Could not read file: ${filePath}`);
    }
  }
}