#!/usr/bin/env node
/**
 * Standalone gate audit: answer "are the gates still effective right now"
 * without reinstalling anything.
 *
 * `reinstall.mjs` was previously the only entry point, which meant the only way
 * to ask whether the gates still block was to tear down and rebuild the
 * installation. Those are different questions and should not share a command.
 *
 * Three layers, reported separately:
 *   1. Static parity -- are the skills/plugins/hooks on disk the right ones
 *      (delegated to verify.mjs, unchanged)
 *   2. Gray box -- do the gates actually reject a planted defect
 *      (lib/gatecheck.mjs; this is the part verify.mjs never had)
 *   3. Blind spots -- sources xp-gate's own extension lists cannot see
 *      (hp-gate.mjs; xp-gate#732)
 *
 * Exit 1 if any layer fails, so it is usable as CI.
 *
 * Usage:
 *   node scripts/audit.mjs             # all three layers
 *   node scripts/audit.mjs --static    # parity only, no gate execution
 *   node scripts/audit.mjs --gates     # gray box + blind spots only
 *   node scripts/audit.mjs --json
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditGates } from './lib/gatecheck.mjs';
import { item, section, table, MARK } from './lib/report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

if (has('--help') || has('-h')) {
  console.log(`Usage: node scripts/audit.mjs [--static] [--gates] [--json]

  --static   Only check on-disk parity (skills, plugins, hooks)
  --gates    Only check that gates block planted defects, and that the
             .mjs blind spot xp-gate#732 leaves open is still covered
  --json     Machine-readable output

Exit code 1 if any check fails.`);
  process.exit(0);
}

const wantStatic = !has('--gates');
const wantGates = !has('--static');

/** One script run, JSON out. Shared by the parity and blind-spot layers. */
function runScriptJson(script, args) {
  const r = spawnSync(process.execPath, [path.join(here, script), ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const raw = String(r.stdout || '');
  const start = raw.indexOf('{');
  if (start < 0) return { error: (r.stderr || raw).slice(0, 300) };
  try {
    return JSON.parse(raw.slice(start));
  } catch (error) {
    return { error: `${script} output not parseable: ${error.message}` };
  }
}

function runStatic() {
  // verify.mjs already knows how to compare the installed tree; reuse it via
  // its --json mode rather than duplicating the parity logic here.
  const out = runScriptJson('verify.mjs', ['--quick', '--json']);
  if (out.error) return { ok: false, checks: [], error: out.error };
  return out;
}

function printStatic(staticResult) {
  section('Layer 1 — on-disk parity');
  if (staticResult.error) {
    item(MARK.FAIL, `verify.mjs did not produce results: ${staticResult.error}`);
    return;
  }
  const markFor = { FAIL: MARK.FAIL, WARN: MARK.WARN, SKIP: MARK.SKIP };
  for (const c of staticResult.checks) {
    item(markFor[c.status] || MARK.PASS, `${c.name}: ${c.detail}`);
  }
}

function printGates(gates) {
  section('Layer 2 — do the gates actually block');
  console.log('  Each case runs twice: a clean tree (control) and the same tree with');
  console.log('  a defect planted. A gate is trustworthy only if it separates them.\n');
  table(
    ['Gate', 'Clean', 'Planted', 'Verdict'],
    gates.cases.map((c) => [String(c.id), c.cleanVerdict, c.dirtyVerdict, verdictLabel(c)]),
  );
  const s = gates.summary;
  console.log('');
  if (s.invalid) {
    item(MARK.WARN, `${s.invalid} case(s) unmeasurable: the control tree itself was blocked, so nothing can be concluded about the planted defect`);
  }
  if (s.failed) item(MARK.FAIL, `${s.failed}/${s.total} gate case(s) did not block a planted defect`);
  else if (s.ok) item(MARK.PASS, `${s.ok}/${s.total} gate case(s) blocked the planted defect and passed the control`);
  if (s.knownGaps) item(MARK.WARN, `${s.knownGaps} case(s) are known upstream gaps, reported but not counted`);
}

function verdictLabel(c) {
  if (c.knownGap) return 'KNOWN GAP';
  if (c.measurementValid === false) return 'UNMEASURABLE';
  return c.ok ? 'ok' : 'FAILED';
}

/** The five worst violations, formatted for a one-line report. */
function topViolations(violations) {
  return violations
    .slice()
    .sort((a, b) => b.ccn - a.ccn)
    .slice(0, 5)
    .map((v) => `${v.name}@${v.ccn} (${v.file})`);
}

/**
 * Is a blind-spot report clean? Three independent ways to be dirty, kept as one
 * named predicate so the report and the exit code cannot disagree.
 */
function blindSpotOk(raw) {
  return !raw.scanBroken && (raw.violations || []).length === 0 && (raw.syntax || []).length === 0;
}

/** Project hp-gate's full JSON down to the numbers the audit prints. */
function summarizeHp(raw) {
  if (raw.error) return { error: raw.error };
  const violations = raw.violations || [];
  return {
    files: raw.files || 0,
    threshold: raw.threshold,
    functionCount: list(raw.allFunctions).length,
    violationCount: violations.length,
    syntaxErrorCount: list(raw.syntax).length,
    scanBroken: Boolean(raw.scanBroken),
    topViolations: topViolations(violations),
    ok: blindSpotOk(raw),
  };
}

/** hp-gate always emits these arrays, but a partial report must not throw. */
function list(value) {
  return Array.isArray(value) ? value : [];
}

function printBlindSpot(hp) {
  section("Layer 3 — sources xp-gate's own extension list cannot see");
  if (hp.error) {
    item(MARK.WARN, `hp-gate could not run: ${hp.error}`);
    return;
  }
  item(MARK.INFO, `${hp.files} .mjs/.cjs file(s), ${hp.functionCount} function(s) analysed by lizard`);
  if (hp.scanBroken) {
    item(MARK.FAIL, 'lizard returned no functions for a non-empty source set -- the scan is broken, not the code');
  } else if (hp.violationCount) {
    item(MARK.FAIL, `${hp.violationCount} function(s) above CCN ${hp.threshold}: ${hp.topViolations.join(', ')}`);
  } else {
    item(MARK.PASS, `every function within CCN ${hp.threshold}`);
  }
  if (hp.syntaxErrorCount) item(MARK.FAIL, `${hp.syntaxErrorCount} unparseable file(s)`);
}

const result = { ok: true, static: null, gates: null, blindSpot: null };

if (wantStatic) {
  result.static = runStatic();
  if (!result.static.ok) result.ok = false;
}

if (wantGates) {
  result.gates = await auditGates();
  if (!result.gates.summary.pass) result.ok = false;

  result.blindSpot = summarizeHp(runScriptJson('hp-gate.mjs', ['--json']));
  if (!result.blindSpot.ok) result.ok = false;
}

if (has('--json')) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (result.static) printStatic(result.static);
if (result.gates) printGates(result.gates);
if (result.blindSpot) printBlindSpot(result.blindSpot);

console.log('');
item(result.ok ? MARK.PASS : MARK.FAIL, result.ok ? 'audit passed' : 'audit FAILED');
process.exit(result.ok ? 0 : 1);
