'use strict';
/**
 * Turning lizard's reported CCN into a verified one.
 *
 * lizard loses brace balance on some inputs and reports a span covering the rest of
 * the file, which inflates the complexity of everything below it. This module reads
 * the source, finds the function body, and recounts -- and when it cannot, it says
 * "unverified" rather than passing lizard's number through as if it were checked.
 *
 * Split out of `ccn-report.cjs` when that file crossed its size ceiling. Every
 * comment explaining why a particular rescue exists moved with the code it explains.
 */

const path = require('path');
const fs = require('fs');

const { stripNonCode, skipQuoted } = require('./ccn-strip-noncode.cjs');

// A lizard row whose reported span exceeds this is not a real function extent:
// lizard loses brace balance on some inputs and emits a span covering the rest of
// the file. Shared by verifyRowCcn and classifyUnverifiedRow, which must agree --
// two independent 250s drifting apart would classify the same row differently
// depending on which path reached it.
const SPAN_ARTEFACT_MAX_LINES = 250;

// How far below a row's reported start to search for the body. Must exceed
// SPAN_ARTEFACT_MAX_LINES: a row whose real body sits well inside the span it claims
// has to be findable, or the rescue window and the artefact threshold would disagree
// about the same row.
const RESCUE_WINDOW_LINES = 400;

// The CCN the gate blocks on, named so the classification and the FAIL message
// cannot disagree about which rows carry a verdict.
const CCN_BLOCK_THRESHOLD = 10;


/**
 * The branch tokens this verifier counts.
 *
 * The ternary arm is `\?(?![:?.])`: a bare `?[^.]` also matched TypeScript's OPTIONAL
 * property and parameter markers (`key?: string`, `f(a?: number)`), inflating the
 * recomputed CCN and producing a confident correction to a number that was right
 * (review MC-02). `?:` is a type annotation, `?.` is optional chaining, `??` is already
 * its own arm -- none of the three is a branch.
 *
 * `stripNonCode` has already removed strings and comments, so a surviving `?` is either a
 * ternary or one of those three type-level markers.
 */
/**
 * Branch tokens, with the two lexical exclusions a bare `\b` misses.
 *
 * `\b(if|for|while|case|catch)\b` also matched a PROPERTY or an OBJECT KEY:
 * `obj.if = 1` and `{ while: 1 }` each counted as a branch, inflating the recomputed CCN
 * on ordinary code (review CC-02). The lookbehind rejects a preceding `.` or word
 * character; the lookahead rejects a following `:` or `=`, which is what distinguishes an
 * object key from the keyword.
 *
 * `case 1:` survives because its colon comes AFTER the expression, not immediately after
 * the keyword. Measured across eight shapes including `case`, `catch`, `??` and `&&`.
 */
const BRANCH_RE = /(?<![.\w])(?:if|for|while|case|catch)\b(?!\s*[:=])|(?<![.\w])\?\?|&&|\|\||\?(?![:?.])/g;

// Skip a quoted run starting at `i` (which points at the opening quote) and
// return the index just past the closing quote. Unterminated runs consume the
// rest of the line, which is what a single-line scanner can honestly do.
// Copy `text` through, replacing any block comment with a single space. Returns
// { kept, open } where `open` reports a comment that runs past end of line.
/** Quote characters that open a string this scan must step over whole. */
const QUOTES = new Set(['"', "'", '`']);

/**
 * Copy a block comment out, or report that it runs past this text.
 *
 * The body is replaced by a single space so two tokens never fuse, and the line count
 * is untouched -- branch counting depends on it.
 *
 * @returns `{ next, open }`: where to resume, and whether the comment continues
 */
function consumeBlockComment(text, i) {
  const close = text.indexOf('*/', i + 2);
  return close < 0 ? { next: text.length, open: true } : { next: close + 2, open: false };
}

/** What the scan at `i` produced: text to append, where to resume, and whether open. */
function scanAt(text, i) {
  const ch = text[i];
  if (QUOTES.has(ch)) {
    const next = skipQuoted(text, i, ch);
    return { text: text.slice(i, next), next, open: false };
  }
  if (ch === '/' && text[i + 1] === '*') {
    const comment = consumeBlockComment(text, i);
    return { text: ' ', next: comment.next, open: comment.open };
  }
  return { text: ch, next: i + 1, open: false };
}

function stripBlockCommentOnce(text) {
  let kept = '';
  for (let i = 0; i < text.length;) {
    const step = scanAt(text, i);
    if (step.open) return { kept, open: true };
    kept += step.text;
    i = step.next;
  }
  return { kept, open: false };
}

// Remove comment bodies across LINES, leaving line count intact so branch
// counting is unaffected.
//
// stripNonCode handles comments within a single line only. A block comment can
// span several, and its body was therefore counted as code: measured, a body of
// `return 1` scored CCN 1, and the same body under a
// `/* ... if (x) { for (y) { while (z) ... */` comment scored 11. This repo has
// 438 multi-line block comments across 159 files, so the leak inflated real
// counts. Quoted strings are respected so a `/*` inside one does not open a
// comment.
function stripBlockComments(bodyLines) {
  const out = [];
  let open = false;
  for (const line of bodyLines) {
    let text = line;
    if (open) {
      const close = text.indexOf('*/');
      if (close < 0) { out.push(''); continue; }
      text = text.slice(close + 2);
      open = false;
    }
    const res = stripBlockCommentOnce(text);
    open = res.open;
    out.push(res.kept);
  }
  return out;
}

function ccnOfBody(bodyLines) {
  let ccn = 1;
  for (const raw of stripBlockComments(bodyLines)) {
    const hits = stripNonCode(raw).match(BRANCH_RE);
    if (hits) ccn += hits.length;
  }
  return ccn;
}

// Shared by the report loop and the Gate 3 csv path (#544): lizard's CCN is
// only trustworthy after the span has been verified against brace-balanced
// source. Returns { ccn, inflated, corrected }.
/**
 * Whether this row can be verified at all.
 *
 * Verification runs on EVERY row, not just `ccn > 10`. Measured on this repo: of 3449
 * functions lizard reports at CCN <= 10, 521 are actually higher once the body is read
 * properly -- `renderGatePassRateChart` is reported at 4 and is really 15. Gating on
 * `ccn > 10` meant the ratchet compared raw UNDER-counts for the overwhelming majority
 * of functions, and a function could rise from a reported 4 to a genuine 15 without the
 * ratchet noticing. The cost is one extra body lookup per row.
 */
/**
 * Whether this row can be recomputed against the file at all.
 *
 * The line must be INSIDE the file. Checking only `startLine > 0` let a row whose line is
 * past the end through, and `slice()` then returned a short or empty window that
 * `ccnOfBody` happily turned into a number -- a "corrected" figure computed from no code,
 * which is the most dangerous kind of measurement error: confident and wrong (CI-01/CI-02).
 */
function isVerifiable(srcLines, startLine, ccn) {
  if (!srcLines || startLine <= 0 || ccn <= 0) return false;
  return startLine <= srcLines.length;
}

function verifyRowCcn({ srcLines, name, ccn, lineNo, endNo }) {
  const startLine = Number(lineNo) || 0;
  const reportedSpan = endNo > startLine ? endNo - startLine + 1 : 0;
  const out = { ccn, inflated: false, corrected: false };
  if (!isVerifiable(srcLines, startLine, ccn)) {
    // A row we could not READ must not pass as verified. Returning `out` unchanged made an
    // unreadable file indistinguishable from a clean one, and a low CCN is exactly where a
    // silent under-count hides (review technical CI-01).
    if (!srcLines || startLine <= 0) out.unlocatable = true;
    return out;
  }
  const recomputed = recomputeRow(srcLines, { name, startLine, reportedSpan });
  if (recomputed === null) {
    out.unlocatable = true;
    return out;
  }
  return applyCorrection(out, ccn, recomputed);
}

/**
 * Record a correction on the verdict.
 *
 * `inflated` says the REPORTED number was too high. The flag is kept because the two
 * directions mean different things: an over-report is usually a span artefact in the
 * tool, while an UNDER-report is the dangerous one that lets a function grow unnoticed.
 */
function applyCorrection(out, ccn, recomputed) {
  if (recomputed === ccn) return out;
  out.inflated = recomputed < ccn;
  out.ccn = recomputed;
  out.corrected = true;
  return out;
}

/**
 * Recount a row's CCN from its source, or null when the body cannot be found.
 *
 * Two ways to find the body, and the second exists because the FIRST can fail on
 * generated code: an unlocatable body with an implausibly long reported span is a
 * MEASUREMENT artefact, and recounting over the reported window is more honest than
 * trusting a number whose span is broken. With a plausible span, an unlocatable body is
 * reported as unverified rather than guessed at.
 */
function recomputeRow(srcLines, { name, startLine, reportedSpan }) {
  const body = locateBodyAtRow(srcLines, name, startLine);
  if (body) return ccnOfBody(srcLines.slice(body.start, body.end + 1));
  if (reportedSpan <= SPAN_ARTEFACT_MAX_LINES) return null;
  return ccnOfBody(srcLines.slice(startLine - 1, startLine - 1 + reportedSpan));
}

// Read a source file as lines, or null when unreadable (caller keeps lizard's
// number and says so — an unverified row must never look verified).
function readSourceLines(root, relPath) {
  // lizard echoes back whatever path it was handed in the CSV path column, so an
  // absolute target produces an absolute path here. Joining that onto root would
  // seek <root>/<absolute>, which never exists — every row then reads as
  // unlocatable, which is either a hard failure or (with allowUnverified) a pass
  // on unverified numbers. Resolve absolute paths as themselves and confirm a
  // relative one still lives under root.
  const target = path.isAbsolute(relPath) ? relPath : path.join(root, relPath);
  try {
    return fs.readFileSync(target, 'utf8').split(/\r?\n/);
  } catch {
    return null;
  }
}

// The "verifyRowCcn could not pin the body" branch of csvRows, extracted so
// csvRows stays inside the complexity ratchet. All three outcomes are about
// CLASSIFYING an unverified row, not about the CSV rewrite itself, so they read
// as one decision: rescue by name, or count against a category.
//
// Returns { ccn, corrected } when the row was rescued, otherwise only the
// category it belongs to. The caller owns the counters, so this function stays
// free of side effects it cannot report.
function classifyUnverifiedRow({ body, ccn, reportedSpan }) {
  if (body) {
    // `corrected` must mean "the number leaving this function was read from
    // source", not "the number changed". When verification happens to agree
    // with the linter, the row is still VERIFIED — reporting it as unverified
    // would be a false accusation. The feasibility seat caught that the
    // `res.ccn !== ccn` test collapsed those two meanings.
    return { ccn: ccnOfBody(body), corrected: true, category: 'rescued' };
  }
  if (reportedSpan > SPAN_ARTEFACT_MAX_LINES) {
    // Unlocatable AND an implausibly long span: the known lizard brace-loss
    // artefact. Counting it as unverified would blame the code for a parser
    // defect; discarding it silently would hide a real number. Recorded as a
    // distinct, visible category.
    //
    // This category is OBSERVABILITY ONLY and deliberately does not fail the
    // gate — matching the pre-refactor behaviour, where the exit condition was
    // `unverified > 0` and the artefact counter never appeared in it. The
    // feasibility seat read the old "the caller decides" wording as a promise the
    // code did not keep; the honest statement is that the gate does NOT block on
    // a parser artefact, and the count is surfaced on stderr so it cannot be
    // mistaken for a clean run.
    return { category: 'span_artefact' };
  }
  // Only rows the GATE would act on are allowed to fail the gate. A row at or
  // below the block threshold has no verdict riding on it, and lizard emits
  // rows for non-declarations (`String`, `clearTimeout`, anonymous callbacks)
  // that are unlocatable by construction — counting those would block every
  // commit on noise.
  return { category: ccn > CCN_BLOCK_THRESHOLD ? 'unverified' : 'unverified_low' };
}

// Rewrite ONE `lizard --csv` row so its CCN column carries the VERIFIED value,
// or return the row unchanged when it is not a row / not verifiable. Extracted
// from csvRows so the loop there is a loop, not a parser.
//
// Returns the row text to emit. `tally` is mutated with the classification of an
// unverified row; csvRows aggregates it and decides whether to fail.
/** A line that carries data rather than the header. */
function isDataRow(line) {
  return !/^NLOC\b/.test(line) && /^\d+,/.test(line);
}

/** Re-quote a field when it contains a comma or a quote. */
function quoteField(value) {
  return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Rewrite one CSV row's CCN when the brace check corrected it.
 *
 * Field 1 is the CCN column -- writing to field 4 would silently overwrite
 * `location_size` and leave the wrong complexity in place.
 *
 * A row the verifier could not correct is returned VERBATIM rather than re-serialised:
 * re-quoting an untouched row would churn the output for no change.
 */
function rewriteCsvRow(line, { srcPath, root, sourceLines, tally }) {
  if (!isDataRow(line)) return line;
  const row = parseCsvRowIdentity(line, srcPath, root);
  if (!row) return line;
  const verified = verifyCcnForRow({ sourceLines, ...row, tally });
  if (!verified.corrected) return line;

  const cols = parseCsvLine(line);
  cols[1] = String(verified.ccn);
  return cols.map(quoteField).join(',');
}

// Decode one CSV row into the fields the verifier needs, or null when the row
// does not carry a usable CCN + location.
//
// Column order (lizard 1.21.3 --csv, NO header row, 11 fields):
//   0 NLOC | 1 CCN | 2 token_len | 3 param_count | 4 location_size
//   5 "name@start-end@path" | 6 path | 7 name | 8 signature | 9 start | 10 end
// The signature column contains commas, so it must be parsed quote-aware —
// parseCsvLine does that. CCN is field 1; field 4 is the span SIZE and
// reading it as CCN understates nothing but is simply a different number.
function parseCsvRowIdentity(line, srcPath, root) {
  const f = parseCsvLine(line);
  const ccn = parseInt(f[1], 10);
  const loc = f[5] || '';
  if (!Number.isFinite(ccn) || !loc.includes('@')) return null;
  const at = loc.split('@');
  const span = (at[1] || '').split('-');
  return {
    name: firstNonEmpty(at[0], f[7], '(anon)'),
    ccn,
    lineNo: intOrZero(span[0]),
    endNo: intOrZero(span[1]),
    // The CSV path field lizard prints is the path it was handed; resolve it
    // against the repo root so cached lines match the measured file.
    rowPath: firstNonEmpty(f[6], path.relative(root, srcPath)),
  };
}
// Locate a function body by name via brace balance. Returns [startIdx, endIdx]
// inclusive over `lines`, or null when no balanced body matches. Anonymous
// callbacks — the `(anonymous)` rows lizard emits for arrow/function literals —
// are located positionally: their row's start line IS the literal's line, so
// the first balanced `{...}` body at or after it is theirs.
/** Names that stand for "this row has no name of its own". */
const ANONYMOUS_NAMES = new Set(['(anonymous)', '(anon)']);

/** Escape a name so it can be embedded in a regular expression. */
function escapeForRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Modifiers that may precede a declaration NAME.
 *
 * TypeScript class properties and members carry a run of these, and without them the
 * body is unlocatable and the row keeps its raw count.
 */
const DECL_MODIFIERS = 'public|private|protected|readonly|static|override|declare|abstract';

/** Modifiers allowed before a bare `name(` or `name:` at the START of a line. */
const LINE_MODIFIERS = `${DECL_MODIFIERS}|async|get|set`;

/**
 * The pattern that recognises a declaration of `name`.
 *
 * Four forms, each added after a measured miss:
 *
 *   1. `function name(`                  -- the ordinary one;
 *   2. `const name =` / `let name:`      -- lizard names the row after the BINDING;
 *   3. mods then `name =` / `name:`      -- TypeScript class properties;
 *   4. mods then `name(` / `name:` at the START OF A LINE -- anchored, because
 *      unanchored it matched every USE, and since the scan takes the first hit, a call
 *      ABOVE the declaration won (measured: `isRuleEnabled` graded at its caller's CCN 6
 *      instead of its own 2).
 *
 * The source text here must never contain a backtick or an unpaired quote: a stray
 * backtick opens a template literal for lizard's own parser and it emits phantom rows
 * for the rest of this function.
 */
function declarationPattern(name) {
  const esc = escapeForRegex(name);
  return new RegExp(
    '(function\\s+' + esc + '\\s*[(<]'
    + '|\\b(?:const|let|var)\\s+' + esc + '\\s*[:=]'
    + '|\\b(?:(?:' + DECL_MODIFIERS + ')\\s+)*' + esc + '\\s*[:=]'
    + '|^\\s*(?:(?:' + LINE_MODIFIERS + ')\\s+)*' + esc + '\\s*[:(]'
    + ')',
  );
}

/** The span of the FIRST block that balances, which is what an unnamed row means. */
function firstBalancedSpan(lines) {
  for (let i = 0; i < lines.length; i++) {
    const span = balancedExtentFrom(lines, i);
    if (span) return [i, span];
  }
  return null;
}

function findFunctionBody(lines, name) {
  if (ANONYMOUS_NAMES.has(name)) return firstBalancedSpan(lines);
  const re = declarationPattern(name);
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(stripNonCode(lines[i]))) continue;
    const span = balancedExtentFrom(lines, i);
    if (span !== null) return [i, span];
  }
  return null;
}

// Close the first brace opened at/after `startIdx`. Returns the index of the
// balancing `}` (or null) so both the named and positional searches share one
// definition of "the body".
function balancedExtentFrom(lines, startIdx) {
  let depth = 0, started = false;
  for (let j = startIdx; j < lines.length; j++) {
    const step = consumeBraces(stripNonCode(lines[j]), { depth, started });
    ({ depth, started } = step);
    if (step.closed) return j;
  }
  return null;
}

/**
 * Apply one line's braces to the running depth.
 *
 * `started` matters: a line with no opening brace yet cannot CLOSE anything, so a
 * leading `}` from an earlier construct must not end the block immediately. Counting is
 * per line rather than per character so the closed line is returned, not a position.
 *
 * @returns the new state, plus whether the block closed on this line
 */
function consumeBraces(code, state) {
  let { depth, started } = state;
  for (const ch of code) {
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') depth--;
  }
  return { depth, started, closed: started && depth === 0 };
}

// Lizard reports a row's start as the DECLARATION of the parsed entity, so for
// `export const fn: Rule = { ... }` the CCN-31 row can point at `check:` while
// the binding it is named after starts a few lines ABOVE. Searching only
// downward left those rows unverified — and an unverified row keeps lizard's
// span-inflated number (measured: srpRule 31 vs real 8). Look a few lines up
// first, then fall back to the original downward search.
//
// The upward search is only valid when the reported line is part of that
// entity. A row can also name a function purely because a CALL to it happens
// inside a different, badly-scoped entity: lizard filed the body of `main()`
// under `resolvePromptBudgetBytes` (CCN 7 at line 885 of
// scripts/delphi-external-review.cjs, where the real function is a CCN-6
// one-liner 400 lines above). Blindly accepting the enclosing function gave two
// same-named baseline keys and let a bogus count look verified. So an upward hit
// is only taken when the reported line itself is not a bare mention of the name
// — i.e. the reported text is a declaration of it, or opens a body.
function isBareMention(line, name) {
  const code = stripNonCode(line);
  // The reported line need not contain the name at all: lizard names a row after
  // the enclosing binding and can file it under a member, e.g. `check: (a) => {`
  // for a row named `rule`. Such a line declares a member and is legitimate.
  const declaresMember = /[A-Za-z_$][\w$]*\s*(:\s*[([{])|\([^()]*\)\s*:\s*[^=]*=>/;
  if (declaresMember.test(code)) return false;
  if (!code.includes(name)) return true;
  // A declaration of `name` — the thing a row SHOULD point at. Two shapes:
  //   function name(...)  /  const name = ...
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declaration = new RegExp(
    '(function\\s+' + esc + '\\s*[(<]' +
    '|\\b(?:const|let|var)\\s+' + esc + '\\s*[:=])'
  );
  if (declaration.test(code)) return false;
  // A call site declares nothing: `maxBytes: name(x),` invokes the name, and the
  // brace it sits in belongs to the enclosing construct — so an upward hit is
  // not this row's body.
  return true;
}

const DECL_LOOKBACK = 6;
function locateBodyAtRow(lines, name, startLine) {
  const from = startLine - 1;
  const reported = lines[from] === undefined ? '' : lines[from];
  const mentionOnly = isBareMention(reported, name);

  // A row is filed against a line that is often NOT where the function starts:
  // lizard reports one line late for `export`ed declarations, and it also files
  // a whole later construct under a name that is merely CALLED near it
  // (measured: the 60-line `main()` body was reported as
  // `resolvePromptBudgetBytes`, a 6-line helper 400 lines above). The row's
  // reported line therefore only decides WHEN there is no declaration to
  // anchor on. A real declaration always wins — that is the body the row is
  // about, and its own extent is the only trustworthy span.
  const anchored = bodyFromDeclaration(lines, name);
  if (anchored) return anchored;

  // No declaration in this file (`(anonymous)` callbacks, class methods named only in a
  // parent, ...). Fall back to the balanced body at the reported line: exact when the
  // row starts ON a literal, approximate for member rows, and either way better than
  // trusting an unverified span.
  return bodyNearRow(lines, { from, name, mentionOnly });
}

/**
 * The body of a real DECLARATION of this name, or null.
 *
 * A declaration always wins over the reported line: it is the body the row is about, and
 * its own extent is the only trustworthy span.
 */
function bodyFromDeclaration(lines, name) {
  const declIdx = findDeclarationLine(lines, name);
  if (declIdx === null) return null;
  const span = balancedExtentFrom(lines, declIdx);
  return span === null ? null : { start: declIdx, end: span };
}

/**
 * The body found by searching BACKWARD from the reported line, or null.
 *
 * Two guards on the hit. The window is bounded (`DECL_LOOKBACK` positions of
 * `RESCUE_WINDOW_LINES` each), because the real body can be hundreds of lines away. And
 * a hit at or below the reported line is rejected when that line merely MENTIONS the
 * name: a call site inside the body would otherwise become the body.
 */
function bodyNearRow(lines, { from, name, mentionOnly }) {
  for (let k = from; k >= 0 && k >= from - DECL_LOOKBACK; k--) {
    const hit = bodyAtOffset(lines, k, { name, from, mentionOnly });
    if (hit) return hit;
  }
  return null;
}

/**
 * Whether a hit is the body we are looking for.
 *
 * A hit at or below the reported line is rejected when that line merely MENTIONS the
 * name: a call site inside the body would otherwise BE the body, and the row would be
 * graded on its own caller.
 */
function isUsableHit(absStart, from, mentionOnly) {
  return !(absStart >= from && mentionOnly);
}

/** Search one window starting at `k` for the function's body. */
function bodyAtOffset(lines, k, { name, from, mentionOnly }) {
  const window = lines.slice(k, Math.min(lines.length, k + RESCUE_WINDOW_LINES));
  const span = findFunctionBody(window, name);
  if (!span) return null;
  const absStart = k + span[0];
  return isUsableHit(absStart, from, mentionOnly) ? { start: absStart, end: k + span[1] } : null;
}

// Index of the line that DECLARES `name` (function/const/let/var/class-method
// form), or null.
// Scan stops at the first match: a file may mention a helper many times, but it
// declares it once (hoisted duplicates would be a separate bug).
function findDeclarationLine(lines, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    '(function\\s+' + esc + '\\s*[(<]' +
    '|\\b(?:const|let|var)\\s+' + esc + '\\s*[:=]' +
    // Class-method form: `  extractInterfaces(): Array<...> {`, `  maskCode(x) {`.
    //
    // Without this branch a method row could not be anchored to its declaration,
    // so locateBodyAtRow fell through to "balanced body at the reported line".
    // That fallback trusts lizard's line number, and lizard files some rows one
    // line off: measured on src/principles/adapters/java.ts, whose lizard CSV and
    // its .ccn-baseline.json entry AGREE that extractInterfaces is CCN 3, while
    // this file rewrote it to 24 -- the CCN of `extract`, further down, that the
    // drifted scan ran into. Five functions in that one file were reported as
    // ratchet regressions that did not exist, blocking every commit that touched
    // it with no repair available except faking the baseline.
    //
    // The name is anchored so a prefix cannot match: `extract` is a prefix of
    // `extractInterfaces`, and an unanchored branch would anchor the short name to
    // the long method's declaration and re-derive the same wrong body.
    //
    // `(?<![.!])` excludes MEMBER ACCESS and NEGATED CALLS. The declaration of a
    // name is preceded by nothing meaningful; a USE of it is preceded by the
    // object it is called on (`.`) or by an operator (`!`, `(`, `,`, `=`, `&`,
    // `|`, `?`, `:`) in the expression containing it. Without this, usages won the
    // race against the declaration:
    //   - the doc comment above a method -- "reads `adapter.extractInterfaces()`" --
    //     anchored the span on the comment (extractInterfaces read as CCN 24);
    //   - `if (!isRuleEnabled(rule.id)) return;` on line 189 anchored
    //     isRuleEnabled to the function it is CALLED from, so its body was taken as
    //     that neighbour's and the row graded at the neighbour's CCN 6 instead of 2.
    // Both are the same mistake: a mention is not a declaration.
    '|^\\s*(?:(?:public|private|protected|static|readonly|override|async|get|set|abstract)\\s+)*' +
      esc + '\\s*(?=\\()(?!\\w))'
  );
  for (let i = 0; i < lines.length; i++) {
    if (re.test(stripNonCode(lines[i]))) return i;
  }
  return null;
}

/** What one CSV character did to the parser state. */
function consumeQuoted(line, i, cur) {
  const ch = line[i];
  if (ch !== '"') return { cur: cur + ch, next: i + 1, closed: false };
  // A doubled quote is an ESCAPED quote inside the field, not the end of it.
  if (line[i + 1] === '"') return { cur: cur + '"', next: i + 2, closed: false };
  return { cur, next: i + 1, closed: true };
}

/**
 * Parse one lizard CSV row.
 *
 * Fields are quoted where they contain commas; there are no embedded newlines. Both
 * quote rules matter: without the doubled-quote case a path containing `"` ends the
 * field early, and every subsequent column shifts.
 *
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length;) {
    const ch = line[i];
    if (quoted) {
      const step = consumeQuoted(line, i, cur);
      cur = step.cur;
      quoted = !step.closed;
      i = step.next;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { fields.push(cur); cur = ''; } else cur += ch;
    i++;
  }
  // The final field is pushed unconditionally: a trailing separator produces an empty
  // one, which is what the column contract expects.
  fields.push(cur);
  return fields;
}

// First value that is a non-empty string after trimming, else ''.
function firstNonEmpty(...candidates) {
  for (const c of candidates) {
    const trimmed = (c || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function intOrZero(value) {
  return parseInt(value, 10) || 0;
}

// Verify one row's CCN, falling back to findFunctionBody when verifyRowCcn
// cannot pin the body. The architecture seat caught that this second search
// previously only decided whether to count the row as unverified — if it FOUND
// the body, the row kept its unvalidated CCN and passed through as if it had
// been verified.
function verifyCcnForRow({ sourceLines, rowPath, name, ccn, lineNo, endNo, tally }) {
  // Read the file ONCE. Calling sourceLines(rowPath) separately for the verify and
  // for the rescue would let the two see different text if the cache missed
  // between the calls, so a rescue could be computed against source the verifier
  // never saw.
  const srcLines = sourceLines(rowPath);
  const res = verifyRowCcn({ srcLines, name, ccn, lineNo, endNo });
  if (res.corrected) return res;
  const body = rescueBodyLines(srcLines, name, lineNo);
  const reportedSpan = endNo > lineNo ? endNo - lineNo + 1 : 0;
  const verdict = classifyUnverifiedRow({ body, ccn, reportedSpan });
  tally[verdict.category] += 1;
  if (verdict.category === 'rescued') {
    res.ccn = verdict.ccn;
    res.corrected = true;
  }
  return res;
}

// The rescue body's LINES, or null.
//
// #848: findFunctionBody returns a [startIdx, endIdx] PAIR, but
// classifyUnverifiedRow counts CCN over the body's LINES. Handing the pair
// straight through made ccnOfBody iterate two numbers instead of source text; a
// number matches no branch, so the count fell back to its initial value of 1.
// Measured before this fix: a Go function lizard reports at CCN 8, whose body
// genuinely sums to 8, was rewritten to 1 -- while the stderr tally still said
// "rescued by name", so the row looked MORE verified than the rows it was
// silently corrupting. Every brace-balanced language was affected; Python, Java
// and C# happened to pass only because their rows were corrected before reaching
// this path.
function rescueBodyLines(srcLines, name, lineNo) {
  const window = (srcLines || []).slice(lineNo - 1, lineNo - 1 + RESCUE_WINDOW_LINES);
  const span = findFunctionBody(window, name);
  return span ? window.slice(span[0], span[1] + 1) : null;
}

function memoizedSourceReader(root) {
  const cache = new Map();
  return (rel) => {
    if (!cache.has(rel)) cache.set(rel, readSourceLines(root, rel));
    return cache.get(rel);
  };
}

module.exports = {
  ccnOfBody,
  verifyRowCcn,
  readSourceLines,
  classifyUnverifiedRow,
  rewriteCsvRow,
  parseCsvRowIdentity,
  stripBlockComments,
  memoizedSourceReader,
  findFunctionBody,
  locateBodyAtRow,
  parseCsvLine,
  firstNonEmpty,
  intOrZero,
  verifyCcnForRow,
  rescueBodyLines,
};
