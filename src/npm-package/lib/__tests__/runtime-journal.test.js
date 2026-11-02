/**
 * TDD: written RED first (per AGENTS.md TDD-GATE spec).
 * @test REQ-712 Agent runtime efficiency must be measurable from session journals
 * @intent The runtime-journal CLI must resolve a session store, honour --days,
 *   and report NOT MEASURABLE instead of a silent all-zero report.
 * @covers AC-712-07
 * @covers AC-712-08
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleRuntimeJournal, sessionRootCandidates, pickSessionRoot, parseDays } = require('../runtime-journal');

let TMP_DIR;
let outSpy;
let captured;

beforeEach(() => {
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-cli-'));
  captured = [];
  outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    captured.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  outSpy.mockRestore();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

/**
 * Write a session dir containing an uncompressed journal.
 * @param {string} root
 * @param {string} name
 * @param {Array<object>} events
 */
function writeSession(root, name, events) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

/**
 * Emit a tool/call + tool/result pair.
 * @param {string} callId
 * @param {string} name
 * @param {object} args
 * @param {number} startT
 * @param {number} endT
 * @returns {Array<object>}
 */
function pair(callId, name, args, startT, endT) {
  return [
    { type: 'tool/call', time: startT, data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) } },
    { type: 'tool/result', time: endT, data: { message: { toolCallId: callId, content: [{ type: 'text', text: 'ok' }] } } },
  ];
}

describe('parseDays', () => {
  it('defaults when the flag is absent', () => {
    expect(parseDays(['--json'], 3)).toBe(3);
  });

  it('reads --days N', () => {
    expect(parseDays(['--days', '7'], 3)).toBe(7);
  });

  it('rejects a non-numeric value rather than treating it as 0', () => {
    expect(parseDays(['--days', 'abc'], 3)).toBe(3);
  });
});

describe('sessionRootCandidates', () => {
  it('honours DSH_SESSIONS_DIR as the highest-priority override', () => {
    const prev = process.env.DSH_SESSIONS_DIR;
    process.env.DSH_SESSIONS_DIR = 'C:/custom/store';
    try {
      expect(sessionRootCandidates('xp-gate')[0]).toBe('C:/custom/store');
    } finally {
      if (prev === undefined) delete process.env.DSH_SESSIONS_DIR;
      else process.env.DSH_SESSIONS_DIR = prev;
    }
  });

  it('derives the store slug from the full path, not the basename', () => {
    const prev = process.env.DSH_SESSIONS_DIR;
    delete process.env.DSH_SESSIONS_DIR;
    try {
      // DSH slugs `D:\projects\xp-gate` to `--D-projects-xp-gate--`. A
      // basename-only guess would produce `--xp-gate--`, which never exists.
      const candidates = sessionRootCandidates('D:\\projects\\xp-gate');
      expect(candidates.some((c) => c.endsWith('--D-projects-xp-gate--'))).toBe(true);
    } finally {
      if (prev !== undefined) process.env.DSH_SESSIONS_DIR = prev;
    }
  });
});

describe('pickSessionRoot', () => {
  it('picks the first candidate that actually holds a journal', () => {
    const store = path.join(TMP_DIR, 'store');
    writeSession(store, 's1', pair('a', 'read', {}, 1000, 1010));
    const missing = path.join(TMP_DIR, 'nope');
    expect(pickSessionRoot([missing, store])).toBe(store);
  });

  it('returns null when no candidate holds a journal', () => {
    expect(pickSessionRoot([path.join(TMP_DIR, 'nope')])).toBeNull();
  });
});

describe('handleRuntimeJournal — AC-712-07 NOT MEASURABLE', () => {
  it('reports NOT MEASURABLE and exits 0 when no journal is found', () => {
    const code = handleRuntimeJournal(['--sessions-dir', path.join(TMP_DIR, 'absent')]);
    expect(code).toBe(0);
    expect(captured.join('')).toMatch(/NOT MEASURABLE/i);
  });

  it('reports measurable:false in JSON form so a machine reader sees the gap', () => {
    handleRuntimeJournal(['--json', '--sessions-dir', path.join(TMP_DIR, 'absent')]);
    const payload = JSON.parse(captured.join(''));
    expect(payload.measurable).toBe(false);
    expect(payload.reason).toMatch(/no session journals/i);
  });
});

describe('handleRuntimeJournal — AC-712-08 report content', () => {
  it('measures a real journal and emits the anti-pattern numbers', () => {
    const store = path.join(TMP_DIR, 'store');
    const now = Date.now();
    writeSession(store, 's1', [
      ...pair('j1', 'job_output', { job_id: 'b', wait: true }, now - 600000, now - 60000),
      ...pair('s1', 'bash', { command: 'sleep 120' }, now - 50000, now - 1000),
    ]);

    const code = handleRuntimeJournal(['--json', '--sessions-dir', store, '--days', '1']);
    expect(code).toBe(0);
    const payload = JSON.parse(captured.join(''));
    expect(payload.measurable).toBe(true);
    expect(payload.blockingJobOutput.explicitWaitTrue).toBe(1);
    expect(payload.idleWait.sleep.count).toBe(1);
  });

  it('excludes calls outside the --days window', () => {
    const store = path.join(TMP_DIR, 'store');
    const now = Date.now();
    const oldT = now - 30 * 24 * 60 * 60 * 1000;
    writeSession(store, 's1', pair('j1', 'job_output', { wait: true }, oldT, oldT + 600000));

    handleRuntimeJournal(['--json', '--sessions-dir', store, '--days', '1']);
    const payload = JSON.parse(captured.join(''));
    expect(payload.blockingJobOutput.explicitWaitTrue).toBe(0);
  });

  it('always exits 0 — this is a diagnostic, not a gate', () => {
    const store = path.join(TMP_DIR, 'store');
    writeSession(store, 's1', pair('a', 'read', {}, 1000, 1010));
    expect(handleRuntimeJournal(['--sessions-dir', store])).toBe(0);
  });
});
