/**
 * @test REQ-SECRETS-BASELINE-NORMALIZE
 * @intent detect-secrets writes backslash paths on Windows, so the committed
 *         baseline flips between `src\a.ts` and `src/a.ts` and the real signal
 *         ("a NEW secret appeared") is buried in formatting churn. The
 *         normalizer must be idempotent and must never drop an entry.
 * @covers AC-NORMALIZE-001, AC-NORMALIZE-002, AC-NORMALIZE-003
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '..', 'normalize-secrets-baseline.cjs');
const { normalizeBaseline, normalizePath } = require(script);

const BS = '\\';

function entry(filename, line, secret = 'abc123') {
  return {
    type: 'Secret Keyword',
    filename,
    hashed_secret: secret,
    is_verified: false,
    line_number: line,
    is_added: false,
    is_removed: false,
  };
}

function baselineWith(results) {
  return { version: '1.5.52', plugins_used: [], results };
}

describe('normalizePath', () => {
  it('turns backslashes into forward slashes', () => {
    expect(normalizePath(`src${BS}a.ts`)).toBe('src/a.ts');
  });

  it('collapses repeated separators', () => {
    expect(normalizePath(`src${BS}${BS}a.ts`)).toBe('src/a.ts');
  });

  it('drops a leading ./', () => {
    expect(normalizePath('./src/a.ts')).toBe('src/a.ts');
  });

  it('leaves an already-normal path untouched', () => {
    expect(normalizePath('src/a.ts')).toBe('src/a.ts');
  });
});

describe('normalizeBaseline', () => {
  it('rewrites top-level keys AND per-entry filenames', () => {
    const data = baselineWith({
      [`src${BS}a.ts`]: [entry(`src${BS}a.ts`, 3)],
    });
    const changed = normalizeBaseline(data);
    expect(Object.keys(data.results)).toEqual(['src/a.ts']);
    expect(data.results['src/a.ts'][0].filename).toBe('src/a.ts');
    // Two fields: the key and the entry filename. Asserting the COUNT is what
    // catches a normalizer that fixes the key but forgets the entries, which was
    // the trap the issue called out explicitly ("不能只改顶层").
    expect(changed).toBe(2);
  });

  it('never alters hashed_secret, line_number, type or the is_* flags', () => {
    const before = entry(`src${BS}a.ts`, 42, 'deadbeef');
    const data = baselineWith({ [`src${BS}a.ts`]: [{ ...before }] });
    normalizeBaseline(data);
    const after = data.results['src/a.ts'][0];
    expect(after.hashed_secret).toBe('deadbeef');
    expect(after.line_number).toBe(42);
    expect(after.type).toBe('Secret Keyword');
    expect(after.is_verified).toBe(false);
    expect(after.is_added).toBe(false);
    expect(after.is_removed).toBe(false);
  });

  it('merges keys that collide after normalization instead of dropping one', () => {
    // The same file recorded once per separator. Overwriting would silently
    // un-allowlist a finding, which is the failure mode #735 is about.
    const data = baselineWith({
      [`src${BS}a.ts`]: [entry(`src${BS}a.ts`, 10, 'aaa')],
      'src/a.ts': [entry('src/a.ts', 20, 'bbb')],
    });
    normalizeBaseline(data);
    expect(Object.keys(data.results)).toEqual(['src/a.ts']);
    const lines = data.results['src/a.ts'].map((e) => e.line_number).sort((x, y) => x - y);
    expect(lines).toEqual([10, 20]);
  });

  it('refuses a non-array entry list instead of deleting it', () => {
    // A file key whose value is not an array is malformed. Coercing it to `[]`
    // would silently drop every finding recorded for that file — the exact
    // "losing an entry" outcome the merge path is written to avoid — so the
    // normalizer throws and the caller reports exit 2. Measured against the
    // coercing version: it returned normally with the key's entries gone.
    const data = baselineWith({ 'src/a.ts': { type: 'Secret Keyword' } });
    expect(() => normalizeBaseline(data)).toThrow(TypeError);
  });

  it('refuses a null entry list', () => {
    const data = baselineWith({ 'src/a.ts': null });
    expect(() => normalizeBaseline(data)).toThrow(/expected an array/);
  });

  it('does not throw when a colliding array holds a non-object entry', () => {
    // A hand-edited or partially written baseline can contain `null`. The first
    // merge implementation dereferenced `entry.type` directly and threw a
    // TypeError, which the gate's `|| true` then swallowed — leaving the file
    // un-normalized while the comparison ran on mixed separators. Verified
    // against that implementation: it threw; this one keeps both entries.
    const data = baselineWith({
      [`src${BS}a.ts`]: [null],
      'src/a.ts': [entry('src/a.ts', 20, 'bbb')],
    });
    expect(() => normalizeBaseline(data)).not.toThrow();
    expect(data.results['src/a.ts']).toHaveLength(2);
    expect(data.results['src/a.ts'][1].line_number).toBe(20);
  });

  it('does not duplicate an entry that appears in both separator forms', () => {
    const data = baselineWith({
      [`src${BS}a.ts`]: [entry(`src${BS}a.ts`, 10, 'same')],
      'src/a.ts': [entry('src/a.ts', 10, 'same')],
    });
    normalizeBaseline(data);
    expect(data.results['src/a.ts']).toHaveLength(1);
  });

  it('reports 0 changes for an already-normal baseline', () => {
    const data = baselineWith({ 'src/a.ts': [entry('src/a.ts', 1)] });
    expect(normalizeBaseline(data)).toBe(0);
  });

  it('is idempotent: a second pass changes nothing', () => {
    const data = baselineWith({
      [`src${BS}sub${BS}a.ts`]: [entry(`src${BS}sub${BS}a.ts`, 7)],
    });
    normalizeBaseline(data);
    const once = JSON.stringify(data);
    const secondPass = normalizeBaseline(data);
    expect(secondPass).toBe(0);
    expect(JSON.stringify(data)).toBe(once);
  });

  it('tolerates a baseline with no results object', () => {
    expect(normalizeBaseline({})).toBe(0);
    expect(normalizeBaseline(null)).toBe(0);
  });
});

describe('CLI contract', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-norm-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (data) => {
    const p = path.join(dir, '.secrets.baseline');
    fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
    return p;
  };
  const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: dir });

  it('rewrites the file in place and reports the count', () => {
    const p = write(baselineWith({ [`src${BS}a.ts`]: [entry(`src${BS}a.ts`, 1)] }));
    const r = run([p]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/NORMALIZED/);
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(Object.keys(after.results)).toEqual(['src/a.ts']);
  });

  it('exits 2 — not 1, and no stack trace — on a malformed entry list', () => {
    // Exit 1 means "normalization needed", so a malformed baseline that exited
    // 1 would send a caller looking for a rewrite instead of a repair. The
    // uncaught TypeError this guards against printed a raw stack and exited 1
    // even under --check.
    const p = write(baselineWith({ 'src/a.ts': { type: 'Secret Keyword' } }));
    const r = run([p, '--check']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/FAIL — baseline is malformed/);
    expect(r.stderr).not.toMatch(/at Object\./);
  });

  it('--check exits 1 when normalization is needed, and leaves the file alone', () => {
    const p = write(baselineWith({ [`src${BS}a.ts`]: [entry(`src${BS}a.ts`, 1)] }));
    const original = fs.readFileSync(p, 'utf8');
    const r = run([p, '--check']);
    expect(r.status).toBe(1);
    expect(fs.readFileSync(p, 'utf8')).toBe(original);
  });

  it('--check exits 0 on an already-normal baseline', () => {
    const p = write(baselineWith({ 'src/a.ts': [entry('src/a.ts', 1)] }));
    expect(run([p, '--check']).status).toBe(0);
  });

  it('exits 2 — never 0 — when the baseline is missing', () => {
    // A missing baseline must not read as "already normalized".
    expect(run([path.join(dir, 'nope.json')]).status).toBe(2);
  });

  it('exits 2 on invalid JSON rather than silently rewriting garbage', () => {
    const p = path.join(dir, '.secrets.baseline');
    fs.writeFileSync(p, '{ not json');
    expect(run([p]).status).toBe(2);
  });

  it('produces a byte-identical file when run twice (the whole point)', () => {
    const p = write(baselineWith({ [`src${BS}a.ts`]: [entry(`src${BS}a.ts`, 1)] }));
    run([p]);
    const first = fs.readFileSync(p, 'utf8');
    run([p]);
    expect(fs.readFileSync(p, 'utf8')).toBe(first);
  });
});

/**
 * Line endings are part of "idempotent", not a cosmetic detail.
 *
 * Measured before this was handled: a 63307-byte CRLF baseline came back 61411
 * bytes with ALL 1896 lines changed, while the parsed JSON compared EQUAL. On
 * Windows that is #735 again with a different trigger — a whole-file diff that
 * hides real findings — so the ending is asserted rather than assumed.
 */
describe('line-ending fidelity', () => {
  const CRLF = String.fromCharCode(13, 10);
  const LF = String.fromCharCode(10);

  /** Write a baseline whose every newline is `eol`. */
  function writeWithEol(data, eol) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-eol-'));
    const p = path.join(dir, '.secrets.baseline');
    const body = JSON.stringify(data, null, 2).split(LF).join(eol);
    fs.writeFileSync(p, body + eol);
    return { dir, p };
  }

  const sample = () =>
    baselineWith({ [`src${BS}a.ts`]: [entry(`src${BS}a.ts`, 1)] });

  const runOn = (p) => spawnSync(process.execPath, [script, p], { encoding: 'utf8' });

  function countEol(text, eol) {
    return text.split(eol).length - 1;
  }

  it('preserves CRLF: no line is rewritten to a bare LF', () => {
    const { dir, p } = writeWithEol(sample(), CRLF);
    try {
      expect(runOn(p).status).toBe(0);
      const after = fs.readFileSync(p, 'utf8');
      // Every LF must be part of a CRLF pair.
      expect(countEol(after, CRLF)).toBe(countEol(after, LF));
      expect(countEol(after, LF)).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves an LF baseline as LF', () => {
    const { dir, p } = writeWithEol(sample(), LF);
    try {
      expect(runOn(p).status).toBe(0);
      expect(countEol(fs.readFileSync(p, 'utf8'), CRLF)).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is byte-identical on a second run for a CRLF baseline too', () => {
    const { dir, p } = writeWithEol(sample(), CRLF);
    try {
      runOn(p);
      const first = fs.readFileSync(p);
      runOn(p);
      expect(fs.readFileSync(p).equals(first)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not lose entries across a CRLF round-trip', () => {
    const data = sample();
    const before = Object.values(data.results).reduce((n, v) => n + v.length, 0);
    const { dir, p } = writeWithEol(data, CRLF);
    try {
      runOn(p);
      const after = JSON.parse(fs.readFileSync(p, 'utf8'));
      const count = Object.values(after.results).reduce((n, v) => n + v.length, 0);
      expect(count).toBe(before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
