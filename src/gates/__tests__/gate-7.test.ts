/**
 * @test REQ-619
 * @intent Gate 7 decides PASS / SKIP / FAIL from IaC file detection, adapter presence and
 *        checkov availability. Those three inputs are all environment-dependent, so each
 *        verdict branch needs a case that controls them explicitly — otherwise the gate's
 *        fail-open behaviour is unobserved and a regression ships silently.
 * @covers AC-619-01, AC-619-02, AC-619-03
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const isToolAvailable = vi.fn();
const runTool = vi.fn();
const recordAudit = vi.fn();

vi.mock('../common', () => ({
  isToolAvailable: (...args: unknown[]) => isToolAvailable(...args),
  runTool: (...args: unknown[]) => runTool(...args),
  recordAudit: (...args: unknown[]) => recordAudit(...args),
  filterIaCFiles: (files: string[]) =>
    files.filter((f) => /\.(tf|tfvars|yaml|yml|dockerfile)$/i.test(f) || /(^|\/)Dockerfile$/.test(f)),
  getChangedFiles: () => [],
  detectProjectLang: () => 'typescript',
}));

const { runGate7 } = await import('../gate-7');

/** A temp cwd containing (or not) the n/a IaC adapter script. */
async function tmpCwd(withAdapter: boolean): Promise<string> {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate7-'));
    if (withAdapter) {
      const adapterDir = path.join(dir, 'githooks', 'adapters');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(path.join(adapterDir, 'iac.sh'), '#!/bin/bash\nexit 0\n');
    }
    return dir;
  } catch (error) {
    throw new Error(`could not build the Gate 7 fixture tree: ${String(error)}`);
  }
}

/** A Dockerfile path: unambiguously IaC for the filter, no YAML ambiguity. */
const IAC_FILE = 'deploy/Dockerfile';

/** Exit code the fixtures use to mean "the scanner found problems". */
const CHECKOV_FINDINGS_EXIT = 3;

beforeEach(() => {
  isToolAvailable.mockReset();
  runTool.mockReset();
  recordAudit.mockReset();
});

describe('Gate 7 — IaC security verdicts', () => {
  it('passes without running anything when no IaC file changed', async () => {
    const cwd = await tmpCwd(true);
    const result = runGate7({ changedFiles: ['src/app.ts'], projectLang: 'typescript', cwd });

    expect(result.status).toBe('PASS');
    expect(result.exitCode).toBe(0);
    // The gate must not shell out at all when there is nothing to scan — that is what
    // keeps it free on ordinary commits.
    expect(runTool).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith('gate-7', 'iac-security', 'PASS', 0, expect.any(Number));
  });

  it('skips when an IaC file changed but neither checkov nor an adapter is available', async () => {
    const cwd = await tmpCwd(false);
    // #650: checkov is consulted FIRST, so "no adapter" only means SKIP once the
    // preferred engine has also been ruled out. Without this the gate would skip
    // a scan it could have run.
    isToolAvailable.mockReturnValue({ available: false });
    const result = runGate7({ changedFiles: [IAC_FILE], projectLang: 'typescript', cwd });

    // SKIP, not PASS: no adapter means the scan did not happen, and reporting PASS would
    // claim a check that never ran (the project's "tool missing => SKIP" convention).
    expect(result.status).toBe('SKIP');
    expect(result.exitCode).toBe(0);
    expect(result.messages.join('\n')).toContain('IaC adapter not found');
    expect(runTool).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith('gate-7', 'iac-security', 'SKIP', 0, expect.any(Number));
  });

  it('runs the adapter via bash when checkov is unavailable', async () => {
    const cwd = await tmpCwd(true);
    isToolAvailable.mockReturnValue({ available: false });
    runTool.mockReturnValue({ stdout: 'scan ok', stderr: '', exitCode: 0 });

    const result = runGate7({ changedFiles: [IAC_FILE], projectLang: 'typescript', cwd });

    expect(isToolAvailable).toHaveBeenCalledWith('checkov', cwd);
    const [cmd, args] = runTool.mock.calls[0];
    expect(cmd).toBe('bash');
    expect(args[0]).toMatch(/iac\.sh$/);
    expect(args).toContain(IAC_FILE);
    expect(result.status).toBe('PASS');
    expect(result.messages.join('\n')).toContain('checkov not installed');
  });

  it('fails when the fallback adapter reports a security problem', async () => {
    const cwd = await tmpCwd(true);
    isToolAvailable.mockReturnValue({ available: false });
    runTool.mockReturnValue({ stdout: '', stderr: 'CKV_AWS_1: S3 bucket is public', exitCode: CHECKOV_FINDINGS_EXIT });

    const result = runGate7({ changedFiles: [IAC_FILE], projectLang: 'typescript', cwd });

    expect(result.status).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    // The tool's own output must reach the user; a FAIL with no findings is unactionable.
    expect(result.messages.join('\n')).toContain('CKV_AWS_1');
    expect(recordAudit).toHaveBeenCalledWith('gate-7', 'iac-security', 'FAIL', CHECKOV_FINDINGS_EXIT, expect.any(Number));
  });

  it('passes when checkov is available and reports no findings', async () => {
    const cwd = await tmpCwd(true);
    isToolAvailable.mockReturnValue({ available: true, path: '/usr/bin/checkov', via: 'path' });
    runTool.mockReturnValue({ stdout: 'no problems', stderr: '', exitCode: 0 });

    const result = runGate7({ changedFiles: [IAC_FILE], projectLang: 'typescript', cwd });

    const [cmd, args] = runTool.mock.calls[0];
    expect(cmd).toBe('/usr/bin/checkov');
    expect(args).toContain('--file');
    expect(args).toContain(IAC_FILE);
    expect(result.status).toBe('PASS');
  });

  it('fails when checkov reports findings', async () => {
    const cwd = await tmpCwd(true);
    isToolAvailable.mockReturnValue({ available: true, path: '/usr/bin/checkov', via: 'path' });
    runTool.mockReturnValue({ stdout: 'CKV_DOCKER_2: no healthcheck', stderr: '', exitCode: 1 });

    const result = runGate7({ changedFiles: [IAC_FILE], projectLang: 'typescript', cwd });

    expect(result.status).toBe('FAIL');
    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('CKV_DOCKER_2');
  });

  it('uses npx checkov when the tool resolves via npx', async () => {
    // `via === 'npx'` selects a DIFFERENT command than the resolved path. Passing the path
    // would work locally and fail on a clean machine, which is why the branch is pinned.
    const cwd = await tmpCwd(true);
    isToolAvailable.mockReturnValue({ available: true, path: 'checkov', via: 'npx' });
    runTool.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 });

    runGate7({ changedFiles: [IAC_FILE], projectLang: 'typescript', cwd });

    const [cmd, args] = runTool.mock.calls[0];
    expect(cmd).toBe('npx');
    expect(args).toEqual(expect.arrayContaining(['-y', 'checkov']));
  });

  it('passes the project .checkov.yaml to checkov when one exists', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const cwd = await tmpCwd(true);
    try {
      fs.writeFileSync(path.join(cwd, '.checkov.yaml'), 'quiet: true\n');
    } catch (error) {
      throw new Error(`could not write the checkov config fixture: ${String(error)}`);
    }
    isToolAvailable.mockReturnValue({ available: true, path: '/usr/bin/checkov', via: 'path' });
    runTool.mockReturnValue({ stdout: '', stderr: '', exitCode: 0 });

    runGate7({ changedFiles: [IAC_FILE], projectLang: 'typescript', cwd });

    const [, args] = runTool.mock.calls[0];
    const configIdx = (args as string[]).indexOf('--config-file');
    expect(configIdx).toBeGreaterThanOrEqual(0);
    expect(args[configIdx + 1]).toContain('.checkov.yaml');
  });
});
