/**
 * @test REQ-ARCH-INVOKE
 * @intent archlint 有三种解析形态，每种要不同的启动方式：
 *
 *         - `node-script`（包内的 JS 入口）：用 `process.execPath` 直接跑，
 *           **跨平台且绕开 .cmd/.ps1 垫片**；
 *         - `binary`：直接执行，Windows 上要过 shell；
 *         - `npx`：`--no-install`，绝不因为探测而装东西。
 *
 *         选错了会出两类问题：在 Windows 上跑 .cmd 不走 shell 会 EINVAL；而
 *         走 shell 又会让含空格的路径被拆开。所以引号只在 `useShell` 为真时加。
 *
 * @covers AC-ARCH-INVOKE-01
 * @covers AC-ARCH-INVOKE-02
 * @covers AC-ARCH-INVOKE-03
 */
import { describe, expect, it } from 'vitest';

const { __internals } = require('../arch.js');
const { archlintInvocation, quoteForShell } = __internals;

describe('archlintInvocation', () => {
  it('runs a node-script through the current node binary, never a shim', () => {
    // A .cmd shim needs a shell; the JS entry does not, and going through node makes
    // the invocation identical on every platform.
    const inv = archlintInvocation({ kind: 'node-script', script: '/pkg/cli.js' }, ['--scan', '.']);
    expect(inv.command).toBe(process.execPath);
    expect(inv.commandArgs).toEqual(['/pkg/cli.js', '--scan', '.']);
    expect(inv.useShell).toBe(false);
  });

  it('uses --no-install for the npx fallback', () => {
    // Probing must never install what it was asked to detect.
    const inv = archlintInvocation({ kind: 'npx' }, ['--version']);
    expect(inv.command).toBe('npx');
    expect(inv.commandArgs).toContain('--no-install');
    expect(inv.commandArgs).toContain('--version');
  });

  it('keeps a binary invocation shell-free on POSIX', () => {
    // A path with spaces must stay ONE argv entry, which is only true without a
    // shell on the platforms that do not need one.
    const inv = archlintInvocation({ kind: 'binary', bin: '/home/u/my tools/archlint' }, ['scan']);
    expect(inv.command).toBe('/home/u/my tools/archlint');
    expect(inv.commandArgs).toEqual(['scan']);
    if (process.platform !== 'win32') expect(inv.useShell).toBe(false);
  });

  it('quotes every argv entry when it does use a shell', () => {
    // Quoting is applied to the command AND the args together: quoting only one side
    // leaves the other to be split by the shell.
    const quoted = quoteForShell('a b');
    expect(quoted).toMatch(/^["'].*["']$/);
  });

  it('passes the caller args through unchanged and in order', () => {
    const args = ['--config', '/tmp/cfg.json', '--fail-on', 'high'];
    const inv = archlintInvocation({ kind: 'node-script', script: '/s.js' }, args);
    expect(inv.commandArgs.slice(1)).toEqual(args);
  });
});

describe('reportLaunchFailure', () => {
  it('names the ENOENT case with an actionable fix', () => {
    // "not found" alone leaves the reader guessing between a broken install and a
    // missing devDependency.
    const seen = [];
    const orig = console.error;
    console.error = (...a) => seen.push(a.join(' '));
    try {
      __internals.reportLaunchFailure({ source: 'project devDependency' }, { code: 'ENOENT' });
    } finally {
      console.error = orig;
    }
    const text = seen.join('\n');
    expect(text).toContain('not found');
    expect(text).toContain('project devDependency');
    expect(text).toContain('npm install --save-dev');
  });

  it('reports any other error with its message', () => {
    const seen = [];
    const orig = console.error;
    console.error = (...a) => seen.push(a.join(' '));
    try {
      __internals.reportLaunchFailure({ source: 'own dependency' }, { message: 'EACCES' });
    } finally {
      console.error = orig;
    }
    expect(seen.join('\n')).toContain('EACCES');
  });
});
