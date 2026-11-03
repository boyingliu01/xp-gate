/**
 * @test REQ-725
 * @intent `xp-gate update-skill --check` treated the flag itself as a skill name
 *         and failed with "--check is not installed". #347 fixed exactly this for
 *         --all and the sibling flag was left broken, so the regression is pinned
 *         here at the CLI boundary -- where the bug was -- rather than at the
 *         parser, which was never wrong.
 * @covers AC-725-03
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', '..', 'bin', 'xp-gate.js');

/** Run the real CLI against a throwaway HOME so no real install is touched. */
function runCli(args, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env,
    timeout: 120000,
  });
}

describe('update-skill flag parsing (#725)', () => {
  let home;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'xpg-725-cli-'));
    // An empty but present config dir keeps the command on the update path
    // instead of bailing out with "not installed" for the wrong reason.
    fs.mkdirSync(path.join(home, '.config', 'xp-gate'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.config', 'xp-gate', 'xp-gate.json'),
      JSON.stringify({ installedSkills: {} })
    );
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  /**
   * @covers AC-725-03
   */
  it('AC-725-03: --check is not mistaken for a skill name', () => {
    const result = runCli(['update-skill', '--check'], home);
    const said = `${result.stdout}\n${result.stderr}`;

    // The bug printed exactly this. Anything mentioning it means the flag went
    // through the name slot again.
    expect(said, '--check must not be read as a skill name').not.toMatch(/--check is not installed/i);
    // It should reach check mode instead: a listing pass, exit 0.
    expect(result.status).toBe(0);
  });

  /**
   * @covers AC-725-03
   */
  it('AC-725-03: --all --check keeps working (the combination #347 fixed)', () => {
    const result = runCli(['update-skill', '--all', '--check'], home);
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(/--all is not installed/i);
    expect(result.status).toBe(0);
  });

  /**
   * @covers AC-725-03
   */
  it('AC-725-03: a bare name still routes to the single-skill path', () => {
    // A name that is not installed must be rejected BY NAME -- proof the name
    // slot still works after the flag extraction.
    const result = runCli(['update-skill', 'definitely-not-a-skill'], home);
    const said = `${result.stdout}\n${result.stderr}`;
    expect(said).toMatch(/definitely-not-a-skill/);
  });
});
