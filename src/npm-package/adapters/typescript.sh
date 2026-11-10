#!/usr/bin/env bash

# TypeScript adapter for quality gates

# Print the path of a LOCALLY installed Node tool, or nothing.
#
# `npx <tool> --version` must never be used to answer "is this tool installed?".
# When the package is absent, npx DOWNLOADS it from the registry and runs it, so
# the probe succeeds no matter what the project actually depends on. Measured on
# a repo with no vitest at all:
#
#   $ npx vitest --version
#   vitest/5.1.0 win32-x64 node-v24.22.1     # rc=0
#   $ ls node_modules/vitest
#   (absent)
#
# The gate then ran a vitest that the project never declared, failed on a missing
# @vitest/coverage-v8, and reported that as "tests failed". Answering a question
# about the local environment must not install packages to do it -- the same rule
# AGENTS.md states for XP_GATE_NPX_PROBE, which src/gates/common-process.ts
# already honours on the TypeScript side.
#
# Only the project's own node_modules/.bin is consulted, which is what a real
# install populates. Nothing outside the project can satisfy this check.
_local_bin() {
  local tool="$1"
  if [ -x "node_modules/.bin/$tool" ]; then
    printf '%s\n' "node_modules/.bin/$tool"
    return 0
  fi
  return 1
}

# Run a locally installed Node tool with the given arguments.
#
# Uses the resolved binary directly rather than `npx <tool>`, for the same reason:
# npx would fetch the tool when the local binary is missing, so a typo'd tool name
# would silently test with a downloaded copy instead of failing.
_run_local_tool() {
  local tool="$1"
  shift
  local bin
  bin=$(_local_bin "$tool") || return 127
  run_without_git_context "$bin" "$@"
}

run_static_analysis() {
  # The type-check decision is shared with pre-commit's Gate 1 (#436): a project's
  # own checker (typecheck script, or GATE_TS_TYPECHECK_CMD) is used when declared,
  # otherwise the pre-#436 `npx tsc --noEmit` path. This adapter's contract predates
  # that split, so it keeps reporting only 0 (clean/skipped) or 1 (type errors).
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" 2>/dev/null && pwd)"
  if [ -n "$lib_dir" ] && [ -f "$lib_dir/typecheck.sh" ]; then
    # shellcheck source=/dev/null
    source "$lib_dir/typecheck.sh"
  fi

  if ! command -v run_typescript_typecheck >/dev/null 2>&1; then
    echo "typecheck.sh not resolvable, skipping TypeScript static analysis"
    return 0
  fi

  run_typescript_typecheck
  [ $? -eq 1 ] && return 1
  return 0
}

run_lint() {
  if ! command -v npx >/dev/null 2>&1; then
    echo "npx not available, skipping TypeScript linting"
    return 0
  fi

  # Prefer Biome if biome.json/biome.jsonc exists (covers lint + format in one pass)
  if [ -f "biome.json" ] || [ -f "biome.jsonc" ]; then
    echo "Running Biome linting..."
    # `$?` here is Biome's, and it has to be: this used to read
    #   npx biome check . 2>&1 | head -50
    #   local EXIT_CODE=$?
    # and in a POSIX pipeline `$?` is the status of the LAST command -- `head` --
    # so it was always 0. The failure branch below could never run and a project
    # with Biome errors was told "PASSED". Capture the status first, then trim
    # the output. This repo has no biome.json so its own commits never showed it;
    # every downstream project using Biome was affected (#437).
    local BIOME_OUTPUT
    BIOME_OUTPUT=$(npx biome check . --no-errors-on-unmatched 2>&1)
    local EXIT_CODE=$?
    printf '%s\n' "$BIOME_OUTPUT" | head -50
    if [ $EXIT_CODE -ne 0 ]; then
      echo ""
      echo "❌ Biome check failed"
      echo "Run 'npx biome check --write .' to auto-fix."
      return $EXIT_CODE
    fi
    echo "✅ PASSED - Biome check."
    return 0
  fi

  # Fall back to ESLint if no Biome config exists.
  #
  # #766: the flat-config era renamed and extended these files. `.mjs` is what
  # `eslint --init` produces for an ESM project, and `.ts`/`.mts`/`.cts` appear in
  # monorepos that share one config across packages -- none of them were probed,
  # so a project whose ONLY config was `eslint.config.mjs` was told "No linter
  # configuration found" and Gate 1 skipped linting entirely. That is a fail-open
  # on the whole TypeScript arm, not a cosmetic gap.
  #
  # Kept as one list so the message below cannot drift from the probe. `--ext` is
  # dropped: it is ignored under flat config (and warns), while the config itself
  # owns the file set.
  _eslint_configs=".eslintrc.json .eslintrc .eslintrc.js .eslintrc.cjs .eslintrc.yml .eslintrc.yaml eslint.config.js eslint.config.mjs eslint.config.cjs eslint.config.ts eslint.config.mts eslint.config.cts"
  for _cfg in $_eslint_configs; do
    if [ -f "$_cfg" ]; then
      echo "Running ESLint linting (config: $_cfg)..."
      npx eslint .
      return $?
    fi
  done

  echo "❌ BLOCKED - No linter configuration found for TypeScript project."
  echo "   TypeScript projects require a linter: either Biome (biome.json/biome.jsonc)"
  echo "   or ESLint (any of: $(printf '%s' "$_eslint_configs" | tr ' ' '/'))."
  echo "   Create one of these configuration files to enable linting."
  return 1
}

run_tests() {
  echo "Running TypeScript tests..."
  if _local_bin vitest >/dev/null; then
    _run_local_tool vitest run
  elif _local_bin jest >/dev/null; then
    _run_local_tool jest --passWithNoTests
  else
    # SKIP, not BLOCK: no runner is installed, so no test was expected to run.
    # Returning non-zero here is what turned "this project does not use
    # vitest/jest" into "TESTS FAILED" for every downstream repo with .js files.
    echo "⏭️  SKIP - No test runner installed locally (node_modules/.bin has no vitest or jest)"
    echo "   Install the runner this project uses, or declare its test command."
    return 0
  fi
}

run_coverage() {
  echo "Running TypeScript coverage..."
  local runner bin out_file rc
  if _local_bin vitest >/dev/null; then
    runner=vitest
    bin=$(_local_bin vitest)
  elif _local_bin jest >/dev/null; then
    runner=jest
    bin=$(_local_bin jest)
  else
    echo "⏭️  SKIP - No test runner installed locally (node_modules/.bin has no vitest or jest)"
    return 0
  fi

  out_file=$(mktemp)
  if [ "$runner" = "vitest" ]; then
    run_without_git_context "$bin" run --coverage 2>&1 | tee "$out_file"
  else
    run_without_git_context "$bin" --coverage 2>&1 | tee "$out_file"
  fi
  rc=${PIPESTATUS[0]}

  if [ "$rc" -ne 0 ]; then
    # A runner that could not RUN is not a runner that found failing tests. The
    # common real case is a missing optional peer such as
    # `@vitest/coverage-v8`; reporting that as "tests failed" sends the reader
    # looking for a broken test that does not exist.
    if grep -qiE "MISSING DEPENDENCY|cannot find (dependency|module)" "$out_file"; then
      echo "⏭️  SKIP - $runner could not run (missing dependency), not a test failure"
      echo "   Install the missing package, or drop --coverage from this gate."
      rm -f "$out_file"
      return 0
    fi
    rm -f "$out_file"
    return "$rc"
  fi
  rm -f "$out_file"
  return 0
}

# ── Biome linting (if installed) ──

run_biome_lint() {
  # Detection must not go through npx: `npx biome --version` downloads biome from
  # the registry when the project does not have it, so the probe would always say
  # "installed" and then lint with a package the project never depended on.
  local BIOME_BIN
  BIOME_BIN=$(_local_bin biome) || return 0  # not installed → SKIP (same as other tools)

  echo "Running Biome linting..."
  local BIOME_EXIT=0
  run_without_git_context "$BIOME_BIN" lint . 2>&1 || BIOME_EXIT=$?

  # Check for known conflict: useLiteralKeys vs TypeScript TS4111
  # When biome reports useLiteralKeys on Record<string,unknown> usage,
  # it conflicts with TypeScript strict index-signature access (TS4111).
  # We only warn — we do NOT block — because both rules are correct in their domain.
  if run_without_git_context "$BIOME_BIN" lint . 2>&1 | grep -q "useLiteralKeys"; then
    local TSC_CHECK=0
    if [ -x "node_modules/.bin/tsc" ]; then
      run_without_git_context node_modules/.bin/tsc --noEmit 2>&1 | grep -q "TS4111" || TSC_CHECK=$?
    else
      TSC_CHECK=1  # no local tsc → cannot confirm the conflict; stay quiet
    fi
    if [ $TSC_CHECK -eq 0 ]; then
      echo ""
      echo "ℹ️  NOTE: Biome useLiteralKeys conflicts with TypeScript TS4111"
      echo "   This happens on Record<string,unknown> or index-signature types."
      echo "   Biome wants dot notation (obj.name), TypeScript requires bracket (obj['name'])."
      echo "   Recommended: disable useLiteralKeys in biome.json or see docs/biome-configuration.md"
      echo ""
    fi
  fi

  return $BIOME_EXIT
}
