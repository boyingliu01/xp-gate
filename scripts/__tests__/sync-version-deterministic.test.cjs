/**
 * @test REQ-757
 * @intent `npm ci` runs the root `prepare` hook, which runs scripts/sync-version.cjs.
 *         That script rewrote the AGENTS.md headers with per-run values (today's
 *         date, HEAD sha, current branch). Measured consequence: every CI install
 *         left 32 tracked files modified, so the mutation job's Stryker dry run --
 *         which executes the whole vitest suite, including the in-tree drift guard
 *         comparing src/principles against src/npm-package/principles -- failed on
 *         `expected [ Array(1) ] to deeply equal []` because
 *         `src/npm-package/principles/AGENTS.md` differed from its canonical copy.
 *         It failed that way on EVERY run and EVERY branch, and read as a test
 *         defect rather than an install hook dirtying the tree it prepares.
 *
 *         A prepare hook must be idempotent: running it twice on the same content
 *         must leave the tree unchanged. Date/sha/branch cannot satisfy that, so
 *         they must not be written at all.
 *
 *         These assertions read the script's source rather than executing it:
 *         sync-version.cjs resolves its root from `__dirname`, so any attempt to
 *         run it against a temp fixture writes into the real repository (this was
 *         measured -- the vitest worktree guard caught it).
 * @covers AC-757-01, AC-757-02
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'sync-version.cjs');
const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

/** The AGENTS.md header block, isolated so assertions below cannot match elsewhere. */
function agentsHeaderSection() {
  const start = src.indexOf('AGENTS.md 头部更新');
  if (start === -1) throw new Error('AGENTS.md header section not found in sync-version.cjs');
  return src.slice(start);
}

describe('sync-version.cjs is deterministic (REQ-757)', () => {
  it('AC-757-01: the AGENTS.md header no longer embeds the current date, sha or branch', () => {
    const section = agentsHeaderSection();
    // Node is forbidden here: a header that embeds the wall clock, HEAD, or the
    // branch name differs on every install by construction.
    const volatile = [
      { name: 'current date', pattern: /new Date\(\)/ },
      { name: 'HEAD sha', pattern: /rev-parse', '--short', 'HEAD/ },
      { name: 'branch name', pattern: /rev-parse', '--abbrev-ref'/ },
    ];
    const found = volatile.filter((v) => v.pattern.test(section)).map((v) => v.name);
    expect(found).toEqual([]);
  });

  it('AC-757-02: the version is still written from VERSION', () => {
    const section = agentsHeaderSection();
    // The one header field that is a property of the CONTENT, not of the run.
    expect(section).toMatch(/\\\*\\\*Version:\\\*\\\*/);
    expect(section).toMatch(/FULL_VERSION/);
  });

  it('AC-757-03: headers are written only when the value actually differs', () => {
    // Rewriting an identical file still bumps mtime and can race with readers;
    // the `changed` flag is what makes a no-op install a no-op.
    const section = agentsHeaderSection();
    expect(section).toMatch(/if \(changed\)/);
  });
});
