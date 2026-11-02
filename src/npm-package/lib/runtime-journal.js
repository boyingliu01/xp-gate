/**
 * `xp-gate runtime-journal` — CLI for the AGENTS.md runtime-efficiency rules.
 *
 * Implements the same "measure don't restate" stance as `gate-rules`: the three
 * rules in AGENTS.md §AGENT RUNTIME DISCIPLINE were written on 2026-10-30, but
 * by 2026-11-02 only rule 1 had taken effect (pure-read shell: 32.7% -> 0.2%)
 * while rule 2 stayed at 1.02 calls/step and rule 3 was violated 103 times with
 * an explicit `wait: true`. A rule nobody measures is a rule nobody follows, so
 * this surfaces the cost as numbers.
 *
 * Advisory by design — it reports share-of-time and never blocks a commit.
 * The behaviour it measures (how the agent waits) is not something a git hook
 * can decide.
 *
 * @module runtime-journal
 */

'use strict';

const path = require('path');
const os = require('os');

const {
  analyseSessions,
  discoverSessionDirs,
  summariseForSlot,
} = require('./agent-runtime-journal');

/** Default lookback for the report, in days. */
const DEFAULT_DAYS = 3;

/**
 * Candidate roots that hold DSH session journals, most specific first.
 *
 * `DSH_SESSIONS_DIR` wins so a CI job or a different machine can point at the
 * store without code changes.
 *
 * The DSH store names each project root `--<slug>--`, where the slug is the
 * absolute cwd with every path separator replaced by a dash — e.g.
 * `D:\projects\xp-gate` becomes `--D-projects-xp-gate--`. Deriving it from the
 * full path matters: a basename-only guess (`--xp-gate--`) names a directory
 * that does not exist.
 *
 * @param {string} [cwd] project directory; defaults to `process.cwd()`
 * @returns {string[]}
 */
function sessionRootCandidates(cwd = process.cwd()) {
  const home = os.homedir();
  const dirs = [];
  if (process.env.DSH_SESSIONS_DIR) dirs.push(process.env.DSH_SESSIONS_DIR);
  const base = path.join(home, '.dsh', 'sessions');
  // Each separator becomes one dash, then the store wraps the slug in an extra
  // dash on both sides: `D:\projects\xp-gate` -> `D-projects-xp-gate` ->
  // `--D-projects-xp-gate--`. The wrapping pair is not redundant; without it
  // the path names a directory that does not exist.
  const slug = String(cwd).replace(/[\\/:]+/g, '-');
  if (slug) dirs.push(path.join(base, `--${slug}--`));
  dirs.push(base);
  return dirs;
}

/**
 * Find the session root that actually exists and contains journals.
 * @param {string[]} candidates
 * @returns {string|null}
 */
function pickSessionRoot(candidates) {
  for (const candidate of candidates) {
    if (discoverSessionDirs(candidate).length > 0) return candidate;
  }
  return null;
}

/**
 * Parse `--days N` from argv.
 * @param {string[]} argv
 * @param {number} fallback
 * @returns {number}
 */
function parseDays(argv, fallback) {
  const idx = argv.indexOf('--days');
  if (idx === -1) return fallback;
  const raw = argv[idx + 1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Run the `runtime-journal` subcommand.
 *
 * Always exits 0: this is a diagnostic. Callers that want a gate can read the
 * JSON and apply their own threshold, which keeps the measurement honest
 * (a tool that fails on bad news gets suppressed, not fixed).
 *
 * @param {string[]} argv
 * @returns {number} exit code (always 0)
 */
function handleRuntimeJournal(argv) {
  const args = argv || [];
  const json = args.includes('--json');
  const days = parseDays(args, DEFAULT_DAYS);
  const now = Date.now();
  const sinceMs = now - days * 24 * 60 * 60 * 1000;

  const explicitDir = (() => {
    const idx = args.indexOf('--sessions-dir');
    return idx === -1 ? null : args[idx + 1];
  })();

  const root = explicitDir
    ? (discoverSessionDirs(explicitDir).length ? explicitDir : null)
    : pickSessionRoot(sessionRootCandidates(process.cwd()));

  if (!root) {
    // NOT MEASURABLE rather than a zero report: a zero that means "no data"
    // reads as "no problem", the false-green that #636 set out to remove.
    if (json) {
      process.stdout.write(`${JSON.stringify({ measurable: false, reason: 'no session journals found', days }, null, 2)}\n`);
    } else {
      process.stdout.write('Runtime efficiency: NOT MEASURABLE (no session journals found)\n');
      process.stdout.write('Hint: set DSH_SESSIONS_DIR, or pass --sessions-dir <path>.\n');
    }
    return 0;
  }

  const report = analyseSessions(discoverSessionDirs(root), { sinceMs, untilMs: now });

  if (json) {
    const payload = {
      measurable: report.toolCalls > 0,
      days,
      window: { from: new Date(sinceMs).toISOString(), to: new Date(now).toISOString() },
      sessionsDir: root,
      ...report,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`Runtime efficiency — last ${days} day(s)\n`);
  process.stdout.write(`Sessions: ${root}\n`);
  const slots = summariseForSlot(report);
  for (const line of slots) process.stdout.write(`  ${line}\n`);
  if (report.toolCalls > 0) {
    process.stdout.write(`  measured ${report.toolCalls} tool call(s), median ${report.toolMedianMs} ms\n`);
  }
  return 0;
}

module.exports = {
  DEFAULT_DAYS,
  handleRuntimeJournal,
  sessionRootCandidates,
  pickSessionRoot,
  parseDays,
};
