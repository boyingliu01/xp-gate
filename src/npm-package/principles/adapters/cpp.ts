import { BaseAdapter } from './base';
import { Adapter } from '../types';

/**
 * Lexical state for the C/C++ block scanner: which comment/quote the scan is
 * currently inside. Braces seen in any of these states are data, not structure.
 */
interface CppLexState {
  inString: boolean;
  /** Which quote character opened the string (`'` or `"`). */
  stringChar: string;
  inBlockComment: boolean;
}

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
    return this.createParseResult('cpp');
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    const fnRegex = /(\w+[\s*]+)+([\w:]+[:]+)?([~]?\w+)\s*\([^)]*\)\s*(const\s*)?\s*(override\s*)?\s*(final\s*)?\s*(noexcept\s*)?\s*(->\s*[\w<>:&*\s]+)?\s*[{;]/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      const funcName = match[3] || 'unknown';
      const fullName = match[2] ? match[2] + funcName : funcName;

      functionMatches.push(this.createCodeMatch(fullName.replace(/::$/, ''), 'function', match.index));
    }

    const constructorRegex = /([\w:]+)\s*\([^)]*\)\s*:\s*[\w_]+\s*\([^)]*\)/g;
    while ((match = constructorRegex.exec(this.fileContent)) !== null) {
      const constructorName = match[1];

      functionMatches.push(this.createCodeMatch(constructorName, 'constructor', match.index));
    }

    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const classRegex = /\b(class|struct)\s+(\w+)\s*(:\s*(public|protected|private)\s+[\w:]+)?\s*\{/g;
    let match;

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push(this.createCodeMatch(match[2], match[1], match.index));
    }

    return classMatches;
  }

  /**
   * Report how far the lexer can skip from `i`, updating `lex` as it goes.
   *
   * C and C++ share three constructs the brace tracker must not see into: line
   * comments, block comments, and quoted literals. A `}` inside any of them is
   * data, so counting it would truncate the function body at the wrong place.
   *
   * Extracted from `extractCodeBlock`, which carried all three state machines
   * plus the brace tracking in one CCN-28 body (#620).
   *
   * IMPORTANT: this reports a skip distance and never decides that a character
   * is "consumed". Returning 0 means "the caller must look at this character
   * itself" -- which is what lets a `{` both end a literal-free run and open the
   * block. A `//` or `/*` opener IS skippable (the tracker never wants it), and
   * so are quotes; braces are not.
   *
   * @returns the number of characters to skip, or 0 when the caller must inspect.
   */
  private lexSkip(i: number, lex: CppLexState): number {
    const char = this.fileContent[i];
    const nextChar = this.fileContent[i + 1] || '';

    if (lex.inBlockComment) return this.skipBlockCommentBody(i, char, nextChar, lex);
    if (lex.inString) return this.skipStringBody(i, char, lex);

    if (char === '/' && nextChar === '/') return this.skipLineComment(i);
    if (char === '/' && nextChar === '*') {
      lex.inBlockComment = true;
      return 2;
    }
    if (char === '"' || char === "'") {
      lex.inString = true;
      lex.stringChar = char;
      return 1;
    }
    return 0;
  }

  /** Skip a `//` comment through, but not including, the newline. */
  private skipLineComment(start: number): number {
    let i = start;
    while (i < this.fileContent.length && this.fileContent[i] !== '\n') i++;
    return i - start;
  }

  private skipBlockCommentBody(
    i: number,
    char: string,
    nextChar: string,
    lex: CppLexState,
  ): number {
    if (char === '*' && nextChar === '/') {
      lex.inBlockComment = false;
      return 2;
    }
    return 1;
  }

  private skipStringBody(i: number, char: string, lex: CppLexState): number {
    if (char !== lex.stringChar) return 1;
    // A quote closes the literal only after an EVEN number of backslashes:
    // `"\\"` is a backslash then a terminator, `"\""` is a quote as data.
    let backslashCount = 0;
    let j = i - 1;
    while (j >= 0 && this.fileContent[j] === '\\') {
      backslashCount++;
      j--;
    }
    if (backslashCount % 2 === 0) lex.inString = false;
    return 1;
  }

  override extractCodeBlock(startPos: number, maxFallback: number = 200): string {
    const state = { inBlock: false, braceCount: 0 };
    const lex: CppLexState = { inString: false, stringChar: '', inBlockComment: false };
    let endPos = startPos;

    for (let i = startPos; i < this.fileContent.length;) {
      // The lexer reports how far to skip, but must NEVER consume a character
      // the brace tracker still has to see. A `{` both ends a literal-free run
      // and opens the block; consuming it here would hide the function's own
      // opening brace and leave every later brace off by one.
      //
      // `lexSkip` returns 0 ONLY for characters outside any literal or comment,
      // so a positive skip already guarantees "not structural". There is
      // deliberately no separate inString/inBlockComment test: it would be dead
      // (verified by deleting it -- no test changes colour).
      const skip = this.lexSkip(i, lex);
      if (skip > 0) { i += skip; continue; }

      const result = this.advanceBraceTracker(this.fileContent[i], i, state);
      if (result.closed) {
        endPos = result.endPos;
        break;
      }
      i++;
    }

    if (endPos > startPos) {
      return this.fileContent.substring(startPos, endPos);
    }

    return this.fallbackCodeBlock(startPos, maxFallback);
  }
}
