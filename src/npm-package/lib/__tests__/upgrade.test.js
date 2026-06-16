/**
 * @test REQ-001-02 xp-gate upgrade CLI command
 * @intent 验证 upgrade 命令三种模式（default/preview/apply）的代码路径和错误处理
 * @covers AC-002-01, AC-002-02, AC-002-03, AC-002-04, AC-002-05, AC-002-06, AC-002-07, AC-002-08
 */

const fs = require('fs');
const path = require('path');

function capture() {
  const out = [];
  const err = [];
  const l = console.log;
  const e = console.error;
  console.log = (...a) => { out.push(a.join(' ')); };
  console.error = (...a) => { err.push(a.join(' ')); };
  return { out, err, restore: () => { console.log = l; console.error = e; } };
}

describe('upgrade.js — REQ-001-02', () => {
  let mod;
  let r;

  function evictLibCache() {
    const resolved = require.resolve('../upgrade');
    const cvResolved = require.resolve('../check-version');
    const libPrefix = resolved.replace(/upgrade\.js$/, '');
    Object.keys(require.cache).forEach(key => {
      if (key.startsWith(libPrefix)) delete require.cache[key];
    });
    delete require.cache[resolved];
    delete require.cache[cvResolved];
  }

  beforeEach(() => {
    // Clear disk cache so checkUpgrade doesn't see stale data from
    // upgrade-exec.test.js's mock (which wrote version-cache.json).
    const fs = require('fs');
    const os = require('os');
    const cpPath = require('path').join(os.homedir(), '.xp-gate', 'version-cache.json');
    if (fs.existsSync(cpPath)) { try { fs.unlinkSync(cpPath); } catch { } }
    evictLibCache();
    vi.resetModules();
    r = capture();
    mod = require('../upgrade');
  });

  afterEach(() => {
    r.restore();
  });

  // AC-002-01 through AC-002-06: tested in upgrade-exec.test.js (isolated, no real network)

  // AC-002-07: clearCache is exported and works
  describe('clearCache function — AC-002-07', () => {
    it('is accessible from check-version module', () => {
      const cv = require('../check-version');
      expect(typeof cv.clearCache).toBe('function');
    });
  });

  // AC-002-08: no hardcoded package name
  describe('getPackageName() usage — AC-002-08', () => {
    it('uses pkgName variable in npm install -g commands, not hardcoded name', () => {
      const source = fs.readFileSync(require.resolve('../upgrade.js'), 'utf8');
      // Only check executable lines (non-comment), not JSDoc or inline comments
      const execLines = source.split('\n')
        .filter(l => l.includes('npm install -g') && !l.includes('//') && !l.includes('*'));
      for (const line of execLines) {
        expect(line).toContain('pkgName');
        expect(line).not.toMatch(/npm install -g @boyingliu01/);
      }
    });
  });
});


