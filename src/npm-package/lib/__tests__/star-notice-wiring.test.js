/**
 * @test Issues #871 make the project discoverable from the CLI itself
 * @intent These tests EXECUTE the CLI, not grep its source. A wiring test that
 *         greps can pass while the call sits behind a dead branch -- exactly
 *         the "reported green, verified nothing" failure this repo exists to
 *         prevent, and the one three reviewers caught in the first draft.
 * @covers #871
 *
 * Every case spawns the real binary with an isolated HOME and fakes a TTY by
 * allocating a pseudo-terminal, because the notice's whole contract is
 * "interactive only".
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', '..', 'bin', 'xp-gate.js');
const NOTICE_MARK = 'a star helps others find it';
const CLI_TIMEOUT_MS = 60_000;
const CLEAN_SOURCE = 'const answer = 42;\nexport default answer;\n';
// Six parameters trips the too-many-arguments rule while the body stays honest.
const DIRTY_SOURCE = [
  'export function add(a: number, b: number, c: number, d: number, e: number, f: number): number {',
  '  return a + b + c + d + e + f;',
  '}',
  '',
].join('\n');

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-wiring-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Run the CLI with an isolated HOME. `tty: true` allocates a pty via `script`
 * so process.stdout.isTTY is genuinely true; without it the run is piped and
 * must stay silent.
 */
function runCli(args, { home, tty = false, env = {}, cwd, timeout = CLI_TIMEOUT_MS } = {}) {
  const childEnv = { ...process.env, HOME: home, ...env };
  const cmd = process.execPath;
  if (!tty) {
    const r = spawnSync(cmd, [BIN, ...args], { env: childEnv, cwd, encoding: 'utf8', timeout });
    return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
  }
  try {
    const stdout = execFileSync('script', ['-qec', `${cmd} ${BIN} ${args.join(' ')}`, '/dev/null'], {
      env: childEnv,
      cwd,
      encoding: 'utf8',
      timeout,
    });
    return { stdout, stderr: '', status: 0 };
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', status: e.status ?? 1 };
  }
}

const hasScript = detectScript();

/** @returns {boolean} whether a util-linux `script` is available for pty fakes. */
function detectScript() {
  try {
    execFileSync('which', ['script'], { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a TTY-dependent test only when a pty can be faked.
 *
 * A missing `script` FAILS the test rather than skipping it. A skipped test
 * is a green test, and the silent-on-pipe guarantee is the whole point of this
 * change: silently not checking it is the failure mode this repo exists to
 * prevent. The assertion exists so the environment problem is visible.
 */
function describeTty(name, fn) {
  describe(name, () => {
    if (!hasScript) {
      it('requires util-linux `script` to fake a TTY', () => {
        throw new Error(
          'Cannot verify the interactive-only contract: `script` is not installed. '
          + 'Install util-linux, or the notice may print into pipes unnoticed.',
        );
      });
      return;
    }
    fn();
  });
}

describe('REQ-871 the notice is reachable from the real CLI', () => {
  let home;

  beforeEach(() => {
    home = makeHome();
  });

  afterEach(() => cleanup(home));

  describe('xp-gate --version', () => {
    it('stays silent when stdout is piped', () => {
      const r = runCli(['--version'], { home });
      expect(r.stdout).toContain('xp-gate v');
      expect(r.stdout).not.toContain(NOTICE_MARK);
    });

    it('stays silent when CI is set even on a TTY', () => {
      const r = runCli(['--version'], { home, tty: true, env: { CI: 'true' } });
      expect(r.stdout).not.toContain(NOTICE_MARK);
    });

    describeTty('on a real TTY', () => {
      it('prints the invitation and records it', () => {
        const r = runCli(['--version'], { home, tty: true });
        expect(r.stdout).toContain(NOTICE_MARK);

        const config = JSON.parse(
          fs.readFileSync(path.join(home, '.config', 'xp-gate', 'xp-gate.json'), 'utf8'),
        );
        expect(typeof config.starNotice.lastShownAt).toBe('number');
      });

      it('does not print again on the same day', () => {
        runCli(['--version'], { home, tty: true });
        const second = runCli(['--version'], { home, tty: true });
        expect(second.stdout).not.toContain(NOTICE_MARK);
      });

      it('prints again once the recorded day has passed', () => {
        runCli(['--version'], { home, tty: true });
        const configFile = path.join(home, '.config', 'xp-gate', 'xp-gate.json');
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        config.starNotice.lastShownAt -= 2 * 24 * 60 * 60 * 1000;
        fs.writeFileSync(configFile, JSON.stringify(config));

        const again = runCli(['--version'], { home, tty: true });
        expect(again.stdout).toContain(NOTICE_MARK);
      });

      it('stays silent after `star-notice --off`', () => {
        const off = runCli(['star-notice', '--off'], { home });
        expect(off.status).toBe(0);

        const r = runCli(['--version'], { home, tty: true });
        expect(r.stdout).not.toContain(NOTICE_MARK);
        expect(r.stdout).toContain('xp-gate v');
      });

      it('does not nag when the config cannot be written', () => {
        // A read-only config dir is the case reviewers found: the write fails,
        // so the on-disk throttle is unavailable. The process guard must keep
        // a single invocation to a single notice.
        const cfgDir = path.join(home, '.config', 'xp-gate');
        fs.mkdirSync(cfgDir, { recursive: true });
        fs.chmodSync(cfgDir, 0o500);
        try {
          const r = runCli(['--version'], { home, tty: true });
          const occurrences = r.stdout.split(NOTICE_MARK).length - 1;
          expect(occurrences).toBe(1);
          expect(r.stdout).toContain('could not record');
        } finally {
          fs.chmodSync(cfgDir, 0o700);
        }
      });
    });
  });

  describe('xp-gate check', () => {
    it('stays silent on a piped run regardless of outcome', () => {
      const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-proj-'));
      try {
        fs.writeFileSync(path.join(proj, 'a.ts'), 'const a: number = 1;\nexport default a;\n');
        const r = runCli(['check', '.'], { home, cwd: proj });
        expect(r.stdout).not.toContain(NOTICE_MARK);
      } finally {
        cleanup(proj);
      }
    });

    describeTty('on a real TTY', () => {
      it('does not invite a star when a gate failed', () => {
        const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-proj-'));
        try {
          // A deliberately broken source file: the principles gate must reject
          // it. The fixture is asserted BEFORE the silence assertion -- a test
          // that skips itself when its fixture stops failing passes for the
          // wrong reason and is exactly what round 1 caught.
          fs.writeFileSync(path.join(proj, 'bad.ts'), DIRTY_SOURCE);
          const r = runCli(['check', '.'], { home, cwd: proj, tty: true });

          expect(r.status, 'fixture must actually fail a gate').not.toBe(0);
          expect(r.stdout).toMatch(/\d+\/\d+ gate\(s\) passed/);
          expect(r.stdout).not.toContain(NOTICE_MARK);
        } finally {
          cleanup(proj);
        }
      });

      it('invites a star when every gate passed', () => {
        const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'xp-gate-proj-'));
        try {
          fs.writeFileSync(path.join(proj, 'good.ts'), CLEAN_SOURCE);
          // Gate 6 fails closed without a config; declare no constraints.
          fs.writeFileSync(path.join(proj, '.architecture-skip'), '');
          const r = runCli(['check', '.'], { home, cwd: proj, tty: true });

          expect(r.status, 'fixture must pass every gate').toBe(0);
          expect(r.stdout).toContain(NOTICE_MARK);
        } finally {
          cleanup(proj);
        }
      });
    });
  });
});
