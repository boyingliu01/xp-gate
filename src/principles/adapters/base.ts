import { readFileSync } from 'fs';
import { extname } from 'path';
import { Adapter, DuplicationReport } from '../types';
import { measureDuplication } from './duplication';


export abstract class BaseAdapter implements Adapter {
  protected readonly filePath: string;
  protected readonly fileContent: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.fileContent = this.readFileContent(filePath);
  }

  detectLanguage(): string {
    const extension = extname(this.filePath).toLowerCase();

    // The SECOND map that decides whether an adapter's file gets analysed. An
    // adapter can exist and still be discarded: analyzer.ts drops anything whose
    // detectLanguage() is 'unknown'. So a missing entry here is just as fatal as
    // a missing adapterMap entry, and the two were out of step in the same way.
    //
    // #732: mjs/cjs/mts/cts added. Without them a .mjs file passed the shell
    // filter, got an adapter, and was then thrown away at this line -- Gate 4
    // reported a clean PASS over files it never read.
    //
    // .php/.phtml (#731) and .cs/.csx/.cpp/.c/.h/.hpp/.m/.mm (#717) were also
    // missing here while their adapters existed, so the same silent discard
    // applied to them. Covered by the capability test rather than by hand.
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.mts': 'typescript',
      '.cts': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.java': 'java',
      '.kt': 'kotlin',
      '.kts': 'kotlin',
      '.dart': 'dart',
      '.swift': 'swift',
      '.php': 'php',
      '.phtml': 'php',
      '.cs': 'csharp',
      '.csx': 'csharp',
      '.cpp': 'cpp',
      '.cxx': 'cpp',
      '.cc': 'cpp',
      '.c': 'c',
      '.hpp': 'cpp',
      '.h': 'c',
      '.m': 'objectivec',
      '.mm': 'objectivec',
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

  /**
   * Measure intra-file duplication.
   *
   * Delegates to ./duplication so the algorithm stays testable on its own and
   * BaseAdapter does not grow into a subsystem. See that module for why the
   * measurement is line-level and which lines are excluded.
   */
  getDuplication(): DuplicationReport {
    return measureDuplication(this.fileContent);
  }

  /**
   * Does this adapter really support the clean-code rules, or does it only make
   * the language DETECTABLE?
   *
   * `false` is the SAFE default here, and the direction is worth stating plainly
   * because it is the opposite of the usual instinct: `false` makes the gate say
   * "this language was not analysed", which is a loss of claimed coverage, while
   * `true` makes it say "clean", which is a claim about code nobody looked at.
   * The first is a limitation; the second is a lie.
   *
   * So an adapter opts IN by overriding this to return `true` once it implements
   * rules of its own. A new shallow adapter — detect the language, extract
   * functions with a regex — inherits the honest answer without its author
   * needing to know this member exists.
   *
   * Measured before this: a Go file with 6-level nesting produced
   * `✓ No violations found / Files checked: 1 / Rules run: 21`, and all 21 rules
   * ran against a file none of them can read. TypeScript with the same nesting is
   * reported correctly, which is precisely why the gap survived — the gate looked
   * like it worked.
   * - a `readonly` property rather than a method, because the value is a static
   *   fact about the adapter and this class already sat at the 15-method
   *   God-Class threshold; a 16th method was a genuine warning, not a formality.
   */
  readonly declaresRuleCoverage: boolean = false;

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