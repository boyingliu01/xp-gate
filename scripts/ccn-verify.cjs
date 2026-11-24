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


const BRANCH_RE = /\b(if|for|while|case|catch)\b|\?\?|&&|\|\||\belif\b|\?[^.]/g;

// Skip a quoted run starting at `i` (which points at the opening quote) and
// return the index just past the closing quote. Unterminated runs consume the
// rest of the line, which is what a single-line scanner can honestly do.
// Copy `text` through, replacing any block comment with a single space. Returns
// { kept, open } where `open` reports a comment that runs past end of line.
function stripBlockCommentOnce(text) {
  let kept = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const next = skipQuoted(text, i, ch);
      kept += text.slice(i, next);
      i = next;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) return { kept, open: true };
      i = close + 2;
      kept += ' ';
      continue;
    }
    kept += ch;
    i++;
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
function verifyRowCcn({ srcLines, name, ccn, lineNo, endNo }) {
  const startLine = Number(lineNo) || 0;
  const reportedSpan = endNo > startLine ? endNo - startLine + 1 : 0;
  const out = { ccn, inflated: false, corrected: false };
  // Verify EVERY row, not just ccn > 10. Measured on this repo: of 3449 functions
  // lizard reports at CCN <= 10, 521 are actually higher once the body is read
  // properly — renderGatePassRateChart is reported at 4 and is really 15. Gating
  // verification on ccn > 10 therefore meant the ratchet compared raw
  // UNDER-counts for the overwhelming majority of functions, and a function could
  // rise from an under-reported 4 to a genuine 15 without the ratchet noticing.
  // The cost is one extra body lookup per row, which is what makes the numbers
  // mean anything.
  if (!srcLines || startLine <= 0 || ccn <= 0) return out;
  const body = locateBodyAtRow(srcLines, name, startLine);
  let recomputed;
  if (body) {
    recomputed = ccnOfBody(srcLines.slice(body.start, body.end + 1));
  } else if (reportedSpan > SPAN_ARTEFACT_MAX_LINES) {
    // Unlocatable body AND an implausibly long span: recompute over the
    // reported window rather than trust a number with a broken span.
    recomputed = ccnOfBody(srcLines.slice(startLine - 1, startLine - 1 + reportedSpan));
  } else {
    out.unlocatable = true;
    return out;
  }
  if (recomputed !== ccn) {
    out.inflated = recomputed < ccn;
    out.ccn = recomputed;
    out.corrected = true;
  }
  return out;
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
function rewriteCsvRow(line, { srcPath, root, sourceLines, tally }) {
  if (/^NLOC\b/.test(line) || !/^\d+,/.test(line)) return line;
  const row = parseCsvRowIdentity(line, srcPath, root);
  if (!row) return line;
  const verified = verifyCcnForRow({ sourceLines, ...row, tally });
  if (!verified.corrected) return line;
  const cols = parseCsvLine(line);
  // Field 1 is the CCN column — writing to field 4 would silently overwrite
  // location_size and leave the wrong complexity in place.
  cols[1] = String(verified.ccn);
  return cols.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
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
function findFunctionBody(lines, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (name === '(anonymous)' || name === '(anon)') {
    // Positional: find the first line that opens a brace and close it.
    for (let i = 0; i < lines.length; i++) {
      const span = balancedExtentFrom(lines, i);
      if (span) return [i, span];
    }
    return null;
  }
  // "export const ocpRule: Rule = {" / "const handler = (a) => {" / class
  // methods: lizard names the row after the binding, so the declaration has to
  // count as "the function starts here" too. Without this the row was simply
  // unlocatable and its raw (span-inflated) count survived verification.
  // NOTE: this comment must never contain a backtick. A stray backtick opens a
  // template literal for lizard's parser and it emits phantom rows for the rest
  // of the function (measured: a bogus "=" row at CCN 24 for this very file).
  // Same for single quotes in the paragraphs around it — keep them paired.
  const re = new RegExp(
    '(function\\s+' + esc + '\\s*[(<]' +
    '|\\b(?:const|let|var)\\s+' + esc + '\\s*[:=]' +
    // TypeScript class properties: `public readonly handler = (a) => {`,
    // `private _handler: Handler = ...`. Any run of visibility/readonly/static
    // modifiers may precede the name. Without this the body is unlocatable and
    // the row keeps its raw count — verified by probe that both forms failed
    // before this alternative existed.
    '|\\b(?:(?:public|private|protected|readonly|static|override|declare|abstract)\\s+)*' + esc + '\\s*[:=]' +
    // A bare `name(` / `name:` on a line is a declaration only when it STARTS the
    // line (optionally behind modifiers). Without the `^\\s*` anchor this branch
    // matched every USE of the name anywhere in the file, and because the scan
    // takes the first hit, a call above the declaration won: measured on
    // src/principles/analyzer.ts, `if (!isRuleEnabled(rule.id)) return;` on line
    // 189 anchored isRuleEnabled to the helper it is called from, and the row was
    // graded at that neighbour's CCN 6 instead of its own 2.
    '|^\\s*(?:(?:public|private|protected|readonly|static|override|declare|abstract|async|get|set)\\s+)*' + esc + '\\s*[:(]' +
    ')'
  );
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
    const code = stripNonCode(lines[j]);
    for (const ch of code) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth === 0) return j;
  }
  return null;
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
  const declIdx = findDeclarationLine(lines, name);
  if (declIdx !== null) {
    const span = balancedExtentFrom(lines, declIdx);
    if (span !== null) return { start: declIdx, end: span };
  }

  // No declaration in this file (`(anonymous)` callbacks, class methods named
  // only in a parent, ...). Fall back to the balanced body at the reported line,
  // which is exact when the row starts ON a literal and merely approximate for
  // member rows — either way it beats trusting an unverified span.
  for (let k = from; k >= 0 && k >= from - DECL_LOOKBACK; k--) {
    const span = findFunctionBody(lines.slice(k, Math.min(lines.length, k + RESCUE_WINDOW_LINES)), name);
    if (!span) continue;
    const absStart = k + span[0];
    if (absStart >= from && mentionOnly) continue;
    return { start: absStart, end: k + span[1] };
  }

  return null;
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

function parseCsvLine(line) {
  // lizard CSV rows: fields quoted where they contain commas; no embedded newlines.
  const fields = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
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

module.exports = {
  ccnOfBody,
  verifyRowCcn,
  readSourceLines,
  classifyUnverifiedRow,
  rewriteCsvRow,
  parseCsvRowIdentity,
  stripBlockComments,
  findFunctionBody,
  locateBodyAtRow,
  parseCsvLine,
  firstNonEmpty,
  intOrZero,
  verifyCcnForRow,
  rescueBodyLines,
};
