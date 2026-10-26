/**
 * @test REQ-631
 * @intent `buildPlugin` was a single CCN-14 function: two platform guards, two
 *         directory guards, a clean loop, the copy, and a missing-skill count,
 *         all in one body. It was split into named helpers (validatePlatform,
 *         isDirectory, cleanSkillsTarget, missingSkills, failWhen). This test
 *         pins the BEHAVIOUR of the two helpers that decide outcomes —
 *         isDirectory and missingSkills — because the pre-existing suite only
 *         reads the script's source shape (the REQ-624 spawn invariant) and would
 *         stay green if either helper silently changed its answer.
 *
 *         The helpers live in an ESM `.mjs` module, which this vitest config
 *         evaluates as CommonJS and cannot `require` directly. They are therefore
 *         exercised through `node --input-type=module` in a child process —
 *         which also proves the module loads cleanly as ESM, as `npm pack` will.
 * @covers AC-631-01, AC-631-02, AC-631-03
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-plugin.mjs');

/** Run an ESM snippet in a child node process rooted at the repo. */
function runEsm(body) {
  const modUrl = 'file://' + SCRIPT.replace(/\\/g, '/');
  const source = `import { isDirectory, missingSkills } from ${JSON.stringify(modUrl)};\n${body}`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-bp-'));
}

describe('AC-631-01: isDirectory distinguishes files, missing paths and directories', () => {
  it('is true only for a real directory', () => {
    const r = runEsm(`
      console.log(JSON.stringify({
        dir: isDirectory(${JSON.stringify(REPO_ROOT)}),
        file: isDirectory(${JSON.stringify(SCRIPT)}),
        missing: isDirectory(${JSON.stringify(path.join(REPO_ROOT, 'no-such-path-xyz'))}),
      }));
    `);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ dir: true, file: false, missing: false });
  });
});

describe('AC-631-02: missingSkills reports exactly the absent SKILL.md files', () => {
  it('lists a skill when its SKILL.md is absent, and omits it once present', () => {
    const pluginDir = makeTempDir();
    try {
      const before = runEsm(`console.log(JSON.stringify(missingSkills(${JSON.stringify(pluginDir)})));`);
      expect(before.status).toBe(0);
      const missingBefore = JSON.parse(before.out);
      expect(missingBefore.length).toBeGreaterThan(0);

      const first = missingBefore[0];
      const skillDir = path.join(pluginDir, 'skills', first);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill\n');

      const after = runEsm(`console.log(JSON.stringify(missingSkills(${JSON.stringify(pluginDir)})));`);
      const missingAfter = JSON.parse(after.out);
      expect(missingAfter).not.toContain(first);
      expect(missingAfter.length).toBe(missingBefore.length - 1);
    } finally {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    }
  });
});

describe('AC-631-03: the CLI rejects a bad platform without doing any work', () => {
  function runCli(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  }

  it('exits 1 and names the expected platforms when --platform is unknown', () => {
    const r = runCli(['--platform', 'nope']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('claude-code');
    expect(r.stderr).toContain('got: nope');
  });

  it('exits 1 with usage when no platform is given', () => {
    const r = runCli([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Usage:');
  });
});
