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

describe('execWithTimeout empty-stream retry (#525 follow-up)', () => {
  let stub = null;
  afterEach(() => { if (stub) { stub.restore(); stub = null; } });

  function freshDoctor() {
    const doctorPath = require.resolve('../doctor.js');
    delete require.cache[doctorPath];
    return require(doctorPath).execWithTimeout;
  }

  it('AC-DOCTOR-RETRY-01: retries an exit-0 empty-stdout probe and keeps its own timeout', async () => {
    stub = stubExec([
      (cb) => cb(null, '', ''),            // the lost-stream failure mode
      (cb) => cb(null, 'v24.19.0\n', ''),  // the same probe, stream intact
    ]);
    const execWithTimeout = freshDoctor();
    const result = await execWithTimeout('node --version', { stdio: ['ignore', 'pipe', 'pipe'] });
    expect(stub.calls.length).toBe(2);
    expect(result).toEqual({ stdout: 'v24.19.0', stderr: '' });
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
});
