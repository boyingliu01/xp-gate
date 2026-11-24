#!/usr/bin/env node
/**
 * @module language-capability
 * @test REQ-LANG-CAPABILITY
 * @intent Answer "is language X actually wired into every gate surface?" by
 *         DERIVING the answer from the code instead of reading a document.
 *
 *         WHY THIS EXISTS. C# support took five separate repair waves across
 *         sixteen days (#717, #730, #763, #768, #776, #780, #783, #798), and
 *         the consuming project had to build ~400 lines of its own gates to
 *         cover what xp-gate did not. None of those waves was "a hard bug":
 *         each was ONE SURFACE that had not been wired. The failure mode was
 *         always identical -- the gate read an empty file list, took the
 *         "no files to check" branch, and printed ✅ PASSED or ⏭️ SKIPPED.
 *         Nothing anywhere said "this language is not covered here".
 *
 *         The root cause is structural: a language has to be written into
 *         SIX independent knowledge surfaces (adapter, Gate 1 verdict arm,
 *         Gate 3 lizard population, Gate 4 analyzer map, Gate 5 extensions,
 *         Gate 6 architecture arm, Gate 9 build arm, Gate 13 strictness) plus
 *         three CLI/CI surfaces, and NONE of them reference each other. Adding
 *         a language file without wiring it produces silence, not an error.
 *
 *         So this module does not maintain a second list. It READS the same
 *         files the gates read and reports what it finds, per surface, in the
 *         project's own three-state vocabulary:
 *
 *             checked     the surface will actually evaluate this language
 *             NOT WIRED   the surface exists but this language is absent from it
 *             not impl.   this surface has no arm for the language at all
 *
 *         The distinction between the last two is the point. "NOT WIRED" is a
 *         one-line fix that someone forgot; "not impl." is a design gap that
 *         must be declared. Collapsing them (the way ✅/nothing collapsed them
 *         in the hook) is what made the C# gap invisible.
 *
 *         WHY DERIVED AND NOT DECLARED. `gate-capability.js` already
 *         established the rule for gates: derive from `gate-registry.sh`, never
 *         restate. A hand-maintained "language support matrix" is the same
 *         defect one level down -- it would be the fourteenth copy of the
 *         extension list, written in prose, with no test able to notice it
 *         going stale. Derived output cannot drift: it changes when the code
 *         changes, which is exactly the property the C# retrofit lacked.
 *
 * @see docs/2026-11-19-csharp-onboarding-retrospective.md
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** The three verdicts, closed vocabulary. An open set lets a new state read as fine. */
const STATE = Object.freeze({
  /** The surface will evaluate this language. */
  CHECKED: 'checked',
  /** The surface exists and supports languages, but this one is absent from it. */
  NOT_WIRED: 'not-wired',
  /** The surface has no arm that could ever handle this language. */
  NOT_IMPLEMENTED: 'not-implemented',
  /** The surface could not be located or parsed — say so, never guess. */
  UNKNOWN: 'unknown',
});

/** Display order and human titles for the surfaces, one row per inspection. */
const SURFACES = Object.freeze([
  { key: 'adapter', title: 'Adapter (Gate 1/5 runtime)' },
  { key: 'gate0-detect', title: 'Gate 0 language detection' },
  { key: 'gate-1', title: 'Gate 1 code quality (verdict arm)' },
  { key: 'gate-2', title: 'Gate 2 duplicate code' },
  { key: 'gate-3', title: 'Gate 3 complexity (lizard)' },
  { key: 'gate-4', title: 'Gate 4 principles (analyzer map)' },
  { key: 'gate-5', title: 'Gate 5 tests + coverage' },
  { key: 'gate-6', title: 'Gate 6 architecture' },
  { key: 'gate-9', title: 'Gate 9 build integrity' },
  { key: 'gate-10', title: 'Gate 10 SAST ruleset' },
  { key: 'gate-13', title: 'Gate 13 compiler strictness' },
  { key: 'cli-registry', title: 'CLI LANGUAGE_REGISTRY' },
  { key: 'ci-detect', title: 'CI language detection' },
]);

/**
 * Languages to inspect and the extensions that identify them.
 *
 * This is the ONE place this module names languages, and it does so only to
 * know which tokens to LOOK FOR in the surfaces below -- it is not a claim
 * about support. Every verdict is read from the named file.
 *
 * Deliberately NOT derived from LANGUAGE_REGISTRY in language-tools.js: that
 * registry is itself one of the surfaces under test (cli-registry below), and
 * using it as the source of truth would mean "a language missing from the
 * registry cannot be reported missing from the registry".
 */
const LANGUAGES = Object.freeze({
  typescript: { extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'] },
  python: { extensions: ['py'] },
  go: { extensions: ['go'] },
  java: { extensions: ['java'] },
  kotlin: { extensions: ['kt', 'kts'] },
  csharp: { extensions: ['cs', 'csx'] },
  cpp: { extensions: ['cpp', 'cxx', 'cc', 'c', 'h', 'hpp'] },
  swift: { extensions: ['swift'] },
  objectivec: { extensions: ['m', 'mm'] },
  dart: { extensions: ['dart'] },
  php: { extensions: ['php'] },
  shell: { extensions: ['sh', 'bash'] },
  powershell: { extensions: ['ps1', 'psm1'] },
  iac: { extensions: ['tf'] },
});

/**
 * Languages the `p/security-audit` baseline ruleset can actually analyse.
 *
 * MEASURED, not assumed: the cached ruleset's `languages:` keys count python 77,
 * java 52, go 28, typescript 20, javascript 20, ruby 16, c 9, kt 3, hcl 3. PHP
 * appears only inside OWASP URLs (`.../index.php`) and has ZERO rules, and
 * csharp has zero -- which is why Gate 10 loads `p/csharp` conditionally.
 *
 * This is the one place in this module that encodes MEASURED tool knowledge
 * rather than reading a file, because the cover set lives in a downloaded
 * artifact that is not in the repo. It is kept as a small explicit set so that
 * a language admitted to the baseline later reads as `unknown` (honest) rather
 * than as a defect (a false alarm) until someone re-measures.
 */
const SAST_BASELINE_LANGUAGES = new Set([
  'typescript',
  'python',
  'go',
  'java',
  'kotlin',
  'cpp',
  'shell', // via the `generic`/`c` arms; measured indirectly, see docs
]);

/**
 * Resolve the repo root that holds `githooks/`.
 *
 * Installed copies live under `<pkg>/lib/`, with the hooks one level up; a
 * source checkout may have this file under `src/npm-package/lib/`. Probe for
 * the marker rather than assuming a depth -- a wrong depth would make every
 * surface report `unknown`, which reads like "not implemented".
 *
 * @param {string} [startDir]
 * @returns {string|null} directory containing `githooks/`, or null
 */
function findHooksRoot(startDir = __dirname) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'githooks', 'pre-commit'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * @param {string} file
 * @returns {string|null} file contents, or null when it cannot be read
 */
function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Does `ext` appear as a standalone extension token in a `|`-separated list?
 *
 * The source alternations are written `\.(ts|tsx|cs|csx)$`, so the input here
 * is the CONTENT between the parens (`ts|tsx|cs|csx`) already extracted by
 * `extensionAlternation`. A bare `includes('cs')` would match the `cs` inside
 * `csx` -- reporting a language as wired when the list only lists its sibling.
 * Split on `|` and compare whole elements instead: exact, and impossible to
 * fool with a substring.
 *
 * @param {string} alternation e.g. `ts|tsx|js`
 * @param {string} ext e.g. `ts`
 * @returns {boolean}
 */
function hasExtensionToken(alternation, ext) {
  if (!alternation) return false;
  return alternation
    .split('|')
    .map((token) => token.trim().replace(/^\\+/, '').replace(/[\\)\$\\]+$/, ''))
    .includes(ext);
}

/**
 * Extract the content of every `\.(<alts>)$` alternation in `text`.
 *
 * Written once because the same shape appears in five differently-named
 * variables (`CODE_EXTENSIONS`, `PRINCIPLES_FILES`, `SOURCE_FILES`, `CC_FILES`,
 * the Gate 1 short-circuit). Matching the SHAPE rather than a variable name is
 * what keeps this reader working when someone renames the variable -- and a
 * reader that silently returns '' on a renamed variable would report every
 * language as NOT WIRED, which is the false-alarm direction that gets tools
 * switched off.
 *
 * @param {string} text
 * @returns {string[]} alternation bodies, each like `ts|tsx|js`
 */

/**
 * Does `text` name `lang` as a language key (not merely mention the word)?
 *
 * `csharp`, `php`, `go` are short enough that a plain substring search finds
 * them in comments and in unrelated identifiers. Require a quoted or delimited
 * occurrence so a prose mention cannot be read as an implementation.
 *
 * @param {string} text
 * @param {string} lang
 * @returns {boolean}
 */
function extensionAlternations(text) {
  if (!text) return [];
  // The source spells the regex as `\.( … )$` inside a single-quoted shell
  // string or a double-quoted JS/TS string. Match the literal backslash-dot,
  // then the parenthesised alternation, then the anchor. `[^)]*` rather than a
  // stricter class because extension lists are the only thing this pattern is
  // asked to match.
  const re = /\\\.\(([^)]*)\)/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/**
 * Does any `\.( … )$` alternation in `text` list one of `exts`?
 * @param {string} text
 * @param {string[]} exts
 * @returns {boolean}
 */
function anyAlternationHas(text, exts) {
  const alternations = extensionAlternations(text);
  return exts.some((ext) => alternations.some((alt) => hasExtensionToken(alt, ext)));
}

/**
 * Does `text` name `lang` as a language key (not merely mention the word)?
 *
 * `csharp`, `php`, `go` are short enough that a plain substring search finds
 * them in comments and in unrelated identifiers. Require a quoted or delimited
 * occurrence so a prose mention cannot be read as an implementation.
 *
 * @param {string} text
 * @param {string} lang
 * @returns {boolean}
 */
function hasLanguageKey(text, lang) {
  if (!text) return false;
  const escaped = lang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`["'\`]${escaped}["'\`]`),
    new RegExp(`^\\s*${escaped}\\)`, 'm'),
    new RegExp(`\\b${escaped}\\b\\s*(?::|\\))`),
  ];
  return patterns.some((re) => re.test(text));
}

/**
 * Count function DEFINITIONS and CALLS separately for a shell function name.
 *
 * The C# Gate 13 path shipped a `gate13_run_csharp_analysis()` that nothing
 * called (#717 §8). A surface that is "defined but not invoked" is worse than
 * an absent one: grep finds the name and reads as coverage. These two counts
 * are the difference, so they are counted, not grepped for once.
 *
 * @param {string} text
 * @param {string} fnName
 * @returns {{defined: boolean, called: boolean}}
 */
function definitionAndCall(text, fnName) {
  if (!text) return { defined: false, called: false };
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defined = new RegExp(`^${escaped}\\s*\\(\\)`, 'm').test(text);
  const called = new RegExp(`(^|[^\\w-])${escaped}(\\s|$|;|&)`, 'm').test(
    text
      .split('\n')
      .filter((line) => !new RegExp(`^\\s*${escaped}\\s*\\(\\)`).test(line))
      .filter((line) => !/^\s*#/.test(line))
      .join('\n'),
  );
  return { defined, called };
}

/**
 * Build one result row.
 * @param {string} surface
 * @param {string} language
 * @param {string} state
 * @param {string} evidence
 * @returns {{surface: string, language: string, state: string, evidence: string}}
 */
function row(surface, language, state, evidence) {
  return { surface, language, state, evidence };
}

/**
 * Inspect every surface for one language.
 *
 * Each inspector is independent and returns exactly one row. A surface whose
 * inputs are unreadable returns `unknown` with the reason -- never `checked`,
 * because an unreadable file is not evidence of wiring.
 *
 * @param {string} lang
 * @param {{root: string|null, read: (rel: string) => string|null}} ctx
 * @returns {Array<{surface: string, language: string, state: string, evidence: string}>}
 */
function inspectLanguage(lang, ctx) {
  // The 13 per-surface inspectors live in language-capability-surfaces.js.
  // They were extracted after Gate 4 measured the single function at 264 lines
  // (clean-code.long-function max 50): a report that cannot pass the gate it
  // explains has no standing to explain it. Behaviour is unchanged -- each
  // helper returns exactly the one row this loop used to push.
  const deps = {
    row,
    STATE,
    hasLanguageKey,
    anyAlternationHas,
    // Exposed so the surfaces can recognise an extension declared in
    // `file-classifier.sh` rather than spelled out inside the gate script.
    hasExtensionToken,
    definitionAndCall,
    SAST_BASELINE_LANGUAGES,
    SURFACES,
    LANGUAGES,
  };
  const surfaces = require("./language-capability-surfaces");
  return surfaces.inspectLanguage(deps, lang, ctx);
}

function inspectAll(options = {}) {
  const root = options.root === undefined ? findHooksRoot() : options.root;
  const ctx = {
    root,
    read: (rel) => (root === null ? null : readIfPresent(path.join(root, rel))),
  };
  const rows = [];
  for (const lang of Object.keys(LANGUAGES)) rows.push(...inspectLanguage(lang, ctx));
  return rows;
}

/** @param {string} state @returns {string} a fixed-width glyph for the console table */
function glyph(state) {
  switch (state) {
    case STATE.CHECKED:
      return '✅';
    case STATE.NOT_WIRED:
      return '❌';
    case STATE.NOT_IMPLEMENTED:
      return '⬜';
    default:
      return '❔';
  }
}

/**
 * Summarise one language's rows into the sentence a human actually needs.
 *
 * Deliberately counts NOT WIRED and NOT IMPLEMENTED separately. Folding them
 * together is the same conflation that made "not checked" and "passed" look
 * alike in the hook: one is a bug, the other is a declared gap, and they have
 * different owners.
 *
 * @param {Array<object>} rows
 * @returns {{total: number, checked: number, notWired: number, notImplemented: number, unknown: number}}
 */
function summarise(rows) {
  const out = { total: rows.length, checked: 0, notWired: 0, notImplemented: 0, unknown: 0 };
  for (const r of rows) {
    if (r.state === STATE.CHECKED) out.checked += 1;
    else if (r.state === STATE.NOT_WIRED) out.notWired += 1;
    else if (r.state === STATE.NOT_IMPLEMENTED) out.notImplemented += 1;
    else out.unknown += 1;
  }
  return out;
}

/**
 * Render a human-readable report.
 * @param {Array<object>} rows
 * @param {{lang?: string}} [options]
 * @returns {string}
 */
function formatReport(rows, options = {}) {
  const languages = options.lang ? [options.lang] : [...new Set(rows.map((r) => r.language))];
  const lines = [];
  let anyNotWired = false;

  for (const lang of languages) {
    const mine = rows.filter((r) => r.language === lang);
    if (mine.length === 0) {
      lines.push(`${lang}: unknown language (not in the inspectable set)`);
      continue;
    }
    const sum = summarise(mine);
    if (sum.notWired > 0) anyNotWired = true;
    lines.push('');
    lines.push(
      `${lang}: ${sum.checked}/${sum.total} surfaces checked` +
        (sum.notWired ? `, ${sum.notWired} NOT WIRED` : '') +
        (sum.notImplemented ? `, ${sum.notImplemented} not implemented` : '') +
        (sum.unknown ? `, ${sum.unknown} unknown` : ''),
    );
    for (const surface of SURFACES) {
      const r = mine.find((x) => x.surface === surface.key);
      if (!r) continue;
      lines.push(`  ${glyph(r.state)} ${surface.title.padEnd(38)} ${r.evidence}`);
    }
  }

  lines.push('');
  if (anyNotWired) {
    lines.push('❌ NOT WIRED means the surface exists but this language is absent from it —');
    lines.push('   the gate will print PASSED/SKIPPED without evaluating anything.');
    lines.push('⬜ not implemented is a declared gap: fix it or say so in the capability matrix.');
  } else {
    lines.push('✅ every inspectable surface is wired for the languages above.');
  }
  return lines.join('\n');
}

/**
 * Handle `xp-gate language-capability [lang...] [--json]`.
 *
 * Exit code: 0 when every surface is checked or declared-not-implemented;
 * 1 when any surface is NOT WIRED. Exit 1 rather than 0 because this command
 * exists to gate language onboarding — a report that cannot fail is a report
 * nobody reads.
 *
 * @param {string[]} args
 * @returns {number} process exit code
 */
function handleLanguageCapability(args = []) {
  const json = args.includes('--json');
  const requested = args.filter((a) => !a.startsWith('--'));
  const unknown = requested.filter((l) => !LANGUAGES[l]);
  if (unknown.length > 0) {
    process.stderr.write(`unknown language(s): ${unknown.join(', ')}\n`);
    process.stderr.write(`known: ${Object.keys(LANGUAGES).join(', ')}\n`);
    return 2;
  }

  const all = inspectAll();
  const rows = requested.length === 0 ? all : all.filter((r) => requested.includes(r.language));

  if (json) {
    const byLanguage = {};
    for (const lang of new Set(rows.map((r) => r.language))) {
      const mine = rows.filter((r) => r.language === lang);
      byLanguage[lang] = { summary: summarise(mine), surfaces: mine };
    }
    process.stdout.write(`${JSON.stringify({ languages: byLanguage }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(rows, { lang: requested.length === 1 ? requested[0] : undefined })}\n`);
  }

  return summarise(rows).notWired > 0 ? 1 : 0;
}

module.exports = {
  STATE,
  SURFACES,
  LANGUAGES,
  hasExtensionToken,
  hasLanguageKey,
  definitionAndCall,
  findHooksRoot,
  inspectLanguage,
  inspectAll,
  summarise,
  formatReport,
  handleLanguageCapability,
};
