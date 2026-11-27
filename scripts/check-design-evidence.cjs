#!/usr/bin/env node
/**
 * @test REQ-DESIGN-EVIDENCE
 * @intent Every concrete value (field name, path constant, output string) asserted in a
 *         design document must carry an inline citation to where it was measured, or be
 *         explicitly labelled as a new design decision. This exists because the same
 *         author fabricated API details four separate times in one design sprint
 *         (`archlintStatus`, the summary field list, a description of their own test
 *         output, and `details.skip_kind`). Discipline was falsified four times; this
 *         script is the mechanism that replaces it.
 * @covers AC-DESIGN-EVIDENCE-01, AC-DESIGN-EVIDENCE-02, AC-DESIGN-EVIDENCE-03
 *
 * Usage: node scripts/check-design-evidence.cjs <design-doc.md> [...]
 * Exit 0 = every citation-backed value has a citation or a new-design marker.
 * Exit 1 = at least one value lacks both.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Patterns that indicate "a value copied from somewhere real". Each one must be
 * followed (within the same or an adjacent non-blank line) by a citation marker.
 *
 * Deliberately narrow: this check must be cheap enough to never be disabled.
 * A false positive on prose is a maintenance cost that gets the whole script
 * switched off, which is exactly the failure mode we are avoiding.
 */
const VALUE_PATTERNS = Object.freeze([
  // dotted field access: journal.gates.M.details.skip_kind
  // A single dot (gate6.archlintStatus) MUST also match — that was fabrication #1, and
  // requiring two dots would have let the original mistake through.
  /\b[a-zA-Z_$][\w$]*\.[a-zA-Z_$][\w$]*\b/,
  // capitalised ALL_CAPS constant referenced as a value
  /\b[A-Z][A-Z0-9]{2,}_[A-Z0-9_]+\b/,
  // path.join(...) style path construction
  /path\.join\s*\(/,
]);

/** Markers that discharge the obligation for a value on the same block. */
const CITATION_PATTERNS = Object.freeze([
  /`?[\w./-]+\.(?:md|json|js|cjs|mjs|ts|sh|yaml|yml|py|go|java|kt)(?::\d+)?`?/i, // file (with or without :line)
  /\b[\w./-]+:\d+\b/,              // bare file:line
  /^\s*\$\s+\S/m,                  // shell command line ($ archlint --version)
  /\bexit\s*=\s*\d+/,              // captured exit code
  /实测/,                          // explicitly marked as measured
  /本设计新增/,                    // explicitly marked as a new design decision
  /本设计要新增/,                  // variant
  /需实现/,                        // explicitly marked as to-be-implemented
  /实现任务/,                      // explicitly marked as an implementation task
  // NOTE: a bare "PASS" is a VALUE, not a citation. Matching it would make every
  // assertion about an expected status self-citing — the checker would pass the
  // very fabrications it exists to catch. Only an explicit captured-output marker counts.
  /^\s*#?\s*(?:actual|output|got|结果)[:：]/im,
]);

/**
 * A fenced block that is introduced by a line naming the file it was copied from is
 * itself a citation: every value inside it came from that file.
 */
const FENCE_SOURCE_HINT = Object.freeze([
  /`[\w./-]+\.(?:sh|cjs|js|mjs|ts|py|go|java|kt|yaml|yml|json)`/,  // `githooks/pre-push`
  /githooks\/|src\/|scripts\/|\.github\//,
]);

/** Lines that are structural rather than asserting a measured value. */
const SKIP_LINE_PATTERNS = Object.freeze([
  /^\s*$/,                          // blank
  /^\s*#{1,6}\s/,                   // heading
  /^\s*```/,                        // fence
  /^\s*\|?\s*:?-{3,}/,              // table separator
  /^\s*\|?\s*#/,                    // table header / comment
  /^\s*[-*]\s*\[[ x]\]/,            // task list
  /^\s*>\s*$/,                      // bare quote marker
]);

/**
 * A document that explains this very check inevitably quotes the patterns it looks for.
 * Those meta lines are not asserting a measured value, so exempting them is correct —
 * and keeps the checker usable on the design doc that introduces it.
 */
const META_LINE_PATTERNS = Object.freeze([
  /剩余 \d+ 处/,                    // "the remaining N findings are ..."
  /\|\s*点号字段正则/,             // the checker's own defect table (any column layout)
  /\|\s*错误\s*\|\s*后果\s*\|/,       // "error | consequence | how found" tables
  /console\.warn/,                 // discussing the probe API itself
]);

function isStructural(line) {
  return SKIP_LINE_PATTERNS.some((re) => re.test(line))
    || META_LINE_PATTERNS.some((re) => re.test(line));
}

function hasCitation(block) {
  return CITATION_PATTERNS.some((re) => re.test(block));
}

function hasValue(line) {
  return VALUE_PATTERNS.some((re) => re.test(line));
}

/**
 * A "block" is the line plus its neighbours, because a citation is often written
 * on the line after the value it justifies (in prose) or in a comment above it.
 */
function buildBlocks(lines, radius) {
  return lines.map((_, i) => {
    const from = Math.max(0, i - radius);
    const to = Math.min(lines.length, i + radius + 1);
    return lines.slice(from, to).join('\n');
  });
}

function checkFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const blocks = buildBlocks(lines, 2);
  const fenceOf = assignFences(lines);
  const fenceSources = indexFenceSources(lines, fenceOf);

  const findings = [];
  lines.forEach((line, i) => {
    if (needsCitation(line, { block: blocks[i], fenceId: fenceOf[i], fenceSources })) {
      findings.push({ line: i + 1, text: line.trim() });
    }
  });
  return findings;
}

/** An inline code span, whose contents are a value assertion. */
const INLINE_CODE = /`[^`]+`/;

/**
 * Whether this line states a value without saying where it came from.
 *
 * Four ways it does not need a citation:
 *
 *  - it is structural (a heading, a list marker) and asserts nothing;
 *  - it asserts a value NOWHERE -- outside a fence only inline code counts, while
 *    INSIDE a fence every line is a value assertion;
 *  - the paragraph it belongs to already carries a citation;
 *  - it is a fence copied verbatim from a named source file, which is a citation in
 *    itself.
 */
function needsCitation(line, { block, fenceId, fenceSources }) {
  if (isStructural(line) || !hasValue(line)) return false;
  if (!assertsValue(line, fenceId)) return false;
  if (hasCitation(block)) return false;
  return !isCitedFence(fenceId, fenceSources);
}

/** Whether this fence was copied from a named source file, which cites itself. */
function isCitedFence(fenceId, fenceSources) {
  return isInFence(fenceId) && Boolean(fenceSources.get(fenceId));
}

/** Whether this line sits inside a fenced block. */
function isInFence(fenceId) {
  return fenceId !== -1;
}

/**
 * Whether this line actually ASSERTS a value.
 *
 * Inside a fence every line is a value assertion; outside one, only inline code is --
 * a prose sentence mentioning no `code span` claims nothing checkable.
 */
function assertsValue(line, fenceId) {
  return isInFence(fenceId) || INLINE_CODE.test(line);
}

/**
 * Map each line index to its 0-based fence id, or -1 when outside every fence.
 * Fence delimiter lines themselves map to -1 (they are structural).
 */
function assignFences(lines) {
  const fenceOf = new Array(lines.length).fill(-1);
  let current = -1;
  let inside = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      if (inside) {
        inside = false;
        current = -1;
      } else {
        inside = true;
        current += 1;
      }
      return;
    }
    fenceOf[i] = inside ? current : -1;
  });
  return fenceOf;
}

/**
 * For each fenced block, record whether the line introducing it carried a citation
 * or new-design marker. A marker on the introducing line covers everything inside
 * the block — that is how a reader reads it too: "the following is a new design",
 * then the code. Requiring a marker on every line would produce noise, and noise is
 * what gets a checker switched off.
 */
function indexFenceSources(lines, fenceOf) {
  const sources = new Map();
  lines.forEach((line, i) => {
    if (!FENCE_DELIMITER.test(line)) return;
    const nextId = fenceOf.slice(i + 1).find((id) => id !== -1);
    recordFence(sources, { nextId, lines, i });
  });
  return sources;
}

/** A fence delimiter line. */
const FENCE_DELIMITER = /^\s*```/;

/**
 * Record whether the fence opening at `i` is cited.
 *
 * Two skips: no following fence id means this is the CLOSING delimiter or an empty
 * block, and a fence already recorded was seen from its opening line.
 */
function recordFence(sources, { nextId, lines, i }) {
  if (nextId === undefined || sources.has(nextId)) return;
  const context = lines.slice(Math.max(0, i - FENCE_CONTEXT_LINES), i + 1).join('\n');
  sources.set(nextId, fenceIsCited(context));
}

/** How many lines before a fence may name its source. */
const FENCE_CONTEXT_LINES = 6;

/**
 * Whether a fence's CONTEXT cites it.
 *
 * Six lines rather than one: the source is often named in the sentence above a blank
 * line, and the marker may be on either side of the fence opener.
 */
function fenceIsCited(contextLines) {
  const named = FENCE_SOURCE_HINT.some((re) => re.test(contextLines));
  const marked = CITATION_PATTERNS.some((re) => re.test(contextLines));
  return named || marked;
}

/**
 * Check and report one design document.
 *
 * @returns the finding count, or null when the file is missing -- an unreadable target
 *   is a HARD failure rather than a finding, because "no citation problems" must never
 *   be reported for a document that was not read.
 */
function reportOne(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    console.error(`missing: ${target}`);
    return null;
  }
  const findings = checkFile(resolved);
  if (findings.length === 0) return 0;
  console.error(`\n${target}: ${findings.length} value(s) with no citation or new-design marker`);
  for (const f of findings) {
    // Truncated because a table row can run long, and the LINE NUMBER is what the
    // reader navigates by -- a clipped quote is still enough to recognise it.
    console.error(`  :${f.line}  ${f.text.slice(0, MAX_REPORTED_LINE)}`);
  }
  return findings.length;
}

/** How much of a finding's text to print beside its line number. */
const MAX_REPORTED_LINE = 120;

function main(argv) {
  const targets = argv.slice(2);
  if (targets.length === 0) {
    console.error('usage: node scripts/check-design-evidence.cjs <design-doc.md> [...]');
    return 2;
  }

  let total = 0;
  for (const target of targets) {
    const findings = reportOne(target);
    if (findings === null) return 2;
    total += findings;
  }

  if (total > 0) {
    console.error(
      '\nEach finding asserts a concrete value (field name, constant, path, output string) '
      + 'without saying where it came from.\n'
      + 'Add one of: a `file:line` citation, a `$ command` + its output, `实测`,\n'
      + '`本设计新增` / `本设计要新增`, or `需实现` — in the same paragraph as the value.\n'
      + 'This is not bureaucracy: the same author fabricated API details four times in '
      + 'sprint-20261110-33, each time while intending to be careful.'
    );
    return 1;
  }

  console.log(`design-evidence: OK (${targets.length} file(s) checked)`);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { checkFile, VALUE_PATTERNS, CITATION_PATTERNS };
