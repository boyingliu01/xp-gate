/**
 * Line-level questions the Gate 10 scanners ask.
 *
 * Split out of `gate-10.ts` when that file crossed its size ceiling. Both concerns are
 * about ONE source line: is it a multi-line import that needs joining, and does code
 * follow the comment that starts it. Neither looks at more than the text it is given.
 */


/**
 * Assemble a multi-line `import`/`export ... from '...'` statement starting at
 * `start`, or return null when that line does not open one.
 *
 * Returns the joined text and how many FOLLOWING lines were consumed, so the
 * caller can advance past them. The joining character is a space, which keeps
 * `from` adjacent to its quotes without disturbing `['"]` matching; the text is
 * only used for matching, never for the reported line number, so collapsing
 * newlines cannot shift a position that is reported.
 */
/** A line that BEGINS a static import or export. */
const IMPORT_OPENER = /^\s*(?:import|export)\b/;

/** A line that already carries the module path, so the statement is complete. */
const IMPORT_COMPLETE = /\bfrom\s*['"]|^\s*(?:import|export)\s*['"]/;

/** How many lines a statement may span before giving up on joining it. */
const MAX_STATEMENT_LINES = 40;

/**
 * Join a multi-line `import ... from '...'` into one line, when it is one.
 *
 * Prettier splits a long import across lines, and a single-line scan then sees an
 * incomplete statement. Returns null -- "leave it alone" -- for anything that is not
 * an unfinished opener, because guessing would join unrelated code.
 */
/** Whether this line opens an import statement that still lacks its path. */
function opensUnfinishedImport(line: string): boolean {
  // Only a line that BEGINS a static import/export can open a statement, and only one
  // without its path yet needs joining.
  return IMPORT_OPENER.test(line) && !IMPORT_COMPLETE.test(line);
}

function joinImportStatement(
  lines: string[],
  start: number,
): { text: string; consumed: number } | null {
  if (!opensUnfinishedImport(lines[start])) return null;

  const parts: string[] = [lines[start]];
  for (let k = start + 1; k < lines.length && parts.length <= MAX_STATEMENT_LINES; k++) {
    parts.push(lines[k]);
    if (IMPORT_COMPLETE.test(lines[k])) return { text: parts.join(' '), consumed: k - start };
  }
  return null;
}

/**
 * Does any CODE follow the comment that starts this line?
 *
 * Returns true when the line does not start with a comment at all, so callers can
 * treat it as the single "should this line be scanned?" question. Only three prefixes
 * can begin a comment line and each closes in exactly one way, so this needs no lexer
 * -- the masker has already established that the line is not inside a literal.
 *
 * Skipping on the raw prefix alone was a real MISS: an eslint-disable directive that
 * also carries an import starts with a block-comment opener, so the whole line was
 * dropped and the genuine import on it was never checked -- the one direction a
 * compliance gate must not fail in.
 */
function startsInBlockComment(trimmed: string): boolean {
  return trimmed.startsWith('/*') || trimmed.startsWith('*');
}

/**
 * Whether CODE follows the comment that starts this line.
 *
 * Returns true when the line does not start with a comment at all, so callers can
 * treat it as the single "should this line be scanned?" question -- the alternative
 * was every caller re-deriving it.
 */
function hasCodeAfterLeadingComment(originalLine: string): boolean {
  const trimmed = originalLine.trim();
  if (trimmed.startsWith('//')) return false; // nothing can follow on this line
  if (!startsInBlockComment(trimmed)) return true;
  return hasTrailingCode(trimmed);
}

/** Whether code follows the marker that closes a block comment on this line. */
function hasTrailingCode(trimmed: string): boolean {
  const close = trimmed.indexOf('*/');
  // An unterminated block comment runs to the end of the file: no code here.
  if (close === -1) return false;
  const rest = trimmed.slice(close + 2).trim();
  return rest.length > 0 && !rest.startsWith('//');
}


export { joinImportStatement, hasCodeAfterLeadingComment };
