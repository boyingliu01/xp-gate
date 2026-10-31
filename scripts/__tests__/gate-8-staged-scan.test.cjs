/**
 * @test REQ-684
 * @intent Gate 8 的 CLI 必须扫描**暂存区**，而不是用 gitleaks 的 `--pre-commit`
 *         去走已提交历史——后者在 pre-commit 场景下扫描 0 字节并报告"无泄漏"，
 *         于是暂存区里的密钥能被钩子拦住却拦不住 CLI（#675）
 * @covers AC-684-01, AC-684-02
 *
 * 这组用例跑**真的 gitleaks**，断言的是「同一份暂存内容会不会被报出来」，
 * 而不是「传了哪个字符串」。断言参数等于把实现抄一遍：换一种同样正确的方式
 * 表达同一意图（比如换成 `protect --staged`）会被误判为回归，而参数拼错却
 * 可能因为测试里也拼错而双双通过。
 *
 * gitleaks 不在 PATH 上时整体 skip 而不是失败——它不是本仓库的运行时依赖。
 */
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * A GitLab PAT-shaped string for gitleaks' `gitlab-pat` rule to detect.
 *
 * Assembled at runtime rather than written as one literal: this repository runs
 * Gate 8 (gitleaks) on its own commits, and it correctly flags a literal here as
 * a leaked credential. Splitting the prefix keeps the fixture indistinguishable
 * to gitleaks inside the temp repo while not tripping the scan of this file.
 */
const FAKE_SECRET = 'GITLAB_TOKEN = "' + ['glpat', 'abcdefghij', '1234567890'].join('-') + '"\n';

function gitleaksAvailable() {
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  return probe.status === 0 && !probe.error;
}

/** Run gitleaks with the given subcommand args over a repo holding one staged secret. */
function scanWith(args) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-g8-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Gate 8 Test'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'secrets.py'), FAKE_SECRET);
    execFileSync('git', ['add', 'secrets.py'], { cwd: repo });

    const report = path.join(repo, 'report.json');
    const result = spawnSync(
      'gitleaks',
      ['git', ...args, '--redact', '--no-banner', '--report-format=json', `--report-path=${report}`],
      { cwd: repo, encoding: 'utf8' }
    );
    let findings = [];
    try {
      findings = JSON.parse(fs.readFileSync(report, 'utf8'));
    } catch {
      findings = [];
    }
    return { status: result.status, findings, stdout: result.stdout + result.stderr };
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

describe('gate-8 gitleaks invocation (#675)', () => {
  const available = gitleaksAvailable();

  it.skipIf(!available)('AC-684-01: scanning with --staged finds a secret sitting in the index', () => {
    const { findings } = scanWith(['--staged']);
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBeGreaterThan(0);
  });

  it.skipIf(!available)('AC-684-02: --pre-commit misses it, which is why the CLI must not use it', () => {
    // Pins the actual defect rather than the fix: this is the behaviour that made
    // the CLI pass. If a future gitleaks changes it, this test tells us the reason
    // we switched has expired -- it does not silently keep passing.
    const { findings, stdout } = scanWith(['--pre-commit']);
    expect(findings.length).toBe(0);
    expect(stdout).toMatch(/0 commits scanned|no leaks found/i);
  });

  it('AC-684-01: the CLI source scans the index rather than committed history', () => {
    // A static backstop for environments without gitleaks: the subcommand flag the
    // gate passes must be one that reads the index. Kept narrow on purpose -- it
    // asserts the flag exists, not how the argument list is assembled.
    const src = fs.readFileSync(path.join(__dirname, '../../src/gates/gate-8.ts'), 'utf8');
    expect(src).toMatch(/['"]--staged['"]/);
    expect(src).not.toMatch(/['"]--pre-commit['"]/);
  });
});
