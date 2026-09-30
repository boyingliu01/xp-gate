/**
 * @test REQ-010-04 dependency lockfile registry pinning
 * @intent Verify the committed root lockfile carries no mirror registry host, so CI installs never depend on a third-party mirror
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

const LOCK_PATH = path.resolve(__dirname, '../../package-lock.json');
const CANONICAL_REGISTRY_HOST = 'registry.npmjs.org';

describe('root package-lock registry pinning', () => {
  let resolved;

  beforeAll(() => {
    let lock;
    try {
      lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    } catch (error) {
      throw new Error(`cannot parse ${LOCK_PATH}: ${error.message}`);
    }
    expect(lock.lockfileVersion).toBe(3);
    resolved = Object.entries(lock.packages || {}).filter(([, meta]) => meta.resolved);
  });

  it('inspects a non-trivial set of resolved tarballs', () => {
    // Canary against a silent no-op (renamed field, truncated or replaced lock).
    expect(resolved.length).toBeGreaterThan(100);
  });

  it('resolves every registry tarball from an approved host', () => {
    const offenders = [];
    for (const [name, meta] of resolved) {
      let url;
      try {
        url = new URL(meta.resolved);
      } catch (error) {
        offenders.push(`${name} -> unparseable (${meta.resolved})`);
        continue;
      }
      // git+ssh://, git://, file: etc. are not registry downloads.
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        continue;
      }
      if (url.host !== CANONICAL_REGISTRY_HOST) {
        offenders.push(`${name} -> ${url.host}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
