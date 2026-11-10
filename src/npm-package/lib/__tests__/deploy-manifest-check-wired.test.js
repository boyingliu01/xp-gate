/**
 * @test REQ-DEPLOY-001
 * @intent 证明「双投影」不是纸面设计：篡改生成物后 `--check` 必须非零退出，
 *   且 Gate 12b 真的会调用它。没有这个断言，`--check` 只是一个没人调用的函数，
 *   生成物会静默漂移回「11 处手写清单互不一致」的老问题（#789）。
 *
 *   两个断言缺一不可：
 *     (a) `checkProjection()` 面对被篡改的文件确实失败 —— 检测器本身有效；
 *     (b) pre-commit 里确实有调用它的代码 —— 检测器被接入了门禁。
 *   只测 (a) 会得到「一个正确但永不运行的检测器」，那正是本 sprint 要消灭的形态。
 * @covers AC-DEPLOY-13
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../../../..');
const GENERATOR = path.join(ROOT, 'scripts/generate-deploy-manifest.cjs');
const PROJECTION = path.join(ROOT, 'githooks/deploy-manifest.sh');
const PRE_COMMIT = path.join(ROOT, 'githooks/pre-commit');

const backups = [];

afterEach(() => {
  while (backups.length > 0) {
    const { file, content } = backups.pop();
    fs.writeFileSync(file, content);
  }
});

/** Run the generator CLI and capture its exit status without throwing. */
function runGenerator(args) {
  try {
    const stdout = execFileSync(process.execPath, [GENERATOR, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (err) {
    const stdout = typeof err.stdout === 'string' ? err.stdout : '';
    const stderr = typeof err.stderr === 'string' ? err.stderr : '';
    return { status: err.status ?? 1, output: `${stdout}${stderr}` };
  }
}

describe('deploy-manifest projection freshness is enforced, not just implemented', () => {
  it('AC-DEPLOY-13: --check exits 0 when the projection matches its source', () => {
    const result = runGenerator(['--check']);

    expect(result.status).toBe(0);
    expect(result.output).toContain('is current');
  });

  it('AC-DEPLOY-13: --check exits non-zero when the projection is tampered with', () => {
    const original = fs.readFileSync(PROJECTION, 'utf8');
    backups.push({ file: PROJECTION, content: original });
    // A single extra entry is exactly the drift shape that matters: someone
    // hand-edits the generated file instead of the source.
    fs.writeFileSync(PROJECTION, `${original}\nGATE_FILES+=('gate-does-not-exist.sh')\n`);

    const result = runGenerator(['--check']);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('STALE');
  });

  it('AC-DEPLOY-13: --check exits non-zero when the projection is missing', () => {
    const original = fs.readFileSync(PROJECTION, 'utf8');
    backups.push({ file: PROJECTION, content: original });
    fs.rmSync(PROJECTION);

    const result = runGenerator(['--check']);

    expect(result.status).not.toBe(0);
  });

  it('AC-DEPLOY-13: pre-commit actually invokes the generator with --check', () => {
    // The detector is only worth the lines it occupies if a gate runs it.
    // This asserts the wiring, which is the half that silently goes missing.
    const hook = fs.readFileSync(PRE_COMMIT, 'utf8');

    expect(hook).toContain('generate-deploy-manifest.cjs --check');
    // And it must be able to BLOCK: a call whose failure is swallowed would
    // reproduce the "gate that prints a verdict nobody consumes" defect.
    const callSite = hook.indexOf('generate-deploy-manifest.cjs --check');
    const tail = hook.slice(callSite, callSite + 600);
    expect(tail).toContain('exit 1');
  });

  it('AC-DEPLOY-13: the freshness check sits under a guard keyed on the manifest path', () => {
    // A source-text assertion alone can pass while the call sits in a branch
    // that never runs for a manifest edit (code-walkthrough R2, A3/F2/F-2).
    // This extracts the enclosing guard and proves it is keyed on the manifest,
    // so relocating the call into a dead branch fails the test.
    const hook = fs.readFileSync(PRE_COMMIT, 'utf8');
    const callSite = hook.indexOf('generate-deploy-manifest.cjs --check');

    expect(callSite).toBeGreaterThan(-1);
    const guardStart = hook.lastIndexOf('if printf', callSite);
    expect(guardStart).toBeGreaterThan(-1);
    const guard = hook.slice(guardStart, callSite);

    expect(guard).toContain('CHANGED_FILES');
    expect(guard).toContain('deploy-manifest\\.js');
  });

  it('AC-DEPLOY-13: no dead status assignment before the blocking exit', () => {
    // `exit 1` makes every later line unreachable, so a GATE_12_STATUS=WARN
    // written just before it would be dead -- the same "verdict nobody
    // consumes" defect the mirror half of Gate 12b documents at length.
    const hook = fs.readFileSync(PRE_COMMIT, 'utf8');
    const callSite = hook.indexOf('generate-deploy-manifest.cjs --check');
    const block = hook.slice(callSite, callSite + 900);
    const staleBranchEnd = block.indexOf('git add githooks/deploy-manifest.sh');

    expect(staleBranchEnd).toBeGreaterThan(-1);
    expect(block.slice(0, staleBranchEnd)).not.toContain('GATE_12_STATUS=');
  });
});
