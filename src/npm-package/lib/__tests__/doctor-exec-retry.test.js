/**
 * @test REQ-DOCTOR retry-on-empty-stream guard
 * @intent On win32, cmd.exe (exec's shell) can deliver exit 0 with an EMPTY
 *         stdout+stderr when many spawns are in flight — doctor read that as
 *         "Not found" and red-flagged Node/Git/hooksPath on a healthy machine.
 *         execWithTimeout must retry an empty-but-successful probe before
 *         reporting it, and must NOT retry real failures or real output.
 * @covers AC-DOCTOR-RETRY-01
 */
const path = require('path');
const { describe, it, expect, afterEach } = await import('vitest');

const cpPath = require.resolve('child_process');

function stubExec(behaviors) {
  // doctor builds its async exec at load time via util.promisify(exec), which
  // binds Node's INTERNAL custom promisify implementation — replacing the plain
  // `exec` property afterwards is invisible to it (measured: stub fired 0-1
  // times while the real cmd.exe child ran). The only patch point that holds
  // across a fresh require is util.promisify itself.
  const util = require('util');
  const originalPromisify = util.promisify;
  const calls = [];
  util.promisify = function (fn) {
    if (fn && fn.name === 'exec') {
      stubWasConsumed = true;
      return (cmd, opts = {}) => {
        const attempt = calls.length;
        calls.push(cmd);
        return new Promise((resolve, reject) => {
          behaviors[attempt]((err, stdout, stderr) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          }, attempt);
        });
      };
    }
    return originalPromisify.call(util, fn);
  };
  return {
    calls,
    restore: () => { util.promisify = originalPromisify; },
  };
}

// Node couples exec to promisify via a custom symbol; if a future runtime drops
// that coupling the name-based stub above silently stops intercepting and the
// real cmd.exe child runs. Each test flips this to true from inside its own
// stubbed load (never inherited from an earlier test), so afterEach can fail
// loudly instead of passing vacuously.
let stubWasConsumed = false;

describe('execWithTimeout empty-stream retry (#525 follow-up)', () => {
  let stub = null;
  afterEach(() => {
    if (stub) { stub.restore(); stub = null; }
    // Fail loudly if the fn.name === 'exec' stub never intercepted this test's
    // doctor load — that would mean Node dropped the exec/promisify custom-
    // symbol coupling and the assertions ran against real cmd.exe children.
    expect(stubWasConsumed, `stub did not intercept the doctor load in this test`).toBe(true);
    stubWasConsumed = false;
  });

  function freshDoctor() {
    const doctorPath = require.resolve('../doctor.js');
    delete require.cache[doctorPath];
    return require(doctorPath).execWithTimeout;
  }

  // Windows-only by construction, as a whole: the RETRY it asserts does not exist
  // off win32. The retry compensates for cmd.exe returning exit 0 with an EMPTY
  // stream; elsewhere the first empty probe is final, so `result` comes back null
  // and there is nothing to retry. Asserting the attempt count alone is not enough
  // — measured under a faked `process.platform = 'linux'`, the count assertion
  // passed while `result` failed with "expected null to deeply equal { stdout:
  // 'v24.19.0' }". The premise of the whole case is win32 (#586).
  it.skipIf(process.platform !== 'win32')(
    'AC-DOCTOR-RETRY-01: retries an exit-0 empty-stdout probe and keeps its own timeout',
    async () => {
      stub = stubExec([
        (cb) => cb(null, '', ''),            // the lost-stream failure mode
        (cb) => cb(null, 'v24.19.0\n', ''),  // the same probe, stream intact
      ]);
      const execWithTimeout = freshDoctor();
      const result = await execWithTimeout('node --version', { stdio: ['ignore', 'pipe', 'pipe'] });
      expect(stub.calls.length).toBe(2);
      expect(result).toEqual({ stdout: 'v24.19.0', stderr: '' });
    }
  );

  it('AC-DOCTOR-RETRY-01: returns null after exhausting attempts on a persistently empty probe', async () => {
    stub = stubExec([
      (cb) => cb(null, '', ''),
      (cb) => cb(null, '', ''),
      (cb) => cb(null, '', ''),
      (cb) => cb(null, 'unexpected fourth attempt', ''),
    ]);
    const execWithTimeout = freshDoctor();
    const result = await execWithTimeout('node --version', {});
    // win32: 3 attempts then null; other platforms: single attempt, still null.
    expect(result).toBeNull();
    expect(stub.calls.length).toBe(process.platform === 'win32' ? 3 : 1);
  });

  it('AC-DOCTOR-RETRY-01: does not retry when the probe produced output', async () => {
    stub = stubExec([(cb) => cb(null, 'git version 2.54.0\n', '')]);
    const execWithTimeout = freshDoctor();
    const result = await execWithTimeout('git --version', {});
    expect(stub.calls.length).toBe(1);
    expect(result.stdout).toContain('git version');
  });

  it('AC-DOCTOR-RETRY-01: does not retry a failing command', async () => {
    stub = stubExec([(cb) => cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }), '', '')]);
    const execWithTimeout = freshDoctor();
    const result = await execWithTimeout('definitely-not-a-tool --version', {});
    expect(stub.calls.length).toBe(1);
    expect(result).toBeNull();
  });

  it('AC-DOCTOR-RETRY-01: attempts:1 opts a side-effecting call out of the retry', async () => {
    stub = stubExec([
      (cb) => cb(null, '', ''),
      (cb) => cb(null, 'unexpected second attempt', ''),
    ]);
    const execWithTimeout = freshDoctor();
    const result = await execWithTimeout('some-mutating-command', { attempts: 1 });
    expect(stub.calls.length).toBe(1);
    expect(result).toBeNull();
  });

  it('AC-DOCTOR-RETRY-01: the attempts option is consumed, not forwarded to exec', async () => {
    let forwarded = null;
    stub = stubExec([(cb) => { cb(null, 'ok\n', ''); }]);
    // Capture what doctor hands to the promisified exec by re-stubbing with an
    // options recorder: stubExec's behaviors receive only the callback, so
    // assert forwarding through a second fresh module with a capturing wrapper.
    const util = require('util');
    const originalPromisify = util.promisify;
    const execWithTimeout = (() => {
      util.promisify = function (fn) {
        if (fn && fn.name === 'exec') {
          stubWasConsumed = true;
          return (cmd, opts = {}) => {
            forwarded = opts;
            return Promise.resolve({ stdout: 'ok\n', stderr: '' });
          };
        }
        return originalPromisify.call(util, fn);
      };
      const doctorPath = require.resolve('../doctor.js');
      delete require.cache[doctorPath];
      const f = require(doctorPath).execWithTimeout;
      util.promisify = originalPromisify;
      return f;
    })();
    const result = await execWithTimeout('git --version', { attempts: 2, timeout: 999 });
    expect(result.stdout).toBe('ok');
    expect(forwarded.attempts).toBeUndefined();
    expect(forwarded.timeout).toBe(999);
  });
});
