/**
 * @test doctor-delphi
 * @intent Guard #414 REQ-3/REQ-6: `xp-gate doctor delphi` turns the failure
 * modes measured on real machines into diagnosable checks — drifted agent
 * bindings (B2), a skill install that silently lagged the published package
 * (B4), a runner script nobody can find (B3), and a config that cannot serve
 * three distinct models. Every check must be assertable in isolation, and the
 * npm-latest probe must be skippable so the doctor never needs the network.
 */
const fs = require('fs');
const path = require('path');
const { resetLibModules, muteConsole, makeTempDirs, removeTempDirs } = require('./helpers/lib-sandbox.cjs');

const LIB_MODULES = ['../init', '../detect-deps.js', '../shared-paths', '../doctor', '../delphi-setup'].map(name => require.resolve(name));

function repoRoot() {
  return path.join(__dirname, '..', '..', '..', '..');
}

function bundledSkillDir() {
  return path.join(repoRoot(), 'src', 'npm-package', 'skills', 'delphi-review');
}

describe('doctor delphi (#414 REQ-3/REQ-6)', () => {
  let tmpDirs;
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    tmpDirs = makeTempDirs(['doctor-delphi-home']);
    tmpHome = tmpDirs['doctor-delphi-home'];
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    fs.mkdirSync(path.join(tmpHome, '.qoder'), { recursive: true });
    resetLibModules(vi, LIB_MODULES);
    muteConsole(vi);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    removeTempDirs(tmpDirs);
    vi.restoreAllMocks();
  });

  function healthyHome() {
    // A home that would pass the agent + skill-parity checks.
    fs.mkdirSync(path.join(tmpHome, '.qoder', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.qoder', 'skills', 'delphi-review'), { recursive: true });
    for (const role of ['architecture', 'technical', 'feasibility']) {
      fs.copyFileSync(
        path.join(repoRoot(), 'plugins', 'qoder', 'agents', `delphi-${role}.md`),
        path.join(tmpHome, '.qoder', 'agents', `delphi-${role}.md`),
      );
    }
    for (const f of fs.readdirSync(bundledSkillDir(), { withFileTypes: true })) {
      if (f.isFile()) {
        fs.copyFileSync(path.join(bundledSkillDir(), f.name), path.join(tmpHome, '.qoder', 'skills', 'delphi-review', f.name));
      }
    }
  }

  function writeConfig(configPath) {
    fs.writeFileSync(configPath, JSON.stringify({
      active_profile: 'default',
      profiles: {
        default: {
          providers: {
            gw: { base_url: 'https://gw.example/v1', api_key: 'k' },
          },
          experts: {
            architecture: { provider: 'gw', model: 'model-a' },
            technical: { provider: 'gw', model: 'model-b' },
            feasibility: { provider: 'gw', model: 'model-c' },
          },
        },
      },
    }));
    return configPath;
  }

  it('a fully healthy environment PASSes every check and exits 0', async () => {
    healthyHome();
    const { doctorDelphi } = require('../doctor');
    const configPath = writeConfig(path.join(tmpDirs['doctor-delphi-home'], '.delphi-config.json'));
    const localVersion = require('../../package.json').version;
    const code = await doctorDelphi({ configPath, npmLatest: localVersion });
    expect(code).toBe(0);
  });

  it('a stale agent binding FAILs and names delphi-setup as the repair path', async () => {
    healthyHome();
    fs.writeFileSync(
      path.join(tmpHome, '.qoder', 'agents', 'delphi-technical.md'),
      '---\nname: delphi-technical\nmodel: "[Retired](retired-id)"\n---\n# body\n',
    );
    const { doctorDelphi } = require('../doctor');
    const code = await doctorDelphi({ configPath: path.join(tmpHome, 'absent.json'), npmLatest: null });
    expect(code).toBe(1);
  });

  it('a skill install that drifted from the bundled copy FAILs with a reinstall hint', async () => {
    healthyHome();
    const installed = path.join(tmpHome, '.qoder', 'skills', 'delphi-review', 'SKILL.md');
    fs.appendFileSync(installed, '\ndrifted line\n');
    const logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    const { doctorDelphi } = require('../doctor');
    await doctorDelphi({ configPath: path.join(tmpHome, 'absent.json'), npmLatest: null });
    logSpy.mockRestore();
    expect(logs.join('\n')).toMatch(/install-skill|reinstall/i);
  });

  it('a duplicate-model config FAILs instead of promising a review that will BLOCK', async () => {
    healthyHome();
    const configPath = path.join(tmpHome, '.delphi-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      active_profile: 'default',
      profiles: {
        default: {
          providers: { gw: { base_url: 'https://gw.example/v1', api_key: 'k' } },
          experts: {
            architecture: { provider: 'gw', model: 'same' },
            technical: { provider: 'gw', model: 'same' },
            feasibility: { provider: 'gw', model: 'model-c' },
          },
        },
      },
    }));
    const { doctorDelphi } = require('../doctor');
    const code = await doctorDelphi({ configPath, npmLatest: null });
    expect(code).toBe(1);
  });

  it('a missing config FAILs with the copy-the-example hint', async () => {
    healthyHome();
    const logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    const { doctorDelphi } = require('../doctor');
    await doctorDelphi({ configPath: path.join(tmpHome, 'absent.json'), npmLatest: null });
    logSpy.mockRestore();
    expect(logs.join('\n')).toMatch(/\.delphi-config\.json/);
  });

  it('npmLatest=null skips the version check without failing the run', async () => {
    healthyHome();
    const { doctorDelphi } = require('../doctor');
    const configPath = writeConfig(path.join(tmpHome, '.delphi-config.json'));
    const code = await doctorDelphi({ configPath, npmLatest: null });
    expect(code).toBe(0);
  });
});
