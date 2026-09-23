/**
 * @test REQ-379 privacy-safe clipboard vision
 * @intent Verify one-shot clipboard image analysis enforces local-first privacy boundaries
 * @covers AC-379-01, AC-379-02, AC-379-03, AC-379-04, AC-379-05, AC-379-06
 */
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASH_SCRIPT = path.join(ROOT, 'scripts', 'clipboard-vision.sh');
const POWERSHELL_SCRIPT = path.join(ROOT, 'scripts', 'clipboard-vision.ps1');
const SECRET = 'cv-secret-must-never-leak';

function writeExecutable(file, content) {
  fs.writeFileSync(file, content, { mode: 0o755 });
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clipboard-vision-test-'));
  const bin = path.join(root, 'bin');
  const temp = path.join(root, 'temp');
  fs.mkdirSync(bin);
  fs.mkdirSync(temp);
  const image = path.join(root, 'clipboard.png');
  fs.writeFileSync(image, Buffer.from('89504e470d0a1a0a', 'hex'));
  const clipboardCount = path.join(root, 'clipboard-count');
  const curlCount = path.join(root, 'curl-count');
  const curlArgs = path.join(root, 'curl-args');
  const curlBody = path.join(root, 'curl-body');

  writeExecutable(path.join(bin, 'pngpaste'), `#!/usr/bin/env bash
set -euo pipefail
printf x >> "${clipboardCount}"
cp "${image}" "$1"
`);
  writeExecutable(path.join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
printf x >> "${curlCount}"
printf '%s\n' "$@" > "${curlArgs}"
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--data-binary' ]; then cp "\${2#@}" "${curlBody}"; shift 2; continue; fi
  if [ "$1" = '--output' ]; then output="$2"; shift 2; continue; fi
  if [ "$1" = '--write-out' ]; then shift 2; continue; fi
  shift
done
if [ -n "\${CV_FAKE_RESPONSE:-}" ]; then
  printf '%s' "$CV_FAKE_RESPONSE" > "$output"
else
  printf '%s' '{"choices":[{"message":{"content":"described safely"}}]}' > "$output"
fi
printf '%s' "\${CV_FAKE_STATUS:-200}"
`);

  return { root, bin, temp, image, clipboardCount, curlCount, curlArgs, curlBody };
}

function run(fixture, args = [], env = {}) {
  return spawnSync('bash', [BASH_SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      TMPDIR: fixture.temp,
      CLIPBOARD_VISION_MODEL: 'fixture-model',
      CLIPBOARD_VISION_API_KEY: SECRET,
      ...env,
    },
  });
}

function combined(result) {
  return `${result.stdout}${result.stderr}`;
}

function count(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').length : 0;
}

function consentToken(hostname, model, base = `https://${hostname}/v1`) {
  const url = new URL(base);
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  const normalizedHost = url.hostname.toLowerCase();
  const port = url.port || (scheme === 'https' ? '443' : '80');
  const displayHost = normalizedHost.includes(':') ? `[${normalizedHost}]` : normalizedHost;
  const endpoint = `${scheme}://${displayHost}:${port}${url.pathname.replace(/\/+$/, '')}/chat/completions`;
  return crypto.createHash('sha256').update(`${endpoint}\n${model}`, 'utf8').digest('hex');
}

function assertNoTempFiles(fixture) {
  expect(fs.readdirSync(fixture.temp)).toEqual([]);
}

describe('clipboard-vision Bash client', () => {
  let fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  it('fails without model configuration before reading clipboard or calling network', () => {
    const result = run(fixture, [], { CLIPBOARD_VISION_MODEL: '' });

    expect(result.status).not.toBe(0);
    expect(count(fixture.clipboardCount)).toBe(0);
    expect(count(fixture.curlCount)).toBe(0);
  });

  it('rejects a non-loopback endpoint in local mode before reading clipboard', () => {
    const result = run(fixture, [], { CLIPBOARD_VISION_API_BASE: 'https://vision.example.test/v1' });

    expect(result.status).not.toBe(0);
    expect(count(fixture.clipboardCount)).toBe(0);
    expect(count(fixture.curlCount)).toBe(0);
  });

  it('requires both remote opt-in and destination-bound confirmation', () => {
    const endpoint = { CLIPBOARD_VISION_API_BASE: 'https://vision.example.test/v1' };
    const optInOnly = run(fixture, ['--allow-remote'], endpoint);
    const confirmationOnly = run(fixture, ['--confirm-remote', consentToken('vision.example.test', 'fixture-model')], endpoint);

    expect(optInOnly.status).not.toBe(0);
    expect(confirmationOnly.status).not.toBe(0);
    expect(count(fixture.clipboardCount)).toBe(0);
    expect(count(fixture.curlCount)).toBe(0);
  });

  it('prints disclosure and expected token before rejecting missing confirmation', () => {
    const result = run(fixture, ['--allow-remote'], {
      CLIPBOARD_VISION_API_BASE: 'https://vision.example.test/v1',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('vision.example.test');
    expect(result.stderr).toContain('fixture-model');
    expect(result.stderr.toLowerCase()).toContain('image');
    expect(result.stderr).toContain(consentToken('vision.example.test', 'fixture-model'));
    expect(count(fixture.clipboardCount)).toBe(0);
    expect(count(fixture.curlCount)).toBe(0);
  });

  it('accepts the confirmation token bound to normalized hostname and exact model', () => {
    const token = consentToken('vision.example.test', 'fixture-model');
    const result = run(fixture, ['--allow-remote', '--confirm-remote', token], {
      CLIPBOARD_VISION_API_BASE: 'https://VISION.Example.Test/v1',
    });

    expect(result.status, combined(result)).toBe(0);
    expect(count(fixture.clipboardCount)).toBe(1);
    expect(count(fixture.curlCount)).toBe(1);
  });

  it('rejects a token for a changed destination before clipboard or network', () => {
    const staleToken = consentToken('old.example.test', 'fixture-model');
    const result = run(fixture, ['--allow-remote', '--confirm-remote', staleToken], {
      CLIPBOARD_VISION_API_BASE: 'https://vision.example.test/v1',
    });

    expect(result.status).not.toBe(0);
    expect(count(fixture.clipboardCount)).toBe(0);
    expect(count(fixture.curlCount)).toBe(0);
  });

  it('rejects a token for a changed model before clipboard or network', () => {
    const staleToken = consentToken('vision.example.test', 'old-model');
    const result = run(fixture, ['--allow-remote', '--confirm-remote', staleToken], {
      CLIPBOARD_VISION_API_BASE: 'https://vision.example.test/v1',
    });

    expect(result.status).not.toBe(0);
    expect(count(fixture.clipboardCount)).toBe(0);
    expect(count(fixture.curlCount)).toBe(0);
  });

  it('never exposes the API key in output or request JSON', () => {
    const result = run(fixture);

    expect(result.status, combined(result)).toBe(0);
    expect(combined(result)).not.toContain(SECRET);
    expect(fs.readFileSync(fixture.curlBody, 'utf8')).not.toContain(SECRET);
  });

  it('rejects oversized clipboard images before network access', () => {
    fs.writeFileSync(fixture.image, Buffer.alloc(33));
    const result = run(fixture, [], { CLIPBOARD_VISION_MAX_BYTES: '32' });

    expect(result.status).not.toBe(0);
    expect(count(fixture.curlCount)).toBe(0);
    assertNoTempFiles(fixture);
  });

  it('removes temporary files after success', () => {
    const result = run(fixture);

    expect(result.status, combined(result)).toBe(0);
    expect(result.stdout.trim()).toBe('described safely');
    assertNoTempFiles(fixture);
  });

  it('redacts API failure bodies and removes temporary files after failure', () => {
    const response = `upstream body contains ${SECRET}`;
    const result = run(fixture, [], { CV_FAKE_STATUS: '500', CV_FAKE_RESPONSE: response });

    expect(result.status).not.toBe(0);
    expect(combined(result)).not.toContain(response);
    expect(combined(result)).not.toContain(SECRET);
    assertNoTempFiles(fixture);
  });

  it('performs exactly one clipboard read and one request per explicit invocation', () => {
    const result = run(fixture);

    expect(result.status, combined(result)).toBe(0);
    expect(count(fixture.clipboardCount)).toBe(1);
    expect(count(fixture.curlCount)).toBe(1);
  });
});

describe('clipboard-vision PowerShell contract', () => {
  it('keeps credentials in the environment and enforces bound consent, bounds, and cleanup', () => {
    const content = fs.readFileSync(POWERSHELL_SCRIPT, 'utf8');

    expect(content).toMatch(/\$env:CLIPBOARD_VISION_API_KEY/);
    expect(content).toMatch(/AllowRemote/);
    expect(content).toMatch(/ConfirmRemote/);
    expect(content).toMatch(/SHA256/i);
    expect(content).toMatch(/CLIPBOARD_VISION_MAX_BYTES/);
    expect(content).toMatch(/finally\s*\{/i);
    expect(content).toMatch(/Remove-Item/);
    expect(content).not.toMatch(/https:\/\/(?!127\.0\.0\.1|localhost|\[::1\])/);
  });

  it('disables HTTP redirects so loopback cannot forward the clipboard body remotely', () => {
    const content = fs.readFileSync(POWERSHELL_SCRIPT, 'utf8');

    expect(content).toMatch(/MaximumRedirection\s+0/);
  });

  it('validates an absolute HTTP(S) URI without credentials before disclosure or seams', () => {
    const content = fs.readFileSync(POWERSHELL_SCRIPT, 'utf8');
    const validationPosition = content.indexOf('IsAbsoluteUri');
    const disclosurePosition = content.indexOf('Remote disclosure');
    const clipboardPosition = content.indexOf('CLIPBOARD_VISION_TEST_IMAGE');

    expect(validationPosition).toBeGreaterThan(0);
    expect(content).toMatch(/Scheme[^\n]+https?/i);
    expect(content).toMatch(/UserInfo/);
    expect(validationPosition).toBeLessThan(disclosurePosition);
    expect(validationPosition).toBeLessThan(clipboardPosition);
  });

  it('ships a discoverable Windows-CI executable behavior harness', () => {
    expect(fs.existsSync(path.join(ROOT, '__tests__', 'clipboard-vision.Tests.ps1'))).toBe(true);
  });

  it('wires the discoverable PowerShell harness into windows-latest CI', () => {
    let repoRoot = ROOT;
    while (!fs.existsSync(path.join(repoRoot, '.github', 'workflows', 'cross-platform-ci.yml'))) {
      repoRoot = path.dirname(repoRoot);
    }
    const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'cross-platform-ci.yml'), 'utf8');

    expect(workflow).toContain('windows-latest');
    expect(workflow).toContain('clipboard-vision.Tests.ps1');
    expect(workflow).toMatch(/shell:\s*pwsh/);
  });
});
