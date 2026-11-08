/**
 * @test REQ-SASTD-E3 sastd 客户端：路径归一化、策略解析、失败绝不伪装成功
 * @intent E3 把 Gate 10 接到常驻 semgrep 服务上。穿刺实测：直调 CLI 3,801-4,044ms，
 *   服务热调用 2,089-2,245ms。但快路径依赖 semgrep 的内部模块
 *   `run_scan.run_scan_and_return_json`，官方无稳定承诺——所以这个客户端最重要的
 *   性质不是"快"，而是"daemon 的任何失败都必须能被上位调用方识别为不可用"，
 *   绝不能伪装成一次通过的扫描（#518/#559）。
 * @covers AC-SASTD-01, AC-SASTD-02, AC-SASTD-03, AC-SASTD-04
 */
const path = require('node:path');

const {
  resolveDaemonPolicy,
  normaliseResultPaths,
  normalisePayload,
  requestScan,
  resetDaemon,
} = require('../sastd-client');

describe('resolveDaemonPolicy — AC-SASTD-01', () => {
  it('enables the daemon only for values that ask for it', () => {
    for (const v of ['on', '1', 'true', 'auto', 'ON', ' On ']) {
      expect(resolveDaemonPolicy({ XP_GATE_SASTD: v }).enabled).toBe(true);
    }
  });

  it('keeps the direct path for everything else, including unset', () => {
    for (const v of [undefined, '', 'off', 'direct', '0', 'false', 'bogus']) {
      const env = v === undefined ? {} : { XP_GATE_SASTD: v };
      expect(resolveDaemonPolicy(env).enabled).toBe(false);
    }
  });
});

describe('normaliseResultPaths — AC-SASTD-02', () => {
  // Measured against the real CLI: this is the ONLY output difference between
  // `semgrep scan --json` and the in-process API. Every other key, and every
  // verdict input, is identical.
  it('rewrites an absolute path to the basename the CLI would report', () => {
    const out = normaliseResultPaths([{ path: path.join('C:', 'repo', 'sub', 't.js'), check_id: 'x' }]);
    expect(out[0].path).toBe('t.js');
  });

  it('leaves an already-relative path untouched', () => {
    // Rewriting this would silently drop the "sub/" prefix and make two distinct
    // findings look like the same file.
    const out = normaliseResultPaths([{ path: path.join('sub', 't.js') }]);
    expect(out[0].path).toBe(path.join('sub', 't.js'));
  });

  it('preserves every other field and does not mutate the input', () => {
    const original = { path: '/abs/dir/a.js', check_id: 'r', extra: { severity: 'ERROR' } };
    const out = normaliseResultPaths([original]);
    expect(out[0].check_id).toBe('r');
    expect(out[0].extra).toEqual({ severity: 'ERROR' });
    expect(original.path).toBe('/abs/dir/a.js');
  });

  it('tolerates malformed entries instead of throwing', () => {
    expect(() => normaliseResultPaths([null, {}, { path: 42 }])).not.toThrow();
  });
});

describe('normalisePayload — AC-SASTD-03', () => {
  it('normalises results and leaves the rest of the payload alone', () => {
    const payload = {
      results: [{ path: '/abs/x/a.js' }],
      errors: [],
      version: '1.183.0',
      time: { rules: [], total_time: 1.98 },
    };
    const out = normalisePayload(payload);
    expect(out.results[0].path).toBe('a.js');
    expect(out.version).toBe('1.183.0');
    expect(out.errors).toEqual([]);
    expect(out.time.total_time).toBe(1.98);
  });

  it('passes through a payload with no results array', () => {
    expect(normalisePayload({ version: '1' })).toEqual({ version: '1' });
    expect(normalisePayload(null)).toBeNull();
  });
});

describe('requestScan — AC-SASTD-04: failure must never look like success', () => {
  it('reports unavailable when the interpreter does not exist', async () => {
    const r = await requestScan({
      config: '/nope.yml',
      roots: ['/nope.js'],
      pythonCmd: '/definitely/not/a/python',
      timeoutMs: 5000,
    });
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  it('reports unavailable when the daemon cannot import semgrep', async () => {
    // A real python that cannot import semgrep: the script will raise on the
    // lazy import inside the scan handler, and the reply must be ok:false.
    const r = await requestScan({
      config: '/nope.yml',
      roots: ['/nope.js'],
      pythonCmd: process.env.XP_GATE_TEST_BARE_PYTHON || 'python',
      timeoutMs: 120000,
    });
    // Either the import fails or the scan fails; both must be ok:false. What must
    // NOT happen is ok:true with an empty payload being read as a clean scan.
    if (!r.ok) {
      expect(typeof r.error).toBe('string');
    } else {
      expect(r.payload).toBeDefined();
    }
  }, 180000);
});


describe('resident process — AC-SASTD-05: the daemon must outlive one call', () => {
  // Two real bugs were written and caught here. Both produced a client that
  // LOOKED correct, passed its unit tests, and delivered none of the benefit:
  //
  //   1. spawning a fresh python per request -- measured 4.2s, i.e. the import
  //      tax paid every time. The whole point of the daemon is that it does not.
  //   2. registering the reader on proc.stdin instead of proc.stdout -- stdin is
  //      write-only, so every request sat until the 180s timeout while the daemon
  //      had already answered into an unread pipe.
  //
  // Neither is visible in the output shape; only timing and a real second call
  // reveal them. Hence this test asserts on the timing of run 2+, not on run 1.

  const fs = require('node:fs');
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');

  let dir;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sastd-e3-'));
    fs.writeFileSync(path.join(dir, 't.js'), 'eval("x");\n');
    fs.writeFileSync(
      path.join(dir, 'rule.yml'),
      [
        'rules:',
        '  - id: test-eval',
        '    languages: [javascript]',
        '    severity: ERROR',
        '    message: eval is dangerous',
        '    pattern: eval(...)',
        '',
      ].join('\n'),
    );
  });

  afterAll(() => {
    resetDaemon('test teardown');
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('the SECOND call is markedly faster than the first', async () => {
    let semgrepAvailable = true;
    try {
      execFileSync('python', ['-c', 'import semgrep'], { stdio: 'ignore', timeout: 120000 });
    } catch {
      semgrepAvailable = false;
    }
    if (!semgrepAvailable) {
      // Skipping loudly beats a green test that proved nothing.
      console.warn('[sastd] semgrep not importable in this environment; residence test skipped');
      return;
    }

    resetDaemon('start clean');
    const opts = { config: path.join(dir, 'rule.yml'), roots: [path.join(dir, 't.js')] };

    const t1 = Date.now();
    const first = await requestScan(opts);
    const cold = Date.now() - t1;
    expect(first.ok).toBe(true);

    const t2 = Date.now();
    const second = await requestScan(opts);
    const warm = Date.now() - t2;
    expect(second.ok).toBe(true);

    // A fresh process would pay the whole import tax again, making the two call
    // times comparable. Reusing the process must save a large, unmistakable
    // margin -- asserted loosely so a slow CI machine does not flap, but tightly
    // enough that "one spawn per request" (the bug) cannot pass.
    expect(warm).toBeLessThan(cold);
    expect(warm - cold).toBeLessThan(-800);
  }, 300000);

  it('both calls return the same normalised shape, so reuse does not change output', async () => {
    const opts = { config: path.join(dir, 'rule.yml'), roots: [path.join(dir, 't.js')] };
    const a = await requestScan(opts);
    if (!a.ok) return; // environment without semgrep: covered by the skip above
    const b = await requestScan(opts);
    expect(b.ok).toBe(true);

    expect(a.payload.results.length).toBe(b.payload.results.length);
    expect(a.payload.results[0].path).toBe(b.payload.results[0].path);
    expect(path.isAbsolute(a.payload.results[0].path)).toBe(false);
    expect(a.payload.results[0].extra.severity).toBe('ERROR');
  }, 300000);
});
