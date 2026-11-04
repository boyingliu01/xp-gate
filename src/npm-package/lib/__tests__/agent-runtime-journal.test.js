/**
 * TDD: written RED first (per AGENTS.md TDD-GATE spec).
 * @test REQ-712 Agent runtime efficiency must be measurable from session journals
 * @intent Expose the four AGENTS.md runtime anti-patterns (blocking job_output,
 *   literal sleep, CI polling loops, serial tool calls) as machine-checkable
 *   numbers instead of a prose rule that nobody measures.
 * @covers AC-712-01, AC-712-06
 * @covers AC-712-02
 * @covers AC-712-03
 * @covers AC-712-04
 * @covers AC-712-05
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  analyseSessions,
  parseSessionBuffer,
  classifyCommand,
  summariseForSlot,
  DEFAULT_MAX_PLAUSIBLE_MS,
} = require('../agent-runtime-journal');

let TMP_DIR;

beforeAll(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-journal-'));
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

/**
 * Build a session journal buffer from a compact event list.
 * @param {Array<object>} events
 * @returns {string}
 */
function journalText(events) {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

/**
 * Emit a tool/call + tool/result pair at the given times.
 * @param {string} callId
 * @param {string} name
 * @param {object} args
 * @param {number} startT
 * @param {number} endT
 * @param {{isError?: boolean, text?: string}} [result]
 * @param {{turn?: number, step?: number}} [pos]
 * @returns {Array<object>}
 */
function toolPair(callId, name, args, startT, endT, result = {}, pos = {}) {
  const turn = pos.turn ?? 1;
  const step = pos.step ?? 1;
  const call = {
    type: 'tool/call',
    time: startT,
    data: { turn, step, callId, name, arguments: JSON.stringify(args) },
  };
  // Built separately so the pair stays flat: inlining it put the event five
  // objects deep, which trips clean-code.deep-nesting (max 4) on every run.
  const reply = {
    type: 'tool/result',
    time: endT,
    data: { turn, step, message: toolResultMessage(callId, result) },
  };
  return [call, reply];
}

/** The `message` payload of a tool/result event. */
function toolResultMessage(callId, result) {
  return {
    role: 'tool',
    toolCallId: callId,
    isError: !!result.isError,
    content: [{ type: 'text', text: result.text ?? 'ok' }],
  };
}

describe('parseSessionBuffer', () => {
  // `zlib.zstdCompressSync` / `zstdDecompressSync` landed in Node 22. CI pins
  // Node 20.x, so without this guard the test throws "zstdCompressSync is not a
  // function" there and turns Gate 5 red on a machine difference rather than a
  // code defect. Locally (Node 24) it passed, which is exactly why the gap
  // survived. Feature-detected rather than version-sniffed, so a backport or a
  // future rename cannot silently disable the coverage.
  const hasZstd = typeof zlib.zstdCompressSync === 'function' && typeof zlib.zstdDecompressSync === 'function';

  it.skipIf(!hasZstd)('reads a zstd-compressed session journal', () => {
    const events = toolPair('c1', 'read', { file_path: '/a.ts' }, 1000, 1010);
    const buf = zlib.zstdCompressSync(Buffer.from(journalText(events), 'utf8'));
    const parsed = parseSessionBuffer(buf);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe('tool/call');
  });

  it('skips a zstd-magic buffer it cannot decode, rather than throwing', () => {
    // The counterpart to the test above: on a runtime without zstd the magic
    // number still gets recognised, `zstdDecompressSync` is missing, and the
    // catch must degrade to "no events" instead of crashing the whole journal.
    // This runs on every Node version, so the degraded path is never untested.
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x00, 0x00, 0x00]);
    expect(() => parseSessionBuffer(magic)).not.toThrow();
    expect(parseSessionBuffer(magic)).toEqual([]);
  });

  it('reads an uncompressed journal too, so fixtures need no encoder', () => {
    const events = toolPair('c1', 'read', { file_path: '/a.ts' }, 1000, 1010);
    const parsed = parseSessionBuffer(Buffer.from(journalText(events), 'utf8'));
    expect(parsed).toHaveLength(2);
  });

  it('skips malformed lines instead of throwing away the whole journal', () => {
    const good = toolPair('c1', 'read', {}, 1000, 1010).map((e) => JSON.stringify(e));
    const text = [good[0], 'not json at all', good[1]].join('\n');
    const parsed = parseSessionBuffer(Buffer.from(text, 'utf8'));
    expect(parsed).toHaveLength(2);
  });
});

describe('classifyCommand', () => {
  it('flags a literal sleep', () => {
    expect(classifyCommand('cd /repo && sleep 600; echo ok').sleep).toBe(true);
  });

  it('does not flag words that merely contain "sleep"', () => {
    expect(classifyCommand('echo sleepless').sleep).toBe(false);
  });

  it('flags a seq-driven polling loop', () => {
    expect(classifyCommand('for i in $(seq 1 20); do gh run list; done').pollLoop).toBe(true);
  });

  it('flags gh run status polling', () => {
    expect(classifyCommand('gh run list --limit 4 --json status').ciPolling).toBe(true);
    expect(classifyCommand('gh run watch 123').ciPolling).toBe(true);
  });

  it('flags an oversized explicit timeout', () => {
    expect(classifyCommand('timeout 1800 npx vitest run').oversizedTimeout).toBe(true);
    expect(classifyCommand('timeout 60 npx vitest run').oversizedTimeout).toBe(false);
  });
});

describe('analyseSessions — AC-712-01 blocking job_output', () => {
  it('counts job_output calls that block longer than the threshold', () => {
    const events = [
      ...toolPair('j1', 'job_output', { job_id: 'b1', wait: true }, 0, 120000),
      ...toolPair('j2', 'job_output', { job_id: 'b2' }, 200000, 200010),
    ];
    const dir = path.join(TMP_DIR, 'a');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText(events));

    const report = analyseSessions([dir]);
    expect(report.blockingJobOutput.count).toBe(1);
    expect(report.blockingJobOutput.totalMs).toBe(120000);
  });

  it('counts explicit wait:true separately — the rule names that exact mistake', () => {
    const events = [
      ...toolPair('j1', 'job_output', { job_id: 'b1', wait: true }, 0, 1000),
      ...toolPair('j2', 'job_output', { job_id: 'b2', wait: true }, 2000, 3000),
      ...toolPair('j3', 'job_output', { job_id: 'b3' }, 4000, 5000),
    ];
    const dir = path.join(TMP_DIR, 'b');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText(events));

    const report = analyseSessions([dir]);
    expect(report.blockingJobOutput.explicitWaitTrue).toBe(2);
  });
});

describe('analyseSessions — AC-712-02 idle waiting', () => {
  it('totals literal-sleep commands', () => {
    const events = [
      ...toolPair('s1', 'bash', { command: 'sleep 300; echo done' }, 0, 300000),
      ...toolPair('s2', 'bash', { command: 'npx tsc --noEmit' }, 310000, 320000),
    ];
    const dir = path.join(TMP_DIR, 'c');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText(events));

    const report = analyseSessions([dir]);
    expect(report.idleWait.sleep.count).toBe(1);
    expect(report.idleWait.sleep.totalMs).toBe(300000);
  });

  it('totals CI polling separately from sleep so the cause stays visible', () => {
    const events = [
      ...toolPair('p1', 'bash', { command: 'gh run list --limit 3' }, 0, 5000),
      ...toolPair('p2', 'bash', { command: 'for i in $(seq 1 30); do sleep 10; done' }, 10000, 600000),
    ];
    const dir = path.join(TMP_DIR, 'd');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText(events));

    const report = analyseSessions([dir]);
    expect(report.idleWait.ciPolling.count).toBe(1);
    expect(report.idleWait.pollLoop.count).toBe(1);
  });
});

describe('analyseSessions — AC-712-03 call batching', () => {
  it('reports calls per step and the share of batched steps', () => {
    // step 1: two concurrent calls; step 2: one call.
    const s1 = [
      ...toolPair('a', 'read', {}, 0, 5, {}, { step: 1 }),
      ...toolPair('b', 'grep', {}, 0, 5, {}, { step: 1 }),
    ];
    const s2 = toolPair('c', 'bash', { command: 'git status' }, 100, 150, {}, { step: 2 });
    const dir = path.join(TMP_DIR, 'e');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText([...s1, ...s2]));

    const report = analyseSessions([dir]);
    expect(report.batching.stepsWithCalls).toBe(2);
    expect(report.batching.stepsWithMultipleCalls).toBe(1);
    expect(report.batching.batchedRatioPct).toBe(50);
    expect(report.batching.callsPerStep).toBeCloseTo(1.5, 5);
  });
});

describe('analyseSessions — AC-712-04 implausible durations', () => {
  it('excludes resume/flush artifacts above the plausible ceiling', () => {
    const huge = DEFAULT_MAX_PLAUSIBLE_MS + 1;
    const events = [
      ...toolPair('x1', 'bash', { command: 'echo hi' }, 0, huge),
      ...toolPair('x2', 'bash', { command: 'echo hi' }, huge + 1000, huge + 1010),
    ];
    const dir = path.join(TMP_DIR, 'f');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText(events));

    const report = analyseSessions([dir]);
    expect(report.implausible.count).toBe(1);
    // The surviving sample must not be averaged with the excluded one.
    expect(report.toolCalls).toBe(2);
    expect(report.timedCalls).toBe(1);
  });
});

describe('summariseForSlot — AC-712-05 output contract', () => {
  it('emits a one-screen summary naming every measured anti-pattern', () => {
    const events = [
      ...toolPair('j1', 'job_output', { wait: true }, 0, 600000),
      ...toolPair('s1', 'bash', { command: 'sleep 60' }, 700000, 760000),
    ];
    const dir = path.join(TMP_DIR, 'g');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText(events));

    const report = analyseSessions([dir]);
    const lines = summariseForSlot(report);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(15);
    const text = lines.join('\n');
    expect(text).toMatch(/job_output/i);
    expect(text).toMatch(/sleep/i);
  });

  it('says NOT MEASURABLE rather than 0% when there are no steps to measure', () => {
    const dir = path.join(TMP_DIR, 'h');
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    // Journal with no tool calls at all.
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText([{ type: 'session', time: 0 }]));

    const report = analyseSessions([dir]);
    const text = summariseForSlot(report).join('\n');
    expect(text).toMatch(/NOT MEASURABLE/i);
  });
});

describe('analyseSessions — AC-712-06 time window', () => {
  it('counts only calls inside [sinceMs, untilMs) so a before/after A/B is possible', () => {
    const events = [
      // Before the window: one 600s sleep that must NOT be counted.
      ...toolPair('old', 'bash', { command: 'sleep 600' }, 1000, 601000),
      // Inside the window: one 60s sleep that must be counted.
      ...toolPair('new', 'bash', { command: 'sleep 60' }, 2_000_000, 2_060_000),
    ];
    const dir = path.join(TMP_DIR, 'win');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText(events));

    const report = analyseSessions([dir], { sinceMs: 1_500_000 });
    expect(report.idleWait.sleep.count).toBe(1);
    expect(report.idleWait.sleep.totalMs).toBe(60_000);
  });

  it('excludes calls at or after untilMs', () => {
    const events = [
      ...toolPair('in', 'bash', { command: 'sleep 60' }, 2_000_000, 2_060_000),
      ...toolPair('after', 'bash', { command: 'sleep 300' }, 3_000_000, 3_300_000),
    ];
    const dir = path.join(TMP_DIR, 'win2');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), journalText(events));

    const report = analyseSessions([dir], { sinceMs: 1_000_000, untilMs: 2_500_000 });
    expect(report.idleWait.sleep.count).toBe(1);
    expect(report.idleWait.sleep.totalMs).toBe(60_000);
  });
});

describe('analyseSessions — robustness', () => {
  it('ignores a directory with no journal instead of crashing', () => {
    const dir = path.join(TMP_DIR, 'empty');
    fs.mkdirSync(dir, { recursive: true });
    const report = analyseSessions([dir]);
    expect(report.toolCalls).toBe(0);
  });

  it('returns an empty-but-shaped report for an empty session list', () => {
    const report = analyseSessions([]);
    expect(report.sessions).toBe(0);
    expect(report.batching.stepsWithCalls).toBe(0);
  });
});
