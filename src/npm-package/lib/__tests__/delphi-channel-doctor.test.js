/**
 * @test REQ-646
 * @intent 通道偏好必须**真正改变行为**，而不只是被读进来。这里跑的是真实的
 *         `doctorDelphi()`，检查它输出的 Qoder agent bindings 那一行。
 *
 *         问题原状：外部通道用户删掉三个 agent 之后得到 `✗ Qoder Delphi agent
 *         bindings: ... missing (run: xp-gate init --global)`。那是一条**会把机制
 *         重新装回来**的修复提示，而且判它 FAIL 等于告诉用户"你的可用配置坏了"。
 *
 *         所以这里钉的是两种状态的**区分**：配置关掉 -> SKIP 且理由写清来源；
 *         没配置 -> 该 FAIL 的照旧 FAIL。只钉前者会造出一个"永远跳过"的守卫，
 *         那和永远通过没有区别。
 * @covers AC-646-02, AC-646-04
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const doctor = require(path.join(REPO_ROOT, 'src/npm-package/lib/doctor.js'));

/** The single check whose behaviour #646 changes. */
const BINDING_CHECK = 'Qoder Delphi agent bindings';

describe('doctor 在 external-only 通道下的判定 (#646)', () => {
  let tmpDir;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-doctor-channel-'));
    // Point both the home dir and the XDG config root at the sandbox so the real
    // machine configuration can never leak into these assertions.
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    process.env.XDG_CONFIG_HOME = path.join(tmpDir, '.config');
    delete process.env.XP_GATE_DELPHI_CHANNEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeMachineConfig(body) {
    const dir = path.join(tmpDir, '.config', 'xp-gate');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.delphi-config.json'), JSON.stringify(body), 'utf8');
  }

  /**
   * Run the real `doctorDelphi()` and capture the line it prints.
   *
   * The function prints its own report and returns an exit code, so the assertion has
   * to go through stdout -- that is also the surface a user actually reads, which is
   * what #646 is about. Returns `undefined` when the check is absent from the report.
   */
  async function runChecks() {
    const written = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = (...args) => written.push(args.join(' '));
    console.warn = (...args) => written.push(args.join(' '));
    try {
      await doctor.doctorDelphi({ projectDir: tmpDir });
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }
    const line = written.find((l) => l.includes(BINDING_CHECK));
    if (line === undefined) return undefined;
    // doctor prints a GLYPH, never the status word: "✓" PASS, "✗" FAIL, "○" SKIP.
    // Matching on the word "SKIP" instead would read the ○ line as PASS, since its
    // detail sentence contains no FAIL marker -- i.e. the assertion would pass for
    // exactly the wrong reason.
    let status = 'PASS';
    if (line.includes('○')) status = 'SKIP';
    else if (line.includes('✗')) status = 'FAIL';
    return { status, detail: line };
  }

  it('AC-646-02: external-only reports SKIP, not FAIL, and names the source', async () => {
    writeMachineConfig({ channels: ['external'] });
    const check = await runChecks();
    expect(check).toBeDefined();
    expect(check.status).toBe('SKIP');
    expect(check.detail).toMatch(/native channel disabled/);
    // The reason must name where the setting came from: an unexplained SKIP is
    // indistinguishable from a broken install.
    expect(check.detail).toMatch(/via config/);
  });

  it('AC-646-02: the environment override is honoured by doctor too', async () => {
    process.env.XP_GATE_DELPHI_CHANNEL = 'external';
    const check = await runChecks();
    expect(check.status).toBe('SKIP');
    expect(check.detail).toMatch(/via env/);
  });

  it('AC-646-04: with no preference the check still FAILs — the guard is not a permanent skip', async () => {
    // No agent files exist in the sandbox, and no channel preference disables the
    // native path, so the original FAIL must survive. If this ever turns SKIP, the
    // #646 fix has swallowed the check instead of gating it.
    const check = await runChecks();
    expect(check).toBeDefined();
    expect(check.status).toBe('FAIL');
  });

  it('AC-646-02: an explicit native channel keeps the check active', async () => {
    writeMachineConfig({ channels: ['native', 'external'] });
    const check = await runChecks();
    expect(check.status).toBe('FAIL');
  });
});
