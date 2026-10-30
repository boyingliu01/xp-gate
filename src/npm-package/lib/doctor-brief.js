/**
 * `xp-gate doctor --brief` — one command that answers every common environment
 * probe (#653).
 *
 * Why this exists: 32.7% of shell calls in a working session were pure probing
 * (`where gcc`, `Test-Path`, per-file `Get-Content`, version checks), at ~16s
 * each. The common thread is that the answers barely change, yet every question
 * costs a full round trip. The fix is not to print less — it is to ask once.
 *
 * Two rules this module holds itself to:
 *
 * 1. **Read-only.** `--brief` is meant to be called often precisely because it is
 *    cheap. Anything that writes would make frequent calling compound state
 *    changes instead of only latency.
 * 2. **Structured first, summary second.** A model that has to regex a sentence
 *    has not saved a round trip. `facts` carries the data; `summary` is a
 *    convenience for humans and nothing depends on it.
 *
 * No runtime dependencies: this ships inside the zero-install package.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** The fact groups `--brief` promises. Tests pin this list; adding a group here
 *  without teaching the model to use it only adds output, so keep it deliberate. */
const BRIEF_FACTS = ['hooks', 'language', 'adapters', 'coverage', 'gateState'];

/** Run a command, returning trimmed stdout or null. Never throws. */
function tryExec(cmd, args, cwd) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return null;
  }
}

/** Which hooks actually execute, and where they live. */
function readHooks(cwd) {
  const hooksPath = tryExec('git', ['config', '--get', 'core.hooksPath'], cwd);
  const effective = hooksPath || '.git/hooks';
  const dir = path.isAbsolute(effective) ? effective : path.join(cwd, effective);
  let installed = [];
  try {
    installed = fs.readdirSync(dir).filter((name) => !name.endsWith('.sample'));
  } catch {
    installed = [];
  }
  return {
    hooksPath: hooksPath || null,
    effectivePath: dir,
    installed,
    // #451: when core.hooksPath is set, the repo copy is NOT what runs.
    globalOverride: Boolean(hooksPath),
  };
}

/** Project language markers, cheapest signal first. */
const LANGUAGE_MARKERS = [
  ['typescript', ['tsconfig.json']],
  ['python', ['pyproject.toml', 'setup.py', 'requirements.txt']],
  ['go', ['go.mod']],
  ['java', ['pom.xml', 'build.gradle', 'build.gradle.kts']],
  ['kotlin', ['build.gradle.kts']],
  ['dart', ['pubspec.yaml']],
  ['rust', ['Cargo.toml']],
];

function detectLanguages(cwd) {
  const found = [];
  for (const [lang, markers] of LANGUAGE_MARKERS) {
    if (markers.some((m) => fs.existsSync(path.join(cwd, m)))) found.push(lang);
  }
  return { detected: found, primary: found[0] || null };
}

/** Which adapters are reachable via the documented 3-tier resolution. */
function detectAdapters(cwd) {
  const tiers = [
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'xp-gate', 'adapters'),
    path.join(cwd, 'githooks', 'adapters'),
  ];
  const seen = new Set();
  const sources = [];
  for (const dir of tiers) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.sh'));
    } catch {
      continue;
    }
    for (const n of names) seen.add(n);
    sources.push({ dir, count: names.length });
  }
  return { count: seen.size, sources };
}

/** Where coverage would come from, if anywhere. */
const COVERAGE_CANDIDATES = [
  'coverage/coverage-final.json',
  'coverage/lcov.info',
  'target/site/jacoco/jacoco.xml',
  'build/reports/jacoco/test/jacocoTestReport.xml',
];

function detectCoverage(cwd) {
  const hits = COVERAGE_CANDIDATES.filter((rel) => fs.existsSync(path.join(cwd, rel)));
  return { found: hits.length > 0, files: hits };
}

/** Last gate artifact, so callers stop re-reading `.xp-gate/` by hand. */
function readGateState(cwd) {
  const artifact = path.join(cwd, '.xp-gate', 'quality-status', 'main.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    return {
      artifact,
      commit: parsed.commit || null,
      gates: Object.keys(parsed).filter((k) => k.startsWith('gate')).length,
    };
  } catch {
    // No artifact is a fact worth stating, not an error: "never run" and
    // "failed to read" would otherwise be indistinguishable.
    return { artifact, commit: null, gates: 0 };
  }
}

/**
 * Build the brief report.
 *
 * @param {{cwd?: string}} opts
 * @returns {{facts: object, summary: string}}
 */
function buildBriefReport(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const facts = {
    hooks: readHooks(cwd),
    language: detectLanguages(cwd),
    adapters: detectAdapters(cwd),
    coverage: detectCoverage(cwd),
    gateState: readGateState(cwd),
  };
  const summary = [
    `lang=${facts.language.primary || 'unknown'} adapters=${facts.adapters.count} ` +
      `coverage=${facts.coverage.found ? 'yes' : 'no'} hooks=${facts.hooks.globalOverride ? 'global' : 'local'}`,
    `hooksPath=${facts.hooks.effectivePath}`,
  ].join('\n');
  return { facts, summary };
}

module.exports = { BRIEF_FACTS, buildBriefReport };
