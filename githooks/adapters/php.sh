#!/usr/bin/env bash
# ============================================================================
# PHP adapter -- GATE 1/5 (#731, following the C# adapter's shape)
#
# Sourced directly by the gate entries; there is no dispatcher between them
# (#688). Every function below must therefore exist and must return a status the
# caller can turn into a verdict:
#
#   0 = PASS      tool ran, found nothing
#   1 = FAIL      tool ran, found violations (blocks)
#   2 = BLOCK     tool could NOT run -> fail closed, never "clean"
#   3 = WARN      non-blocking observation
#
# ---------------------------------------------------------------------------
# WHY THIS FILE DOES NOT COPY THE C# ADAPTER'S DETECTION TRICK
#
# csharp.sh hoists its manifest detection arm to the FRONT of the detection
# chain. PHP must not: `composer.json` is NOT exclusive -- a JavaScript project
# with a composer wrapper for one build step has one too, and promoting it would
# relabel the whole repo as PHP. PHP therefore has to be correct on the
# EXTENSION side, and this file never assumes a repo is PHP just because a
# composer.json exists (`_php_detect_root` only *locates* the working directory;
# the gate decides whether to call this adapter at all).
#
# ---------------------------------------------------------------------------
# MEASURED TOOL CONTRACTS (2026-11-19, php 8.4.27 + composer 2.11.2)
#
#   phpcs (squizlabs/php_codesniffer 3.11)
#     0 = clean
#     2 = errors found
#     3 = THE TOOL COULD NOT RUN (unknown --standard, missing path)
#   Exit 3 is the trap: it is NOT "more violations". An adapter that folds
#   everything non-zero into FAIL reports "your code is bad" when the standard
#   was merely misspelled. 3 maps to BLOCK (2), matching csharp.sh's 126/127
#   handling of `dotnet format`.
#
#   phpstan (2.x)
#     0 = no errors
#     1 = errors found
#     1 = ALSO used for a bad path / bad config, i.e. phpstan does not
#         distinguish "found problems" from "could not run" in its exit code.
#   Because the exit code cannot separate those two, the structured output is
#   parsed instead: `--error-format=raw` emits `path:line:message`, while a
#   configuration failure writes its explanation to stderr and no raw rows. A
#   non-zero exit with ZERO raw rows is therefore "could not run" (BLOCK), not
#   "clean" -- the same defect class as reading a scanner's exit code as a
#   severity.
#
#   phpunit (11.x)
#     0 = pass, 1 = failures, 2 = errors/aborted
#
#   Coverage: PHPUnit emits Cobertura natively via --coverage-cobertura.
#   Gate 5 Stage 2 already parses <coverage line-rate="..."> (#768), so no new
#   verdict parser is needed -- choosing clover instead would have produced a
#   syntactically valid report Gate 5 cannot read, which is exactly the #768
#   failure this adapter must not repeat. Verified by measuring both formats.
#
#   A coverage driver is required for ANY coverage report: pcov or xdebug.
#   Without one PHPUnit prints "No code coverage driver available", writes NO
#   file, and exits 0. That combination is indistinguishable from "coverage is
#   100%" to a caller that only checks the exit code, so run_coverage detects the
#   missing artifact and reports it instead of returning a silent PASS.
# ============================================================================

# Root of the PHP project: the nearest directory with a composer.json, else the
# nearest with a phpunit.xml, else the current directory.
#
# Returns 0 and prints the root; returns 1 when no PHP project marker exists.
_php_detect_root() {
  local dir="${1:-$PWD}"
  local probe="$dir" found=""
  while [ -n "$probe" ] && [ "$probe" != "/" ]; do
    if [ -f "$probe/composer.json" ]; then found="$probe"; break; fi
    if [ -f "$probe/phpunit.xml" ] || [ -f "$probe/phpunit.xml.dist" ]; then
      found="$probe"; break
    fi
    probe=$(dirname "$probe")
  done
  if [ -z "$found" ]; then
    if [ -f "composer.json" ] || [ -f "phpunit.xml" ] || [ -f "phpunit.xml.dist" ]; then
      found="$PWD"
    fi
  fi
  [ -n "$found" ] || return 1
  printf '%s\n' "$found"
}

# A PHP command name that actually resolves. `php` may be satisfied by a shim.
_php_bin() {
  local c
  for c in php php84 php83 php82; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return 0; fi
  done
  return 1
}

# Resolve a vendor/bin tool. PHP tools live in vendor/bin, installed by
# composer, and are NOT on PATH -- four independent tools means four separate
# "not on PATH" cases, which is the PHP-specific difference from C#'s single
# `dotnet` entry point. Each one is probed in both the bare and .bat forms
# because MSYS2 only resolves .bat when the extension is spelled out.
# Usage: _php_vendor_bin <root> <name> ; prints the path or returns 1.
_php_vendor_bin() {
  local root="$1" name="$2" base cand
  for base in "vendor/bin" ".build/vendor/bin" "tools/vendor/bin"; do
    for cand in "$root/$base/$name" "$root/$base/$name.bat" "$root/$base/$name.phar"; do
      if [ -f "$cand" ]; then printf '%s\n' "$cand"; return 0; fi
    done
  done
  # Also accept a globally installed tool (phpcs/phpstan installed via composer
  # global). Probing PATH is what makes the adapter usable outside a project.
  for cand in "$name" "$name.bat" "$name.phar"; do
    if command -v "$cand" >/dev/null 2>&1; then command -v "$cand"; return 0; fi
  done
  return 1
}

# Composer is needed for install/test discovery, and is its own failure mode.
_php_composer_bin() {
  local c
  for c in composer composer.bat composer.phar; do
    if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return 0; fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# run_static_analysis -- phpstan
#
# Returns 0 (clean) / 1 (findings) / 2 (could not run) / 3 (warn).
# ---------------------------------------------------------------------------
run_static_analysis() {
  local root php phpstan level out rc rows
  root=$(_php_detect_root) || { echo "No composer.json / phpunit.xml found -- not a PHP project"; return 0; }
  php=$(_php_bin) || {
    echo "php is not installed -- static analysis not measurable"
    echo "XP_G1_REASON: php_missing"
    echo "   Install: scoop install php   (or winget install PHP.PHP.8.4)"
    return 2
  }

  if ! phpstan=$(_php_vendor_bin "$root" phpstan); then
    echo "phpstan is not installed -- static analysis not measurable"
    echo "XP_G1_REASON: phpstan_missing"
    echo "   Install: composer require --dev phpstan/phpstan"
    return 2
  fi

  # Honour the project's declared level; default to 5 (phpstan's own practical
  # baseline) rather than 0, which analyses almost nothing and would report a
  # clean run over code it barely inspected.
  level="${XP_GATE_PHPSTAN_LEVEL:-}"
  if [ -z "$level" ]; then
    if [ -f "$root/phpstan.neon" ] || [ -f "$root/phpstan.neon.dist" ]; then
      level=""   # let phpstan read its own config
    else
      level="--level=5"
    fi
  else
    level="--level=${level}"
  fi

  # --error-format=raw makes the verdict machine-readable; without it the table
  # renderer's output would have to be parsed, which is what the G1 contract
  # forbids.
  # shellcheck disable=SC2086
  out=$("$php" "$phpstan" analyse $level --no-progress --error-format=raw 2>&1)
  rc=$?

  # Count only rows that look like diagnostics (path:line:message). A non-zero
  # exit with zero such rows is a configuration/execution fault, NOT "clean".
  rows=$(printf '%s\n' "$out" | grep -cE '^[^ ]+:[0-9]+:' || true)

  if [ "$rc" -eq 0 ]; then
    echo "phpstan: no errors"
    return 0
  fi
  if [ "${rows:-0}" -gt 0 ]; then
    printf '%s\n' "$out" | sed -n '1,25p'
    echo "phpstan reported ${rows} finding(s)"
    return 1
  fi
  # Non-zero, no diagnostics: the tool could not do its job.
  printf '%s\n' "$out" | sed -n '1,15p'
  echo "phpstan could not run (no diagnostic rows produced) -- refusing to report this as clean"
  echo "XP_G1_REASON: phpstan_no_diagnostics"
  return 2
}

# ---------------------------------------------------------------------------
# run_lint -- phpcs
#
# Exit 3 is deliberately mapped to BLOCK(2): measured, phpcs uses 3 for an
# unknown --standard and for a missing path, not for "more errors".
# ---------------------------------------------------------------------------
run_lint() {
  local root php phpcs standard out rc
  root=$(_php_detect_root) || { echo "No composer.json / phpunit.xml found -- not a PHP project"; return 0; }
  php=$(_php_bin) || {
    echo "php is not installed -- lint not measurable"
    echo "XP_G1_REASON: php_missing"
    return 2
  }

  if ! phpcs=$(_php_vendor_bin "$root" phpcs); then
    echo "phpcs is not installed -- lint not measurable"
    echo "XP_G1_REASON: phpcs_missing"
    echo "   Install: composer require --dev squizlabs/php_codesniffer"
    return 2
  fi

  # A project that declares its own standard wins; otherwise PSR12. The value is
  # validated rather than trusted: an unknown standard makes phpcs exit 3, which
  # is a tool failure, and silently falling back would hide a typo in the
  # project's own config.
  standard="${XP_GATE_PHPCS_STANDARD:-}"
  if [ -z "$standard" ]; then
    if [ -f "$root/phpcs.xml" ] || [ -f "$root/phpcs.xml.dist" ] \
       || [ -f "$root/.phpcs.xml" ] || [ -f "$root/.phpcs.xml.dist" ]; then
      standard=""   # phpcs picks up its own ruleset
    else
      standard="--standard=PSR12"
    fi
  else
    standard="--standard=${standard}"
  fi

  # Target the conventional source roots when they exist, so a repo's tests
  # directory does not produce style noise about production code.
  local targets=() t
  for t in src app lib; do [ -d "$root/$t" ] && targets+=("$t"); done
  if [ "${#targets[@]}" -eq 0 ]; then
    echo "phpcs: no src/ app/ lib/ directory found to lint"
    return 0
  fi

  # shellcheck disable=SC2086
  out=$("$php" "$phpcs" $standard --report=full "${targets[@]/#/$root/}" 2>&1)
  rc=$?

  case "$rc" in
    0)
      echo "phpcs: no violations"
      return 0
      ;;
    1|2)
      printf '%s\n' "$out" | sed -n '1,25p'
      echo "phpcs found violations"
      return 1
      ;;
    3)
      # Measured: unknown --standard or a path phpcs cannot open.
      printf '%s\n' "$out" | sed -n '1,15p'
      echo "phpcs could not run (exit 3: bad standard or unusable path), not a violation"
      echo "XP_G1_REASON: phpcs_unusable_standard"
      return 2
      ;;
    *)
      printf '%s\n' "$out" | sed -n '1,15p'
      echo "phpcs exited ${rc} -- unexpected status, treating as could-not-run"
      return 2
      ;;
  esac
}

# ---------------------------------------------------------------------------
# run_tests -- phpunit
# ---------------------------------------------------------------------------
run_tests() {
  local root php phpunit out rc
  root=$(_php_detect_root) || { echo "No composer.json / phpunit.xml found -- not a PHP project"; return 0; }
  php=$(_php_bin) || {
    echo "php is not installed -- tests not measurable"
    echo "XP_G1_REASON: php_missing"
    return 2
  }

  if [ ! -f "$root/phpunit.xml" ] && [ ! -f "$root/phpunit.xml.dist" ]; then
    echo "No phpunit.xml(.dist) found -- test suite not discoverable"
    echo "   Gate 5 cannot distinguish 'no tests' from 'tests not configured'; declare a suite to have it run"
    return 2
  fi

  if ! phpunit=$(_php_vendor_bin "$root" phpunit); then
    echo "phpunit is not installed -- tests not measurable"
    echo "XP_G1_REASON: phpunit_missing"
    echo "   Install: composer require --dev phpunit/phpunit"
    return 2
  fi

  out=$(cd "$root" && "$php" "$phpunit" --no-progress 2>&1)
  rc=$?
  printf '%s\n' "$out" | sed -n '1,30p'

  case "$rc" in
    0) echo "phpunit: all tests passed"; return 0 ;;
    1) echo "phpunit: test failures"; return 1 ;;
    2) echo "phpunit: errors or aborted run -- not a test verdict"; return 2 ;;
    255) echo "phpunit could not start (bad configuration or bootstrap)"; return 2 ;;
    *) echo "phpunit exited ${rc} -- unexpected status"; return 2 ;;
  esac
}

# ---------------------------------------------------------------------------
# run_coverage -- phpunit --coverage-cobertura
#
# DOES run the suite: PHPUnit's coverage options execute the tests and write the
# report in one invocation, so Gate 5 does not need a second pass. Declared via
# coverage_runs_tests() below, which is what lets Gate 5 run the suite once
# instead of twice (the C# adapter made the same declaration after #798 measured
# a 28.5s+30.0s duplicate).
# ---------------------------------------------------------------------------
coverage_runs_tests() { return 0; }

run_coverage() {
  local root php phpunit out rc report
  root=$(_php_detect_root) || { echo "No composer.json / phpunit.xml found -- not a PHP project"; return 0; }
  php=$(_php_bin) || {
    echo "php is not installed -- coverage not measurable"
    echo "XP_G1_REASON: php_missing"
    return 2
  }

  if [ ! -f "$root/phpunit.xml" ] && [ ! -f "$root/phpunit.xml.dist" ]; then
    echo "No phpunit.xml(.dist) found -- coverage not measurable"
    return 2
  fi

  if ! phpunit=$(_php_vendor_bin "$root" phpunit); then
    echo "phpunit is not installed -- coverage not measurable"
    return 2
  fi

  # A coverage driver is mandatory. Without one PHPUnit writes no report and
  # still exits 0, which reads as full coverage to anything checking only the
  # exit status. Detect it up front so the reason is explicit.
  local drivers
  drivers=$("$php" -r 'echo implode(",", array_filter(["pcov","xdebug"], fn($d)=>extension_loaded($d)));' 2>/dev/null)
  if [ -z "$drivers" ]; then
    echo "No PHP coverage driver installed (pcov or xdebug required) -- coverage not measurable"
    echo "   Install: php_pcov.dll from windows.php.net/downloads/pecl/releases/pcov, or xdebug"
    echo "   Refusing to report 0% (a measured value) for an unmeasured suite"
    return 2
  fi
  echo "Coverage driver: ${drivers}"

  # Cobertura, not clover: Gate 5 Stage 2 parses <coverage line-rate="...">
  # (#768) and has no clover arm. Choosing clover here would produce a valid
  # report the gate cannot read -- the exact #768 shape.
  report="$root/coverage/cobertura.xml"
  mkdir -p "$root/coverage" 2>/dev/null || true
  rm -f "$report" 2>/dev/null || true

  out=$(cd "$root" && "$php" "$phpunit" --no-progress --coverage-cobertura "$report" 2>&1)
  rc=$?
  printf '%s\n' "$out" | sed -n '1,25p'

  if [ ! -f "$report" ]; then
    echo "phpunit produced no Cobertura report at ${report} -- coverage not measurable"
    return 2
  fi
  echo "Coverage report: ${report}"

  # A suite whose tests failed still produced a report; report the failure so the
  # caller's verdict reflects the tests, not just the percentage.
  if [ "$rc" -ne 0 ]; then
    echo "phpunit exited ${rc} while collecting coverage -- tests did not all pass"
    return 1
  fi
  return 0
}
