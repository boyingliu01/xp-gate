/**
 * @test C0-mattpocock-license-gate
 * @intent Verify check-mattpocock-license.cjs enforces the C0 publish gate:
 *         (a) valid MIT license → PASS (exit 0);
 *         (b) corrupted license → FAIL (exit 1), missing license → clean-room path (exit 2);
 *         (c) network failure with valid cache → offline fallback (exit 0, source "cache").
 *         All scenarios run hermetically: no real GitHub calls (local 404 server / --offline).
 * @covers AC-C0-01, AC-C0-02, AC-C0-03
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'check-mattpocock-license.cjs');

// Valid MIT license text (mirrors mattpocock/skills LICENSE, verified 2026-07-26).
const VALID_MIT_LICENSE = `MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const CORRUPTED_LICENSE = 'PROPRIETARY LICENSE\nAll rights reserved. Redistribution prohibited.\n';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'license-check-test-'));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Build hermetic env overrides so the script never touches the real network
 * or the real repo paths. Default URL points at a closed localhost port
 * (instant ECONNREFUSED) — individual tests override with a local 404 server.
 */
function buildEnv(tmpDir, licenseUrl) {
  return {
    ...process.env,
    XPGATE_LICENSE_URL: licenseUrl || 'http://127.0.0.1:9/LICENSE',
    XPGATE_LICENSE_CACHE: path.join(tmpDir, 'mattpocock-license.cache.md'),
    XPGATE_LICENSE_VERDICT: path.join(tmpDir, 'mattpocock-license-verdict.json'),
    XPGATE_CLEAN_ROOM_DECISION: path.join(tmpDir, 'clean-room-decision.json'),
  };
}

function runScript(args, env) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env,
    stdio: 'pipe',
    timeout: 30000,
  });
  const verdictPath = env.XPGATE_LICENSE_VERDICT;
  return {
    status: result.status,
    stderr: (result.stderr || Buffer.alloc(0)).toString(),
    stdout: (result.stdout || Buffer.alloc(0)).toString(),
    verdict: fs.existsSync(verdictPath) ? JSON.parse(fs.readFileSync(verdictPath, 'utf8')) : null,
  };
}

/** Start a localhost HTTP server that always returns 404 (fake dead license URL). */
function start404Server() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.statusCode = 404;
      res.end('Not Found');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/LICENSE` });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe('check-mattpocock-license (C0 gate)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  // ── Scenario (a): valid MIT license → PASS ────────────────────────────
  it('(a) exits 0 with PASS verdict when the cache holds a valid MIT license (--offline)', () => {
    const env = buildEnv(tmpDir);
    fs.writeFileSync(env.XPGATE_LICENSE_CACHE, VALID_MIT_LICENSE, 'utf8');

    const r = runScript(['--offline'], env);

    expect(r.status).toBe(0);
    expect(r.verdict).not.toBeNull();
    expect(r.verdict.verdict).toBe('PASS');
    expect(r.verdict.license_type).toBe('MIT');
    expect(r.verdict.source).toBe('cache');
    expect(r.verdict.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.verdict.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // ── Scenario (b): corrupted / missing LICENSE → FAIL ──────────────────
  it('(b1) exits 1 with FAIL verdict and clean-room mitigation when the license is corrupted', () => {
    const env = buildEnv(tmpDir);
    fs.writeFileSync(env.XPGATE_LICENSE_CACHE, CORRUPTED_LICENSE, 'utf8');

    const r = runScript(['--offline'], env);

    expect(r.status).toBe(1);
    expect(r.verdict).not.toBeNull();
    expect(r.verdict.verdict).toBe('FAIL');
    expect(r.stderr).toMatch(/clean-room/i);
  });

  it('(b2) exits 2 with clean-room rewrite instruction when the license is missing (404 + no cache)', async () => {
    const { server, url } = await start404Server();
    try {
      const env = buildEnv(tmpDir, url);
      // No cache file written → license entirely missing.

      const r = runScript([], env);

      // Exit 2 per MUST-DO §6: "LICENSE missing or unrecognizable" triggers the clean-room path.
      expect(r.status).toBe(2);
      expect(r.verdict).not.toBeNull();
      expect(r.verdict.verdict).toBe('FAIL');
      expect(r.verdict.source).toBe('none');
      expect(r.stderr).toMatch(/clean-room rewrite/i);
    } finally {
      await stopServer(server);
    }
  });

  // ── Scenario (c): offline fallback to cache ───────────────────────────
  it('(c) exits 0 with source "cache" when the network fails but a valid cache exists', async () => {
    const { server, url } = await start404Server();
    try {
      const env = buildEnv(tmpDir, url);
      fs.writeFileSync(env.XPGATE_LICENSE_CACHE, VALID_MIT_LICENSE, 'utf8');

      // No --offline flag: network is attempted first, fails (404), then falls back to cache.
      const r = runScript([], env);

      expect(r.status).toBe(0);
      expect(r.verdict).not.toBeNull();
      expect(r.verdict.verdict).toBe('PASS');
      expect(r.verdict.license_type).toBe('MIT');
      expect(r.verdict.source).toBe('cache');
      expect(r.stderr).toMatch(/offline cache/i);
    } finally {
      await stopServer(server);
    }
  });

  // ── --force-clean-room override ───────────────────────────────────────
  it('records a clean-room decision and exits 0 with --force-clean-room', () => {
    const env = buildEnv(tmpDir);
    // No cache, dead network URL — without the override this would exit 2.

    const r = runScript(['--force-clean-room'], env);

    expect(r.status).toBe(0);
    expect(fs.existsSync(env.XPGATE_CLEAN_ROOM_DECISION)).toBe(true);
    const decision = JSON.parse(fs.readFileSync(env.XPGATE_CLEAN_ROOM_DECISION, 'utf8'));
    expect(decision.decision).toBe('clean-room-rewrite');
    expect(decision.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── Unit tests for the pure validation function (in-process) ──────────────
describe('validateLicense (unit)', () => {
  const { validateLicense, sha256, EXIT_PASS, EXIT_FAIL, EXIT_MISSING } = require('../check-mattpocock-license.cjs');

  it('accepts a valid MIT license', () => {
    const result = validateLicense(VALID_MIT_LICENSE);
    expect(result.valid).toBe(true);
    expect(result.licenseType).toBe('MIT');
  });

  it('rejects a proprietary license', () => {
    const result = validateLicense(CORRUPTED_LICENSE);
    expect(result.valid).toBe(false);
  });

  it('rejects empty input', () => {
    expect(validateLicense('').valid).toBe(false);
    expect(validateLicense(null).valid).toBe(false);
  });

  it('computes a stable SHA-256 hex digest', () => {
    expect(sha256('MIT License')).toBe(sha256('MIT License'));
    expect(sha256('MIT License')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exports distinct exit code constants', () => {
    expect(EXIT_PASS).toBe(0);
    expect(EXIT_FAIL).toBe(1);
    expect(EXIT_MISSING).toBe(2);
  });
});
