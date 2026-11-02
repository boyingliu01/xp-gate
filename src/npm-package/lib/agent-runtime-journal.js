/**
 * xp-gate agent-runtime-journal — measure the AGENTS.md runtime anti-patterns.
 *
 * `AGENTS.md` §AGENT RUNTIME DISCIPLINE has named three rules since 2026-10-30.
 * Rule 1 (native read/grep/glob instead of shell) took effect — measurement on
 * 2026-11-02 showed pure-read shell calls fall from 32.7% to 0.2%. Rules 2 and
 * 3 did not: calls/step stayed at 1.02, and `job_output` was called with an
 * explicit `wait: true` 103 times across three days, blocking 8.9 h.
 *
 * The reason a prose rule was ignored is that nothing measured it. This module
 * turns those rules into numbers read from the agent's own session journals, so
 * `retro`/CI can show the cost instead of restating the prohibition.
 *
 * Zero npm dependencies (Node built-ins only) — `src/npm-package/` ships
 * zero-install, and `zlib.zstdDecompressSync` covers the journal format.
 *
 * @module agent-runtime-journal
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * A tool call cannot plausibly run longer than this. Beyond it, the recorded
 * span measures a session resume or log flush, not work: the 2026-10-30
 * diagnosis found single `pwsh` calls "lasting" 78 hours because the matching
 * result was only written at the next compaction/prune. Excluding them is what
 * makes the totals mean anything.
 */
const DEFAULT_MAX_PLAUSIBLE_MS = 30 * 60 * 1000;

/** A `job_output` call counts as blocking once it waits longer than this. */
const DEFAULT_BLOCKING_THRESHOLD_MS = 30 * 1000;

/** Journal filename used by the DSH session store. */
const JOURNAL_BASENAME = 'session.v4.jsonl';

/**
 * Parse a session journal buffer, accepting both the zstd-compressed on-disk
 * form and plain UTF-8 (so fixtures need no encoder).
 *
 * Malformed lines are skipped rather than discarding the whole journal: one
 * truncated tail line must not erase an otherwise usable session.
 *
 * @param {Buffer|string} buffer
 * @returns {Array<object>} parsed events
 */
function parseSessionBuffer(buffer) {
  let text;
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer), 'utf8');
  // zstd magic number: 0x28 0xB5 0x2F 0xFD (little endian 0xFD2FB528).
  if (buf.length >= 4 && buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) {
    try {
      text = zlib.zstdDecompressSync(buf).toString('utf8');
    } catch {
      return [];
    }
  } else {
    text = buf.toString('utf8');
  }

  const events = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip a malformed line; the rest of the journal is still valid.
    }
  }
  return events;
}

/**
 * Resolve the journal file inside a session directory.
 * @param {string} dir
 * @returns {string|null} absolute path, or null when absent
 */
function journalPathIn(dir) {
  for (const name of [JOURNAL_BASENAME, `${JOURNAL_BASENAME}.zstd`]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Classify a shell command against the waiting anti-patterns rule 3 forbids.
 *
 * Returned flags are independent: a command can be both a poll loop and a
 * literal sleep, and reporting them separately keeps the cause visible.
 *
 * @param {string} command
 * @returns {{sleep: boolean, pollLoop: boolean, ciPolling: boolean, oversizedTimeout: boolean}}
 */
function classifyCommand(command) {
  const cmd = String(command || '');
  return {
    // `sleep N` as a command, not the word "sleepless" inside an argument.
    sleep: /(?:^|[;&|(]\s*|\s)sleep\s+\d+/.test(cmd),
    pollLoop: /for\s+\w+\s+in\s+\$\(seq|while\s+true|while\s*:\s*;/.test(cmd),
    ciPolling: /gh\s+run\s+(?:list|watch|view)/.test(cmd),
    // `timeout` only counts as oversized past 10 minutes; the diagnosis found
    // 375 such calls whose p50 runtime was 6.3 s — budget far above reality.
    oversizedTimeout: /timeout\s+(\d{3,})\b/.test(cmd) && Number((cmd.match(/timeout\s+(\d{3,})\b/) || [])[1]) >= 600,
  };
}

/**
 * Median of a numeric array (0 for an empty input).
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Round to one decimal place without leaving float noise in JSON output.
 * @param {number} value
 * @returns {number}
 */
function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Build a measured record for every tool call in one journal.
 *
 * @param {Array<object>} events
 * @param {number} maxPlausibleMs
 * @returns {Array<{name: string, t: number, durMs: number|null, args: object, implausible: boolean, turn: number, step: number}>}
 */
function extractCalls(events, maxPlausibleMs) {
  /** @type {Map<string, number>} callId -> result timestamp */
  const endedAt = new Map();
  for (const e of events) {
    if (e && e.type === 'tool/result') {
      const id = e.data && e.data.message && e.data.message.toolCallId;
      if (id && typeof e.time === 'number') endedAt.set(id, e.time);
    }
  }

  const calls = [];
  for (const e of events) {
    if (!e || e.type !== 'tool/call') continue;
    const d = e.data || {};
    let args = {};
    try {
      args = JSON.parse(d.arguments || '{}');
    } catch {
      args = {};
    }
    const end = endedAt.get(d.callId);
    const durMs = typeof end === 'number' && typeof e.time === 'number' ? end - e.time : null;
    calls.push({
      name: d.name || 'unknown',
      t: e.time,
      durMs,
      args,
      implausible: durMs !== null && (durMs < 0 || durMs > maxPlausibleMs),
      turn: d.turn ?? 0,
      step: d.step ?? 0,
    });
  }
  return calls;
}

/**
 * Summarise tool-call efficiency across a set of session directories.
 *
 * @param {string[]} sessionDirs directories containing `session.v4.jsonl[.zstd]`
 * @param {{maxPlausibleMs?: number, blockingThresholdMs?: number, sinceMs?: number, untilMs?: number}} [options]
 *   `sinceMs`/`untilMs` bound the calls considered, so the same journal supports a
 *   before/after comparison instead of only an all-time total.
 * @returns {object} report
 */
function analyseSessions(sessionDirs, options = {}) {
  const maxPlausibleMs = options.maxPlausibleMs ?? DEFAULT_MAX_PLAUSIBLE_MS;
  const blockingThresholdMs = options.blockingThresholdMs ?? DEFAULT_BLOCKING_THRESHOLD_MS;
  const sinceMs = typeof options.sinceMs === 'number' ? options.sinceMs : -Infinity;
  const untilMs = typeof options.untilMs === 'number' ? options.untilMs : Infinity;

  const allCalls = [];
  let sessions = 0;

  for (const dir of sessionDirs || []) {
    const jp = journalPathIn(dir);
    if (!jp) continue;
    let buf;
    try {
      buf = fs.readFileSync(jp);
    } catch {
      continue;
    }
    const events = parseSessionBuffer(buf);
    if (!events.length) continue;
    sessions += 1;
    for (const call of extractCalls(events, maxPlausibleMs)) {
      if (typeof call.t === 'number' && call.t >= sinceMs && call.t < untilMs) allCalls.push(call);
    }
  }

  const plausible = allCalls.filter((c) => c.durMs !== null ? !c.implausible : true);
  const implausible = allCalls.filter((c) => c.implausible);
  const timed = plausible.filter((c) => c.durMs !== null);

  // ---- rule 3a: job_output blocking ----
  const jobCalls = plausible.filter((c) => c.name === 'job_output');
  const blocking = jobCalls.filter((c) => c.durMs !== null && c.durMs > blockingThresholdMs);
  const explicitWaitTrue = jobCalls.filter((c) => c.args && c.args.wait === true);

  // ---- rule 3b: idle waiting inside bash ----
  const bashCalls = plausible.filter((c) => c.name === 'bash' || c.name === 'pwsh' || c.name === 'powershell');
  const sleep = [];
  const pollLoop = [];
  const ciPolling = [];
  const oversizedTimeout = [];
  for (const c of bashCalls) {
    const flags = classifyCommand(c.args && c.args.command);
    if (flags.sleep) sleep.push(c);
    if (flags.pollLoop) pollLoop.push(c);
    if (flags.ciPolling) ciPolling.push(c);
    if (flags.oversizedTimeout) oversizedTimeout.push(c);
  }

  // ---- rule 2: call batching ----
  const perStep = new Map();
  for (const c of plausible) {
    if (!c.turn && !c.step) continue;
    const key = `${c.turn}:${c.step}`;
    perStep.set(key, (perStep.get(key) || 0) + 1);
  }
  const stepCounts = Array.from(perStep.values());
  const stepsWithMultiple = stepCounts.filter((n) => n >= 2).length;

  const total = (arr) => arr.reduce((acc, c) => acc + (c.durMs || 0), 0);

  return {
    sessions,
    toolCalls: allCalls.length,
    timedCalls: timed.length,
    implausible: { count: implausible.length, totalMs: total(implausible) },
    maxPlausibleMs,
    blockingJobOutput: {
      count: blocking.length,
      totalMs: total(blocking),
      explicitWaitTrue: explicitWaitTrue.length,
      maxMs: blocking.length ? Math.max(...blocking.map((c) => c.durMs)) : 0,
      thresholdMs: blockingThresholdMs,
    },
    idleWait: {
      sleep: { count: sleep.length, totalMs: total(sleep) },
      pollLoop: { count: pollLoop.length, totalMs: total(pollLoop) },
      ciPolling: { count: ciPolling.length, totalMs: total(ciPolling) },
      oversizedTimeout: { count: oversizedTimeout.length, totalMs: total(oversizedTimeout) },
    },
    batching: {
      stepsWithCalls: stepCounts.length,
      stepsWithMultipleCalls: stepsWithMultiple,
      batchedRatioPct: stepCounts.length ? round1((stepsWithMultiple / stepCounts.length) * 100) : 0,
      callsPerStep: stepCounts.length ? round1((plausible.length / stepCounts.length) * 100) / 100 : 0,
    },
    toolMedianMs: median(timed.map((c) => c.durMs)),
  };
}

/**
 * Reduce a report to a one-screen summary for `retro`/CI output.
 *
 * Deliberately reports NOT MEASURABLE instead of 0% when the journal holds
 * nothing to measure — a zero that means "no data" reads as "no problem", the
 * same false-green the gate-coverage work (#636) set out to kill.
 *
 * @param {object} report
 * @returns {string[]} at most 15 lines
 */
function summariseForSlot(report) {
  if (!report || report.toolCalls === 0) {
    return ['Runtime efficiency: NOT MEASURABLE (no tool calls in journal)'];
  }

  const hours = (ms) => `${round1(ms / 3600000)} h`;
  const lines = [];

  const blocked = report.blockingJobOutput;
  lines.push(
    `job_output blocked >${Math.round(blocked.thresholdMs / 1000)}s: ${blocked.count} call(s), ${hours(blocked.totalMs)}` +
      ` (explicit wait:true = ${blocked.explicitWaitTrue})`
  );

  const idle = report.idleWait;
  lines.push(`literal sleep: ${idle.sleep.count} call(s), ${hours(idle.sleep.totalMs)}`);
  lines.push(`CI status polling: ${idle.ciPolling.count} call(s), ${hours(idle.ciPolling.totalMs)}`);
  lines.push(`poll loops (seq/while): ${idle.pollLoop.count} call(s), ${hours(idle.pollLoop.totalMs)}`);
  lines.push(`oversized timeout (>=600s): ${idle.oversizedTimeout.count} call(s), ${hours(idle.oversizedTimeout.totalMs)}`);

  const batch = report.batching;
  const batchLine = batch.stepsWithCalls
    ? `call batching: ${batch.callsPerStep} calls/step, ${batch.batchedRatioPct}% of steps batched (target >=2.0)`
    : 'call batching: NOT MEASURABLE (no steps in journal)';
  lines.push(batchLine);

  if (report.implausible.count) {
    lines.push(`excluded ${report.implausible.count} implausible duration(s) (resume/log-flush artifacts)`);
  }

  return lines.slice(0, 15);
}

/**
 * Discover session directories under a root (one level deep).
 * @param {string} root
 * @returns {string[]}
 */
function discoverSessionDirs(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    if (journalPathIn(full)) dirs.push(full);
  }
  return dirs;
}

module.exports = {
  DEFAULT_MAX_PLAUSIBLE_MS,
  DEFAULT_BLOCKING_THRESHOLD_MS,
  parseSessionBuffer,
  journalPathIn,
  classifyCommand,
  analyseSessions,
  summariseForSlot,
  discoverSessionDirs,
};
