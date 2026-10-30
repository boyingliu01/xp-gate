#!/bin/bash
# Changed-line coverage for Gate 5 (#600).
#
# Gate 5 compares GLOBAL coverage against a floor (default 80, hard floor 60).
# A commit that changes five lines and tests none of them passes as long as the
# global number has not dipped below that floor -- so the only thing the gate ever
# measured about a change was the average of everything else in the repo. 指南
# §10.1/§10.3 asks for three measures the repo never computed: changed-line
# coverage (>=90%), changed-branch coverage (>=85%), and module coverage that does
# not go DOWN.
#
# This library reads vitest's v8 `coverage/coverage-final.json` (already produced;
# the json reporter is on) plus the staged diff, and answers exactly one question
# per changed file: of the lines this commit touched, how many did the tests
# execute? Staged-only is deliberate -- the question is about the commit, and
# scanning the working tree would report on code that is not being committed.
#
# Fail-closed on unmeasurable inputs (#570): no coverage file, unparseable JSON, or
# a changed file absent from the coverage report all mean "not measured", and "not
# measured" must never render as "passed". The one legitimate absence is a file
# the coverage provider deliberately omits for being non-executable (type-only
# `.d.ts`, or a source with no statements at all) -- that is reported as `n/a`,
# not as 0%, because scoring it 0% would block every constants module.
#
# The whole computation lives in one node program rather than shell+awk because
# coverage-final.json is a nested object keyed by absolute path; parsing it in
# shell means three places to get the path normalisation wrong, and this repo has
# already paid for that mistake twice (#632, #633).

# Report one line per changed file: `<file> <covered> <total> <pct> <verdict>`.
#
# $1 = coverage-final.json path
# $2 = file with changed line ranges, one per line: `<path> <start> <end>`
# $3 = line-coverage threshold (default 90)
# $4 = branch-coverage threshold (default 85)
#
# Prints:
#   RESULT <covered> <total> <pct>          aggregate over all changed lines
#   MISSING <file>                          changed file with no coverage entry
#   UNCOVERED <file> <line> [<line>...]     individual uncovered changed lines
#   BRANCH <covered> <total> <pct>          aggregate over changed branches
#   NA <file>                               nothing executable changed
# and exits 0 when the aggregate meets both thresholds, 1 otherwise, 2 when the
# input could not be read at all (fail-closed).
compute_diff_coverage() {
  local coverage_file="$1" changes_file="$2"
  local line_threshold="${3:-90}" branch_threshold="${4:-85}"

  if [ ! -f "$coverage_file" ]; then
    echo "ERROR no_coverage_data"
    return 2
  fi
  if [ ! -f "$changes_file" ]; then
    echo "ERROR no_changes"
    return 2
  fi

  node -e '
    const fs = require("fs");
    const [covPath, chgPath, lineT, branchT] = process.argv.slice(1);
    const lineThreshold = Number(lineT);
    const branchThreshold = Number(branchT);

    let cov;
    try {
      cov = JSON.parse(fs.readFileSync(covPath, "utf8"));
    } catch (e) {
      console.log("ERROR unparsable_coverage");
      process.exit(2);
    }

    // Coverage keys are absolute paths emitted by the reporter; the diff paths are
    // repo-relative with forward slashes. Reduce both to a comparable suffix so a
    // Windows drive letter or a leading "./" cannot make every file "missing".
    const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    const bySuffix = new Map();
    for (const [absPath, entry] of Object.entries(cov)) {
      const n = norm(absPath);
      bySuffix.set(n, entry);
      // Also index by the trailing two segments so a repo-relative "src/x.ts"
      // can find "/abs/root/src/x.ts" without guessing the root.
      const segs = n.split("/");
      if (segs.length >= 2) bySuffix.set(segs.slice(-2).join("/"), entry);
    }
    const find = (p) => bySuffix.get(norm(p)) || bySuffix.get(norm(p).split("/").slice(-2).join("/"));

    // Changed line ranges, keyed by file.
    const wanted = new Map();
    for (const raw of fs.readFileSync(chgPath, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      if (parts.length !== 3) continue;
      const [file, s, e] = parts;
      const start = Number(s);
      const end = Number(e);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (!wanted.has(file)) wanted.set(file, []);
      wanted.get(file).push([start, end]);
    }

    let covLines = 0, totLines = 0, covBranches = 0, totBranches = 0;
    for (const [file, ranges] of wanted) {
      const entry = find(file);
      if (!entry) { console.log("MISSING " + file); continue; }

      // statementMap/s and branchMap/b are OBJECTS keyed by numeric string in the
      // v8 provider this repo uses (they are arrays under the babel provider).
      // Iterate whichever shape is present rather than assuming one.
      const stmts = Array.isArray(entry.statementMap)
        ? entry.statementMap.map((v, i) => [String(i), v])
        : Object.entries(entry.statementMap || {});
      const stmtHits = entry.s || {};
      const brs = Array.isArray(entry.branchMap)
        ? entry.branchMap.map((v, i) => [String(i), v])
        : Object.entries(entry.branchMap || {});
      const brHits = entry.b || {};

      const inRange = (ln) => ranges.some(([s, e]) => ln >= s && ln <= e);
      let fileTotal = 0, fileCov = 0;
      const uncovered = [];
      for (const [id, meta] of stmts) {
        const ln = meta && meta.start ? meta.start.line : (meta && meta.line);
        if (!ln || !inRange(ln)) continue;
        fileTotal++;
        if (Number(stmtHits[id] || 0) > 0) fileCov++;
        else uncovered.push(ln);
      }

      let fileBTotal = 0, fileBCov = 0;
      for (const [id, meta] of brs) {
        const ln = meta && meta.line ? meta.line : (meta && meta.loc && meta.loc.start ? meta.loc.start.line : 0);
        if (!ln || !inRange(ln)) continue;
        const counts = brHits[id];
        const arr = Array.isArray(counts) ? counts : [counts || 0];
        for (const c of arr) {
          fileBTotal++;
          if (Number(c) > 0) fileBCov++;
        }
      }

      covLines += fileCov; totLines += fileTotal;
      covBranches += fileBCov; totBranches += fileBTotal;

      if (fileTotal === 0 && fileBTotal === 0) { console.log("NA " + file); continue; }
      if (uncovered.length) {
        console.log("UNCOVERED " + file + " " + uncovered.join(" "));
      }
    }

    const pct = (c, t) => (t === 0 ? 100 : Math.round((c / t) * 1000) / 10);
    console.log("RESULT " + covLines + " " + totLines + " " + pct(covLines, totLines));
    console.log("BRANCH " + covBranches + " " + totBranches + " " + pct(covBranches, totBranches));

    // Nothing executable changed at all: not a failure, and not a pass either --
    // the caller decides (docs-only commits SKIP upstream).
    if (totLines === 0 && totBranches === 0) process.exit(0);
    const lineOk = totLines === 0 || pct(covLines, totLines) >= lineThreshold;
    const branchOk = totBranches === 0 || pct(covBranches, totBranches) >= branchThreshold;
    process.exit(lineOk && branchOk ? 0 : 1);
  ' "$coverage_file" "$changes_file" "$line_threshold" "$branch_threshold"
}

# Emit `<path> <start> <end>` triples for every added line range in the STAGED diff.
#
# Only files the coverage provider can measure are worth listing: a docs-only or
# config-only diff yields no rows, which makes the caller's "nothing executable
# changed" branch reachable instead of comparing 0/0.
#
# $1 = optional output file (defaults to stdout).
staged_added_line_ranges() {
  # Prints `<path> <start> <end>` to STDOUT; the caller redirects. Deliberately not
  # "print to $1": awk's `> file` redirect is not portable across the awk builds on
  # this project's target platforms (the Windows Git Bash awk silently wrote
  # nothing), and a range extractor that yields an empty list makes every diff
  # coverage result vacuously 100%.
  #
  # --unified=0 gives one `@@ -a,b +c,d @@` header per contiguous change, so the
  # added range is exactly +c,d and no context lines need filtering. A header with
  # no ",d" means a single-line change.
  git diff --cached --unified=0 --no-color --diff-filter=ACM 2>/dev/null \
    | awk '
        /^\+\+\+ / {
          path = $2
          sub(/^b\//, "", path)
          next
        }
        /^@@ / {
          if (path == "" || path == "/dev/null") next
          if (path !~ /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|cs|scala|sh|bats|ps1)$/) next
          line = $0
          sub(/^@@ [^+]*\+/, "", line)
          sub(/[^0-9,].*$/, "", line)
          n = split(line, parts, ",")
          start = parts[1] + 0
          len = (n > 1 ? parts[2] + 0 : 1)
          print path " " start " " (start + len - 1)
          next
        }
      '
  return 0
}

# Read a numeric threshold from .xp-gate/test-profile.yaml, falling back to the
# documented default (指南 §10.1: 90% lines, 85% branches) when the file or key is
# absent. Kept here, next to its only consumer, so the two can never drift.
#
# $1 = key name (diff_coverage_lines | diff_coverage_branches)
# $2 = default
diff_coverage_threshold() {
  local key="$1" fallback="$2" profile=".xp-gate/test-profile.yaml"
  if [ ! -f "$profile" ]; then
    printf '%s' "$fallback"
    return 0
  fi
  local value
  value=$(grep -E "^[[:space:]]*${key}[[:space:]]*:" "$profile" 2>/dev/null \
    | head -1 | sed 's/^[^:]*:[[:space:]]*//' | tr -d '"'"'"' \r')
  case "$value" in
    ''|*[!0-9.]*) printf '%s' "$fallback" ;;
    *) printf '%s' "$value" ;;
  esac
}
