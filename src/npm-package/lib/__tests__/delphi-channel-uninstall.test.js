/**
 * @test REQ-646
 * @intent `--uninstall` 是唯一一个**会删文件**的 Delphi 命令，所以它的测试必须
 *         只在沙箱里跑，而且必须钉住"删掉之后 init 不会再装回来"这条闭环——
 *         否则用户删一次、升级一次、机制又回来了，#646 原样复发。
 *
 *         另一个必须钉住的性质是**幂等**：第二次运行不能报错。
 *         一个"没有东西可删"就失败的命令没法放进 bootstrap 脚本，
 *         而 bootstrap 正是这个开关的主要用途。
 *
 *         写在测试里的教训：本命令默认作用于真实的 `~/.qoder/agents/`。
 *         实现完成后我直接跑了一次冒烟测试，把本机三个 agent 文件删掉了。
 *         所以下面每个用例都把 HOME 指向临时目录，不依赖调用者记得加沙箱。
 * @covers AC-646-03, AC-646-05
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '../../../..');

describe('delphi-setup --uninstall (#646)', () => {
  let tmpHome;
  let originalEnv;
  let projectDir;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-uninstall-'));
    projectDir = path.join(tmpHome, 'project');
    // HOME_DIR() resolves from these; pointing them at the sandbox is what keeps
    // this suite from deleting the developer's real agent files.
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    process.env.XDG_CONFIG_HOME = path.join(tmpHome, '.config');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function seedAgents(dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const role of ['architecture', 'technical', 'feasibility']) {
      fs.writeFileSync(path.join(dir, `delphi-${role}.md`), `model: "[x](x)"\n`, 'utf8');
    }
  }

  function agentNames(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.startsWith('delphi-')).sort();
  }

  it('AC-646-03: removes all three user-level agents', async () => {
    const { delphiSetup } = require(path.join(REPO_ROOT, 'src/npm-package/lib/delphi-setup.js'));
    const dir = path.join(tmpHome, '.qoder', 'agents');
    seedAgents(dir);
    expect(agentNames(dir)).toHaveLength(3);

    const code = await delphiSetup(['--uninstall', '--global']);

    expect(code).toBe(0);
    expect(agentNames(dir)).toEqual([]);
  });

  it('AC-646-03: removes project-level agents with --local --project', async () => {
    const { delphiSetup } = require(path.join(REPO_ROOT, 'src/npm-package/lib/delphi-setup.js'));
    const dir = path.join(projectDir, '.qoder', 'agents');
    seedAgents(dir);

    const code = await delphiSetup(['--uninstall', '--local', '--project', projectDir]);

    expect(code).toBe(0);
    expect(agentNames(dir)).toEqual([]);
  });

  it('AC-646-03: a second run still succeeds -- idempotence is the point', async () => {
    const { delphiSetup } = require(path.join(REPO_ROOT, 'src/npm-package/lib/delphi-setup.js'));
    const dir = path.join(tmpHome, '.qoder', 'agents');
    seedAgents(dir);

    expect(await delphiSetup(['--uninstall', '--global'])).toBe(0);
    // Nothing left to delete. "Nothing to do" is success, not failure: a command
    // that errors here cannot be called from a bootstrap script twice.
    expect(await delphiSetup(['--uninstall', '--global'])).toBe(0);
  });

  it('AC-646-03: refuses to combine --uninstall with --model', async () => {
    const { delphiSetup } = require(path.join(REPO_ROOT, 'src/npm-package/lib/delphi-setup.js'));
    const dir = path.join(tmpHome, '.qoder', 'agents');
    seedAgents(dir);

    const code = await delphiSetup([
      '--uninstall',
      '--model', 'architecture=qfmodel',
      '--model', 'technical=gfmodel',
      '--model', 'feasibility=dfmodel',
    ]);

    // Rebinding and uninstalling are opposite verbs; guessing which one wins would
    // silently discard the other intent.
    expect(code).toBe(1);
    expect(agentNames(dir)).toHaveLength(3);
  });

  it('AC-646-05: doctor flips to SKIP once the channel preference is set', async () => {
    // The closed loop: uninstall removes the files, the preference keeps `init` from
    // putting them back, and doctor must read that as configured-not-broken.
    const { delphiSetup } = require(path.join(REPO_ROOT, 'src/npm-package/lib/delphi-setup.js'));
    const dir = path.join(tmpHome, '.qoder', 'agents');
    seedAgents(dir);
    await delphiSetup(['--uninstall', '--global']);

    const cfgDir = path.join(tmpHome, '.config', 'xp-gate');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, '.delphi-config.json'),
      JSON.stringify({ channels: ['external'] }),
      'utf8',
    );

    const channel = require(path.join(REPO_ROOT, 'src/npm-package/lib/delphi-channel.js'));
    expect(channel.nativeAgentDeploymentIsWanted({ home: tmpHome })).toBe(false);
  });
});
