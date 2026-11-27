import { BaseAdapter } from './base';
import { Adapter } from '../types';

/**
 * Words that read like a function name but open a DECLARATION.
 *
 * `class Foo() {` and `abstract Bar() {` match the function pattern, and reporting them as
 * functions would double-count every class the adapter already reports.
 */
const DECLARATION_KEYWORDS = new Set(['class', 'interface', 'abstract']);

export class DartAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const ext = this.filePath.toLowerCase();
    if (ext.endsWith('.dart')) {
      return 'dart';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return this.createParseResult('dart');
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    const fnRegex = /(async\s+)?[\w<>]+\s+(\w+)\s*\([^)]*\)\s*(async\s*)?\s*{/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      if (!DECLARATION_KEYWORDS.has(match[2])) {
        // A leading `async` means the regex matched a declaration whose body is async,
        // which the adapter reports as a distinct type.
        const type = match[1] ? 'async_function' : 'function';
        functionMatches.push(this.createCodeMatch(match[2], type, match.index));
      }
    }

    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const classRegex = /(abstract\s+)?class\s+(\w+)\s*(extends\s+\w+)?\s*(with\s+[\w,\s]+)?\s*(implements\s+[\w,\s]+)?\s*{/g;
    let match;

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      const type = match[1] ? 'abstract_class' : 'class';
      classMatches.push(this.createCodeMatch(match[2], type, match.index));
    }

    return classMatches;
  }
}