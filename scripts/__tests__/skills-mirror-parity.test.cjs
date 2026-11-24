/**
 * AC-485-01..03 (issue #485): the six skill mirror trees are tracked
 * byte-copies of the canonical skills/ tree — a guard must fail when only
 * the canonical is edited and the mirrors are not re-copied.
 *
 * The PR #438 incident: skills/delphi-review/SKILL.md was edited, all six
 * mirrors fell behind, and only a manual re-copy at merge time saved it.
 * npm packaging (sync-package-content.js on prepack) re-copies into the
 * npm trees, so SHIPPED output is usually right — but in-repo readers and
 * gate behavior assertions see stale copies, and silent prepack overwrites
 * hide the historical drift instead of surfacing it.
 *
 * Lives on the `npm test` (vitest) path (never a guard that exists but
 * never runs — the #484 lesson).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CANONICAL = 'skills';
const MIRRORS = [
  'plugins/qoder/skills',
  'src/npm-package/skills',
  'src/npm-package/plugins/qoder/skills',
  'src/npm-package/plugins/claude-code/skills',
  'src/npm-package/plugins/opencode/skills',
  'src/npm-package/plugins/dsh/skills',
];

// Deliberate forks must be registered here as "<mirror>/<relpath>" — silence
// is never an acceptable state (AC-485-03). Empty today.
const EXEMPT = [];

// Directories the SHIPPED mirror never contains, so comparing them would demand
// the mirrors carry files the packaging step deliberately drops.
//
// `__tests__` is the one that matters: sync-package-content.js lists it in
// SKIP_DIRS because shipping a skill's own tests to end users is noise. A
// sprint-flow suite added under skills/sprint-flow/__tests__/ is therefore in the
// canonical tree and by design in no mirror -- and this guard, which walked the
// canonical tree unfiltered, read that correct packaging decision as drift.
//
// The tradeoff is that the exclusion now lives in one place (here) and must track
// SKIP_DIRS. What the guard is for is unchanged: a canonical edit that was never
// re-copied still fails, which is the PR #438 incident.
//
// `reinstall-xp-gate` is excluded on a different ground: it is NOT a shipped
// skill. It uninstalls and reinstalls xp-gate, so a copy living inside the
// package would delete itself mid-run; it is distributed to agent skill roots by
// its own installer instead. Demanding that every mirror carry it would force it
// back into the release chain.
const SKIP_DIRS = new Set(['__tests__', 'reinstall-xp-gate']);

/**
 * Walk a tree, returning forward-slash relative paths.
 *
 * An unreadable directory throws WITH THE PATH: returning an empty list instead
 * would make "this mirror is missing every file" and "this guard could not look"
 * produce the same diff, and the guard would report drift for a tree it never
 * actually read.
 */
function walkFiles(dir, base = dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`cannot read ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(p, base, out);
    } else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Content digest, naming the file when it cannot be read. */
function digest(p) {
  const crypto = require('crypto');
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch (err) {
    throw new Error(`cannot read ${p}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return crypto.createHash('sha256').update(buf).digest('hex');
}

describe('AC-485: the six skill mirror trees are byte-copies of skills/ (#485)', () => {
  let canonical;
  beforeAll(() => {
    canonical = {};
    for (const rel of walkFiles(path.join(ROOT, CANONICAL))) {
      canonical[rel] = digest(path.join(ROOT, CANONICAL, rel));
    }
  });

  it('the canonical tree has the expected baseline size (anti-vacuity)', () => {
    // 74 files at guard-writing time; #522 removed the clipboard-vision skill
    // (9 files), leaving 65. A sudden collapse (e.g. wrong cwd or a deleted
    // tree) must fail loudly instead of comparing empty to empty.
    expect(Object.keys(canonical).length).toBeGreaterThanOrEqual(60);
  });

  for (const mirror of MIRRORS) {
    it(`${mirror}: same file set and byte-identical content as skills/`, () => {
      const mDir = path.join(ROOT, mirror);
      expect(fs.existsSync(mDir)).toBe(true);
      const mFiles = new Set(walkFiles(mDir));
      const cFiles = new Set(Object.keys(canonical));

      const missing = [...cFiles].filter((f) => !mFiles.has(f));
      const extra = [...mFiles].filter((f) => !cFiles.has(f));
      const drifted = [...cFiles]
        .filter((f) => mFiles.has(f))
        .filter((f) => !EXEMPT.includes(`${mirror}/${f}`))
        .filter((f) => digest(path.join(mDir, f)) !== canonical[f]);

      const problems = [
        ...missing.map((f) => `missing in mirror: ${f}`),
        ...extra.map((f) => `extra in mirror (not in canonical): ${f}`),
        ...drifted.map((f) => `content drift: ${f} (edit canonical, then re-copy: cp -r skills/. ${mirror}/)`),
      ];
      expect(problems).toEqual([]);
    });
  }

  it('the exemption list only names files that actually exist (AC-485-03)', () => {
    for (const e of EXEMPT) {
      const p = path.join(ROOT, e);
      expect(fs.existsSync(p)).toBe(true);
    }
  });
});
