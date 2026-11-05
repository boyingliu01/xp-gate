/**
 * @test REQ-719
 * @intent Verify updateSkill() handles check/all/single-name modes, config parsing, and delegates to installSkill correctly
 * @covers AC-416-04, AC-719-01, AC-719-02, AC-719-03
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('update-skill', () => {
  let tmpHome;
  let originalHome;
  let logSpy;
  let errorSpy;
  let installSkillMock;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-up-'));
    process.env.HOME = tmpHome;

    vi.resetModules();
    delete require.cache[require.resolve('../update-skill')];
    delete require.cache[require.resolve('../install-skill.js')];

    // Inject mock install-skill module into the require.cache BEFORE update-skill
    // pulls it in (it lazy-requires it inside updateSingleSkill).
    installSkillMock = vi.fn().mockResolvedValue(0);
    const installSkillPath = require.resolve('../install-skill.js');
    require.cache[installSkillPath] = {
      id: installSkillPath,
      filename: installSkillPath,
      loaded: true,
      exports: { installSkill: installSkillMock },
    };

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    delete require.cache[require.resolve('../install-skill.js')];
    delete require.cache[require.resolve('../update-skill')];
    vi.restoreAllMocks();
  });

  function configDir() {
    return path.join(tmpHome, '.config', 'xp-gate');
  }

  function skillsDir() {
    return path.join(tmpHome, '.config', 'opencode', 'skills');
  }

  function writeConfig(skills) {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(
      path.join(configDir(), 'xp-gate.json'),
      JSON.stringify({ installedSkills: skills })
    );
  }

  function makeSkillDir(name) {
    const dir = path.join(skillsDir(), name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'old content');
    return dir;
  }

  // ----- name + flags validation -----

  it('returns 1 + console.error when name is null and no flags', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null);
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: Skill name required');
    expect(errorSpy).toHaveBeenCalledWith(
      'Usage: xp-gate update-skill <name> or --all'
    );
  });

  it('returns 1 + console.error when name is undefined and no flags', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill();
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: Skill name required');
  });

  it('returns 1 + "is not installed" when name not in config.installedSkills', async () => {
    writeConfig({}); // empty
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: foo is not installed');
  });

  it('returns 1 + "is not installed" when config file is missing entirely', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: foo is not installed');
  });

  // ----- check mode -----

  it('check=true prints each installed skill with its version, returns 0', async () => {
    writeConfig({
      foo: { version: '1.2.3' },
      bar: { version: '2.0.0' },
    });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { check: true });
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('Checking for updates...');

    // #725: the check reads the DISK now, not the registry. These skills have no
    // copy anywhere on this fixture HOME, so the honest answer is "registry only"
    // -- printing the recorded version as though it were verified is what let a
    // stale multi-platform copy look up to date.
    const lines = logSpy.mock.calls.map((c) => c[0]);
    expect(lines.some((l) => /foo: 1\.2\.3 \(registry only/.test(l))).toBe(true);
    expect(lines.some((l) => /bar: 2\.0\.0 \(registry only/.test(l))).toBe(true);
    expect(logSpy).toHaveBeenCalledWith('Update check complete');
  });

  it('check=true with skill missing version falls back to "unknown"', async () => {
    writeConfig({ baz: {} }); // no version field
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { check: true });
    expect(result).toBe(0);
    const lines = logSpy.mock.calls.map((c) => c[0]);
    expect(lines.some((l) => /baz: unknown/.test(l))).toBe(true);
  });

  it('check=true with empty config returns 0 and prints only headers', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { check: true });
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('Checking for updates...');
    expect(logSpy).toHaveBeenCalledWith('Update check complete');
  });

  // ----- all mode -----

  it('all=true with empty skills returns 0 and prints "Updating all skills..."', async () => {
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { all: true });
    expect(result).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('Updating all skills...');
    expect(installSkillMock).not.toHaveBeenCalled();
  });

  // These编排 tests use names the bundle really carries: since #713 `--all`
  // only claims skills xp-gate ships, so a placeholder like 'foo' is filtered
  // out before it can exercise the loop. The orchestration behaviour under test
  // (fan-out, error propagation, verbose passthrough) is orthogonal to ownership.
  it('all=true updates every installed skill (calls installSkill each), returns 0 on success', async () => {
    writeConfig({
      'delphi-review': { version: '1.0.0' },
      'grilling': { version: '1.0.0' },
    });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { all: true });
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalledTimes(2);
    expect(installSkillMock).toHaveBeenCalledWith('delphi-review', {
      force: true,
      verbose: false,
    });
    expect(installSkillMock).toHaveBeenCalledWith('grilling', {
      force: true,
      verbose: false,
    });
    expect(logSpy).toHaveBeenCalledWith('Updating delphi-review...');
    expect(logSpy).toHaveBeenCalledWith('Updating grilling...');
    expect(logSpy).toHaveBeenCalledWith('✓ delphi-review updated');
    expect(logSpy).toHaveBeenCalledWith('✓ grilling updated');
  });

  it('all=true returns 1 when at least one installSkill rejects', async () => {
    writeConfig({
      'delphi-review': { version: '1.0.0' },
      'grilling': { version: '1.0.0' },
    });
    installSkillMock.mockImplementation(async (name) => {
      if (name === 'grilling') throw new Error('boom');
      return 0;
    });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { all: true });
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Failed to update grilling: boom');
    expect(logSpy).toHaveBeenCalledWith('✓ delphi-review updated');
  });

  it('all=true propagates verbose flag into installSkill options', async () => {
    writeConfig({ 'delphi-review': { version: '1.0.0' } });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill(null, { all: true, verbose: true });
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalledWith('delphi-review', {
      force: true,
      verbose: true,
    });
  });

  // ----- single skill mode -----

  it('updateSkill(name) calls installSkill and returns its result (0=success)', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalledWith('foo', {
      force: true,
      verbose: false,
    });
    expect(logSpy).toHaveBeenCalledWith('Updating foo...');
    expect(logSpy).toHaveBeenCalledWith('✓ foo updated');
  });

  it('updateSkill(name) returns installSkill result when non-zero (no success log)', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    installSkillMock.mockResolvedValue(2);
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(2);
    expect(logSpy).not.toHaveBeenCalledWith('✓ foo updated');
  });

  it('leaves the target directory for installSkill to back up and replace', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    const dir = makeSkillDir('foo');
    expect(fs.existsSync(dir)).toBe(true);

    let dirPresentDuringInstall = false;
    installSkillMock.mockImplementation(async () => {
      dirPresentDuringInstall = fs.existsSync(dir);
      return 0;
    });

    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(0);
    // update-skill has no delete of its own: installSkill backs the directory up
    // before replacing it (#416).
    expect(dirPresentDuringInstall).toBe(true);
  });

  it('does not crash when targetDir does not exist', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    // No skill dir on disk
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalled();
  });

  // ----- getConfig fallback paths -----

  it('getConfig returns {} when config file does not exist (single-name path → not installed)', async () => {
    // exercised via "is not installed" — config absent ⇒ installedSkills undefined ⇒ {}
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('anything');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: anything is not installed');
  });

  it('getConfig returns {} on JSON parse error (catch swallows)', async () => {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(path.join(configDir(), 'xp-gate.json'), '{not valid json');
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: foo is not installed');
  });

  // === Mode handler isolation: check/all/single operate independently ===

  it('check and all modes handle empty config without crashing (edge cases)', async () => {
    // No config file at all — getConfig returns {}
    const { updateSkill } = require('../update-skill');
    expect(await updateSkill(null, { check: true })).toBe(0);
    expect(await updateSkill(null, { all: true })).toBe(0);
    expect(await updateSkill('anything')).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: anything is not installed');
  });

  it('getConfig parses valid config (single-name path succeeds)', async () => {
    writeConfig({ foo: { version: '1.0.0' } });
    const { updateSkill } = require('../update-skill');
    const result = await updateSkill('foo');
    expect(result).toBe(0);
    expect(installSkillMock).toHaveBeenCalledWith('foo', {
      force: true,
      verbose: false,
    });
  });
});

/**
 * Shared fixture for the `--all` blocks below.
 *
 * Both blocks need the same three things before a test runs: a throwaway HOME,
 * `install-skill` stubbed in the require cache (update-skill lazy-requires it),
 * and console silenced. Three copies of that boilerplate tripped the clone
 * detector -- and it had to stay byte-identical across copies to work, which is
 * exactly the kind of duplication that rots quietly. Returns the handles each
 * block asserts on.
 */
function makeAllModeFixture(prefix) {
  const handle = { tmpHome: null, installSkillMock: null, logSpy: null, errorSpy: null, originalHome: null };

  handle.beforeEach = () => {
    handle.originalHome = process.env.HOME;
    handle.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    process.env.HOME = handle.tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../update-skill')];
    delete require.cache[require.resolve('../install-skill.js')];
    handle.installSkillMock = vi.fn().mockResolvedValue(0);
    const p = require.resolve('../install-skill.js');
    require.cache[p] = {
      id: p,
      filename: p,
      loaded: true,
      exports: { installSkill: handle.installSkillMock },
    };
    handle.logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    handle.errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  };

  handle.afterEach = () => {
    process.env.HOME = handle.originalHome;
    fs.rmSync(handle.tmpHome, { recursive: true, force: true });
    delete require.cache[require.resolve('../install-skill.js')];
    delete require.cache[require.resolve('../update-skill')];
    vi.restoreAllMocks();
  };

  /**
   * Everything the run printed, log and error channels merged.
   *
   * Both channels matter: the same "nothing to update" message may be a log or
   * a warning depending on the code path, and asserting on one alone silently
   * passes when the message moves. Flattening to one string also keeps the
   * assertions readable instead of re-deriving it in every test.
   */
  handle.output = () =>
    [...handle.logSpy.mock.calls, ...handle.errorSpy.mock.calls].map((c) => c.join(' ')).join('\n');

  /** Deployment helper: writes `<HOME>/.config/<platform>/skills/<name>/SKILL.md`. */
  handle.deploySkill = (platform, name, body) => {
    const dir = path.join(handle.tmpHome, '.config', platform, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
    return dir;
  };

  return handle;
}

// ── #682: `--all` must enumerate what is on disk, not the config registry ────
// `xp-gate init` / `setup-global` deploy skills to disk but never write
// `config.installedSkills`, so `--all` iterated an always-empty object: it
// printed "Updating all skills..." and exited 0 having touched nothing. doctor
// solved the identical problem in #635 by enumerating the filesystem; this
// block pins the same contract for update-skill, plus the honesty requirement
// that a run which updates nothing must not look like a successful one.
describe('update-skill #682 filesystem enumeration', () => {
  const fx = makeAllModeFixture('xpgate-up682-');

  beforeEach(fx.beforeEach);
  afterEach(fx.afterEach);

  function deploySkill(platform, name) {
    return fx.deploySkill(platform, name, 'old content');
  }

  it('AC-719-01: --all updates skills found on disk even when config.installedSkills is absent', async () => {
    deploySkill('opencode', 'sprint-flow');
    deploySkill('opencode', 'delphi-review');
    const { updateSkill } = require('../update-skill');
    const code = await updateSkill(null, { all: true });
    expect(code).toBe(0);
    const names = fx.installSkillMock.mock.calls.map((c) => c[0]);
    expect(names).toContain('sprint-flow');
    expect(names).toContain('delphi-review');
  });

  it('AC-719-02: --all does not update the same skill twice for the same platform', async () => {
    deploySkill('opencode', 'sprint-flow');
    fs.mkdirSync(path.join(fx.tmpHome, '.config', 'xp-gate'), { recursive: true });
    fs.writeFileSync(
      path.join(fx.tmpHome, '.config', 'xp-gate', 'xp-gate.json'),
      JSON.stringify({ installedSkills: { 'sprint-flow': { version: '1.0.0' } } })
    );
    const { updateSkill } = require('../update-skill');
    await updateSkill(null, { all: true });
    const sprintCalls = fx.installSkillMock.mock.calls.filter((c) => c[0] === 'sprint-flow');
    expect(sprintCalls.length).toBe(1);
  });

  it('AC-719-03: --all with nothing installed says so instead of silently succeeding', async () => {
    const { updateSkill } = require('../update-skill');
    const code = await updateSkill(null, { all: true });
    expect(fx.output()).toMatch(/nothing to update|no skills installed|not installed/i);
    expect(fx.installSkillMock).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });
});

// ── #713: `--all` must only claim skills this package actually ships ─────────
// #682 fixed the "enumerate nothing" side of this by scanning the filesystem,
// but scoped the scan too widely: any `<skillsDir>/<name>/SKILL.md` was treated
// as ours. Skill directories are a shared namespace -- every skill tool uses the
// same layout -- so on a machine that also has other skill bundles, `--all`
// walked all of them, printed `Error: Unknown skill: <name>` for each, and told
// the user to `npm install -g xp-gate@latest` to obtain a skill xp-gate does not
// and will never carry. The fix is intersection, not union: scanned names are
// filtered against the bundled set before they become candidates.
describe('update-skill #713 bundled-skill ownership', () => {
  const fx = makeAllModeFixture('xpgate-up713-');

  beforeEach(fx.beforeEach);
  afterEach(fx.afterEach);

  function bundledNames() {
    // Read the real bundle so the test cannot drift from the package contents.
    const dir = path.join(__dirname, '..', '..', 'skills');
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
      .map((e) => e.name);
  }

  function deploySkill(platform, name) {
    return fx.deploySkill(platform, name, 'content');
  }

  /**
   * @test REQ-713 Skill ownership scoping
   * @intent A skill directory xp-gate does not ship must never become an --all candidate
   * @covers AC-713-01
   */
  it('AC-713-01: --all ignores skills present on disk but not in the package bundle', async () => {
    const [ours] = bundledNames();
    deploySkill('opencode', ours);
    deploySkill('opencode', 'clipboard-vision');
    deploySkill('opencode', 'code-search');

    const { updateSkill } = require('../update-skill');
    const code = await updateSkill(null, { all: true });

    expect(code).toBe(0);
    const attempted = fx.installSkillMock.mock.calls.map((c) => c[0]);
    expect(attempted).toContain(ours);
    expect(attempted).not.toContain('clipboard-vision');
    expect(attempted).not.toContain('code-search');
  });

  /**
   * @test REQ-713 Skill ownership scoping
   * @intent Foreign skills must not produce the misleading "update the package" advice
   * @covers AC-713-02
   */
  it('AC-713-02: --all prints no Unknown-skill errors for foreign skill directories', async () => {
    const [ours] = bundledNames();
    deploySkill('opencode', ours);
    deploySkill('opencode', 'pdf');
    deploySkill('opencode', 'docx');

    const { updateSkill } = require('../update-skill');
    await updateSkill(null, { all: true });

    const said = fx.errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(said).not.toMatch(/Unknown skill/);
  });

  /**
   * @test REQ-713 Skill ownership scoping
   * @intent A machine holding only foreign skills must report nothing to update
   * @covers AC-713-03
   */
  it('AC-713-03: --all with only foreign skills reports nothing to update', async () => {
    deploySkill('opencode', 'clipboard-vision');
    deploySkill('opencode', 'xlsx');

    const { updateSkill } = require('../update-skill');
    const code = await updateSkill(null, { all: true });

    expect(fx.output()).toMatch(/nothing to update|no skills installed/i);
    expect(fx.installSkillMock).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });
});

describe('update-skill #725 --check reads the disk, not the registry', () => {
  let tmpHome;
  let originalHome;
  let logSpy;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-725-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../update-skill')];
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
    logSpy.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function writeConfig(installedSkills) {
    const dir = path.join(tmpHome, '.config', 'xp-gate');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'xp-gate.json'), JSON.stringify({ installedSkills }));
  }

  // The bundled version these tests compare against is whatever the package under
  // test actually declares. Reading it keeps the fixtures honest across a release
  // bump: hardcoded stamps silently turn "up to date" fixtures into "behind" ones
  // the moment VERSION moves, and the failure then names /behind/i rather than the
  // stale literal that caused it.
  function bundledVersion() {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ).version;
  }

  /** The same release in the 4-part stamp form AGENTS.md files carry. */
  function bundledStamp() {
    const v = bundledVersion();
    return /^\d+\.\d+\.\d+$/.test(v) ? `${v}.0` : v;
  }

  /** Deploy a copy of a shipped skill into one platform, with a chosen stamp. */
  function deploy(platformRel, name, version) {
    const dir = path.join(tmpHome, platformRel, name);
    fs.mkdirSync(dir, { recursive: true });
    // SKILL.md is copied verbatim so a content comparison would call it current;
    // the version stamp is what must decide.
    const bundled = path.join(__dirname, '..', '..', 'skills', name, 'SKILL.md');
    fs.copyFileSync(bundled, path.join(dir, 'SKILL.md'));
    if (version) {
      fs.writeFileSync(
        path.join(dir, 'AGENTS.md'),
        `# KB\n\n**Version:** ${version}\n`
      );
    }
    return dir;
  }

  function lines() {
    return logSpy.mock.calls.map((c) => String(c[0]));
  }

  /**
   * @test REQ-725
   * @intent A copy stamped with an older version must be reported even when the registry says it is current
   * @covers AC-725-04
   */
  it('AC-725-04: reports a stale on-disk copy the registry calls current', async () => {
    writeConfig({ 'delphi-review': { version: bundledVersion() } });
    deploy(path.join('.qoder', 'skills'), 'delphi-review', bundledStamp());
    deploy(path.join('.config', 'opencode', 'skills'), 'delphi-review', '0.32.0.0');

    const { updateSkill } = require('../update-skill');
    await updateSkill(null, { check: true });

    const said = lines().join('\n');
    // The registry claims the bundled version for this skill, and it is right about Qoder.
    // It is wrong about OpenCode, and only reading the disk can say so.
    expect(said).toMatch(/delphi-review \[opencode\]: 0\.32\.0\.0/);
    expect(said).toMatch(/behind/i);
  });

  /**
   * @test REQ-725
   * @intent Two matching copies must report as up to date
   * @covers AC-725-04
   */
  it('AC-725-04: both copies current reports up to date and no shortfall', async () => {
    writeConfig({ 'delphi-review': { version: bundledVersion() } });
    deploy(path.join('.qoder', 'skills'), 'delphi-review', bundledStamp());
    deploy(path.join('.config', 'opencode', 'skills'), 'delphi-review', bundledStamp());

    const { updateSkill } = require('../update-skill');
    await updateSkill(null, { check: true });

    const said = lines().join('\n');
    expect(said).not.toMatch(/behind/i);
    expect(said).toMatch(/up to date on 2 platform/i);
  });

  /**
   * @test REQ-725
   * @intent A release whose micro digit is 0 must not be read as a different release
   * @covers AC-725-04
   */
  it('AC-725-04: a micro .0 stamp matches its own 3-part version', async () => {
    // The stamp and the packaged version name the SAME release; only their digit
    // count differs. This regressed once: normalization stripped every trailing
    // zero instead of the last segment, so `X.Y.0.0` became `X.Y.0` while
    // `X.Y.0` became `X.Y`, and a current copy was reported as behind. It was
    // invisible while releases ended in a non-zero micro digit, which is why the
    // assertion is built from the live packaged version rather than a literal:
    // it only has teeth on releases whose micro digit is 0.
    const three = bundledVersion();
    const four = bundledStamp();

    writeConfig({ 'delphi-review': { version: three } });
    deploy(path.join('.qoder', 'skills'), 'delphi-review', four);

    const { updateSkill } = require('../update-skill');
    await updateSkill(null, { check: true });

    const said = lines().join('\n');
    expect(said, `${four} and ${three} name the same release`).not.toMatch(/behind/i);
  });

  /**
   * @test REQ-725
   * @intent A skill with no version stamp must not be flagged merely for lacking one
   * @covers AC-725-05
   */
  it('AC-725-05: an unstamped copy identical to the bundle is not reported as behind', async () => {
    // Most skills ship no AGENTS.md, so "unknown" is their normal state. Measuring
    // staleness by absence of a stamp flagged every skill on a healthy machine.
    writeConfig({ 'admin-template-guidelines': { version: bundledVersion() } });
    deploy(path.join('.qoder', 'skills'), 'admin-template-guidelines', null);

    const { updateSkill } = require('../update-skill');
    await updateSkill(null, { check: true });

    expect(lines().join('\n')).not.toMatch(/behind/i);
  });
});
