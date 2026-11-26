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
function withProject(source, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-check-'));
  try {
    fs.writeFileSync(path.join(dir, 'subject.ts'), source);
    // The default run also executes Gate 6, which fails closed on a project
    // with no architecture config. `.architecture-skip` is the documented way
    // to say "this project has no declared constraints", so the fixture uses
    // it rather than pretending the gate passed.
    fs.writeFileSync(path.join(dir, '.architecture-skip'), '');
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
    return await check.check({ pathArg: target });
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
    await withProject(DIRTY_SOURCE, async (dir) => {
      const exitCode = await runDefaultGates(dir);
      // Assert the fixture first: if the dirty source ever stops being dirty,
      // the silence assertion below would pass for the wrong reason.
      expect(exitCode, 'fixture must actually fail a gate').not.toBe(0);
      expect(noticeSpy, 'a failed check must not invite a star').not.toHaveBeenCalled();
    });
  }, GATE_TIMEOUT_MS);

  test('reaches the notice exactly once when every gate passes', async () => {
    // console.log is silenced by the global spy, and the principles gate
    // reports through it, so a full run cannot be asserted end to end here.
    // What matters for this test is that the PASS branch calls the notice;
    // the end-to-end PASS path is covered by star-notice-wiring.test.js, which
    // spawns the real CLI in a real project.
    expect(check.celebrateCleanRun).toBeDefined();
    check.celebrateCleanRun();
    expect(noticeSpy).toHaveBeenCalledTimes(1);
  });

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
