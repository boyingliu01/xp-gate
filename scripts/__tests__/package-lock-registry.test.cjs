/**
 * @test REQ-010-04 dependency lockfile registry pinning
 * @intent Verify the committed root lockfile carries no mirror registry host, and that the offline repair tool rewrites hosts only
 * @covers AC-010-04
 *
 * Scope: root package-lock.json only. src/npm-package ships zero dependencies,
 * and plugins/opencode/package-lock.json is a gitignored build artifact.
 * Annotation note: the REQ-010-* family is a scripts/ guard convention that
 * specification.yaml does not define (it carries REQ-DSH-*); documented in
 * docs/plans/2026-09-30-package-lock-registry-normalization.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeLockRegistry,
  findRegistryOffenders,
  CANONICAL_REGISTRY_HOST,
} = require('../normalize-lock-registry.cjs');

const LOCK_PATH = path.resolve(__dirname, '../../package-lock.json');

function offenderLines(text) {
  return findRegistryOffenders(text).map((o) => `${o.name} -> ${o.host}`);
}

describe('root package-lock registry pinning', () => {
  let lockText;
  let resolvedCount;

  beforeAll(() => {
    try {
      lockText = fs.readFileSync(LOCK_PATH, 'utf8');
    } catch (error) {
      throw new Error(`cannot read ${LOCK_PATH}: ${error.message}`);
    }
    let lock;
    try {
      lock = JSON.parse(lockText);
    } catch (error) {
      throw new Error(`cannot parse ${LOCK_PATH}: ${error.message}`);
    }
    // Fail loudly if npm changes the lock shape the guard and the tool rely on.
    expect(lock.lockfileVersion).toBe(3);
    resolvedCount = Object.values(lock.packages || {}).filter((meta) => meta.resolved).length;
  });

  it('inspects a non-trivial set of resolved tarballs', () => {
    // Canary against a silent no-op (renamed field, truncated or replaced lock).
    expect(resolvedCount).toBeGreaterThan(100);
  });

  it('resolves every registry tarball from the canonical host', () => {
    const offenders = offenderLines(lockText);
    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} resolved entries outside ${CANONICAL_REGISTRY_HOST}:\n` +
          `  ${offenders.slice(0, 5).join('\n  ')}\n` +
          'Fix: npm run normalize-lock (host-only rewrite, offline-safe)',
      );
    }
    expect(offenders).toEqual([]);
  });
});

describe('normalizeLockRegistry', () => {
  function lockWith(resolvedUrl) {
    return `${JSON.stringify(
      {
        name: 'fixture',
        lockfileVersion: 3,
        packages: {
          '': { name: 'fixture', version: '1.0.0' },
          'node_modules/pkg': { version: '1.0.0', resolved: resolvedUrl, integrity: 'sha512-abc=' },
        },
      },
      null,
      2,
    )}\n`;
  }

  const mirrorUrl = 'https://registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz';
  const canonicalUrl = 'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz';

  it('rewrites the host and nothing else', () => {
    const input = lockWith(mirrorUrl);
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(1);
    expect(result.remaining).toEqual([]);
    expect(result.text).toContain(canonicalUrl);

    const inputLines = input.split('\n');
    const outputLines = result.text.split('\n');
    expect(outputLines.length).toBe(inputLines.length);
    expect(inputLines.filter((line, i) => line !== outputLines[i])).toEqual([
      '      "resolved": "https://registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz",',
    ]);
    expect(outputLines).toContain('      "integrity": "sha512-abc="');
  });

  it('handles CRLF lockfiles without silently no-oping', () => {
    const input = lockWith(mirrorUrl).replace(/\n/g, '\r\n');
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(1);
    expect(result.text.includes('\r\n')).toBe(true);
    expect(offenderLines(result.text)).toEqual([]);
    expect(result.text.replace(/\r\n/g, '\n')).toBe(normalizeLockRegistry(lockWith(mirrorUrl)).text);
  });

  it('rewrites regardless of value formatting', () => {
    const compact = '{"packages":{"a":{"resolved":"https://registry.npmmirror.com/a/-/a-1.tgz"}}}\n';
    expect(normalizeLockRegistry(compact).changed).toBe(1);
    expect(offenderLines(normalizeLockRegistry(compact).text)).toEqual([]);
  });

  it('drops ports and credentials when rewriting to the canonical host', () => {
    for (const url of [
      'https://registry.npmmirror.com:443/pkg/-/pkg-1.0.0.tgz',
      'https://token@registry.npmmirror.com/pkg/-/pkg-1.0.0.tgz',
    ]) {
      const result = normalizeLockRegistry(lockWith(url));
      expect(result.changed).toBe(1);
      expect(result.text).toContain(canonicalUrl);
      expect(result.text).not.toContain(url);
      expect(result.remaining).toEqual([]);
    }
  });

  it('counts every occurrence of a shared tarball URL', () => {
    const input = `${JSON.stringify({
      lockfileVersion: 3,
      packages: {
        pkg: { version: '1.0.0', resolved: mirrorUrl, integrity: 'sha512-abc=' },
        'node_modules/pkg': { version: '1.0.0', resolved: mirrorUrl, integrity: 'sha512-abc=' },
      },
    })}\n`;
    const result = normalizeLockRegistry(input);

    expect(result.changed).toBe(2);
    expect(result.text).not.toContain('npmmirror');
    expect(offenderLines(result.text)).toEqual([]);
  });

  it('rewrites the legacy dependencies tree too', () => {
    const legacy = `${JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        a: {
          resolved: 'https://registry.npmmirror.com/a/-/a-1.tgz',
          dependencies: { b: { resolved: 'https://registry.npmmirror.com/b/-/b-2.tgz' } },
        },
      },
    })}\n`;
    const result = normalizeLockRegistry(legacy);

    expect(result.changed).toBe(2);
    expect(offenderLines(result.text)).toEqual([]);
  });

  it('leaves hosts it cannot vouch for in place and reports them', () => {
    const result = normalizeLockRegistry(
      lockWith('https://mirror.example.com/pkg/-/pkg-1.0.0.tgz'),
    );

    expect(result.changed).toBe(0);
    expect(result.remaining).toEqual(['node_modules/pkg -> mirror.example.com']);
    expect(result.text).toContain('https://mirror.example.com/pkg/-/pkg-1.0.0.tgz');
  });

  it('ignores non-registry sources and canonical hosts carrying a port', () => {
    for (const url of [
      'git+ssh://git@github.com/acme/pkg.git#v1.0.0',
      'file:../local/pkg',
      'https://registry.npmjs.org:443/pkg/-/pkg-1.0.0.tgz',
    ]) {
      const input = lockWith(url);
      const result = normalizeLockRegistry(input);

      expect(result.changed).toBe(0);
      expect(result.remaining).toEqual([]);
      expect(result.text).toBe(input);
    }
  });

  it('is idempotent', () => {
    const once = normalizeLockRegistry(lockWith(mirrorUrl)).text;
    const twice = normalizeLockRegistry(once);

    expect(twice.changed).toBe(0);
    expect(twice.text).toBe(once);
  });

  it('refuses to rewrite a lockfile it cannot parse', () => {
    expect(() => normalizeLockRegistry('{"lockfileVersion": 3, "packages":')).toThrow();
  });
});
