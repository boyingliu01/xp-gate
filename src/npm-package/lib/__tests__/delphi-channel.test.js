/**
 * @test REQ-646
 * @intent native Delphi 通道在 Qoder 上**已被实测证伪**：subagent 派发采纳 agent 的提示词，
 *         却丢弃 model 绑定，三席永远跑会话模型。2026-09-23 复测记录写在
 *         `skills/delphi-review/SKILL.md` 里——三份 agent 分别绑 qfmodel / dfmodel / gfmodel，
 *         新会话后 `turn.started` / `model.request.started` / `model.response.completed`
 *         三处的 model **全为会话模型**，dfmodel / gfmodel 出现 0 次。
 *
 *         结论：native 通道只能产出"同模型三角色自查"，**不构成多模型交叉验证证据**，
 *         也不能用作 Gate MW 的三模型凭据。
 *
 *         然而安装路径无条件部署它、doctor 强制要求它存在。于是外部通道用户删掉三个
 *         agent 换来的是一盏红灯 + 一条会把机制重新装回来的修复提示。"关掉它"在产品层面
 *         无路可走——这是本测试要钉住的东西。
 *
 *         设计要点：偏好读 #541 确立的**机器级唯一事实源**，不是项目文件。通道选择是
 *         "这台机器上 Delphi 怎么跑"，与具体仓库无关；放进项目 files 会让每个仓库各写一遍。
 * @covers AC-646-01, AC-646-02, AC-646-03
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

describe('Delphi 通道偏好 (#646)', () => {
  let channel;
  let tmpHome;
  let originalEnv;

  beforeAll(() => {
    channel = require(path.join(REPO_ROOT, 'src/npm-package/lib/delphi-channel.js'));
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-channel-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  /** Writes a machine-level config file the way #541 lays it out. */
  function writeMachineConfig(body) {
    const dir = path.join(tmpHome, '.config', 'xp-gate');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.delphi-config.json'), JSON.stringify(body), 'utf8');
    return dir;
  }

  it('AC-646-01: an explicit channels preference is honoured', () => {
    writeMachineConfig({ channels: ['external'] });
    expect(channel.resolveChannels({ home: tmpHome })).toEqual({
      channels: ['external'],
      source: 'config',
      nativeEnabled: false,
    });
  });

  it('AC-646-01: the environment variable wins over the config file', () => {
    // The env var is the escape hatch for CI and one-off runs; a file cannot be
    // changed from a test harness, so it must lose to an explicit env setting.
    writeMachineConfig({ channels: ['native', 'external'] });
    process.env.XP_GATE_DELPHI_CHANNEL = 'external';
    const resolved = channel.resolveChannels({ home: tmpHome });
    expect(resolved.channels).toEqual(['external']);
    expect(resolved.source).toBe('env');
    expect(resolved.nativeEnabled).toBe(false);
  });

  it('AC-646-01: with no preference, both channels stay enabled and the source says why', () => {
    // Defaulting to external-only would silently change behaviour for everyone who
    // never asked. Defaulting to native-only would keep the disproved path in front.
    const resolved = channel.resolveChannels({ home: tmpHome });
    expect(resolved.channels).toEqual(['native', 'external']);
    expect(resolved.source).toBe('default');
    expect(resolved.nativeEnabled).toBe(true);
  });

  it('AC-646-01: an unrecognised value falls back loudly instead of guessing', () => {
    writeMachineConfig({ channels: ['nonsense'] });
    const resolved = channel.resolveChannels({ home: tmpHome });
    expect(resolved.source).toBe('default');
    expect(resolved.channels).toEqual(['native', 'external']);
    expect(resolved.warning).toMatch(/nonsense/);
  });

  it('AC-646-01: a corrupt config file does not crash and does not pretend to be configured', () => {
    const dir = path.join(tmpHome, '.config', 'xp-gate');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.delphi-config.json'), '{ not json', 'utf8');
    const resolved = channel.resolveChannels({ home: tmpHome });
    expect(resolved.source).toBe('default');
    expect(resolved.warning).toBeTruthy();
  });

  it('AC-646-02: nativeAgentDeploymentIsWanted() is what init must consult', () => {
    writeMachineConfig({ channels: ['external'] });
    expect(channel.nativeAgentDeploymentIsWanted({ home: tmpHome })).toBe(false);

    fs.rmSync(path.join(tmpHome, '.config'), { recursive: true, force: true });
    delete process.env.XP_GATE_DELPHI_CHANNEL;
    expect(channel.nativeAgentDeploymentIsWanted({ home: tmpHome })).toBe(true);
  });
});
