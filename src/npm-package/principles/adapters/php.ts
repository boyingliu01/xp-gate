import { BaseAdapter } from './base';
import { Adapter } from '../types';

/**
 * PHP adapter for the principles engine (Gate 4).
 *
 * Why this file exists: `analyzer.ts`'s `adapterMap` had no `.php` entry, so
 * `getAdapterForFile('a.php')` returned null while `gate-4.sh` had already been
 * widened to accept the extension. That is the #717 shape exactly -- a file is
 * accepted by the filter and then silently inspected by nobody, which reads as
 * "Gate 4 ran and found nothing".
 *
 * Regex-based on purpose, like the C/C++/Objective-C adapters: the engine has no
 * PHP AST and inventing a shallow one would report confident findings it cannot
 * verify. An under-reported file is the acceptable failure; a fabricated finding
 * is not.
 *
 * PDF note: the two forms below cover the declaration shapes the rules act on.
 * Deliberately NOT matched: closures assigned with `$f = function () {}` (the
 * binding is a variable, so a "function" finding would be attributed to `$f`
 * with no name a human recognises) and arrow functions `fn($x) => ...`, which
 * have no brace body for the nesting rules to walk.
 */
export class PhpAdapter extends BaseAdapter implements Adapter {
  detectLanguage(): string {
    const lower = this.filePath.toLowerCase();
    if (lower.endsWith('.php') || lower.endsWith('.phtml')) {
      return 'php';
    }
    return super.detectLanguage();
  }

  parseAST(): unknown {
    return this.createParseResult('php');
  }

  extractFunctions(): unknown[] {
    const functionMatches = [];
    // `function name(` with optional leading modifiers/`&` (by-reference return)
    // and an optional return type after the closing paren. The `$` lookahead the
    // closure form would need is intentionally absent -- see the class comment.
    const fnRegex = /(?:^|[\s;{}])(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+&?\s*(\w+)\s*\(/g;
    let match;

    while ((match = fnRegex.exec(this.fileContent)) !== null) {
      // A method whose name collides with a PHP keyword is not a declaration.
      if (match[1] === '__construct') {
        functionMatches.push(this.createCodeMatch(match[1], 'constructor', match.index));
        continue;
      }
      functionMatches.push(this.createCodeMatch(match[1], 'function', match.index));
    }

    return functionMatches;
  }

  extractClasses(): unknown[] {
    const classMatches = [];
    const classRegex = /(?:^|[\s;{}])class\s+(\w+)(?:\s+extends\s+([\w\\]+))?/g;
    let match;

    while ((match = classRegex.exec(this.fileContent)) !== null) {
      classMatches.push(this.createCodeMatch(match[1], 'class', match.index));
    }

    // Interfaces and traits are separate PHP type declarations. Recorded with
    // their own type rather than folded into `class`: an `interface` reported as
    // a class would be counted by the SOLID rules that reason about concrete
    // implementations.
    const otherRegex = /(?:^|[\s;{}])(interface|trait|enum)\s+(\w+)/g;
    while ((match = otherRegex.exec(this.fileContent)) !== null) {
      classMatches.push(this.createCodeMatch(match[2], match[1], match.index));
    }

    return classMatches;
  }
}
