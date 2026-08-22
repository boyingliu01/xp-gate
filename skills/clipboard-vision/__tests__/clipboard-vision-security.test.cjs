/**
 * @test REQ-379 clipboard vision security hardening
 * @intent Verify credential transport, endpoint-bound consent, literal loopback trust, and output no-follow behavior
 * @covers AC-379-02, AC-379-03, AC-379-04, AC-379-06
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'clipboard-vision.sh');
const POWERSHELL_SCRIPT = path.join(ROOT, 'scripts', 'clipboard-vision.ps1');
const DOC = path.join(ROOT, 'SKILL.md');
const SECRET = 'argv-secret-must-not-leak';

function canonicalDestination(base) {
  const url = new URL(base);
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  const hostname = url.hostname.toLowerCase();
  const port = url.port || (scheme === 'https' ? '443' : '80');
  const basePath = url.pathname.replace(/\/+$/, '') || '';
  const host = hostname.includes(':') ? `[${hostname}]` : hostname;
  return `${scheme}://${host}:${port}${basePath}/chat/completions`;
}

function token(base, model = 'fixture-model') {
  return crypto.createHash('sha256').update(`${canonicalDestination(base)}\n${model}`).digest('hex');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipboard-security-'));
  const bin = path.join(root, 'bin');
  const temp = path.join(root, 'temp');
  fs.mkdirSync(bin);
  fs.mkdirSync(temp);
  const image = path.join(root, 'image.png');
  fs.writeFileSync(image, Buffer.from('89504e470d0a1a0a', 'hex'));
  const argv = path.join(root, 'curl-argv');
  const authMode = path.join(root, 'auth-mode');
  const clipboard = path.join(root, 'clipboard-count');
  const network = path.join(root, 'network-count');
  fs.writeFileSync(path.join(bin, 'pngpaste'), `#!/usr/bin/env bash
printf x >> "${clipboard}"
cp "${image}" "$1"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!/usr/bin/env bash
printf x >> "${network}"
printf '%s\n' "$@" > "${argv}"
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--header' ] && [[ "$2" = @* ]]; then stat -c '%a' "\${2#@}" > "${authMode}"; shift 2; continue; fi
  if [ "$1" = '--output' ]; then out="$2"; shift 2; continue; fi
  if [ "$1" = '--write-out' ]; then shift 2; continue; fi
  shift
done
printf '%s' '{"choices":[{"message":{"content":"secure result"}}]}' > "$out"
printf 200
`, { mode: 0o755 });
  return { root, bin, temp, argv, authMode, clipboard, network };
}

function run(state, base, args = [], env = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${state.bin}:${process.env.PATH}`,
      TMPDIR: state.temp,
      CLIPBOARD_VISION_API_BASE: base,
      CLIPBOARD_VISION_MODEL: 'fixture-model',
      CLIPBOARD_VISION_API_KEY: SECRET,
      ...env,
    },
  });
}

function count(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').length : 0;
}

describe('clipboard-vision security boundaries', () => {
  let state;
  beforeEach(() => { state = fixture(); });
  afterEach(() => { fs.rmSync(state.root, { recursive: true, force: true }); });

  it('keeps API credentials out of curl argv and cleans restrictive auth files', () => {
    const result = run(state, 'http://127.0.0.1:11434/v1');

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(fs.readFileSync(state.argv, 'utf8')).not.toContain(SECRET);
    expect(fs.readFileSync(state.authMode, 'utf8').trim()).toBe('600');
    expect(fs.readdirSync(state.temp)).toEqual([]);
  });

  it.each([
    ['scheme', 'http://vision.example.test/v1'],
    ['port', 'https://vision.example.test:8443/v1'],
    ['path', 'https://vision.example.test/other'],
  ])('rejects a token after %s changes before clipboard or network', (_field, changedBase) => {
    const stale = token('https://vision.example.test/v1');
    const result = run(state, changedBase, ['--allow-remote', '--confirm-remote', stale]);

    expect(result.status).not.toBe(0);
    expect(count(state.clipboard)).toBe(0);
    expect(count(state.network)).toBe(0);
  });

  it('rejects query and fragment components before clipboard or network', () => {
    for (const base of ['https://vision.example.test/v1?tenant=a', 'https://vision.example.test/v1#fragment']) {
      const result = run(state, base, ['--allow-remote', '--confirm-remote', token('https://vision.example.test/v1')]);
      expect(result.status).not.toBe(0);
    }
    expect(count(state.clipboard)).toBe(0);
    expect(count(state.network)).toBe(0);
  });

  it('treats localhost as remote and literal IPv4 and IPv6 loopback as local', () => {
    const localhost = run(state, 'http://localhost:11434/v1');
    const ipv4 = run(state, 'http://127.9.8.7:11434/v1');
    const ipv6 = run(state, 'http://[::1]:11434/v1');

    expect(localhost.status).not.toBe(0);
    expect(ipv4.status, ipv4.stderr).toBe(0);
    expect(ipv6.status, ipv6.stderr).toBe(0);
  });

  it('reuses a stable token only for the same canonical endpoint and exact model', () => {
    const base = 'https://VISION.example.test/v1/';
    const confirmation = token(base);
    const first = run(state, base, ['--allow-remote', '--confirm-remote', confirmation]);
    const second = run(state, base, ['--allow-remote', '--confirm-remote', confirmation]);
    const changedModel = run(state, base, ['--allow-remote', '--confirm-remote', confirmation], { CLIPBOARD_VISION_MODEL: 'other-model' });

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(changedModel.status).not.toBe(0);
  });

  it('rejects --output and never writes a user-selected path', () => {
    const outputPath = path.join(state.root, 'output.txt');
    const result = run(state, 'http://127.0.0.1:11434/v1', ['--output', outputPath]);

    expect(result.status).not.toBe(0);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('documents stable consent artifact and no-follow output behavior', () => {
    const content = fs.readFileSync(DOC, 'utf8');
    expect(content).toContain('consent artifact');
    expect(content).toContain('canonical endpoint');
    expect(content).toContain('stdout-only');
    expect(content).toContain('not persisted');
  });

  it('documents the ephemeral mode-600 auth-header file and cleanup accurately', () => {
    const content = fs.readFileSync(DOC, 'utf8');
    expect(content).toContain('mode 600');
    expect(content).toContain('ephemeral auth-header file');
    expect(content).toContain('removed during cleanup');
    expect(content).not.toContain('Never put secrets in arguments, files, logs, or errors');
  });

  it('requires PowerShell behavior cases through the executable script seams', () => {
    const script = fs.readFileSync(POWERSHELL_SCRIPT, 'utf8');
    const harness = fs.readFileSync(path.join(ROOT, '__tests__', 'clipboard-vision.Tests.ps1'), 'utf8');
    expect(script).not.toMatch(/\$Output|Set-Content.*Result/);
    expect(script).not.toMatch(/\[string\]\$ConfirmRemote,\s*\)/);
    expect(harness).toContain('No output parameter');
    for (const marker of [
      'CV_TEST_MALFORMED_JSON',
      'CV_TEST_NON_STRING',
      'CV_TEST_HTTP_FAILURE',
      'CLIPBOARD_VISION_MAX_BYTES',
      'No output parameter',
      'http://localhost:',
      'http://[::1]:',
      'https://vision.example.test:8443/',
    ]) {
      expect(harness).toContain(marker);
    }
  });
});
