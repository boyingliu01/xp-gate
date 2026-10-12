/**
 * @test #525 doctor: detect sync-spawn EBUSY (WorkBuddy sandbox) and attribute it
 * @intent The Spawn capability check reports a WARN with fixed attribution when
 *   spawnSync fails with EBUSY, PASS when sync spawn works, SKIP on any other
 *   probe error — and never adds to the issue count (environmental, not a
 *   defect). execWithTimeout surfaces the same attribution on stderr once
 *   instead of returning a bare null that reads as "tool missing".
 * @note Every probe is mocked: a test asserting the real spawn path would
 *   itself be EBUSY-blocked inside a WorkBuddy session (the very condition
 *   under test) and green elsewhere — a test that changes verdict with the
 *   terminal it runs in is not a test.
 */
describe('checkSpawnCapability (#525)', () => {
  let doc;
  let spawnSpy;

  function loadDoctorWithSpawn(syncImpl) {
    vi.resetModules();
    delete require.cache[require.resolve('../doctor')];
    spawnSpy = vi.spyOn(require('child_process'), 'spawnSync').mockImplementation(syncImpl);
    doc = require('../doctor');
    return spawnSpy;
  }

  afterEach(() => {
    if (spawnSpy) spawnSpy.mockRestore();
  });

  it('reports PASS with the node version when sync spawn works', () => {
    loadDoctorWithSpawn(() => ({ error: null, stdout: 'v22.11.0\n', stderr: '' }));
    const checks = [];
    const issues = doc.checkSpawnCapability(checks);
    expect(issues).toBe(0);
    expect(checks).toHaveLength(1);
    expect(checks[0].name).toBe('Spawn capability');
    expect(checks[0].status).toBe('PASS');
    expect(checks[0].detail).toContain('v22.11.0');
  });

  it('reports WARN with fixed attribution on EBUSY and never counts it', () => {
    loadDoctorWithSpawn(() => ({
      error: Object.assign(new Error('spawn EBUSY'), { code: 'EBUSY' }),
      stdout: '',
      stderr: '',
    }));
    const checks = [];
    const issues = doc.checkSpawnCapability(checks);
    expect(issues).toBe(0);
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe('WARN');
    expect(checks[0].detail).toBe(doc.EBUSY_ATTRIBUTION);
    // The attribution must name the actual situation, not a vague failure.
    expect(doc.EBUSY_ATTRIBUTION).toContain('WorkBuddy');
    expect(doc.EBUSY_ATTRIBUTION).toContain('async child_process.spawn');
    expect(doc.EBUSY_ATTRIBUTION).toContain('NOT a code or antivirus problem');
  });

  it('reports SKIP (not a sandbox WARN) on non-EBUSY probe errors', () => {
    loadDoctorWithSpawn(() => ({
      error: Object.assign(new Error('permission denied'), { code: 'EACCES' }),
      stdout: '',
      stderr: '',
    }));
    const checks = [];
    const issues = doc.checkSpawnCapability(checks);
    expect(issues).toBe(0);
    expect(checks[0].status).toBe('SKIP');
    expect(checks[0].detail).toContain('EACCES');
  });

  it('probes via process.execPath so PATH differences cannot skew the verdict', () => {
    const spy = loadDoctorWithSpawn(() => ({ error: null, stdout: 'vX\n', stderr: '' }));
    doc.checkSpawnCapability([]);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBe(process.execPath);
  });

  it('probe failure (thrown) degrades to SKIP instead of crashing doctor', () => {
    loadDoctorWithSpawn(() => {
      throw new Error('hostile environment');
    });
    const checks = [];
    const issues = doc.checkSpawnCapability(checks);
    expect(issues).toBe(0);
    expect(checks[0].status).toBe('SKIP');
  });
});

describe('execWithTimeout EBUSY attribution (#525)', () => {
  beforeEach(() => {
    vi.resetModules();
    delete require.cache[require.resolve('../doctor')];
  });

  it('emits the attribution on stderr once for repeated EBUSY, never a bare null read', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cp = require('child_process');
    // doctor.js destructures `exec` at require time, so the spy must be in
    // place BEFORE the fresh require below.
    const execSpy = vi.spyOn(cp, 'exec').mockImplementation((cmd, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      setImmediate(() => callback(Object.assign(new Error('busy'), { code: 'EBUSY' })));
      return { killed: false, exitCode: null, kill() {} };
    });
    const doc = require('../doctor');

    await doc.execWithTimeout('anything');
    await doc.execWithTimeout('anything-again');

    const attrLines = errSpy.mock.calls.filter((c) => String(c[0]).includes('WorkBuddy'));
    expect(attrLines).toHaveLength(1);
    expect(String(attrLines[0][0])).toContain('async child_process.spawn');
    execSpy.mockRestore();
    errSpy.mockRestore();
  });
});
