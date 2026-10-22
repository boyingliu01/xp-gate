#!/usr/bin/env bats
# @test REQ-569
# @intent The DSH plugin's test suite was collected by nobody. Both copies were
#         excluded in `vitest.config.ts`:
#
#             plugins/**                      <- canonical source
#             src/npm-package/plugins/**      <- byte-identical mirror
#
#         The comment above the list reasoned only about mirror double-running,
#         and it was right about that half — the 10 files under
#         `src/npm-package/plugins/dsh/src/` really are byte-identical to the 10
#         under `plugins/dsh/src/`. But excluding BOTH sides of a mirrored pair
#         does not halve the work, it deletes it.
#
#         Measured: the full suite collected 0 files under `plugins/dsh/`, while
#         the same files run in isolation are 10/10 files and 88/88 tests green
#         in 2.6s. The plugin shipped with zero test protection for as long as
#         that exclude entry existed, and nothing anywhere said so.
#
#         This is the same failure shape as the vitest coverage threshold that
#         was never applied (#562) and the Gate 4 directory that checked zero
#         files (#565): a safety net that exists, wired to nothing, reporting
#         success. The guard below asserts the *property* — a mirrored test pair
#         must have at least one collected side — rather than pinning the literal
#         exclude list, so moving the canonical side around does not silently
#         reintroduce the hole.
# @covers AC-569-01, AC-569-02, AC-569-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  VITEST_CONFIG="$REPO_ROOT/vitest.config.ts"
}

# Extract the `exclude:` array from the TEST block.
#
# Full-line `//` comments are blanked so a pattern quoted inside an explanation
# cannot satisfy an assertion. Block comments are NOT stripped: the glob `/**`
# starts with `/*`, and a comment stripper eats every pattern after it —
# measured, that collapsed all 17 patterns into one garbage string.
test_exclude_patterns() {
  node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8");
const noLine = raw.split("\n").map(l => (l.trimStart().startsWith("//") ? "" : l)).join("\n");
// The TEST-level exclude is the first `exclude:` in the file; the coverage block
// has its own further down.
const at = noLine.indexOf("exclude:");
if (at < 0) { console.error("no exclude: found"); process.exit(1); }
const start = noLine.indexOf("[", at);
const end = noLine.indexOf("]", start);
if (start < 0 || end < 0) { console.error("malformed exclude: array"); process.exit(1); }
const pats = [...noLine.slice(start + 1, end).matchAll(/["\x27]([^"\x27]+)["\x27]/g)].map(m => m[1]);
if (pats.length === 0) { console.error("exclude: array is empty"); process.exit(1); }
process.stdout.write(pats.join("\n"));
' "$VITEST_CONFIG"
}

@test "AC-569-01: the canonical DSH plugin tests are not excluded wholesale" {
  local pats
  pats="$(test_exclude_patterns)"
  [ -n "$pats" ]

  # A bare `plugins/**` would re-create the hole: it swallows the canonical
  # source that the mirror exclusion depends on.
  if printf '%s\n' "$pats" | grep -qxF 'plugins/**'; then
    echo "plugins/** is excluded again; both sides of the mirror pair are gone"
    return 1
  fi
}

@test "AC-569-02: a mirrored test pair keeps at least one collected side" {
  local canonical="$REPO_ROOT/plugins/dsh/src"
  local mirror="$REPO_ROOT/src/npm-package/plugins/dsh/src"

  # The premise: these really are mirrors, and the mirror really is excluded.
  [ -d "$canonical" ]
  [ -d "$mirror" ]
  local pats
  pats="$(test_exclude_patterns)"
  printf '%s\n' "$pats" | grep -qxF 'src/npm-package/plugins/**' || {
    echo "mirror is no longer excluded; this guard no longer describes the config"
    return 1
  }

  # The property: the canonical side must NOT be caught by any exclude pattern.
  # Checked in Node so the glob semantics match what vitest uses, and against the
  # real file paths rather than the directory name.
  node -e '
const fs = require("fs");
const [configPath, dir] = process.argv.slice(1);
const raw = fs.readFileSync(configPath, "utf8");
// Same rule as test_exclude_patterns: blank full-line comments only. A glob
// starting with "/**" is not a block comment, and stripping block comments
// swallows every pattern after it.
const noLine = raw.split("\n").map(l => (l.trimStart().startsWith("//") ? "" : l)).join("\n");
const at = noLine.indexOf("exclude:");
const start = noLine.indexOf("[", at);
const end = noLine.indexOf("]", start);
const pats = [...noLine.slice(start + 1, end).matchAll(/["\x27]([^"\x27]+)["\x27]/g)].map(m => m[1]);
const files = fs.readdirSync(dir).filter(f => /\.test\.[tj]s$/.test(f));
if (files.length === 0) { console.error("no test files in " + dir); process.exit(1); }
// Minimal glob -> regexp. One single-pass substitution, longest token first:
// a staged replace (`**/` -> sentinel, then `**`, then `*`) mis-handles `/**`
// because the `*` left behind by the first stage is consumed by the last —
// measured, `plugins/**` compiled to /^plugins\/.[^/]*$/, which matched a single
// character and so reported "not excluded" for every real path.
const toRe = p => {
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const body = escaped.replace(/\*\*\/|\*\*|\*/g, m =>
    m === "**/" ? "(?:.*/)?" : m === "**" ? ".*" : "[^/]*"
  );
  return new RegExp("^" + body + "$");
};
const res = pats.map(toRe);
const excluded = files.filter(f => {
  const rel = "plugins/dsh/src/" + f;
  return res.some(r => r.test(rel));
});
if (excluded.length === files.length) {
  console.error("every canonical plugin test is excluded: " + excluded.join(", "));
  process.exit(1);
}
' "$VITEST_CONFIG" "$canonical"
}

@test "AC-569-03: vendored plugin dependencies stay out of the collection" {
  # Anti-vacuity for the fix: dropping `plugins/**` must not drag
  # `plugins/opencode/node_modules/` (156 vendored zod test files) into the run.
  local pats
  pats="$(test_exclude_patterns)"
  printf '%s\n' "$pats" | grep -qxF 'plugins/*/node_modules/**' || {
    echo "no vendored-plugin exclusion; the fix would collect dependency tests"
    return 1
  }
}
