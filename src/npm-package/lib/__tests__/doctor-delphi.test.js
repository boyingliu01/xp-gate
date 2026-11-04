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
      const dest = path.join(tmpHome, '.qoder', 'skills', 'delphi-review', f.name);
      if (f.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const inner of fs.readdirSync(path.join(bundledSkillDir(), f.name))) {
          if (fs.statSync(path.join(bundledSkillDir(), f.name, inner)).isFile()) {
            fs.copyFileSync(path.join(bundledSkillDir(), f.name, inner), path.join(dest, inner));
          }
        }
      } else if (f.isFile()) {
        fs.copyFileSync(path.join(bundledSkillDir(), f.name), dest);
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
    const code = await doctorDelphi({ projectDir: tmpHome, configPath, npmLatest: localVersion });
    expect(code).toBe(0);
  });

  it('a stale agent binding FAILs and names delphi-setup as the repair path', async () => {
    healthyHome();
    fs.writeFileSync(
      path.join(tmpHome, '.qoder', 'agents', 'delphi-technical.md'),
      '---\nname: delphi-technical\nmodel: "[Retired](retired-id)"\n---\n# body\n',
    );
    const { doctorDelphi } = require('../doctor');
    const code = await doctorDelphi({ projectDir: tmpHome, configPath: path.join(tmpHome, 'absent.json'), npmLatest: null });
    expect(code).toBe(1);
  });

  it('a skill install that drifted from the bundled copy FAILs with a reinstall hint', async () => {
    healthyHome();
    const installed = path.join(tmpHome, '.qoder', 'skills', 'delphi-review', 'SKILL.md');
    fs.appendFileSync(installed, '\ndrifted line\n');
    const logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    const { doctorDelphi } = require('../doctor');
    await doctorDelphi({ projectDir: tmpHome, configPath: path.join(tmpHome, 'absent.json'), npmLatest: null });
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
    const code = await doctorDelphi({ projectDir: tmpHome, configPath, npmLatest: null });
    expect(code).toBe(1);
  });

  // #541 follow-up: the loaders fall back to the machine-wide global config
  // ONLY on ENOENT, so a project-local file silently shadows the global one.
  // When their seats differ, the effective model mix depends on cwd — exactly
  // the cross-project drift class that burned quota (2026-10-03). Doctor must
  // warn about the shadow; identical seats are a legitimate override.
  it('#541 a project config whose seats differ from the global one WARNs as a shadow', async () => {
    healthyHome();
    const globalPath = path.join(tmpHome, '.config', 'xp-gate', '.delphi-config.json');
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    writeConfig(globalPath);
    const configPath = path.join(tmpHome, '.delphi-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      active_profile: 'default',
      profiles: {
        default: {
          providers: { gw: { base_url: 'https://gw.example/v1', api_key: 'k' } },
          experts: {
            architecture: { provider: 'gw', model: 'other-a' },
            technical: { provider: 'gw', model: 'model-b' },
            feasibility: { provider: 'gw', model: 'model-c' },
          },
        },
      },
    }));
    const logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    const { doctorDelphi } = require('../doctor');
    const code = await doctorDelphi({ projectDir: tmpHome, configPath, globalConfigPath: globalPath, npmLatest: null });
    logSpy.mockRestore();
    // A warning, not a failure: an intentional per-project override is legal.
    expect(code).toBe(0);
    expect(logs.join('\n')).toMatch(/shadow/i);
  });

  it('#541 a project config with seats identical to the global one does not warn', async () => {
    healthyHome();
    const globalPath = path.join(tmpHome, '.config', 'xp-gate', '.delphi-config.json');
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    writeConfig(globalPath);
    const configPath = writeConfig(path.join(tmpHome, '.delphi-config.json'));
    const logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    const { doctorDelphi } = require('../doctor');
    const code = await doctorDelphi({ projectDir: tmpHome, configPath, globalConfigPath: globalPath, npmLatest: null });
    logSpy.mockRestore();
    expect(code).toBe(0);
    expect(logs.join('\n')).not.toMatch(/shadow/i);
  });

  it('a missing config FAILs with the copy-the-example hint', async () => {
    healthyHome();
    const logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    const { doctorDelphi } = require('../doctor');
    await doctorDelphi({ projectDir: tmpHome, configPath: path.join(tmpHome, 'absent.json'), npmLatest: null });
    logSpy.mockRestore();
    expect(logs.join('\n')).toMatch(/\.delphi-config\.json/);
  });

  it('npmLatest=null skips the version check without failing the run', async () => {
    healthyHome();
    const { doctorDelphi } = require('../doctor');
    const configPath = writeConfig(path.join(tmpHome, '.delphi-config.json'));
    const code = await doctorDelphi({ projectDir: tmpHome, configPath, npmLatest: null });
    expect(code).toBe(0);
  });

  // #574: `scripts/check_delphi_local_models.py` encoded the local-only seat
  // rule but nothing ever called it, so the guard existed only in its own
  // docstring. The doctor now reports the same verdict, which is what gives the
  // rule a caller. The rule stays a WARN: a deliberately hosted seat is legal,
  // and the HARD enforcement is Gate MW's evidence-to-config binding.
  it('#574 hosted (non local-*) seats are reported as a WARN, not a failure', async () => {
    healthyHome();
    const configPath = writeConfig(path.join(tmpHome, '.delphi-config.json'));
    const logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    const { doctorDelphi } = require('../doctor');
    const code = await doctorDelphi({ projectDir: tmpHome, configPath, npmLatest: null });
    logSpy.mockRestore();
    const output = logs.join('\n');
    expect(code).toBe(0);
    expect(output).toMatch(/local-model guard/i);
    expect(output).toMatch(/model-a|model-b|model-c/);
  });

  it('#574 three local-* seats PASS the local-model guard', async () => {
    healthyHome();
    const configPath = path.join(tmpHome, '.delphi-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      active_profile: 'local',
      profiles: {
        local: {
          providers: { gw: { base_url: 'https://gw.example/v1', api_key: 'k' } },
          experts: {
            architecture: { provider: 'gw', model: 'local-deepseek-v4-flash' },
            technical: { provider: 'gw', model: 'local-qwen3.8-flash' },
            feasibility: { provider: 'gw', model: 'local-qwen3.8-27b' },
          },
        },
      },
    }));
    const logs = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    const { doctorDelphi } = require('../doctor');
    const code = await doctorDelphi({ projectDir: tmpHome, configPath, npmLatest: null });
    logSpy.mockRestore();
    const output = logs.join('\n');
    expect(code).toBe(0);
    expect(output).toMatch(/local-model guard/i);
    expect(output).toMatch(/all 3 seats are local-\*/i);
  });

  // R1 FC-07: the switch shipping off is the platform default, not a defect —
  // only enabled-but-underprovisioned is a real FAIL.
  it('DSH with subagentModelSelection absent is SKIP, not FAIL', async () => {
    healthyHome();
    fs.mkdirSync(path.join(tmpHome, '.dsh'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.dsh', 'settings.json'), JSON.stringify({ other: true }));
    const { doctorDelphi } = require('../doctor');
    const configPath = writeConfig(path.join(tmpHome, '.delphi-config.json'));
    const code = await doctorDelphi({ projectDir: tmpHome, configPath, npmLatest: null });
    expect(code).toBe(0);
  });

  // R1 FC-09: a project-level agent set (delphi-setup --local --project) is
  // what the doctor reads, so the repair loop closes.
  it('a complete project-level agent set takes precedence over the HOME set', async () => {
    healthyHome();
    const projDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'doctor-delphi-proj-'));
    try {
      fs.mkdirSync(path.join(projDir, '.qoder', 'agents'), { recursive: true });
      for (const role of ['architecture', 'technical', 'feasibility']) {
        fs.copyFileSync(
          path.join(repoRoot(), 'plugins', 'qoder', 'agents', `delphi-${role}.md`),
          path.join(projDir, '.qoder', 'agents', `delphi-${role}.md`),
        );
      }
      // Corrupt the HOME set; the project set must win and the run stays green.
      fs.writeFileSync(
        path.join(tmpHome, '.qoder', 'agents', 'delphi-technical.md'),
        '---\nname: delphi-technical\nmodel: "[Retired](retired-id)"\n---\n# body\n',
      );
      const { doctorDelphi } = require('../doctor');
      const configPath = writeConfig(path.join(tmpHome, '.delphi-config.json'));
      const code = await doctorDelphi({
        projectDir: projDir, configPath, npmLatest: null,
      });
      expect(code).toBe(0);
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  // R1 MI-03: parity covers the whole bundled file set, so a stale references/
  // copy cannot hide behind a matching SKILL.md.
  it('a drifted references file FAILs parity even when SKILL.md matches', async () => {
    healthyHome();
    // R2 MJ-R2-01: the assertion must be the ONLY way this test can fail. An
    // absent config would exit 1 regardless of parity, so the fixture supplies
    // a valid one and lets the drifted file carry the verdict.
    const configPath = writeConfig(path.join(tmpHome, '.delphi-config.json'));
    const refsDir = path.join(bundledSkillDir(), 'references');
    const refFile = fs.existsSync(refsDir)
      ? fs.readdirSync(refsDir).find((f) => f.endsWith('.md'))
      : null;
    expect(refFile).toBeTruthy(); // explicit: without a bundled reference this test has nothing to say
    fs.mkdirSync(path.join(tmpHome, '.qoder', 'skills', 'delphi-review', 'references'), { recursive: true });
    fs.appendFileSync(
      path.join(tmpHome, '.qoder', 'skills', 'delphi-review', 'references', refFile),
      '\ndrift\n',
    );
    const { doctorDelphi } = require('../doctor');
    const code = await doctorDelphi({ projectDir: tmpHome, configPath, npmLatest: null });
    expect(code).toBe(1);
  });

  // R3 FC-01/FC-02: the empty-bundle branch is driven directly through the
  // injectable bundledSkillDir — the healthy fixture cannot exercise it, and
  // an indirect output-shape assertion would pass even without the fix.
  it('an empty bundled skill directory FAILs parity instead of passing vacuously', async () => {
    healthyHome();
    const emptyBundle = fs.mkdtempSync(path.join(require('os').tmpdir(), 'doctor-empty-bundle-'));
    try {
      const logs = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
      const { doctorDelphi } = require('../doctor');
      const configPath = writeConfig(path.join(tmpHome, '.delphi-config.json'));
      const code = await doctorDelphi({ projectDir: tmpHome, configPath, npmLatest: null, bundledSkillDir: emptyBundle });
      logSpy.mockRestore();
      expect(code).toBe(1);
      const parityLine = logs.find((l) => l.includes('Delphi skill install parity'));
      expect(parityLine).toContain('missing or empty');
    } finally {
      fs.rmSync(emptyBundle, { recursive: true, force: true });
    }
  });
});

// ── #684: the documented global-config fallback ──────────────────────────────
// SKILL.md tells users to keep ONE machine-level config at
// `~/.config/xp-gate/.delphi-config.json` and carry no repo-local copy. The
// runner resolves that fallback, so a review works; the doctor did not, and
// reported FAIL on a layout its own documentation recommends. Worse, the FAIL
// detail told the user to copy the example into the project — which manufactures
// exactly the drifted duplicate that #541 added a shadow warning for.
//
// The distinction this batch pins: "no config anywhere" is still a FAIL
// (that is a genuinely broken install); "no project config but a valid global
// one" is not.
describe('doctor delphi #684 global config fallback', () => {
  let tmpDirs;
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    tmpDirs = makeTempDirs(['doctor-684-home']);
    tmpHome = tmpDirs['doctor-684-home'];
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

  // Local copy: the suite above keeps its own writeConfig inside its describe
  // scope, so this block cannot reach it.
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

  function writeGlobalConfig() {
    const dir = path.join(tmpHome, '.config', 'xp-gate');
    fs.mkdirSync(dir, { recursive: true });
    return writeConfig(path.join(dir, '.delphi-config.json'));
  }

  function captureLogs() {
    const logs = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => logs.push(args.join(' ')));
    return { logs, restore: () => spy.mockRestore() };
  }

  it('AC-721-01: a valid global config with no project copy PASSes instead of failing', async () => {
    const globalPath = writeGlobalConfig();
    const project = path.join(tmpHome, 'a-project-with-no-config');
    fs.mkdirSync(project, { recursive: true });
    const { logs, restore } = captureLogs();
    const { doctorDelphi } = require('../doctor');
    await doctorDelphi({ projectDir: project, globalConfigPath: globalPath, npmLatest: null });
    restore();
    const cfgLine = logs.find((l) => l.includes('Delphi config'));
    expect(cfgLine).toBeDefined();
    expect(cfgLine).not.toMatch(/FAIL/);
    expect(cfgLine).toMatch(/global/i);
  });

  it('AC-721-02: no config in either scope still FAILs (fallback must not mask a broken install)', async () => {
    const project = path.join(tmpHome, 'bare-project');
    fs.mkdirSync(project, { recursive: true });
    const { logs, restore } = captureLogs();
    const { doctorDelphi } = require('../doctor');
    const code = await doctorDelphi({
      projectDir: project,
      globalConfigPath: path.join(tmpHome, 'no-such-global.json'),
      npmLatest: null,
    });
    restore();
    expect(code).toBe(1);
    // The rendered line carries a ✗ marker, not the literal word FAIL.
    const cfgLine = logs.find((l) => l.includes('Delphi config (.delphi-config.json)'));
    expect(cfgLine).toBeDefined();
    expect(cfgLine).toContain('✗');
    expect(cfgLine).toMatch(/not found/);
  });

  it('AC-721-03: a project config still wins over the global one', async () => {
    const globalPath = writeGlobalConfig();
    const project = path.join(tmpHome, 'project-with-own-config');
    fs.mkdirSync(project, { recursive: true });
    const localPath = writeConfig(path.join(project, '.delphi-config.json'));
    const { logs, restore } = captureLogs();
    const { doctorDelphi } = require('../doctor');
    await doctorDelphi({ projectDir: project, globalConfigPath: globalPath, npmLatest: null });
    restore();
    const cfgLine = logs.find((l) => l.includes('Delphi config'));
    expect(cfgLine).toBeDefined();
    expect(cfgLine).toContain(localPath);
    expect(cfgLine).not.toMatch(/global/i);
  });
});

describe('doctor delphi #725 multi-platform skill parity', () => {
  let tmpDirs;
  let tmpHome;
  let originalHome;
  let originalUserProfile;

  beforeEach(() => {
    tmpDirs = makeTempDirs(['doctor-725-home']);
    tmpHome = tmpDirs['doctor-725-home'];
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    resetLibModules(vi, LIB_MODULES);
    muteConsole(vi);
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    removeTempDirs(tmpDirs);
    vi.restoreAllMocks();
  });

  /** Copy the shipped bundle into \`<home>/<rel>/delphi-review\`. */
  function deploySkillAt(rel, mutate) {
    const dest = path.join(tmpHome, rel, 'delphi-review');
    fs.mkdirSync(dest, { recursive: true });
    const src = bundledSkillDir();
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name);
      const to = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(to, { recursive: true });
        for (const inner of fs.readdirSync(from)) {
          if (fs.statSync(path.join(from, inner)).isFile()) {
            fs.copyFileSync(path.join(from, inner), path.join(to, inner));
          }
        }
      } else {
        fs.copyFileSync(from, to);
      }
    }
    if (mutate) mutate(dest);
    return dest;
  }

  /** Minimal agent set so only skill parity is under test. */
  function seedAgents() {
    fs.mkdirSync(path.join(tmpHome, '.qoder', 'agents'), { recursive: true });
    for (const role of ['architecture', 'technical', 'feasibility']) {
      fs.copyFileSync(
        path.join(repoRoot(), 'plugins', 'qoder', 'agents', `delphi-${role}.md`),
        path.join(tmpHome, '.qoder', 'agents', `delphi-${role}.md`),
      );
    }
  }

  function captureResults() {
    const lines = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => lines.push(args.join(' ')));
    return { lines, spy };
  }

  /**
   * @test REQ-725 Multi-platform skill parity
   * @intent A second platform whose copy drifted must fail the parity check instead of being invisible
   * @covers AC-725-01, AC-721-01, AC-721-02, AC-721-03
   */
  it('AC-725-01: a drifted OpenCode copy FAILs parity even though Qoder is clean', async () => {
    seedAgents();
    deploySkillAt(path.join('.qoder', 'skills'));
    // Qoder is selected by detectPlatform(), so this is the copy the check used
    // to look at -- and it is clean. The OpenCode copy is the one that rotted.
    deploySkillAt(path.join('.config', 'opencode', 'skills'), (dest) => {
      fs.writeFileSync(path.join(dest, 'AGENTS.md'), '# stale copy from 0.32.0.0\n');
    });
    fs.mkdirSync(path.join(tmpHome, '.config', 'xp-gate'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, '.config', 'xp-gate', 'xp-gate.json'),
      JSON.stringify({ installedSkills: {} }),
    );

    const { doctorDelphi } = require('../doctor');
    const { lines, spy } = captureResults();
    await doctorDelphi({ skipLatestProbe: true });
    spy.mockRestore();

    const parity = lines.filter((l) => /parity/i.test(l)).join('\n');
    expect(parity, 'a stale second-platform copy must be reported').toMatch(/✗/);
    expect(parity).toMatch(/opencode/i);
  });

  /**
   * @test REQ-725 Multi-platform skill parity
   * @intent Both platforms matching must still PASS, and say how many were compared
   * @covers AC-725-02
   */
  it('AC-725-02: two clean platform copies PASS together', async () => {
    seedAgents();
    deploySkillAt(path.join('.qoder', 'skills'));
    deploySkillAt(path.join('.config', 'opencode', 'skills'));
    fs.mkdirSync(path.join(tmpHome, '.config', 'xp-gate'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, '.config', 'xp-gate', 'xp-gate.json'),
      JSON.stringify({ installedSkills: {} }),
    );

    const { doctorDelphi } = require('../doctor');
    const { lines, spy } = captureResults();
    await doctorDelphi({ skipLatestProbe: true });
    spy.mockRestore();

    const parity = lines.filter((l) => /parity/i.test(l)).join('\n');
    expect(parity).toMatch(/✓/);
    expect(parity).toMatch(/2 platform/i);
  });

  /**
   * @test REQ-725 Multi-platform skill parity
   * @intent dsh is a first-class deploy target but detectPlatform() never returns
   *         it, so a drifted dsh copy must fail parity exactly like opencode
   * @covers AC-725-01
   */
  it('AC-725-01: a drifted dsh copy FAILs parity even though Qoder is clean', async () => {
    seedAgents();
    deploySkillAt(path.join('.qoder', 'skills'));
    deploySkillAt(path.join('.dsh', 'skills'), (dest) => {
      fs.writeFileSync(path.join(dest, 'AGENTS.md'), '# stale dsh copy\n');
    });
    fs.mkdirSync(path.join(tmpHome, '.config', 'xp-gate'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, '.config', 'xp-gate', 'xp-gate.json'),
      JSON.stringify({ installedSkills: {} }),
    );

    const { doctorDelphi } = require('../doctor');
    const { lines, spy } = captureResults();
    await doctorDelphi({ skipLatestProbe: true });
    spy.mockRestore();

    const parity = lines.filter((l) => /parity/i.test(l)).join('\n');
    expect(parity, 'a stale dsh copy must be reported').toMatch(/✗/);
    expect(parity).toMatch(/dsh/i);
  });

  /**
   * @test REQ-725 Multi-platform skill parity
   * @intent a machine whose only installed agent is dsh has no marker detectPlatform()
   *         keys on, so the opencode fallback falsely FAILs "not installed" even though
   *         the skill IS deployed under ~/.dsh/skills
   * @covers AC-725-01
   */
  it('AC-725-01: a dsh-only machine PASSes parity instead of "not installed at opencode"', async () => {
    // No seedAgents(): keep .qoder/.claude/.config-opencode absent so detectPlatform()
    // falls back to opencode while dsh is the only live tree.
    deploySkillAt(path.join('.dsh', 'skills'));
    fs.mkdirSync(path.join(tmpHome, '.config', 'xp-gate'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHome, '.config', 'xp-gate', 'xp-gate.json'),
      JSON.stringify({ installedSkills: {} }),
    );

    const { doctorDelphi } = require('../doctor');
    const { lines, spy } = captureResults();
    await doctorDelphi({ skipLatestProbe: true });
    spy.mockRestore();

    const parity = lines.filter((l) => /parity/i.test(l)).join('\n');
    expect(parity, 'a deployed dsh copy must be found and verified').toMatch(/✓/);
    expect(parity).not.toMatch(/not installed/i);
  });
});
