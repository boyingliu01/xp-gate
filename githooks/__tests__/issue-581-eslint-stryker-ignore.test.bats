#!/usr/bin/env bats
# @test REQ-581
# @intent `npx eslint .` must report the same result on a developer machine as in
#         CI. It does not, because Stryker leaves sandbox copies of `src/` inside
#         `.stryker-tmp/sandbox-*/`, and ESLint was not told to ignore them.
#
#         Measured on a machine that had run mutation testing:
#
#             $ npx eslint . --max-warnings 0
#             ✖ 73 problems (64 errors, 9 warnings)
#
#         versus 8 warnings in CI for the same commit. The 64 errors are all
#         inside `.stryker-tmp/sandbox-*/`, which `.gitignore` already excludes
#         (`:119 .stryker-tmp/`) but the ESLint flat config did not.
#
#         The consequence is worse than noise: a lint failure that reproduces only
#         on machines that ran Stryker. It either burns time chasing phantom
#         errors or, more likely, teaches people that a red `npm run lint` is not
#         meaningful — which is how real failures start getting waved through.
#
#         Pin: every path `.gitignore` treats as generated-and-not-source that
#         ESLint can walk into must also be in the ESLint `ignores` list.
# @covers AC-581-01, AC-581-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  CFG="$REPO_ROOT/eslint.config.js"
  GITIGNORE="$REPO_ROOT/.gitignore"
}

# Read the effective ignore list by ASKING ESLint, not by pattern-matching the
# config text. A regex over the source broke the moment the array stopped being
# a single line, which is exactly what the fix does — so the check would have
# failed for a correct fix.
ignores_list() {
  # CFG is an MSYS-style path under Git Bash (/d/projects/...), which is not a
  # valid file URL. Convert it through node's pathToFileURL so the same test
  # works on Windows and POSIX.
  node -e '
    (async () => {
      const { pathToFileURL } = await import("node:url");
      const cfg = (await import(pathToFileURL(process.env.CFG_PATH).href)).default;
      const flat = Array.isArray(cfg) ? cfg : [cfg];
      const out = flat.flatMap((c) => (c && Array.isArray(c.ignores) ? c.ignores : []));
      console.log(out.join("\n"));
    })().catch((e) => { console.error(e.message); process.exit(1); });
  '
}

@test "AC-581-01: the Stryker sandbox is excluded from linting" {
  local ignores
  ignores=$(CFG_PATH="$CFG" ignores_list) || {
    echo "could not load the ESLint config"
    return 1
  }
  [ -n "$ignores" ] || {
    echo "the ESLint config declares no ignores"
    return 1
  }
  # .gitignore already excludes it; ESLint must agree, or local and CI diverge.
  grep -qE '^\.stryker-tmp/' "$GITIGNORE" || {
    echo ".gitignore no longer excludes .stryker-tmp/ -- this test's premise is gone"
    return 1
  }
  echo "$ignores" | grep -q 'stryker' || {
    echo ".stryker-tmp/ is gitignored but not in the ESLint ignores list; local lint scans mutation sandboxes"
    echo "ignores: $(echo "$ignores" | tr '\n' ' ')"
    return 1
  }
}

@test "AC-581-02: the other local-only build outputs stay excluded" {
  # Adding one entry must not be a rewrite: the existing exclusions are what keep
  # CI and local comparable in the first place.
  local ignores
  ignores=$(CFG_PATH="$CFG" ignores_list) || return 1
  for entry in 'node_modules' 'dist' 'coverage'; do
    echo "$ignores" | grep -q "$entry" || {
      echo "existing ignore '$entry' disappeared from eslint.config.js"
      return 1
    }
  done
}
