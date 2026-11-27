/**
 * Parse lizard output into rows the repository can assert on.
 *
 * WHY THIS IS PURE
 * ----------------
 * The first version of the complexity check compared line lengths while parsing
 * text lizard never actually emits, so it reported "no violations" for a file
 * with CCN 22. Keeping the parsing separate from process spawning is what makes
 * that trap testable: `parseLizardCsv` can be fed real captured output in a test
 * without a lizard install, and `ccnViolations` can be pinned to the boundary.
 *
 * FIELD ORDER (verified against lizard 1.26.1 `lizard_ext/csvoutput.py`, which
 * writes these fields literally in this order):
 *
 *   0 NLOC  1 CCN  2 token  3 PARAM  4 length  5 "name@start-end@file"
 *   6 file  7 name  8 long_name  9 start  10 end
 *
 * COLUMN 1, NOT COLUMN 0. Column 0 is NLOC (non-comment lines); CCN is column
 * 1. This parser originally read column 0, which silently produced zero rows
 * because the start-line lookup then landed on a filename -- and "zero rows"
 * was reported to the user as "no complex functions". There is a test pinning
 * each of the three numeric columns so the mistake cannot come back quietly.
 *
 * Token count (column 2) is NOT a substitute for CCN, which is why it is worth
 * writing down: measured on a fixture, the branch-free helper has CCN 1 and 54
 * tokens, while the two-branch function has CCN 3 and 25 tokens. The most
 * branched function in that file has the FEWEST tokens, so any check that
 * compares tokens to a complexity threshold ranks the code backwards.
 *
 *   function simple(n) { const a=n+1; ... return d; }   -> 7,1,54,...   CCN 1
 *   function branchy(n){ if..if.. return -1 }           -> 5,3,25,...   CCN 3
 */

/** One CSV record from lizard, or null when the line is not a function row. */
function functionRow(line) {
  // A malformed or non-function line must not be counted as CCN 0.
  const cells = splitCsvLine(line);
  if (cells.length < 10) return null;
  const row = {
    nloc: Number(cells[0]),
    ccn: Number(cells[1]),
    file: cells[6],
    line: Number(cells[9]),
    name: cells[7],
  };
  return Number.isFinite(row.ccn) && Number.isFinite(row.nloc) && Number.isFinite(row.line) ? row : null;
}

/** Splitting on any newline keeps CRLF and LF input working. */
function lines(text) {
  return String(text || '').split(String.fromCharCode(10));
}

/** @returns {Array<{ccn:number,nloc:number,file:string,line:number,name:string}>} */
export function parseLizardCsv(text) {
  return lines(text)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(functionRow)
    .filter(Boolean);
}

/**
 * Split one CSV record, honouring double-quoted cells (RFC 4180).
 *
 * Lizard quotes the function signature, and a signature routinely contains a
 * comma (`applySkillCopies ( rows , { backupRoot , dryRun } )`). A plain
 * `split(',')` therefore shifts every later column by one and the "file" cell
 * becomes part of the name -- silently detaching the violation from its file.
 *
 * A regex-over-quoted-spans version was tried first and emitted an empty cell
 * wherever two quoted spans met (`"a","b"`); a comma that appears while
 * `inQuotes` is NOT a separator is the whole rule, and separating the walk into
 * "consume one character" keeps both the rule and the loop readable.
 *
 * The last rule is the doubled quote: inside a quoted cell, `""` is ONE literal
 * quote. That needs the following character, so the walk is index-based and
 * `step` reports whether it consumed the next character too.
 */
export function splitCsvLine(line) {
  const chars = [...String(line)];
  const state = { cells: [], cell: '', inQuotes: false };
  for (let i = 0; i < chars.length; i += 1) {
    if (step(state, chars[i], chars[i + 1])) i += 1;
  }
  return [...state.cells, state.cell];
}

/**
 * One character: escape, quote toggle, separator, or literal.
 * @returns {boolean} true when the NEXT character was consumed as part of this one
 */
function step(state, ch, next) {
  if (isEscapedQuote(state, ch, next)) {
    state.cell += '"';
    return true;
  }
  if (ch === '"') {
    state.inQuotes = !state.inQuotes;
    return false;
  }
  return appendCell(state, ch);
}

/** `""` inside a quoted cell is one literal quote, not two toggles. */
function isEscapedQuote(state, ch, next) {
  return state.inQuotes && ch === '"' && next === '"';
}

/** A comma outside quotes ends the cell; anything else is a literal character. */
function appendCell(state, ch) {
  if (ch === ',' && !state.inQuotes) {
    state.cells.push(state.cell);
    state.cell = '';
    return false;
  }
  state.cell += ch;
  return false;
}

/** Rows whose CCN is strictly above `threshold`; equal to it is allowed. */
export function ccnViolations(rows, threshold) {
  return rows.filter((r) => r.ccn > threshold);
}
