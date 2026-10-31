/**
 * Position analysis for TypeScript's regex-based extraction.
 *
 * The extraction regexes match `name(` for both a method DECLARATION and a CALL.
 * This module answers which one it is, keeping `typescript.ts` inside its line
 * budget and giving the rule a place to be tested directly.
 */

/**
 * Characters that can only precede a CALL, never a declaration.
 *
 * `.` covers member calls (`this.c()`, `obj.method()`), `(` a call used as an
 * argument (`if (existsSync(p))`), `,` a call in a list (`foo(a, bar(b))`), and
 * the operators cover a call in a condition or expression
 * (`hadExisting && existsSync(p)`, `x = read(p)`, `!isReady(q)`). No member
 * declaration begins with any of them.
 *
 * Deliberately NOT included: `{`, `;`, `}` and plain whitespace. Those precede
 * BOTH shapes -- `{ helper(1); }` is a call, `{ run(): void {` is a declaration
 * -- so using them makes the answer depend on formatting. Depth is what
 * separates those two, which is why extractClasses counts by brace depth.
 */
const CALL_PRECEDERS = new Set([
  '.', '(', ',',
  '&', '|', '=', '!', '?', ':', '+', '-', '*', '/', '<', '>', '[',
]);

/**
 * Is the identifier starting at `nameIndex` a call rather than a declaration?
 *
 * Without this check `if (existsSync(p))` was extracted as a method named
 * `existsSync` -- the extraction regex's lookbehind permits `(` before the name
 * -- which then borrowed the enclosing block's brace as a "body" and reported a
 * phantom `missing-error-handling` warning that no edit could clear. It also
 * inflated `extractClasses().methodCount` with the names of whatever the class
 * body happened to call (66 reported for a class declaring 30).
 */
export function isCallPosition(masked: string, nameIndex: number): boolean {
  let i = nameIndex - 1;
  while (i >= 0 && /\s/.test(masked[i])) i -= 1;
  return i >= 0 && CALL_PRECEDERS.has(masked[i]);
}

