/**
 * @test REQ-ts-gate-startup tsx 直调（#779）
 * @intent 证明 TypeScript 门禁不再经 `npx -y tsx` 启动，而是用当前 node.exe 直接
 *   运行 tsx 的 cli.mjs。`npx -y` 每次都要重新解析包位置，实测 4.5-5.8s，而
 *   node 直调 0.79-0.82s —— 每道 TS 门禁白付约 4 秒。
 * @covers AC-TS-GATE-STARTUP-01, AC-TS-GATE-STARTUP-02, AC-TS-GATE-STARTUP-03, AC-TS-GATE-STARTUP-04
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveTsxInvocation } = require('../gate-runner');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-tsx-'));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Lay down a fake <root>/node_modules/tsx/dist/cli.mjs that exists and is readable.
 *
 * Failing here means the FIXTURE broke, not the resolver, so the error names the
 * fixture. Swallowing it would let a setup defect surface later as "the resolver
 * returned the npx fallback", which is a misleading diagnosis.
 */
function plantLocalTsx(root) {
  const cli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  try {
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, '// fake tsx cli' + String.fromCharCode(10));
  } catch (err) {
    throw new Error(`fixture: could not plant tsx cli at ${cli}: ${err.message}`);
  }
  return cli;
}

describe('resolveTsxInvocation — AC-TS-GATE-STARTUP-01', () => {
  it('uses node.exe + tsx/cli.mjs when a local tsx is installed', () => {
    const cli = plantLocalTsx(tmpDir);
    const { command, args } = resolveTsxInvocation(['gate.ts', '--run'], { cwd: tmpDir });

    expect(command).toBe(process.execPath);
    expect(args[0]).toBe(cli);
    expect(args.slice(1)).toEqual(['gate.ts', '--run']);
  });

  it('never puts `-y` in the argv — that is the npx network-retry flag', () => {
    plantLocalTsx(tmpDir);
    const { args } = resolveTsxInvocation(['gate.ts'], { cwd: tmpDir });
    expect(args).not.toContain('-y');
    expect(args).not.toContain('tsx');
  });
});

describe('resolveTsxInvocation — AC-TS-GATE-STARTUP-02', () => {
  it('walks up parent directories to find a hoisted node_modules/tsx', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    const cli = plantLocalTsx(tmpDir);

    const { args } = resolveTsxInvocation(['gate.ts'], { cwd: nested });
    expect(args[0]).toBe(cli);
  });

  it('falls back to npm npx-cli.js (still no shell) when no tsx is installed', () => {
    const { command, args } = resolveTsxInvocation(['gate.ts'], { cwd: tmpDir });

    // The fallback keeps the pre-existing no-shell guarantee: node.exe runs npx's
    // own JS entry. What must NOT happen is a bare `npx` (unresolvable without a
    // shell on Windows) or `shell: true` (cmd.exe's 8191-char ceiling, #586).
    expect(command).toBe(process.execPath);
    expect(args.some((a) => String(a).includes('npx-cli.js'))).toBe(true);
    expect(args).toContain('-y');
  });
});

describe('resolveTsxInvocation — AC-TS-GATE-STARTUP-03', () => {
  it('ignores a tsx dir that exists but has no cli.mjs (partial install)', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'tsx', 'dist'), { recursive: true });
    const { args } = resolveTsxInvocation(['gate.ts'], { cwd: tmpDir });
    expect(args.some((a) => String(a).includes('npx-cli.js'))).toBe(true);
  });

  it('produces a spawnable argv: an existing file for args[0] when local', () => {
    plantLocalTsx(tmpDir);
    const { command, args } = resolveTsxInvocation(['gate.ts'], { cwd: tmpDir });
    expect(command).toBe(process.execPath);
    expect(fs.existsSync(args[0])).toBe(true);
  });
});

describe('resolveTsxInvocation — AC-TS-GATE-STARTUP-04 (npm layout varies by install)', () => {
  /**
   * Restore `process.execPath` after the probe. Kept as a helper because the
   * override is only sound if it is undone even when an assertion throws, and an
   * unrestored execPath would corrupt every later test in this process.
   */
  function withExecPath(fakeNode, fn) {
    const real = process.execPath;
    Object.defineProperty(process, 'execPath', { value: fakeNode, configurable: true });
    try {
      return fn();
    } finally {
      Object.defineProperty(process, 'execPath', { value: real, configurable: true });
      delete require.cache[require.resolve('../gate-runner')];
    }
  }

  it('finds npm under lib/node_modules — the layout actions/setup-node produces on Linux', () => {
    // This is the shape CI actually runs on: /opt/hostedtoolcache/node/<v>/x64/bin/node
    // with npm's library at <...>/lib/node_modules/npm, not alongside the binary.
    // Probe order matters only because the plain layout is tried first; what this
    // asserts is that the `lib/` layout is tried at all.
    const root = path.join(tmpDir, 'node-install');
    const fakeNode = path.join(root, 'x64', 'bin', 'node');
    const libNpm = path.join(root, 'x64', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
    fs.mkdirSync(path.dirname(libNpm), { recursive: true });
    fs.writeFileSync(libNpm, '');

    withExecPath(fakeNode, () => {
      const { command, args } = resolveTsxInvocation(['gate.ts'], { cwd: tmpDir });
      // A bare `npx` here is the defect: unresolvable without a shell on Windows,
      // and a PATH hop that silently runs whatever npx happens to be first.
      expect(command).toBe(fakeNode);
      expect(args.some((a) => String(a).includes('npx-cli.js'))).toBe(true);
      expect(fs.existsSync(args[0])).toBe(true);
    });
  });

  it('finds npm alongside the binary — the Windows MSI / official tarball layout', () => {
    const root = path.join(tmpDir, 'win-install');
    const fakeNode = path.join(root, 'node.exe');
    const plainNpm = path.join(root, 'node_modules', 'npm', 'bin', 'npx-cli.js');
    fs.mkdirSync(path.dirname(plainNpm), { recursive: true });
    fs.writeFileSync(plainNpm, '');

    withExecPath(fakeNode, () => {
      const { command, args } = resolveTsxInvocation(['gate.ts'], { cwd: tmpDir });
      expect(command).toBe(fakeNode);
      expect(args.some((a) => String(a).includes('npx-cli.js'))).toBe(true);
    });
  });
});
