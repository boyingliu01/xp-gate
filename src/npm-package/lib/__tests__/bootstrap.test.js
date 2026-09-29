const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bootstrap } = require('../bootstrap.js');

const GATE_TOOLS = ['jscpd', 'lizard', 'checkov', 'hadolint', 'gitleaks', 'semgrep', 'npx', 'jq'];

describe('bootstrap', () => {
  let consoleLogSpy;
  let realPath;
  let stubDir;

  // The module mocks these tests used to declare were never applied: bootstrap.js
  // is CommonJS, so its internal require of detect-deps.js bypasses the mock
  // registry and every case fell through to the real installer (global npm/pip
  // installs, ~60s in CI). Stubbing the tools on PATH exercises the real
  // detection path without touching the environment.
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    realPath = process.env.PATH;
    stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-bootstrap-'));
    for (const tool of GATE_TOOLS) {
      const stub = path.join(stubDir, process.platform === 'win32' ? `${tool}.cmd` : tool);
      fs.writeFileSync(stub, process.platform === 'win32' ? '@echo 1.0.0\r\n' : '#!/bin/sh\necho 1.0.0\n');
      if (process.platform !== 'win32') fs.chmodSync(stub, 0o755);
    }
    process.env.PATH = `${stubDir}${path.delimiter}${realPath}`;
  });

  afterEach(() => {
    process.env.PATH = realPath;
    fs.rmSync(stubDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns 0 when --dry-run given with no missing tools', () => {
    const code = bootstrap(['--dry-run']);
    expect(code).toBe(0);
  });

  it('returns 0 when all CLI tools are available', () => {
    const code = bootstrap([]);
    expect(code).toBe(0);
  });

  it('accepts --lang ts parameter', () => {
    const code = bootstrap(['--lang', 'ts']);
    expect(code).toBe(0);
  });

  it('accepts --lang ts,py parameter', () => {
    const code = bootstrap(['--lang', 'ts,py']);
    expect(code).toBe(0);
  });

  it('recognizes --verbose flag without error', () => {
    const code = bootstrap(['--verbose']);
    expect(code).toBe(0);
  });
});
