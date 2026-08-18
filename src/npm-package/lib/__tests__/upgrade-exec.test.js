/**
 * @test REQ-001-02 xp-gate upgrade --apply execSync path
 * @intent 验证 upgrade --apply 模式下 execSync 的调用路径和错误处理
 * @covers AC-002-03
 *
 * Must be a separate file (not merged into upgrade.test.js) because:
 * upgrade.test.js has a describe-level beforeEach that calls
 * vi.resetModules() + require('../upgrade'), which runs before
 * EVERY test — including tests in a sibling describe block.
 * This would clobber our mock setup. The helper approach
 * (withMockedEnv) works correctly in isolation, confirmed by
 * standalone test verification.
 */

const { EventEmitter } = require('events');

describe('upgrade.js --apply execSync path', () => {
  function installFakeHttpsGet(latestVersion) {
    const https = require('https');
    const saved = https.get;
    https.get = (_url, options, callbackArg) => {
      const callback = typeof options === 'function' ? options : callbackArg;
      const request = new EventEmitter();
      request.destroy = () => undefined;
      if (!callback) return request;
      const response = new EventEmitter();
      response.statusCode = 200;
      callback(response);
      response.emit('data', JSON.stringify({ latest: latestVersion }));
      response.emit('end');
      return request;
    };
    return () => {
      https.get = saved;
    };
  }

  function evictCache() {
    const resolved = require.resolve('../upgrade');
    const cvResolved = require.resolve('../check-version');
    const libPrefix = resolved.replace(/upgrade\.js$/, '');
    Object.keys(require.cache).forEach(key => {
      if (key.startsWith(libPrefix)) delete require.cache[key];
    });
    delete require.cache[resolved];
    delete require.cache[cvResolved];
  }

  function spawnEE(closeCode) {
    const ee = new EventEmitter();
    process.nextTick(() => ee.emit('close', closeCode));
    return ee;
  }

  function spawnErr(err) {
    const ee = new EventEmitter();
    process.nextTick(() => ee.emit('error', err));
    return ee;
  }

  async function withMockedEnv(latestVersion, spawnImpl, fn) {
    const fs = require('fs');
    const os = require('os');
    const cpPath = require('path').join(os.homedir(), '.xp-gate', 'version-cache.json');
    if (fs.existsSync(cpPath)) {
      try { fs.unlinkSync(cpPath); } catch { }
    }
    evictCache();
    const cp = require('child_process');
    const updateSkillPath = require.resolve('../update-skill');
    const saved = {
      spawn: cp.spawn,
      updateSkillCache: require.cache[updateSkillPath],
    };
    cp.spawn = spawnImpl;
    require.cache[updateSkillPath] = {
      id: updateSkillPath,
      filename: updateSkillPath,
      loaded: true,
      exports: { updateSkill: vi.fn(async () => 0) },
      children: [],
      paths: [],
    };
    const restoreHttpsGet = installFakeHttpsGet(latestVersion);
    try {
      const m = require('../upgrade');
      return await fn(m);
    } finally {
      cp.spawn = saved.spawn;
      restoreHttpsGet();
      if (saved.updateSkillCache) require.cache[updateSkillPath] = saved.updateSkillCache;
      else delete require.cache[updateSkillPath];
    }
  }

  it('returns 0 when spawn succeeds', async () => {
    const code = await withMockedEnv('99.99.99', vi.fn(() => spawnEE(0)), async (m) => {
      return m.upgrade(['--apply']);
    });
    expect(code).toBe(0);
  }, 10000);

  it('returns 1 when spawn errors with EACCES', async () => {
    const err = new Error('EACCES: permission denied');
    const code = await withMockedEnv('99.99.99', vi.fn(() => spawnErr(err)), async (m) => {
      return m.upgrade(['--apply']);
    });
    expect(code).toBe(1);
  }, 10000);

  it('returns 1 when spawn errors with ETIMEDOUT', async () => {
    const err = new Error('ETIMEDOUT');
    const code = await withMockedEnv('99.99.99', vi.fn(() => spawnErr(err)), async (m) => {
      return m.upgrade(['--apply']);
    });
    expect(code).toBe(1);
  }, 10000);

  it('returns 1 when spawn exits with non-zero code', async () => {
    const code = await withMockedEnv('99.99.99', vi.fn(() => spawnEE(1)), async (m) => {
      return m.upgrade(['--apply']);
    });
    expect(code).toBe(1);
  }, 10000);

  it('calls spawn with correct args', async () => {
    const mockSpawn = vi.fn(() => spawnEE(0));
    await withMockedEnv('99.99.99', mockSpawn, async (m) => {
      await m.upgrade(['--apply']);
      expect(mockSpawn).toHaveBeenCalledWith(
        'npm',
        ['install', '-g', expect.stringMatching(/@99\.99\.99/)],
        expect.objectContaining({ stdio: 'inherit', timeout: 120000 }),
      );
    });
  }, 10000);

  // ── default mode (no --apply/--preview) outdated path ──
  it('default mode: shows upgrade msg when outdated', async () => {
    await withMockedEnv('99.99.99', vi.fn(() => spawnEE(0)), async (m) => {
      const out = [];
      const origLog = console.log;
      console.log = (...a) => { out.push(a.join(' ')); };
      try {
        const code = await m.upgrade([]);
        expect(code).toBe(0);
        const joined = out.join(' ');
        expect(joined).toContain('newer version') || expect(joined).toContain('v99.99.99');
      } finally {
        console.log = origLog;
      }
    });
  }, 10000);

  // ── withMockedEnv variant: also mocks getLocalVersion() to return null ──
  async function withMockedEnvNoLocal(latestVersion, spawnImpl, fn) {
    const fs = require('fs');
    const os = require('os');
    const cpPath = require('path').join(os.homedir(), '.xp-gate', 'version-cache.json');
    if (fs.existsSync(cpPath)) {
      try { fs.unlinkSync(cpPath); } catch { }
    }
    evictCache();
    const cp = require('child_process');
    const saved = { spawn: cp.spawn, fsReadFileSync: fs.readFileSync };
    cp.spawn = spawnImpl;
    // Make getLocalVersion() return null by making fs.readFileSync throw for package.json
    fs.readFileSync = (filePath, encoding) => {
      if (typeof filePath === 'string' && filePath.includes('package.json')) {
        const err = new Error('ENOENT: no such file');
        err.code = 'ENOENT';
        throw err;
      }
      return saved.fsReadFileSync.call(fs, filePath, encoding);
    };
    const restoreHttpsGet = installFakeHttpsGet(latestVersion);
    try {
      const m = require('../upgrade');
      return await fn(m);
    } finally {
      cp.spawn = saved.spawn;
      restoreHttpsGet();
      fs.readFileSync = saved.fsReadFileSync;
    }
  }

  // ── Coverage gap: L71-72 — --apply with null local, not outdated ──
  // getLocalVersion() returns null (fs.readFileSync throws), remote matches
  it('--apply mode: null local, not outdated (L71-72)', async () => {
    const out = [];
    const origLog = console.log;
    console.log = (...a) => { out.push(a.join(' ')); };
    try {
      const code = await withMockedEnvNoLocal('0.8.12', vi.fn(() => spawnEE(0)), async (m) => m.upgrade(['--apply']));
      expect(code).toBe(0);
      expect(out.join(' ')).toBe('xp-gate is up to date.');
    } finally {
      console.log = origLog;
    }
  }, 10000);

  // ── Coverage gap: L107-108 — default mode with null local, not outdated ──
  it('default mode: null local, not outdated (L107-108)', async () => {
    const out = [];
    const origLog = console.log;
    console.log = (...a) => { out.push(a.join(' ')); };
    try {
      const code = await withMockedEnvNoLocal('0.8.12', vi.fn(() => spawnEE(0)), async (m) => m.upgrade([]));
      expect(code).toBe(0);
      expect(out.join(' ')).toBe('xp-gate is up to date.');
    } finally {
      console.log = origLog;
    }
  }, 10000);

  // ── AC-002-01: default mode human-readable output (isolated, no real network) ──
  it('AC-002-01: displays human-readable output (exit 0)', async () => {
    const out = [];
    const origLog = console.log;
    console.log = (...a) => { out.push(a.join(' ')); };
    try {
      const code = await withMockedEnv('99.99.99', vi.fn(() => spawnEE(0)), async (m) => m.upgrade([]));
      expect(code).toBe(0);
      expect(out.length + (out.join(' ').length > 0 ? 1 : 0)).toBeGreaterThan(0);
    } finally {
      console.log = origLog;
    }
  }, 10000);

  // ── AC-002-02: --preview mode JSON output (isolated, no real network) ──
  it('AC-002-02: outputs single-line JSON with version info', async () => {
    const out = [];
    const origLog = console.log;
    console.log = (...a) => { out.push(a.join(' ')); };
    try {
      const code = await withMockedEnv('1.0.0', vi.fn(() => spawnEE(0)), async (m) => m.upgrade(['--preview']));
      expect(code).toBe(0);
      expect(out.length).toBe(1);
      const parsed = JSON.parse(out[0]);
      expect(parsed).toHaveProperty('local');
      expect(parsed).toHaveProperty('remote');
      expect(parsed).toHaveProperty('outdated');
      expect(parsed).toHaveProperty('lagDays');
      expect(parsed).toHaveProperty('releaseUrl');
    } finally {
      console.log = origLog;
    }
  }, 10000);
});
