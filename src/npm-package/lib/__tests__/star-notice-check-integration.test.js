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

  /**
   * Run `check(['.'])` with `principles` replaced by `verdict`, on a freshly
   * required check.js so the replacement is the binding it captured.
   *
   * Returns the exit code and how many times the notice was reached.
   */
  async function checkWithPrinciplesVerdict(verdict, spy) {
    const principlesModule = require('../principles.js');
    const original = principlesModule.principles;
    const checkPath = require.resolve('../check.js');
    const cachedCheck = require.cache[checkPath];

    principlesModule.principles = async () => verdict;
    delete require.cache[checkPath];
    try {
      const fresh = require('../check.js');
      const exitCode = await fresh.check(['.']);
      return { exitCode, noticeCalls: spy.mock.calls.length };
    } finally {
      principlesModule.principles = original;
      if (cachedCheck) require.cache[checkPath] = cachedCheck;
      else delete require.cache[checkPath];
    }
  }

  test('stays silent when a gate fails, and the stub is proven to be in effect', async () => {
    // Two reviewers objected, correctly, that neither the stub nor the branch
    // is proven by asserting a single exit code. This is a differential
    // experiment: the SAME harness is run with the stub returning 0 and 1.
    // If the replacement were ignored, both runs would produce the same exit
    // code, because the real gates pass on this checkout. They do not.
    vi.restoreAllMocks();
    const spy = vi.spyOn(starNotice, 'maybeShowStarNotice').mockImplementation(() => true);
    const mute = () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    };

    try {
      mute();
      const passing = await checkWithPrinciplesVerdict(0, spy);
      vi.restoreAllMocks();
      const spy2 = vi.spyOn(starNotice, 'maybeShowStarNotice').mockImplementation(() => true);
      mute();
      const failing = await checkWithPrinciplesVerdict(1, spy2);

      // Differential: the verdict drives the exit code, so the stub is consumed.
      expect(passing.exitCode, 'stub 0 must yield a passing run').toBe(0);
      expect(failing.exitCode, 'stub 1 must yield a failing run').toBe(1);

      // And the branch: a passing run reaches the notice, a failing one does not.
      expect(passing.noticeCalls, 'a passing run invites a star').toBe(1);
      expect(failing.noticeCalls, 'a failing run must not').toBe(0);
    } finally {
      vi.restoreAllMocks();
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
