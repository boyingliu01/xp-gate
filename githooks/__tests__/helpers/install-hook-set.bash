#!/usr/bin/env bash
# ============================================================================
# Shared fixture helper: install the COMPLETE pre-commit hook set into a test
# fixture (#798).
#
# WHY THIS EXISTS
#   pre-commit is no longer one file. Since #798 the installed set is:
#
#     pre-commit                 the entry point (preamble + driver call + epilogue)
#     gate-driver.sh             the ordered chain (XP_GATE_ORDER)
#     gate-entries/*.sh          one body per gate
#     adapter-common.sh          startup
#     hook-module-resolution.sh  startup
#     lib/*.sh                   runtime helpers
#
#   Test suites used to each copy whichever subset they remembered. When a
#   refactor adds a file to the set, every suite that did not know about it
#   fails at once with "could not load ..." - and, worse, the assertions then
#   test a CRASHED hook rather than a verdict. That happened twice already
#   (#497 for lib/, #548 for hook-module-resolution.sh) and a third time for
#   gate-driver.sh during this very refactor.
#
#   Copying the whole set from one place makes the fixture track the real
#   installation automatically, so a future file addition cannot silently
#   break every suite.
#
# USAGE (inside a bats setup(), with SOURCE_GITHOOKS pointed at githooks/):
#
#     load_helpers() { . "$BATS_TEST_DIRNAME/helpers/install-hook-set.bash"; }
#     setup() { ... ; install_hook_set "$SOURCE_GITHOOKS" .git/hooks ; }
# ============================================================================

# install_hook_set <source-githooks-dir> <dest-hook-dir>
#
# Copies every file the hook chain needs. Missing source files are reported
# rather than silently skipped: a fixture with a partial set produces confusing
# verdict assertions instead of an obvious error.
install_hook_set() {
  local src="$1"
  local dest="$2"

  if [ ! -d "$src" ]; then
    echo "install_hook_set: source githooks dir not found: $src" >&2
    return 1
  fi
  if [ ! -f "$src/pre-commit" ]; then
    echo "install_hook_set: $src/pre-commit not found" >&2
    return 1
  fi

  mkdir -p "$dest"

  # Entry point + the files it sources at startup.
  cp "$src/pre-commit" "$dest/pre-commit"
  chmod +x "$dest/pre-commit"

  local f
  for f in adapter-common.sh hook-module-resolution.sh gate-driver.sh gate-registry.sh; do
    [ -f "$src/$f" ] && cp "$src/$f" "$dest/$f"
  done

  # Runtime lib helpers (#449).
  if [ -d "$src/lib" ]; then
    mkdir -p "$dest/lib"
    for f in "$src"/lib/*.sh; do
      [ -f "$f" ] && cp "$f" "$dest/lib/"
    done
  fi

  # Per-gate bodies (#798). This is the part a hand-written fixture forgets.
  if [ -d "$src/gate-entries" ]; then
    mkdir -p "$dest/gate-entries"
    for f in "$src"/gate-entries/*.sh; do
      [ -f "$f" ] && cp "$f" "$dest/gate-entries/"
    done
  else
    echo "install_hook_set: WARNING: $src/gate-entries missing - the hook will abort" >&2
  fi

  # Gate implementations sourced by path (gate-7.sh, gate-8.sh, gate-10.sh,
  # gate-12-file-hygiene.sh, gate-13-compiler-strictness.sh, sprint-gate*.sh).
  for f in "$src"/gate-*.sh "$src"/sprint-gate*.sh; do
    [ -f "$f" ] || continue
    cp "$f" "$dest/"
  done

  return 0
}
