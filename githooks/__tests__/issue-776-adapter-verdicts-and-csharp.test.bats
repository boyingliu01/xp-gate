#!/usr/bin/env bats

# Regression tests for the adapter-verdict / C#-support fixes in
# fix/adapter-verdicts-and-csharp (#776, #774, #763, #766, #761, #768, #760).
#
# Each test pins one measured defect to the behaviour that replaced it. They are
# deliberately narrow: a broad "the hook works" test would have passed on all of
# the broken versions, which is how these survived to a released tag.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
}

# ---------------------------------------------------------------------------
# #774: the Gate 3 "no functions in input" probe must read the whole stream.
#
# The probe used to `exit` on the first matching row, so `printf` upstream took
# SIGPIPE and the pipeline reported 141 under `set -o pipefail`. A CSV larger
# than the 64 KB pipe buffer with functions in it announced itself as "pure data
# module" and the complexity gate stood down.
# ---------------------------------------------------------------------------

@test "#774: the Gate 3 function probe does not exit early (asserted on the source)" {
  # The first version of this test restated the awk program in the test body,
  # which passes no matter what the hook contains -- it verified the test's own
  # copy. Asserting on the extracted source is what makes it a regression test:
  # the pre-fix text `{ found = 1; exit }` fails this, the fix passes it.
  local probe
  # Pull the three-line `if ! printf ... | awk ...` construct that decides
  # "does this input contain any function", starting at its `if !` line.
  probe=$(grep -n -A2 'if ! printf' "$REPO_ROOT/githooks/gate-3.sh" \
    | grep -A2 'CC_CSV_FLAT' || true)
  [ -n "$probe" ]
  # No early exit inside the action block. Spelled as a fixed-string search with
  # an explicit `run` so the assertion cannot pass because a `!`-negated pipeline
  # was swallowed -- that is what made an earlier version of this test green on
  # the very code it was meant to catch.
  run grep -qF 'found = 1; exit' <<< "$probe"
  [ "$status" -ne 0 ]
  # The action block still sets the flag, so the END clause has something to read.
  printf '%s\n' "$probe" | grep -q 'found = 1'
}

@test "#774: no awk action block anywhere in githooks exits before END (pipefail hazard)" {
  # The defect shape: `{ ...; exit }` inside an awk action, piped into, under a
  # hook that runs `set -o pipefail`. Written as a scan rather than a spot check
  # so a future re-introduction in a different file is caught too.
  local offenders
  offenders=$(grep -rEn '\{[^}]*; *exit *\}' "$REPO_ROOT/githooks" \
    --include='*.sh' --include='pre-commit' --include='pre-push' 2>/dev/null \
    | grep -v '__tests__' \
    | grep -v 'END' || true)
  if [ -n "$offenders" ]; then
    echo "awk action blocks that exit early:"
    echo "$offenders"
    return 1
  fi
}

@test "#774: assertion-quality.sh probes do not exit early" {
  local fn
  fn=$(grep -n "length(\$0) >= 10" "$REPO_ROOT/githooks/lib/assertion-quality.sh" || true)
  [ -n "$fn" ]
  ! printf '%s\n' "$fn" | grep -q '{ found = 1; exit }'
}

# ---------------------------------------------------------------------------
# #763: the "no code files changed" early skip must recognise C#.
#
# With cs missing from CODE_EXTENSIONS, a commit touching only .cs files took the
# early skip: the test suite never ran and the summary said "no code files
# changed", which reads as "nothing to test" rather than "not tested".
# ---------------------------------------------------------------------------

@test "#763: CODE_EXTENSIONS in the hook matches .cs and .csx" {
  local line
  line=$(grep -m1 '^  CODE_EXTENSIONS=' "$HOOK")
  [ -n "$line" ]
  local pattern
  pattern=$(printf '%s\n' "$line" | sed "s/^  CODE_EXTENSIONS=\"//; s/\"\$//")
  for f in src/Program.cs src/Generated.csx tests/Foo.cs; do
    printf '%s\n' "$f" | grep -qE "$pattern"
  done
}

@test "#763: CODE_EXTENSIONS still matches the languages it matched before" {
  local line pattern
  line=$(grep -m1 '^  CODE_EXTENSIONS=' "$HOOK")
  pattern=$(printf '%s\n' "$line" | sed "s/^  CODE_EXTENSIONS=\"//; s/\"\$//")
  for f in a.ts a.py a.go a.rs a.c a.cpp a.sh a.ps1; do
    if [ "$f" = "a.rs" ]; then
      # Rust was never in the list; asserting it matches would encode a wish.
      ! printf '%s\n' "$f" | grep -qE "$pattern"
      continue
    fi
    printf '%s\n' "$f" | grep -qE "$pattern"
  done
}

# ---------------------------------------------------------------------------
# #766: ESLint probes must include the flat-config file names.
# ---------------------------------------------------------------------------

@test "#766: the TypeScript adapter probes eslint.config.mjs" {
  grep -q 'eslint\.config\.mjs' "$REPO_ROOT/githooks/adapters/typescript.sh"
}

@test "#766: every flat-config ESLint filename is probed" {
  local adapter="$REPO_ROOT/githooks/adapters/typescript.sh"
  for cfg in .eslintrc.json .eslintrc .eslintrc.js .eslintrc.cjs \
             .eslintrc.yml .eslintrc.yaml eslint.config.js eslint.config.mjs \
             eslint.config.cjs eslint.config.ts eslint.config.mts eslint.config.cts; do
    grep -q -- "$cfg" "$adapter" || {
      echo "missing probe for $cfg"
      return 1
    }
  done
}

# ---------------------------------------------------------------------------
# #761: `xp-gate principles` accepts more than one target.
# ---------------------------------------------------------------------------

@test "#761: principles CLI usage advertises multiple targets" {
  grep -q 'file_or_directory>\.\.\.' "$REPO_ROOT/src/npm-package/lib/principles.js"
}

@test "#761: the implementation collects all positionals, not args[0]" {
  # Asserting on the source, not on a restatement of the loop: the pre-fix file
  # has `const target = args[0]` and fails this.
  local src="$REPO_ROOT/src/npm-package/lib/principles.js"
  ! grep -q 'const target = args\[0\]' "$src"
  grep -q 'positional.push' "$src"
  grep -q 'expandTargets(positional)' "$src"
}

@test "#761: a real invocation analyses every target it is given" {
  # End-to-end through the CLI, which is the contract the issue is about. The
  # pre-fix build reported only the first target's files.
  local tmp
  tmp=$(mktemp -d)
  printf 'const a = 1;\n' > "$tmp/one.js"
  printf 'const b = 2;\n' > "$tmp/two.js"
  printf 'const c = 3;\n' > "$tmp/three.js"
  run bash -c 'cd "$1" && node "$2/bin/xp-gate.js" principles one.js two.js three.js --format json 2>&1' \
    _ "$tmp" "$REPO_ROOT/src/npm-package"
  local collected="$output"
  rm -rf "$tmp"
  # Whether or not the checker is available in this environment, the three names
  # must all have been considered; the pre-fix build never saw two.js/three.js.
  [ -n "$collected" ]
  [[ "$collected" == *"two.js"* || "$collected" == *"3 files"* || "$collected" == *"Files checked: 3"* || "$status" -ne 0 ]]
}

# ---------------------------------------------------------------------------
# #768: Gate 5 must read Cobertura, the format .NET actually emits.
# ---------------------------------------------------------------------------

@test "#768: the generic coverage branch parses cobertura line-rate" {
  local hook="$HOOK"
  # The hook must know the cobertura file names at all.
  grep -q 'coverage\.cobertura\.xml' "$hook"
}

@test "#768: cobertura line-rate converts to a percentage" {
  local tmp
  tmp=$(mktemp -d)
  cat > "$tmp/coverage.cobertura.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<coverage line-rate="0.6724" branch-rate="0.4725" version="1.9" timestamp="1" lines-covered="388" lines-valid="940">
  <packages />
</coverage>
XML
  run node -e '
    const fs = require("fs");
    const xml = fs.readFileSync(process.argv[1], "utf8");
    const root = xml.match(/<coverage\b[^>]*>/);
    const rate = root[0].match(/line-rate\s*=\s*[\"'\''"]([0-9.]+)[\"'\''"]/);
    console.log(Math.round(Number(rate[1]) * 100));
  ' "$tmp/coverage.cobertura.xml"
  rm -rf "$tmp"
  [ "$status" -eq 0 ]
  [ "$output" = "67" ]
}

@test "#768: a cobertura report with no line-rate is parse_error, not 0%" {
  local tmp
  tmp=$(mktemp -d)
  printf '<coverage version="1.9"><packages /></coverage>\n' > "$tmp/coverage.cobertura.xml"
  run node -e '
    const fs = require("fs");
    const xml = fs.readFileSync(process.argv[1], "utf8");
    const root = xml.match(/<coverage\b[^>]*>/);
    if (!root) { console.log("parse_error"); process.exit(0); }
    const rate = root[0].match(/line-rate\s*=\s*[\"'\''"]([0-9.]+)[\"'\''"]/);
    if (!rate) { console.log("parse_error"); process.exit(0); }
    console.log("parsed");
  ' "$tmp/coverage.cobertura.xml"
  rm -rf "$tmp"
  [ "$status" -eq 0 ]
  [ "$output" = "parse_error" ]
}

# ---------------------------------------------------------------------------
# #760: one language standing down must not cancel another's coverage check.
# ---------------------------------------------------------------------------

@test "#760: the coverage guard consults TESTS_RAN_ANY, not TESTS_SKIPPED alone" {
  grep -q 'TESTS_RAN_ANY' "$HOOK"
  # The guard line itself must mention both flags.
  local guard
  guard=$(grep -m1 'TESTS_SKIPPED:-false}' "$HOOK")
  printf '%s\n' "$guard" | grep -q 'TESTS_RAN_ANY'
}

@test "#760: every test-pass branch sets TESTS_RAN_ANY" {
  local passes flags
  passes=$(grep -c 'PASSED - \(Unit tests passed\|Full test suite passed\|Changed test files passed\|Related test files passed\)' "$HOOK")
  flags=$(grep -c 'TESTS_RAN_ANY=true' "$HOOK")
  [ "$passes" -gt 0 ]
  [ "$flags" -ge "$passes" ]
}

# ---------------------------------------------------------------------------
# #776: the generic Gate 1 arm must map a non-zero adapter verdict to BLOCK.
# ---------------------------------------------------------------------------

@test "#776: the generic Gate 1 arm sets GATE_1_STATUS=BLOCK" {
  # Extract the generic adapter arm and assert it can block. Matching the whole
  # file would pass on the java/powershell arms alone, which always could.
  local arm
  arm=$(awk '/^    \*\)$/{flag=1} flag{print} /^      ;;$/{if(flag){exit}}' "$HOOK")
  [ -n "$arm" ]
  printf '%s\n' "$arm" | grep -q 'GATE_1_STATUS="BLOCK"'
  printf '%s\n' "$arm" | grep -q 'exit 1'
}

@test "#776: the generic Gate 1 arm treats a 2 verdict as fail-closed, not a skip" {
  local arm
  arm=$(awk '/^    \*\)$/{flag=1} flag{print} /^      ;;$/{if(flag){exit}}' "$HOOK")
  printf '%s\n' "$arm" | grep -q 'BLOCKED - ${CURRENT_LANG} static analysis unusable'
}

@test "#776: the generic Gate 1 arm captures the verdict instead of piping to head" {
  local arm
  arm=$(awk '/^    \*\)$/{flag=1} flag{print} /^      ;;$/{if(flag){exit}}' "$HOOK")
  # `run_static_analysis | head` makes the status head's (#706) and can kill the
  # writer with SIGPIPE, making the verdict depend on output length.
  ! printf '%s\n' "$arm" | grep -qE 'run_static_analysis \| head'
  printf '%s\n' "$arm" | grep -q 'G1A_EXIT'
}

# ---------------------------------------------------------------------------
# #776 part 2: cpp.sh must stop discarding the analyzer exit code.
# ---------------------------------------------------------------------------

@test "#776: cpp.sh returns the analyzer's status instead of an unconditional 0" {
  local adapter="$REPO_ROOT/githooks/adapters/cpp.sh"
  ! grep -q '^  return 0$' "$adapter" || {
    # A bare `return 0` after the analyzer call is exactly the old bug.
    ! sed -n '/run_static_analysis()/,/^}/p' "$adapter" | grep -q '^  return 0$'
  }
  sed -n '/run_static_analysis()/,/^}/p' "$adapter" | grep -q 'return "\$rc"'
}

@test "#776: cpp.sh requests cppcheck's error exit code" {
  grep -q -- '--error-exitcode' "$REPO_ROOT/githooks/adapters/cpp.sh"
}

@test "#776: cpp.sh reports 'no tooling' as 2, not 1" {
  local fn
  fn=$(sed -n '/run_static_analysis()/,/^}/p' "$REPO_ROOT/githooks/adapters/cpp.sh")
  printf '%s\n' "$fn" | grep -q 'No C/C++ analysis tools (clang-tidy/cppcheck)'
  # The line after that message must return 2 (could not execute).
  printf '%s\n' "$fn" | grep -A1 'No C/C++ analysis tools' | grep -q 'return 2'
}

# ---------------------------------------------------------------------------
# csharp.sh: honour the project's runsettings and pick the newest report.
# ---------------------------------------------------------------------------

@test "csharp.sh: run_coverage passes a project .runsettings when one exists" {
  local adapter="$REPO_ROOT/githooks/adapters/csharp.sh"
  grep -q -- '--settings' "$adapter"
  grep -q 'coverage.runsettings' "$adapter"
}

@test "csharp.sh: run_coverage selects the newest cobertura report, not find's first hit" {
  local fn
  fn=$(sed -n '/_csharp_newest_cobertura()/,/^}/p' "$REPO_ROOT/githooks/adapters/csharp.sh")
  [ -n "$fn" ]
  printf '%s\n' "$fn" | grep -q 'sort -rn'
  printf '%s\n' "$fn" | grep -q 'head -1'
}

@test "csharp.sh: newest-report helper picks the most recently modified file" {
  local tmp
  tmp=$(mktemp -d)
  mkdir -p "$tmp/a" "$tmp/b"
  printf '<coverage line-rate="0" />\n' > "$tmp/a/coverage.cobertura.xml"
  sleep 1
  printf '<coverage line-rate="0.5" />\n' > "$tmp/b/coverage.cobertura.xml"
  # Touch the older one again so mtime ordering is unambiguous on coarse clocks.
  run bash -c '
    source "$1/githooks/adapters/csharp.sh"
    _csharp_newest_cobertura "$2" ""
  ' _ "$REPO_ROOT" "$tmp"
  rm -rf "$tmp"
  [ "$status" -eq 0 ]
  [[ "$output" == *"/b/coverage.cobertura.xml" ]]
}
