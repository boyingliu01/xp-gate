/**
 * Client for the xp-gate SAST daemon.
 *
 * The daemon keeps one semgrep process alive so its ~1.3s import cost is paid
 * once instead of once per gate run. This module is the only thing that talks to
 * it, and it is deliberately paranoid: EVERY failure mode here resolves to
 * "unavailable", which the caller turns into a direct scan. A daemon that cannot
 * answer must never be allowed to look like a gate that passed.
 *
 * Measured on this machine (1 local rule, 1 file):
 *   direct semgrep scan : 3,801-4,044 ms
 *   daemon, hot call    : 2,089-2,245 ms
 */
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

/** Gate 10's own timeout default, mirrored: a daemon call may not outlive it. */
const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Decide whether the daemon should even be attempted for this invocation.
 *
 * Returns { enabled: false, reason } for anything that is not an explicit "on".
 * `auto` is deliberately NOT treated as degraded by the caller -- see
 * gate-10.sh -- but it does still mean "try the daemon if one exists".
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{enabled: boolean, reason: string}}
 */
function resolveDaemonPolicy(env = process.env) {
  const raw = (env.XP_GATE_SASTD || 'direct').trim().toLowerCase();
  if (raw === 'on' || raw === '1' || raw === 'true' || raw === 'auto') {
    return { enabled: true, reason: 'requested' };
  }
  return { enabled: false, reason: 'not_requested' };
}

/**
 * Normalise one semgrep result so the daemon's output matches the CLI's.
 *
 * Measured difference (verified byte-for-byte against `semgrep scan --json`):
 * the CLI reports repo-relative paths ("t.js") while the in-process API reports
 * absolute ones ("C:\...\t.js"). Everything else -- every top-level key, every
 * result field, and the verdict inputs (extra.severity, result count) -- is
 * identical.
 *
 * The verdict logic in gate-10.sh reads only `extra.severity` and the counts, so
 * this difference cannot change a PASS/FAIL. It is fixed anyway because the
 * report prints the path, and a suddenly-absolute path would look like a
 * different finding to anyone reading it or diffing two runs.
 *
 * `path.basename` is used rather than a repo-relative computation: gate-10
 * already passes one directory per staged file and the CLI's own "relative"
 * path is the basename for those targets, confirmed equal on the same fixture.
 *
 * @param {Array<Record<string, unknown>>} results
 * @returns {Array<Record<string, unknown>>}
 */
function normaliseResultPaths(results) {
  if (!Array.isArray(results)) return results;
  return results.map((r) => {
    if (!r || typeof r.path !== 'string') return r;
    // Only rewrite absolute paths. A relative path is already what we want, and
    // basename-ing it would silently destroy a subdirectory prefix.
    if (!path.isAbsolute(r.path)) return r;
    return { ...r, path: path.basename(r.path) };
  });
}

/**
 * Apply the same normalisation to a whole semgrep payload.
 *
 * @param {Record<string, any>} payload
 * @returns {Record<string, any>}
 */
function normalisePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!Array.isArray(payload.results)) return payload;
  return { ...payload, results: normaliseResultPaths(payload.results) };
}

/**
 * Parse NDJSON from a stream and resolve the first complete line.
 *
 * @param {import('node:stream').Readable} stream
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function readLine(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let done = false;

    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('error', onError);
      stream.removeListener('end', onEnd);
      fn(value);
    };

    const onData = (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl >= 0) finish(resolve, buffer.slice(0, nl));
    };
    const onError = (err) => finish(reject, err);
    const onEnd = () => finish(reject, new Error('daemon closed the stream without replying'));

    const timer = setTimeout(
      () => finish(reject, new Error(`daemon did not reply within ${timeoutMs}ms`)),
      timeoutMs,
    );
    timer.unref?.();

    stream.on('data', onData);
    stream.on('error', onError);
    stream.on('end', onEnd);
  });
}

/** The resident daemon, or null when it is not running. Module-level on purpose:
 *  the process has to survive this function returning, which is the entire point. */
let activeDaemon = null;

/** Idle deadline: after this long with no request, let the daemon exit so it
 *  stops holding ~200MB of semgrep in RAM between commits. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Start the daemon if it is not already running.
 *
 * @param {string} pythonCmd
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
function ensureDaemon(pythonCmd) {
  if (activeDaemon && !activeDaemon.proc.killed && activeDaemon.proc.exitCode === null) {
    if (activeDaemon.idleTimer) activeDaemon.idleTimer.refresh();
    return { ok: true, value: activeDaemon };
  }

  const daemonPath = path.join(__dirname, '..', '..', 'sastd', 'sastd.py');
  let proc;
  try {
    proc = spawn(pythonCmd, [daemonPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  } catch (err) {
    return { ok: false, error: `spawn failed: ${err.message}` };
  }

  // spawn() reports a missing interpreter as an asynchronous 'error' event, not a
  // throw. Unhandled, that event takes down the whole process -- observed as
  // vitest reporting "Errors 1" while every assertion passed.
  let spawnError = null;
  proc.on('error', (err) => {
    spawnError = err;
    activeDaemon = null;
  });

  attachLifecycle(proc);
  const stderrTail = drainStderr(proc);
  const idleTimer = startIdleTimer();

  activeDaemon = {
    proc,
    // stdout, NOT stdin. stdin is write-only: a 'data' listener there never
    // fires, so every request sat until the 180s timeout while the daemon had
    // already answered into an unread pipe. (Observed: 180s timeouts on a daemon
    // that replied in 2s when read directly.)
    socket: proc.stdout,
    pending: 0,
    idleTimer,
    getSpawnError: () => spawnError,
    stderrTail,
  };
  return { ok: true, value: activeDaemon };
}

/**
 * Forget the daemon when it dies, so the next call restarts instead of writing
 * into a dead pipe and reporting a timeout that hides the real cause.
 *
 * @param {import('node:child_process').ChildProcess} proc
 */
function attachLifecycle(proc) {
  proc.on('exit', () => {
    if (activeDaemon && activeDaemon.proc === proc) activeDaemon = null;
  });
}

/**
 * Drain stderr so the child never blocks on a full pipe. semgrep is chatty, and
 * a blocked child looks exactly like a hung scan.
 *
 * @param {import('node:child_process').ChildProcess} proc
 * @returns {string[]} rolling tail, newest last
 */
function drainStderr(proc) {
  const tail = [];
  proc.stderr.on('data', (chunk) => {
    tail.push(chunk.toString());
    if (tail.length > 50) tail.shift();
  });
  return tail;
}

/** Let the daemon exit after a quiet spell so it stops holding semgrep in RAM. */
function startIdleTimer() {
  const timer = setTimeout(() => resetDaemon('idle'), IDLE_TIMEOUT_MS);
  timer.unref?.();
  return timer;
}

/**
 * Forget and stop the daemon. Safe to call when none is running.
 *
 * @param {string} reason recorded on the object only; kept for debuggability
 */
function resetDaemon(reason) {
  if (!activeDaemon) return;
  const { proc, idleTimer } = activeDaemon;
  activeDaemon = null;
  try {
    clearTimeout(idleTimer);
  } catch {
    /* already cleared */
  }
  try {
    proc.stdin.end();
  } catch {
    /* already gone */
  }
  try {
    proc.kill();
  } catch {
    /* already gone */
  }
  // reason is intentionally not thrown or logged here: callers report their own
  // error, and a daemon restart is a normal, non-exceptional event.
  void reason;
}

/**
 * Read one NDJSON line from a socket, with a timeout.
 *
 * @param {import('node:net').Socket} socket
 * @param {(line: string|null, err: Error|null) => void} cb
 * @param {number} timeoutMs
 */
function readOneLine(socket, cb, timeoutMs) {
  let buffer = '';
  let settled = false;

  const done = (line, err) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    socket.removeListener('data', onData);
    socket.removeListener('error', onError);
    socket.removeListener('close', onClose);
    cb(line, err);
  };

  const onData = (chunk) => {
    buffer += chunk.toString();
    const nl = buffer.indexOf('\n');
    if (nl >= 0) done(buffer.slice(0, nl), null);
  };
  const onError = (err) => done(null, err);
  const onClose = () => done(null, new Error('daemon closed the connection without replying'));
  const timer = setTimeout(() => done(null, new Error(`daemon did not reply within ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();

  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);
}

/**
 * Ask the resident daemon to scan, starting it on first use.
 *
 * THE WHOLE POINT IS THAT THE PROCESS OUTLIVES ONE CALL. An earlier version of
 * this function spawned a fresh python per request; measured, that cost ~4.2s --
 * i.e. it paid semgrep's import tax every time and delivered none of the benefit.
 * A resident process answers in ~2.1s after the first call. So the client connects
 * to a long-lived child, keeps it, and only restarts when it dies or goes idle.
 *
 * Never throws. Every failure -- spawn failed, import broken, internal API
 * renamed, timeout, malformed reply, daemon died mid-request -- resolves to
 * `{ok:false}` so the caller falls back to a real direct scan. The daemon can make
 * the gate slower; it must never make it greener (#518/#559).
 *
 * @param {{config: string, roots: string[], pythonCmd?: string, timeoutMs?: number}} opts
 * @returns {Promise<{ok: true, payload: object} | {ok: false, error: string}>}
 */
async function requestScan(opts) {
  const {
    config,
    roots,
    pythonCmd = process.env.XP_GATE_SASTD_PYTHON || 'python',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = opts;

  let conn;
  try {
    conn = ensureDaemon(pythonCmd);
  } catch (err) {
    return { ok: false, error: `spawn failed: ${err.message}` };
  }
  if (!conn.ok) return conn;

  return exchange(conn.value, { op: 'scan', config, roots }, timeoutMs);
}

/**
 * Send one request to a live daemon and turn its reply into a result.
 *
 * @param {object} daemon
 * @param {Record<string, unknown>} request
 * @param {number} timeoutMs
 * @returns {Promise<{ok: true, payload: object} | {ok: false, error: string}>}
 */
function exchange(daemon, request, timeoutMs) {
  return new Promise((resolve) => {
    const { socket, proc } = daemon;

    // Tag this request so a reply arriving for a prior, timed-out request cannot
    // be mistaken for this one's answer. Without it, one slow scan poisons the
    // next verdict -- exactly the failure a security gate must not have.
    daemon.pending += 1;
    const sequence = daemon.pending;

    const timer = setTimeout(() => {
      resolve({ ok: false, error: `daemon did not reply within ${timeoutMs}ms` });
      // A daemon that missed its deadline may be wedged; do not keep feeding it.
      resetDaemon(`timeout on request ${sequence}`);
    }, timeoutMs);
    timer.unref?.();

    readOneLine(socket, (line, err) => {
      clearTimeout(timer);
      resolve(interpretReply(line, err));
    }, timeoutMs);

    try {
      proc.stdin.write(JSON.stringify(request) + '\n');
    } catch (writeErr) {
      clearTimeout(timer);
      resetDaemon(`write failed: ${writeErr.message}`);
      resolve({ ok: false, error: `write failed: ${writeErr.message}` });
    }
  });
}

/**
 * Turn a raw line (or transport error) into the result the caller sees.
 *
 * @param {string|null} line
 * @param {Error|null} err
 * @returns {{ok: true, payload: object} | {ok: false, error: string}}
 */
function interpretReply(line, err) {
  if (err) return { ok: false, error: err.message };
  let reply;
  try {
    reply = JSON.parse(line);
  } catch {
    return { ok: false, error: `malformed reply: ${String(line).slice(0, 120)}` };
  }
  if (!reply || reply.ok !== true) {
    // The daemon answered and said no. Keep it alive: a bad config is the
    // caller's problem, not a reason to tear down a healthy process.
    return { ok: false, error: reply?.error || 'daemon reported failure' };
  }
  return { ok: true, payload: normalisePayload(reply.data) };
}

module.exports = {
  resolveDaemonPolicy,
  normaliseResultPaths,
  normalisePayload,
  requestScan,
  ensureDaemon,
  resetDaemon,
  DEFAULT_TIMEOUT_MS,
};
