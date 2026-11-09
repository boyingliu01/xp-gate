#!/usr/bin/env bash
# sync-version.sh — thin wrapper around scripts/sync-version.cjs
#
# VERSION is the single source of truth for this repository's version number.
# The SYNC LOGIC must be a single implementation too, and it was not.
#
# This file used to carry its own copy of the target list -- a bash rewrite of
# scripts/sync-version.cjs -- and the two lists drifted apart. Measured on
# 2026-11-09 by resetting versions to 0.0.0 and running this script:
#
#     package.json              0.0.0.0 -> 0.37.1.0   repaired
#     package-lock.json         0.0.0.0 -> 0.0.0.0    NOT repaired
#     plugins/dsh/package.json  0.0.0   -> 0.0.0      NOT repaired
#
# It also found AGENTS.md with a `find` excluding only node_modules and .git,
# so it rewrote mutation-sandbox copies under .stryker-tmp and reported
# "401 files" where the .cjs reported 41. Counting is the only observable signal
# that a sync actually happened, so a wrong count is not a cosmetic problem.
#
# That mattered beyond this repository: skills/sprint-flow/references/phase-5-ship.md
# instructs the reader to run `bash scripts/sync-version.sh` as step 4 of
# VERSION-GATE. Anyone following the documented procedure silently skipped two
# files. The entry point stays, because that documentation and CI reference it;
# only the duplicated implementation goes away.
#
# Keep this file free of logic. If a target needs to be added, add it to
# scripts/sync-version.cjs -- there is deliberately no second place to put it.
# scripts/__tests__/sync-version-single-source.test.bats fails if this file
# starts carrying its own target list again.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec node "${SCRIPT_DIR}/sync-version.cjs" "$@"
