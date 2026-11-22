#!/usr/bin/env bats
# @test REQ-SYNC-GATE-ENTRIES-MIRRORED
#
# @intent Gate 12b demanded a mirror that the sync tool could not produce.
#
# Gate 12b requires a package mirror for every `githooks/*` file a diff touches,
# and it exempts nothing. The printed remedy is `sync-package-content.js --fix`.
# But syncHooks only ever copied HOOK_FILES (five root-level hook scripts), the
# `githooks/*.sh` gate scripts, and lib/. `gate-entries/` was in NEITHER list, so
# `--fix` reported success without touching it and the mirror could only be
# produced by hand.
#
# MEASURED 2026-11-22. After editing githooks/gate-entries/gate-5-entry.sh:
#
#     $ node src/npm-package/scripts/sync-package-content.js --fix
#     [sync] done: ... 20 hook entries ...
#     $ md5sum githooks/gate-entries/gate-5-entry.sh \
#              src/npm-package/hooks/gate-entries/gate-5-entry.sh
#     56475dbf... *githooks/gate-entries/gate-5-entry.sh
#     37833a68... *src/npm-package/hooks/gate-entries/gate-5-entry.sh
#
# -- exit 0, and still different. Gate 12b then blocked the commit with
# "src/npm-package/hooks/gate-entries/gate-5-entry.sh differs from canonical
# githooks/gate-entries/gate-5-entry.sh". A gate whose own remedy cannot satisfy
# it is un-committable, and the workaround (a manual cp) leaves the next person
# to rediscover the same thing.
#
# The fix mirrors gate-entries/ exactly like lib/, which already worked.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SYNC="$REPO_ROOT/src/npm-package/scripts/sync-package-content.js"
  SRC="$REPO_ROOT/githooks/gate-entries"
  DST="$REPO_ROOT/src/npm-package/hooks/gate-entries"
}

# @covers the sync tool knows about gate-entries at all
@test "the sync tool mirrors the gate-entries directory" {
  run grep -n "gate-entries" "$SYNC"
  [ "$status" -eq 0 ]
}

# @covers every canonical gate entry has a mirror
@test "every gate entry has a package mirror" {
  [ -d "$SRC" ]
  [ -d "$DST" ]
  local f missing=0
  for f in "$SRC"/*.sh; do
    [ -e "$f" ] || continue
    [ -f "$DST/$(basename "$f")" ] || { echo "no mirror for $(basename "$f")"; missing=$((missing + 1)); }
  done
  [ "$missing" -eq 0 ]
}

# @covers the mirrors are byte-identical
#
# This is the property Gate 12b actually enforces; asserting it here means a broken
# sync shows up in a fast suite instead of at commit time.
@test "gate-entry mirrors are byte-identical to their canonical copies" {
  local f differ=0
  for f in "$SRC"/*.sh; do
    [ -e "$f" ] || continue
    local name
    name=$(basename "$f")
    [ -f "$DST/$name" ] || continue
    cmp -s "$f" "$DST/$name" || { echo "differs: $name"; differ=$((differ + 1)); }
  done
  [ "$differ" -eq 0 ]
}
