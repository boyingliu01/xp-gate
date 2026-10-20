/**
 * @test REQ-404 CRAP advisory CLI
 * @intent Verify `xp-gate crap` renders a ranking, stays advisory (exit 0 no
 *         matter what it finds), and refuses to invent a ranking when its
 *         inputs are missing.
 * @covers AC-404
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleCrap, parseArgs } = require('../crap-cli.js');

function capture(fn) {
  const logs = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  return fn()
    .then((code) => ({ code, out: logs.join('\n'), err: errs.join('\n') }))
    .finally(() => {
      console.log = origLog;
      console.error = origErr;
    });
}

describe('crap-cli.js - argument parsing', () => {
  it('defaults to top 20, threshold 6, mirrors excluded', () => {
    const opts = parseArgs([]);
    expect(opts.top).toBe(20);
    expect(opts.threshold).toBe(6);
    expect(opts.includeMirrors).toBe(false);
    expect(opts.json).toBe(false);
  });

  it('parses the documented flags', () => {
    const opts = parseArgs(['--top', '5', '--threshold', '12', '--json', '--include-mirrors']);
    expect(opts.top).toBe(5);
    expect(opts.threshold).toBe(12);
    expect(opts.json).toBe(true);
    expect(opts.includeMirrors).toBe(true);
  });

  it('collects multiple --paths values', () => {
    expect(parseArgs(['--paths', 'src', 'scripts']).paths).toEqual(['src', 'scripts']);
  });
});

describe('crap-cli.js - advisory contract', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crap-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('prints usage and exits 0 on --help', async () => {
    const res = await capture(() => handleCrap(['--help']));
    expect(res.code).toBe(0);
    expect(res.out).toContain('ADVISORY ONLY');
  });

  it('refuses to rank when there is no coverage artifact', async () => {
    // Without coverage every function is unmeasured; printing an empty ranking
    // would read as "nothing to fix", which is the opposite of the truth.
    const missing = path.join(tmpDir, 'does-not-exist.json');
    const res = await capture(() => handleCrap(['--coverage', missing]));
    expect(res.code).toBe(1);
    expect(res.err).toContain('No coverage artifact');
  });
});
