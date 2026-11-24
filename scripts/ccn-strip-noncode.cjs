'use strict';
/**
 * Strip strings, comments and regex literals from a source line, leaving only code.
 *
 * Split out of `ccn-report.cjs` when that file crossed its size ceiling. The block is
 * a coherent unit: a character scanner and the four constructs it can meet.
 *
 * The comments explaining each construct moved with it, and they matter --
 * particularly the one on `stripNonCode`: leaving a regex body in place once produced
 * a confident CCN 24 for a function that is 3, because a brace inside the regex text
 * opened a block the brace scan never saw closed.
 */

function skipQuoted(line, i, quote) {
  let k = i + 1;
  while (k < line.length) {
    if (line[k] === '\\') { k += 2; continue; }
    if (line[k] === quote) return k + 1;
    k++;
  }
  return line.length;
}

function stripNonCode(line) {
  // Remove string/template/comment/regex content so keywords and braces inside
  // them do not count.
  //
  // REGEX LITERALS ARE LOAD-BEARING, not a nicety. A regex such as
  // `/(?:interface)\s*\{/g` contains a `{` that is part of its text, and leaving
  // it in made the brace scan believe a function opened a block it never closed.
  // Measured on src/principles/adapters/java.ts: extractInterfaces opened its
  // body, then this line added an unbalanced `{`, so balancedExtentFrom ran to the
  // END OF THE FILE and ccnOfBody summed ~90 lines -- reporting CCN 24 for a
  // function lizard and the baseline both say is 3. Every function below a regex
  // containing a brace inherited the same wrong body.
  let out = '';
  let i = 0;
  // The last character emitted as real code: a `/` can only START a regex where an
  // expression is expected, never after an identifier, literal or closing bracket.
  let prev = '';
  while (i < line.length) {
    const ch = line[i];
    const step = stripAt(line, i, prev);
    if (step) {
      out += step.text;
      if (step.prev !== undefined) prev = step.prev;
      i = step.next;
      continue;
    }
    out += ch;
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  return out;
}

/**
 * Strip the construct starting at `i`, if one starts there.
 *
 * A line comment ends the scan, so it reports `next` at the end of the line. Nothing
 * here touches brace counting; it only decides what counts as CODE, and every
 * construct it removes is replaced by a single space so two tokens never fuse.
 *
 * @param {string} line
 * @param {number} i index of the character under the cursor
 * @param {string} prev last character emitted as code
 * @returns {{text: string, prev: string, next: number} | null} null when the
 *   character is ordinary code
 */
/** The strip rules, each asked in turn at the cursor. */
const STRIP_RULES = [
  stripLineComment,
  stripBlockComment,
  stripRegexLiteral,
  stripQuoted,
];

/**
 * Strip the construct starting at `i`, if any rule claims it.
 *
 * The rules are asked in ORDER: a comment opener must win over a regex, because a
 * bare slash preceded by `(` could otherwise be read as the start of one.
 *
 * @param {string} line
 * @param {number} i index of the character under the cursor
 * @param {string} prev last character emitted as code
 * @returns {{text: string, prev: string, next: number} | null} null when the
 *   character is ordinary code
 */
function stripAt(line, i, prev) {
  for (const rule of STRIP_RULES) {
    const hit = rule(line, i, prev);
    if (hit) return hit;
  }
  return null;
}

/** `//` runs to the end of the line. */
function stripLineComment(line, i) {
  if (line[i] !== '/' || line[i + 1] !== '/') return null;
  return { text: '', prev: undefined, next: line.length };
}

/** A block comment is replaced by nothing; the scanner resumes after it. */
function stripBlockComment(line, i) {
  if (line[i] !== '/' || line[i + 1] !== '*') return null;
  return { text: '', prev: undefined, next: skipBlockComment(line, i) };
}

/** A regex literal, only where an expression may START. */
function stripRegexLiteral(line, i, prev) {
  if (line[i] !== '/' || !REGEX_PRECEDERS.has(prev)) return null;
  const end = skipRegexLiteral(line, i);
  return end > i ? { text: ' ', prev: ' ', next: end } : null;
}

/** A single-, double- or back-quoted run. */
function stripQuoted(line, i) {
  const ch = line[i];
  if (ch !== '"' && ch !== "'" && ch !== '`') return null;
  return { text: ' ', prev: ' ', next: skipQuoted(line, i, ch) };
}

/**
 * Index just past a block comment starting at `i`.
 *
 * An unterminated comment consumes the rest of the line: there is no closing pair to
 * find, and pretending otherwise would resume scanning inside it.
 *
 * @param {string} line
 * @param {number} i index of the opening slash
 * @returns {number}
 */
function skipBlockComment(line, i) {
  const end = line.indexOf('*/', i + 2);
  return end < 0 ? line.length : end + 2;
}

// Characters after which a `/` opens a regex literal rather than dividing.
const REGEX_PRECEDERS = new Set([
  '', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*',
  '<', '>', '~', '^', '%',
]);

// Index just past a regex literal starting at `start` (which points at `/`), or
// -1 when the run does not look like one (no unescaped closing `/` on this line).
/**
 * Index just past a regex literal's flag run (g, i, m, u, s, y, d).
 *
 * Its own function so the character walk below stays flat: folding the flags
 * into it put the branch chain five levels deep for no gain.
 */
function skipRegexFlags(line, from) {
  let k = from;
  while (k < line.length && /[a-z]/i.test(line[k])) k++;
  return k;
}

function skipRegexLiteral(line, start) {
  let k = start + 1;
  let inClass = false;
  while (k < line.length) {
    const ch = line[k];
    if (ch === '\\') { k += 2; continue; }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) return skipRegexFlags(line, k + 1);
    k++;
  }
  return -1;
}

module.exports = {
  stripNonCode,
  skipQuoted,
};
