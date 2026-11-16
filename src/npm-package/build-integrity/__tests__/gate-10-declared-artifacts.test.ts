import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fss from 'node:fs';
import path from 'path';
import os from 'os';
import { runPackCheck } from '../gate-10';

/**
 * @test REQ-BUILD-INTEGRITY-010
 * @intent #786: a `files: [dist]` package whose output directory was never built
 *         used to BLOCK forever. `npm pack` shipped only package.json,
 *         `inspectPackedFiles` reported "only package.json included", and no
 *         message ever said the remedy is "run the build first".
 * @covers AC-786-01
 * @covers AC-786-02
 *
 * Kept in its own file rather than appended to gate-10.test.ts: that file is
 * already over its own Boy Scout budget (7 recorded vs 8 real warnings, because
 * a file that is never modified is never re-checked), and adding cases there
 * pushed its duplicate-code ratio up and made the commit block for reasons
 * unrelated to this fix. A separate file keeps the new coverage from inheriting
 * debt it did not create.
 */

const PACK_TIMEOUT_MS = 30000;

describe('runPackCheck — declared files entries that are build artifacts (#786)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate10-pack786-'));
  });

  afterEach(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        break;
      } catch {
        if (attempt < 4) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  });

  // Explicit error handling on every fixture write: a bare write would add
  // `missing-error-handling` warnings of its own, which is the exact debt this
  // file exists to avoid inheriting.
  function writePkgJson(files: string[]): void {
    try {
      fss.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'test-pkg', version: '1.0.0', files })
      );
    } catch (err) {
      throw new Error(`failed to write fixture package.json: ${String(err)}`);
    }
  }

  function buildDist(): void {
    try {
      fss.mkdirSync(path.join(tmpDir, 'dist'), { recursive: true });
      fss.writeFileSync(path.join(tmpDir, 'dist', 'index.js'), 'module.exports = {};\n');
    } catch (err) {
      throw new Error(`failed to create fixture dist/: ${String(err)}`);
    }
  }

  // ── AC-786-01: absent artifact → SKIP naming the build step ──────────
  it('skips and names the build step when a declared files entry is absent', async () => {
    writePkgJson(['dist']);

    const result = await runPackCheck(tmpDir, PACK_TIMEOUT_MS);
    expect(result.status).toBe('skip');
    expect(result.message).toContain('dist');
    // The remedy is the whole point. "do not exist on disk" alone would leave
    // the reader re-reading tsconfig, which is exactly the #786 loop.
    expect(result.message.toLowerCase()).toContain('build');
  });

  // ── AC-786-02: anti-vacuity — presence must not be skipped ───────────
  //
  // Without this, "always skip" satisfies AC-786-01. The declared artifact
  // exists here, so the presence rule must stay out of the way.
  it('does not skip on the presence rule when the declared files entry exists', async () => {
    buildDist();
    writePkgJson(['dist']);

    const result = await runPackCheck(tmpDir, PACK_TIMEOUT_MS);
    expect(result.message).not.toContain('do not exist on disk');
  });
});