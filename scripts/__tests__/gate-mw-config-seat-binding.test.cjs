/**
 * @test REQ-574
 * @intent Gate MW validated only INTERNAL consistency: three roles, three
 *         distinct requested_model values, three distinct resolved_model
 *         values, an explicit channel. Nothing ever compared that evidence
 *         against the seats the project actually configured, so evidence that
 *         was internally perfect while externally wrong passed the gate.
 *
 *         Measured 2026-10-22: a code walkthrough ran on
 *         s-deepseek-v4.1-flash / g-deepseek-v4-pro / doubao-seed-2.0-pro --
 *         none of them a seat in `.delphi-config.json`, which specified three
 *         local-* models -- and the walkthrough evidence recorded that fact
 *         verbatim (`channel: "external"`, requested_model
 *         `s-deepseek-v4.1-flash`) and still validated APPROVED. The rules
 *         demanded distinctness; the user had asked for identity.
 *
 *         The binding is therefore: when a `.delphi-config.json` exists, each
 *         expert's requested_model must be THAT role's configured seat.
 * @covers AC-574-01, AC-574-02, AC-574-03, AC-574-04, AC-574-05, AC-574-06, AC-574-07
 *
 * DESIGN NOTE (why the binding is opt-in on config presence, and why the
 * direction is requested_model -> config and never the reverse):
 *   - Projects without a `.delphi-config.json` keep working unchanged. Making
 *     the config mandatory would block every repo that reviews through another
 *     platform's channel, which is not what this defect is about.
 *   - The check reads the config's ACTIVE profile only, exactly like
 *     `plugins/dsh/src/delphi-config.ts` and `scripts/check_delphi_local_models.py`
 *     do. Comparing against a non-active profile would bless seats the operator
 *     did not select.
 *   - A role missing from the config is not silently skipped: with a config
 *     present, all three roles are required there too, otherwise removing the
 *     seat you dislike would be a one-line bypass.
 */

// vitest globals: true - no import needed
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Resolved from cwd rather than __dirname: vitest's CJS transform does not
// guarantee __dirname matches the file's real directory (same reasoning as
// gate-mw-provenance.test.cjs).
const VALIDATOR = join(process.cwd(), 'githooks', 'lib', 'validate-code-walkthrough.cjs');

const NOW = '2026-10-03T11:30:00.000Z';
const COMMIT = 'a'.repeat(40);
const BRANCH = 'sprint/2026-10-22-seat-binding';

const LOCAL_SEATS = {
  architecture: 'local-deepseek-v4-flash',
  technical: 'local-qwen3.8-flash',
  feasibility: 'local-qwen3.8-27b',
};

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'xpgate-574-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Build a `.delphi-config.json` in the documented profiles shape.
 * @param seats role -> model map for the active profile
 * @param active name of the profile to activate
 */
function delphiConfig(seats = LOCAL_SEATS, active = 'local') {
  const experts = {};
  for (const [role, model] of Object.entries(seats)) {
    experts[role] = { provider: 'whalecloud', model };
  }
  return {
    active_profile: active,
    profiles: {
      [active]: {
        providers: { whalecloud: { base_url: 'https://example.invalid/gpt-proxy', api_key: '${KEY}' } },
        experts,
      },
    },
    consensus: { threshold_percent: 90, max_review_rounds: 5, distinct_models_required: true },
  };
}

/**
 * Build an evidence document whose three experts report `seats`.
 * @param seats role -> requested model map; resolved_model mirrors it
 */
function evidenceFor(seats) {
  const roles = ['architecture', 'technical', 'feasibility'];
  return {
    commit: COMMIT,
    branch: BRANCH,
    verdict: 'APPROVED',
    timestamp: '2026-10-03T11:00:00.000Z',
    expires: '2026-10-03T12:00:00.000Z',
    consensus_ratio: 1.0,
    experts: roles.map((role) => ({
      role,
      verdict: 'APPROVED',
      result_type: 'delphi_expert_result',
      channel: 'external',
      requested_model: seats[role],
      // Uppercased so resolved_model is distinct from requested_model, mirroring
      // how a real gateway reports a different display id.
      resolved_model: `${seats[role]}-resolved`.toUpperCase(),
    })),
  };
}

/**
 * Write the fixture tree and run the validator.
 *
 * The project root is passed as the 5th argument, matching how pre-push calls
 * it (`"$RESULT_FILE" "$EXPECTED_COMMIT" "$CURRENT_BRANCH" "$CURRENT_TIME" "$PR_ROOT"`).
 * It is deliberately NOT implied by cwd: an earlier draft resolved the config
 * from `process.cwd()`, which made this very suite bind to xp-gate's own
 * `.delphi-config.json` when run from the repo root and broke the #423 tests.
 *
 * HOME/XDG_CONFIG_HOME are redirected at an empty temp dir for the same reason
 * (2026-10-27). The validator now falls back to the machine-wide config when the
 * project has none, so an unisolated run would read the DEVELOPER's real
 * `~/.config/xp-gate/.delphi-config.json` — making "no config => unbound"
 * pass or fail depending on whose machine the suite runs on. Options:
 *   - `globalConfig: {...}` writes that config into the isolated HOME and
 *     exercises the fallback deliberately;
 *   - omitting it leaves HOME truly empty, so `null` project config really
 *     means "no config anywhere".
 *
 * @param document evidence document
 * @param config `.delphi-config.json` contents, or null to omit the file
 * @param options.cwd directory to launch the validator from
 * @param options.globalConfig machine-wide config to place in an isolated HOME
 * @returns {exitCode, output}
 */
function run(document, config, options = {}) {
  const dir = makeTempDir();
  const projectRoot = join(dir, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const evidencePath = join(dir, 'evidence.json');
  writeFileSync(evidencePath, JSON.stringify(document), 'utf8');
  if (config !== null) {
    writeFileSync(join(projectRoot, '.delphi-config.json'), JSON.stringify(config), 'utf8');
  }
  // Isolated HOME: $HOME/.config/xp-gate/.delphi-config.json holds the
  // machine-wide config the validator falls back to.
  const fakeHome = join(dir, 'home');
  const globalDir = join(fakeHome, '.config', 'xp-gate');
  mkdirSync(globalDir, { recursive: true });
  if (options.globalConfig) {
    writeFileSync(join(globalDir, '.delphi-config.json'), JSON.stringify(options.globalConfig), 'utf8');
  }
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  delete env.XDG_CONFIG_HOME;
  const args = [VALIDATOR, evidencePath, COMMIT, BRANCH, NOW, projectRoot];
  try {
    const out = execFileSync('node', args, {
      cwd: options.cwd ?? projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    return { exitCode: 0, output: out };
  } catch (error) {
    return { exitCode: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('#574 Gate MW binds evidence to the configured Delphi seats', () => {
  it('AC-574-01: evidence matching all three configured seats PASSES', () => {
    const result = run(evidenceFor(LOCAL_SEATS), delphiConfig());

    expect(result.exitCode).toBe(0);
  });

  it('AC-574-01: no `.delphi-config.json` keeps the previous behaviour (unbound)', () => {
    const drifted = {
      architecture: 's-deepseek-v4.1-flash',
      technical: 'g-deepseek-v4-pro',
      feasibility: 'doubao-seed-2.0-pro',
    };

    const result = run(evidenceFor(drifted), null);

    expect(result.exitCode).toBe(0);
  });

  it('AC-574-02: the measured 2026-10-22 drift is BLOCKED when a config exists', () => {
    // The exact trio that ran the walkthrough while the config specified three
    // local-* seats. Internally consistent, externally wrong.
    const drifted = {
      architecture: 's-deepseek-v4.1-flash',
      technical: 'g-deepseek-v4-pro',
      feasibility: 'doubao-seed-2.0-pro',
    };

    const result = run(evidenceFor(drifted), delphiConfig());

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/requested_model/);
    expect(result.output).toMatch(/doubao-seed-2\.0-pro|s-deepseek-v4\.1-flash/);
  });

  it('AC-574-03: one drifted seat out of three is enough to BLOCK', () => {
    const oneDrifted = { ...LOCAL_SEATS, feasibility: 'doubao-seed-2.0-pro' };

    const result = run(evidenceFor(oneDrifted), delphiConfig());

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/feasibility/);
  });

  it('AC-574-04: seats swapped between roles are BLOCKED (identity, not just membership)', () => {
    // Both models are configured -- but under the wrong roles. A membership-only
    // check would wave this through; the reported role attribution would be a lie.
    const swapped = {
      architecture: LOCAL_SEATS.technical,
      technical: LOCAL_SEATS.architecture,
      feasibility: LOCAL_SEATS.feasibility,
    };

    const result = run(evidenceFor(swapped), delphiConfig());

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/requested_model/);
  });

  it('AC-574-05: only the ACTIVE profile is binding', () => {
    const config = {
      active_profile: 'local',
      profiles: {
        local: {
          providers: { whalecloud: { base_url: 'https://example.invalid/gpt-proxy', api_key: '${KEY}' } },
          experts: {
            architecture: { provider: 'whalecloud', model: LOCAL_SEATS.architecture },
            technical: { provider: 'whalecloud', model: LOCAL_SEATS.technical },
            feasibility: { provider: 'whalecloud', model: LOCAL_SEATS.feasibility },
          },
        },
        // Deliberately different seats in the inactive profile: evidence matching
        // THIS one must still be rejected.
        scratch: {
          providers: { whalecloud: { base_url: 'https://example.invalid/gpt-proxy', api_key: '${KEY}' } },
          experts: {
            architecture: { provider: 'whalecloud', model: 'scratch-a' },
            technical: { provider: 'whalecloud', model: 'scratch-b' },
            feasibility: { provider: 'whalecloud', model: 'scratch-c' },
          },
        },
      },
    };

    const activeMatch = run(evidenceFor(LOCAL_SEATS), config);
    expect(activeMatch.exitCode).toBe(0);

    const inactiveMatch = run(
      evidenceFor({ architecture: 'scratch-a', technical: 'scratch-b', feasibility: 'scratch-c' }),
      config
    );
    expect(inactiveMatch.exitCode).toBe(1);
  });

  it('AC-574-08: no project config falls back to the machine-wide config', () => {
    // The consolidation setup: one config at ~/.config/xp-gate/, no per-repo
    // copy. Before this fallback the seat check silently disappeared for that
    // setup, so the drift below passed while the gate reported PASS.
    const drifted = {
      architecture: 's-deepseek-v4.1-flash',
      technical: 'g-deepseek-v4-pro',
      feasibility: 'doubao-seed-2.0-pro',
    };

    const blocked = run(evidenceFor(drifted), null, { globalConfig: delphiConfig(LOCAL_SEATS) });
    expect(blocked.exitCode).toBe(1);
    expect(blocked.output).toMatch(/requested_model/);

    const accepted = run(evidenceFor(LOCAL_SEATS), null, { globalConfig: delphiConfig(LOCAL_SEATS) });
    expect(accepted.exitCode).toBe(0);
  });

  it('AC-574-09: a project config still WINS over the machine-wide one', () => {
    // Overrides stay possible: the fallback must not shadow a deliberate
    // per-repo choice.
    const projectSeats = {
      architecture: 'repo-a',
      technical: 'repo-b',
      feasibility: 'repo-c',
    };
    const machineSeats = {
      architecture: 'machine-a',
      technical: 'machine-b',
      feasibility: 'machine-c',
    };

    const usesProject = run(evidenceFor(projectSeats), delphiConfig(projectSeats), {
      globalConfig: delphiConfig(machineSeats),
    });
    expect(usesProject.exitCode).toBe(0);

    const rejectsMachine = run(evidenceFor(machineSeats), delphiConfig(projectSeats), {
      globalConfig: delphiConfig(machineSeats),
    });
    expect(rejectsMachine.exitCode).toBe(1);
  });

  it('AC-574-06: a config with an unresolvable active_profile FAILS closed', () => {
    // Mirrors selectProfile() in plugins/dsh/src/delphi-config.ts: a config that
    // names profiles but no usable active one cannot be turned into a review
    // setup, so it must not become a silent allow.
    const config = delphiConfig(LOCAL_SEATS, 'local');
    config.active_profile = 'does-not-exist';

    const result = run(evidenceFor(LOCAL_SEATS), config);

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/active_profile/);
  });

  it('AC-574-07: binding follows the named project root, not the launch cwd', () => {
    // Guards the defect an earlier draft shipped: resolving the config from
    // process.cwd() meant this suite bound to xp-gate's OWN
    // .delphi-config.json when it ran from the repo root, which broke the #423
    // provenance tests. Launch from a directory that HAS a conflicting config
    // while the named project root has none -- the evidence must stay unbound.
    const decoy = makeTempDir();
    writeFileSync(join(decoy, '.delphi-config.json'), JSON.stringify(delphiConfig()), 'utf8');

    const drifted = {
      architecture: 's-deepseek-v4.1-flash',
      technical: 'g-deepseek-v4-pro',
      feasibility: 'doubao-seed-2.0-pro',
    };

    // No config in the named project root => unbound, even though cwd has one.
    const unbound = run(evidenceFor(drifted), null, { cwd: decoy });
    expect(unbound.exitCode).toBe(0);

    // And the reverse: named root binds even when cwd has no config at all.
    const bound = run(evidenceFor(drifted), delphiConfig(), { cwd: decoy });
    expect(bound.exitCode).toBe(1);
    expect(bound.output).toMatch(/requested_model/);
  });

  // Two shapes, one reading. `.delphi-config.json`'s `experts` is documented as
  // either an object keyed by role (what xp-gate writes) or an array of records
  // carrying `role`. Only the OBJECT shape was ever exercised, so a mutation that
  // silently dropped every array-shape seat passed the whole suite (#599
  // mutation test: M1 survived). seatsFromExperts() is the one function that
  // reads both, and it was refactored in the same commit — these cases are what
  // makes that refactor safe.
  it('AC-574-10: the ARRAY experts shape binds seats too, not just the object shape', () => {
    const config = delphiConfig(LOCAL_SEATS, 'local');
    // Rewrite the active profile's experts from { role: {model} } to
    // [{ role, model }] -- the other documented shape.
    config.profiles.local.experts = Object.entries(LOCAL_SEATS).map(([role, model]) => ({
      provider: 'whalecloud',
      role,
      model,
    }));

    // Matching evidence passes...
    const passing = run(evidenceFor(LOCAL_SEATS), config);
    expect(passing.exitCode).toBe(0);

    // ...and drift is still caught, proving the seats were actually READ rather
    // than the array branch quietly resolving to "no seats configured".
    const drifted = {
      architecture: 's-deepseek-v4.1-flash',
      technical: 'g-deepseek-v4-pro',
      feasibility: 'doubao-seed-2.0-pro',
    };
    const blocked = run(evidenceFor(drifted), config);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.output).toMatch(/requested_model/);
  });

  it('AC-574-10: a seat entry using requested_model instead of model is honoured', () => {
    // The two shapes also differ in the key that carries the model id: xp-gate's
    // own configs use `model`, but a record captured from an actual expert run
    // carries `requested_model`. Both must resolve to the same seat.
    const config = delphiConfig(LOCAL_SEATS, 'local');
    config.profiles.local.experts = Object.entries(LOCAL_SEATS).map(([role, requested_model]) => ({
      role,
      requested_model,
    }));

    const result = run(evidenceFor(LOCAL_SEATS), config);

    expect(result.exitCode).toBe(0);
  });

  // A validator that cannot read its input must never conclude "nothing to
  // object to". `readEvidence()` used to be inline in main() and was split out in
  // #599; the mutation test on that split (M4: make the catch return `{}`) was
  // NOT caught by any test, because the message had never been asserted.
  it('AC-574-09: an unreadable evidence file FAILS closed instead of being treated as empty', () => {
    const dir = makeTempDir();
    const projectRoot = join(dir, 'project');
    mkdirSync(projectRoot, { recursive: true });
    const missing = join(dir, 'does-not-exist.json');

    let outcome;
    try {
      const out = execFileSync('node', [VALIDATOR, missing, COMMIT, BRANCH, NOW, projectRoot], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      outcome = { exitCode: 0, output: out };
    } catch (error) {
      outcome = { exitCode: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }

    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toMatch(/must exist and contain valid JSON/);
  });

  it('AC-574-09: a syntactically invalid evidence file FAILS closed with the same message', () => {
    const dir = makeTempDir();
    const projectRoot = join(dir, 'project');
    mkdirSync(projectRoot, { recursive: true });
    const broken = join(dir, 'broken.json');
    // Truncated JSON: the shape a half-written artifact actually takes.
    writeFileSync(broken, '{"commit": "aaaa", "verdict": ', 'utf8');

    let outcome;
    try {
      const out = execFileSync('node', [VALIDATOR, broken, COMMIT, BRANCH, NOW, projectRoot], {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      outcome = { exitCode: 0, output: out };
    } catch (error) {
      outcome = { exitCode: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }

    expect(outcome.exitCode).toBe(1);
    expect(outcome.output).toMatch(/must exist and contain valid JSON/);
  });
});
