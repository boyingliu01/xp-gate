/**
 * Per-gate inspection helpers for the language-capability report.
 *
 * One function per gate surface, each returning the single row it produces.
 * Split out of a 264-line inspectLanguage() after Gate 4 measured it: the
 * original passed the report but failed clean-code.long-function (max 50
 * lines), and a report that cannot itself pass the gate it explains has no
 * standing to explain anything.
 *
 * Every helper takes (lang, exts, ctx) and returns one row. `ctx.read(rel)`
 * returns the file text or null, so "unreadable" is distinguishable from
 * "empty" -- an unreadable file is not evidence of wiring.
 */

/** The four functions pre-commit calls directly on a language adapter (#688). */
function inspectAdapterSurface(deps, lang, exts, ctx) {
  const adapterPath = `githooks/adapters/${lang}.sh`;
  if (ctx.root === null) return deps.row('adapter', lang, deps.STATE.UNKNOWN, 'githooks/ not found');
  const adapter = ctx.read(adapterPath);
  if (adapter === null) {
    return deps.row('adapter', lang, deps.STATE.NOT_IMPLEMENTED, `${adapterPath} missing`);
  }
  const required = ['run_static_analysis', 'run_lint', 'run_tests', 'run_coverage'];
  const missing = required.filter((fn) => !deps.definitionAndCall(adapter, fn).defined);
  return missing.length === 0
    ? deps.row('adapter', lang, deps.STATE.CHECKED, `${adapterPath}: 4/4 functions`)
    : deps.row('adapter', lang, deps.STATE.NOT_WIRED, `${adapterPath} lacks ${missing.join(', ')}`);
}

/** Gate 0: does detection emit this language? */
function inspectGate0(deps, lang, exts, ctx) {
  const src = ctx.read('githooks/gate-entries/gate-0-entry.sh');
  if (src === null) return deps.row('gate0-detect', lang, deps.STATE.UNKNOWN, 'gate-0-entry.sh unreadable');
  return deps.hasLanguageKey(src, lang)
    ? deps.row('gate0-detect', lang, deps.STATE.CHECKED, `_detect_ext_lang emits ${lang}`)
    : deps.row('gate0-detect', lang, deps.STATE.NOT_WIRED, `no _detect_ext_lang arm adds ${lang}`);
}

/**
 * Gate 1: the CHANGED-FILE SHORT-CIRCUIT is the decisive list. A language
 * missing from this alternation makes Gate 1 stand down before it looks at any
 * adapter, which is the exact #798 shape.
 */
function inspectGate1(deps, lang, exts, ctx) {
  const src = ctx.read('githooks/gate-entries/gate-1-entry.sh');
  if (src === null) return deps.row('gate-1', lang, deps.STATE.UNKNOWN, 'gate-1-entry.sh unreadable');
  // Read the `any_changed_files_match "\.(...)$"` call specifically: the file
  // contains several longer alternations (shell shebang handling) that would
  // match the token by accident.
  const scLine = src.split('\n').find((l) => l.includes('any_changed_files_match "\\\.(')) || '';
  const wired = deps.anyAlternationHas(scLine, exts);
  return deps.row(
    'gate-1',
    lang,
    wired ? deps.STATE.CHECKED : deps.STATE.NOT_WIRED,
    wired
      ? 'present in the changed-file short-circuit'
      : 'ABSENT from the changed-file short-circuit: Gate 1 stands down before the adapter runs',
  );
}

/** Gate 2: duplicate code. A dedicated `<lang>)` arm wins over the generic list. */
function inspectGate2(deps, lang, exts, ctx) {
  const src = ctx.read('githooks/gate-entries/gate-2-entry.sh');
  if (src === null) return deps.row('gate-2', lang, deps.STATE.UNKNOWN, 'gate-2-entry.sh unreadable');
  if (deps.hasLanguageKey(src, lang)) {
    return deps.row('gate-2', lang, deps.STATE.CHECKED, `dedicated "${lang})" arm`);
  }
  const inList = deps.anyAlternationHas(src, exts);
  return inList
    ? deps.row(
        'gate-2',
        lang,
        deps.STATE.CHECKED,
        'generic jscpd arm lists the extension (see C3: empty list prints PASS)',
      )
    : deps.row(
        'gate-2',
        lang,
        deps.STATE.NOT_WIRED,
        `"${lang})" arm absent and extension not in the generic list`,
      );
}

/**
 * Gate 3: the lizard population. The extension must appear in the gate at all;
 * whether the CURRENT repo’s baseline also declares it depends on whether that
 * repo HAS the language, so that second fact is reported as evidence, not folded
 * into the state -- it would otherwise make every language absent from this
 * repo report NOT WIRED, which is a fact about the repo, not about the wiring.
 */
function inspectGate3(deps, lang, exts, ctx) {
  const gate3 = ctx.read('githooks/adapters/gate-3.sh');
  if (gate3 === null) {
    return deps.row('gate-3', lang, deps.STATE.UNKNOWN, 'gate-3.sh unreadable');
  }
  // Scan the WHOLE file: the extension has been listed in more than one
  // alternation over time and a name-bound reader went silently blank once.
  const wired = deps.anyAlternationHas(gate3, exts);
  if (!wired) {
    return deps.row(
      'gate-3',
      lang,
      deps.STATE.NOT_WIRED,
      'lizard population EXCLUDES the extension',
    );
  }
  // Evidence only: does this repo's baseline score the language? A baseline
  // written before the language existed legitimately omits it (#617 declares the
  // population it was written from), and that is not a wiring defect.
  let note = '';
  const baseline = ctx.read('.ccn-baseline.json');
  if (baseline !== null) {
    try {
      const declared = JSON.parse(baseline)?.population?.extensions || [];
      if (!exts.some((e) => declared.includes(`.${e}`))) {
        note =
          ' (no baseline entry in THIS repo: the population is derived from the files that exist, so nothing here is scored until such code is added)';
      }
    } catch {
      note = ' (.ccn-baseline.json is not valid JSON)';
    }
  }
  return deps.row('gate-3', lang, deps.STATE.CHECKED, `lizard population includes the extension${note}`);
}

/**
 * Gate 4: BOTH the filter and the analyzer map. Accepting a file in the filter
 * and dropping it in the map is the #717 defect: the gate reports a clean run
 * over code it never opened.
 */
function inspectGate4(deps, lang, exts, ctx) {
  const gate = ctx.read('githooks/adapters/gate-4.sh');
  const analyzer = ctx.read('src/principles/analyzer.ts');
  if (gate === null) return deps.row('gate-4', lang, deps.STATE.UNKNOWN, 'gate-4.sh unreadable');
  if (analyzer === null) {
    return deps.row('gate-4', lang, deps.STATE.UNKNOWN, 'src/principles/analyzer.ts unreadable');
  }
  const filterLine = gate.split('\n').find((l) => l.includes('PRINCIPLES_FILES=')) || '';
  const inFilter = deps.anyAlternationHas(filterLine, exts);
  const inMap = exts.some((e) => analyzer.includes(`'.${e}':`));
  if (inFilter && inMap) {
    return deps.row('gate-4', lang, deps.STATE.CHECKED, 'filter + analyzer.ts adapterMap both present');
  }
  if (inFilter && !inMap) {
    return deps.row(
      'gate-4',
      lang,
      deps.STATE.NOT_WIRED,
      'FILTER ACCEPTS IT, analyzer.ts adapterMap has no entry -> file accepted then dropped (#717)',
    );
  }
  if (!inFilter && inMap) {
    return deps.row(
      'gate-4',
      lang,
      deps.STATE.NOT_WIRED,
      'adapterMap has an entry but the filter rejects the extension: the adapter is unreachable',
    );
  }
  return deps.row('gate-4', lang, deps.STATE.NOT_WIRED, 'extension absent from gate-4.sh PRINCIPLES_FILES');
}

/** Gate 5: test/coverage entry. An absent extension takes the #763 skip. */
function inspectGate5(deps, lang, exts, ctx) {
  const src = ctx.read('githooks/gate-entries/gate-5-entry.sh');
  if (src === null) return deps.row('gate-5', lang, deps.STATE.UNKNOWN, 'gate-5-entry.sh unreadable');
  const ceLine = src.split('\n').find((l) => l.includes('CODE_EXTENSIONS=')) || '';
  const wired = deps.anyAlternationHas(ceLine, exts);
  return wired
    ? deps.row('gate-5', lang, deps.STATE.CHECKED, 'CODE_EXTENSIONS includes the extension')
    : deps.row(
        'gate-5',
        lang,
        deps.STATE.NOT_WIRED,
        'ABSENT from CODE_EXTENSIONS: a commit touching only this language takes the "no code files changed" skip (#763)',
      );
}

/** Gate 6: architecture detector arm. */
function inspectGate6(deps, lang, exts, ctx) {
  const src = ctx.read('githooks/gate-entries/gate-6-entry.sh');
  if (src === null) return deps.row('gate-6', lang, deps.STATE.UNKNOWN, 'gate-6-entry.sh unreadable');
  return deps.hasLanguageKey(src, lang)
    ? deps.row('gate-6', lang, deps.STATE.CHECKED, `"${lang})" arm present`)
    : deps.row('gate-6', lang, deps.STATE.NOT_IMPLEMENTED, `no "${lang})" arm: falls to the no-detector branch`);
}

/** Gate 9: build integrity arm. */
function inspectGate9(deps, lang, exts, ctx) {
  const src = ctx.read('githooks/gate-entries/gate-9-entry.sh');
  if (src === null) return deps.row('gate-9', lang, deps.STATE.UNKNOWN, 'gate-9-entry.sh unreadable');
  return deps.hasLanguageKey(src, lang)
    ? deps.row('gate-9', lang, deps.STATE.CHECKED, `"${lang})" arm present`)
    : deps.row('gate-9', lang, deps.STATE.NOT_IMPLEMENTED, 'no build arm: this language is SKIPped with no verdict');
}

/**
 * Gate 10: SAST ruleset. The measured question is whether ANY loaded ruleset
 * can analyse the language, which is why the baseline list is consulted rather
 * than the mere presence of a `p/` directory.
 */
function inspectGate10(deps, lang, exts, ctx) {
  const hasRuleset = ctx.root !== null && ctx.read(`sast/rulesets/p/${lang}`) !== null;
  if (hasRuleset) return deps.row('gate-10', lang, deps.STATE.CHECKED, `dedicated p/${lang} ruleset`);
  if (deps.SAST_BASELINE_LANGUAGES.has(lang)) {
    return deps.row('gate-10', lang, deps.STATE.CHECKED, 'covered by the p/security-audit baseline ruleset');
  }
  return deps.row(
    'gate-10',
    lang,
    deps.STATE.UNKNOWN,
    `no p/${lang} ruleset and the language is NOT in the p/security-audit baseline as measured: verify whether any loaded ruleset can analyse it before claiming coverage`,
  );
}

/** Gate 13: compiler strictness -- DEFINED (adapter) AND INVOKED (entry). */
function inspectGate13(deps, lang, exts, ctx) {
  const strictness = ctx.read('githooks/adapters/gate-13-compiler-strictness.sh');
  const entry13 = ctx.read('githooks/gate-entries/gate-13-entry.sh');
  if (strictness === null || entry13 === null) {
    return deps.row('gate-13', lang, deps.STATE.UNKNOWN, 'gate-13 files unreadable');
  }
  const fnName = `gate13_run_${lang}_analysis`;
  const { defined } = deps.definitionAndCall(strictness, fnName);
  const { called } = deps.definitionAndCall(entry13, fnName);
  if (!defined) {
    return deps.row('gate-13', lang, deps.STATE.NOT_IMPLEMENTED, `${fnName}() not defined`);
  }
  if (!called) {
    return deps.row(
      'gate-13',
      lang,
      deps.STATE.NOT_WIRED,
      `${fnName}() DEFINED BUT NEVER CALLED - the exact C# defect (#717 section 8)`,
    );
  }
  return deps.row('gate-13', lang, deps.STATE.CHECKED, `${fnName}() defined and invoked`);
}

/** CLI registry: LANGUAGE_REGISTRY key. */
function inspectRegistry(deps, lang, exts, ctx) {
  const langTools = ctx.read('src/npm-package/lib/language-tools.js');
  if (langTools === null) {
    return deps.row('cli-registry', lang, deps.STATE.UNKNOWN, 'language-tools.js unreadable');
  }
  // [#731] The original pattern was `^\s{2}${lang}:\s*\{` with the `m` flag,
  // and it NEVER matched: under `m`, `\s` matches the newline that `^` just
  // anchored to, so `^\s{2}` demanded a blank line followed by another whitespace
  // run. Measured: `new RegExp('^\\s{2}csharp:\\s*\\{','m').test(src)` was false
  // against a file whose line 306 is literally `  csharp: {`. Every language was
  // therefore reported NOT WIRED here, including ones whose entry exists --
  // a false accusation that hid the real gaps by making them all look alike.
  // `[ \t]{2}` is what the pattern meant: two spaces of indentation.
  const registered = new RegExp(`^[ \\t]{2}${lang}:[ \\t]*\\{`, 'm').test(langTools);
  return deps.row(
    'cli-registry',
    lang,
    registered ? deps.STATE.CHECKED : deps.STATE.NOT_WIRED,
    registered
      ? 'LANGUAGE_REGISTRY entry present'
      : 'ABSENT from LANGUAGE_REGISTRY: detect-languages omits it, and the hook trusts that config without an extension fallback (#730)',
  );
}

/**
 * CI detection. `.github/workflows/` keeps a private copy of the detection
 * chain, so a language present locally can still be invisible to CI -- the
 * duplication is the reason this surface is checked separately.
 */
function inspectCiDetection(deps, lang, exts, ctx) {
  const src = ctx.read('.github/workflows/quality-gates.yml');
  if (src === null) {
    return deps.row('ci-detect', lang, deps.STATE.UNKNOWN, 'quality-gates.yml unreadable');
  }
  return deps.hasLanguageKey(src, lang)
    ? deps.row('ci-detect', lang, deps.STATE.CHECKED, 'CI detection chain names the language')
    : deps.row('ci-detect', lang, deps.STATE.NOT_WIRED, 'CI keeps a private copy of the chain and omits it');
}

/** The ordered surface list, one entry per checkable surface. */
const SURFACE_CHECKS = [
  ['adapter', inspectAdapterSurface],
  ['gate0-detect', inspectGate0],
  ['gate-1', inspectGate1],
  ['gate-2', inspectGate2],
  ['gate-3', inspectGate3],
  ['gate-4', inspectGate4],
  ['gate-5', inspectGate5],
  ['gate-6', inspectGate6],
  ['gate-9', inspectGate9],
  ['gate-10', inspectGate10],
  ['gate-13', inspectGate13],
  ['cli-registry', inspectRegistry],
  ['ci-detect', inspectCiDetection],
];

/**
 * Inspect every surface for one language.
 *
 * @param {string} lang
 * @param {{root: string|null, read: (rel: string) => string|null}} ctx
 * @returns {Array<{surface: string, language: string, state: string, evidence: string}>}
 */
function inspectLanguage(deps, lang, ctx) {
  const spec = deps.LANGUAGES ? deps.LANGUAGES[lang] : null;
  const exts = spec ? spec.extensions : [lang];
  return SURFACE_CHECKS.map(([, check]) => check(deps, lang, exts, ctx));
}


module.exports = {
  inspectLanguage,
  SURFACE_CHECKS,
};
