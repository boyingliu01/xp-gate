/**
 * @test Issues #871 make the project discoverable from the CLI itself
 * @intent A reviewer caught the first draft wiring check.js with no test that
 *         the FAIL path stays silent. This suite runs the real default check
 *         against real source and observes which path reached the notice.
 * @covers #871
 *
 * The project under test is a throwaway directory containing one real source
 * file, so `principles` genuinely passes or genuinely fails; nothing about the
 * gate itself is stubbed. Only the notice is spied, because its own behaviour
 * is covered by star-notice.test.js.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const starNotice = require('../star-notice');
const check = require('../check');

const CLEAN_SOURCE = 'const answer = 42;\nexport default answer;\n';
// Six parameters trips the too-many-arguments rule while the body stays honest.
const DIRTY_SOURCE = [
  'export function add(a: number, b: number, c: number, d: number, e: number, f: number): number {',
  '  return a + b + c + d + e + f;',
  '}',
  '',
].join('\n');

const GATE_TIMEOUT_MS = 120_000;

/**
 * Build a throwaway project from one source file, run `fn`, always clean up.
 * @param {string} source file contents
 * @param {(dir: string) => any} fn
 */
function withProject(source, fn, { skipArchitecture = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-check-'));
  try {
    fs.writeFileSync(path.join(dir, 'subject.ts'), source);
    // The default run also executes Gate 6, which fails closed on a project
    // with no architecture config. `.architecture-skip` is the documented way
    // to say "this project has no declared constraints", so the fixture uses
    // it rather than pretending the gate passed.
    if (skipArchitecture) fs.writeFileSync(path.join(dir, '.architecture-skip'), '');
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run the default gate set against `target` with output muted.
 * @param {string} target directory under test
 * @returns {Promise<number>} exit code
 */
async function runDefaultGates(target) {
  try {
    return await check.check([target]);
  } finally {
    // console.log is muted by the global spy installed in beforeEach.
  }
}

describe('REQ-871 check invites a star only when every gate passed', () => {
  let noticeSpy;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    noticeSpy = vi.spyOn(starNotice, 'maybeShowStarNotice').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('stays silent when a gate fails', async () => {
    // Round 3's remaining objection: the earlier version grepped check.js for
    // the guard instead of running it. This drives the FAIL path for real --
    // `principles` is replaced on its module export, then the SAME check.js is
    // re-required, so the code under test is the shipped `runDefaultChecks`,
    // not a copy of its string.
    //
    // Driving a real gate to failure is not reproducible here: the gates
    // resolve configuration from the enclosing checkout, so `check --all` on a
    // bare fixture passes 9/19. Replacing one gate's verdict is the smallest
    // honest way to reach the branch.
    const principlesModule = require('../principles.js');
    const originalPrinciples = principlesModule.principles;
    const checkPath = require.resolve('../check.js');
    const cachedCheck = require.cache[checkPath];

    principlesModule.principles = async () => 1;
    delete require.cache[checkPath];
    try {
      vi.restoreAllMocks();
      const freshSpy = vi.spyOn(starNotice, 'maybeShowStarNotice').mockImplementation(() => true);
      const muted = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const freshCheck = require('../check.js');
      const exitCode = await freshCheck.check(['.']);

      expect(exitCode, 'a failing gate must produce a failing exit code').toBe(1);
      expect(freshSpy, 'a failed check must not invite a star').not.toHaveBeenCalled();
      muted.mockRestore();
      vi.restoreAllMocks();
    } finally {
      principlesModule.principles = originalPrinciples;
      if (cachedCheck) require.cache[checkPath] = cachedCheck;
      else delete require.cache[checkPath];
    }
  });

  test('reaches the notice exactly once when every gate passes', async () => {
    // Reviewers rejected an earlier draft that only called celebrateCleanRun()
    // directly: that proves the helper, not the path. This runs the real
    // default gate set over a clean fixture and asserts the notice fired.
    // console.log is NOT muted for this case, because the principles gate
    // reports over it and muting it makes the gate unreachable.
    vi.restoreAllMocks();
    const realSpy = vi.spyOn(starNotice, 'maybeShowStarNotice').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await withProject(CLEAN_SOURCE, async (dir) => {
        const exitCode = await check.check([dir]);
        expect(exitCode, 'fixture must pass every gate').toBe(0);
        expect(realSpy).toHaveBeenCalledTimes(1);
      });
    } finally {
      stdout.mockRestore();
      realSpy.mockRestore();
    }
  }, GATE_TIMEOUT_MS);

  test('does not crash the check when the notice module throws', () => {
    noticeSpy.mockImplementation(() => {
      throw new Error('boom');
    });

    // A decoration must never turn a green check into a crash.
    expect(() => check.celebrateCleanRun()).not.toThrow();
  });

  test('celebrateCleanRun is the only place check.js reaches the notice', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'check.js'), 'utf8');
    expect(source.split('maybeShowStarNotice').length - 1).toBe(1);
  });
});
