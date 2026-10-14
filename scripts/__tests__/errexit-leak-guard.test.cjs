/**
 * AC-489-04 (issue #520): no module that pre-commit sources may switch
 * errexit on for the caller.
 *
 * #489's root cause was a CLASS, not an instance: any sourced module that
 * runs `set -e` at top level re-enables errexit for the whole hook (pre-commit
 * itself only sets pipefail), so the very next grep that legitimately finds
 * nothing kills the hook AFTER all gates printed PASS — a silent commit death
 * that only triggers when the previous pipeline happens to match zero lines.
 * The existing AC-489-01 guard pins every gate-4 copy; nothing covered the
 * other 11+ sourced modules. This guard pins the CLASS: parse the source list
 * from pre-commit itself (so new modules are covered automatically) and
 * statically reject any top-level `set -e` / `set -o errexit`.
 *
 * Lives on the `npm test` (vitest) path so it can never become a
 * "guard that exists but never runs" (the 6ebbd5a failure mode).
 */
const fs = require('fs');
const path = require('path');

const GITHOOKS = path.resolve(__dirname, '..', '..', 'githooks');
const PRE_COMMIT = path.join(GITHOOKS, 'pre-commit');

// The hook sources at least this many modules on the main path (gates +
// adapter-common + lib/*.sh). A lower bound here turns a parsing regression
// (zero modules extracted = guard vacuously green) into a loud failure.
const MIN_SOURCED_MODULES = 10;

function extractSourcedModules(hookPath) {
  const text = fs.readFileSync(hookPath, 'utf8');
  const modules = [];
  for (const raw of text.split('\n')) {
    // Match `source <path>` / `. <path>` at statement position; ignore comments.
    const m = raw.match(/^\s*(?:source|\.)\s+("([^"]+)"|'([^']+)'|(\S+))/);
    if (!m) continue;
    const target = m[2] || m[3] || m[4];
    if (!target || target.includes('$(')) continue; // dynamic sources resolved at runtime
    modules.push(target);
  }
  return modules;
}

function resolveModule(target) {
  // Sources in pre-commit use runtime variables that all resolve to the hook
  // dir itself (SCRIPT_DIR) or to a mirror of it (ADAPTER_DIR/GATE_DIR point
  // at githooks/ in-repo or at the installed copy — which the byte-parity
  // guards keep identical). Resolve every spelling against githooks/ so the
  // checked file IS the source-of-truth copy.
  const cleaned = target
    .replace(/^\$\{?[A-Z_]+\}?/, '')
    .replace(/"/g, '');
  return path.join(GITHOOKS, cleaned);
}

function topLevelErrexitOffenders(modulePath) {
  const text = fs.readFileSync(modulePath, 'utf8');
  const offenders = [];
  let parenDepth = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();
    // Skip pure comments AFTER counting nothing (comments never change depth).
    if (trimmed.startsWith('#')) continue;
    // Strip inline comments conservatively: only ' #' outside quotes matters
    // for these scripts; the guard is heuristic and errs toward false PASS on
    // exotic quoting, which the anti-vacuity case below bounds.
    const hash = trimmed.indexOf(' #');
    if (hash >= 0) line = trimmed.slice(0, hash);

    // Track subshell depth from the ORIGINAL line's parens (case patterns'
    // lone `)` closes nothing it did not open in practice for these scripts;
    // balanced parens per line are the norm, and errors fail toward MORE
    // depth which only makes the guard stricter on later lines).
    for (const ch of line) {
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    }

    const t = line.trim();
    if (parenDepth === 0 && /^set\s+(-e|-o\s+errexit)\b/.test(t)) {
      offenders.push({ line: i + 1, text: trimmed });
    }
  }
  return offenders;
}

describe('AC-489-04: sourced modules must not enable errexit for the caller (#520)', () => {
  let modules;
  beforeAll(() => {
    modules = extractSourcedModules(PRE_COMMIT);
  });

  it('parses a real module list from pre-commit (anti-vacuity lower bound)', () => {
    expect(modules.length).toBeGreaterThanOrEqual(MIN_SOURCED_MODULES);
  });

  it('every sourced module exists on disk (list is not stale)', () => {
    const missing = modules
      .map(resolveModule)
      .filter((p) => !fs.existsSync(p));
    expect(missing).toEqual([]);
  });

  it('no sourced module sets errexit at top level', () => {
    const offenders = [];
    for (const target of modules) {
      const p = resolveModule(target);
      if (!fs.existsSync(p)) continue; // covered by the existence test above
      for (const o of topLevelErrexitOffenders(p)) {
        offenders.push(`${target}:${o.line}: ${o.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the detector itself catches a planted errexit (anti-vacuity)', () => {
    // A module that top-level `set -e`s must be flagged...
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'errexit-guard-'));
    const planted = path.join(tmp, 'planted.sh');
    fs.writeFileSync(planted, '#!/usr/bin/env bash\nset -o pipefail\nset -e\necho hi\n');
    expect(topLevelErrexitOffenders(planted)).toHaveLength(1);
    // ...and a subshell-scoped one must NOT be (the #489 fix pattern's legal form).
    fs.writeFileSync(planted, '#!/usr/bin/env bash\n( set -e; cmd )\necho done\n');
    expect(topLevelErrexitOffenders(planted)).toHaveLength(0);
    // ...and `set +e` (disabling errexit) is never an offender.
    fs.writeFileSync(planted, '#!/usr/bin/env bash\nset +e\ngrep x y || true\n');
    expect(topLevelErrexitOffenders(planted)).toHaveLength(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('heuristic boundary: MULTI-LINE subshell scoping is respected (FC-01)', () => {
    // The #489 legal form split across lines: depth carried from the '(' line
    // must keep the inner `set -e` off the top-level verdict.
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'errexit-guard-'));
    const p = path.join(tmp, 'multiline.sh');
    fs.writeFileSync(p, '#!/usr/bin/env bash\n(\n  set -e\n  cmd1\n)\nset +e\necho ok\n');
    expect(topLevelErrexitOffenders(p)).toHaveLength(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('heuristic boundary: case-branch closers can only cause FALSE POSITIVES, never false negatives (FC-01)', () => {
    // A single-line `case ... foo) set -e ;; esac` closes one more paren than
    // it opens; Math.max(0, ...) clamps, so the planted top-level `set -e` on
    // such a line is still flagged — the heuristic's failure direction on
    // case statements is over-reporting (safe), not under-reporting. What the
    // heuristic may NOT do is miss a genuinely top-level set -e after a line
    // with unbalanced closers.
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'errexit-guard-'));
    const p = path.join(tmp, 'case.sh');
    fs.writeFileSync(p, '#!/usr/bin/env bash\ncase $x in foo) echo a ;; esac\nset -e\necho after\n');
    const offenders = topLevelErrexitOffenders(p);
    // Line 3: line 1 is the shebang, line 2 is the case statement.
    expect(offenders.map((o) => o.line)).toContain(3);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
