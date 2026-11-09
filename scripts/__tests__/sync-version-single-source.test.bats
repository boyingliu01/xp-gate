#!/usr/bin/env bats
#
# @test REQ-VERSION-SINGLE-SOURCE Both sync-version entry points must share one target list
# @intent scripts/sync-version exists twice: a .cjs implementation and a .sh
#         implementation that each carry their own hardcoded list of files to
#         rewrite. They drifted, and nobody noticed because nothing compared them.
#
#         Measured on 2026-11-09, after resetting package.json,
#         package-lock.json and plugins/dsh/package.json to 0.0.0 and running
#         `bash scripts/sync-version.sh`:
#
#             package.json              0.0.0.0 -> 0.37.1.0   repaired
#             package-lock.json         0.0.0.0 -> 0.0.0.0    NOT repaired
#             plugins/dsh/package.json  0.0.0   -> 0.0.0      NOT repaired
#
#         The .sh finds AGENTS.md with a `find` that excludes only node_modules
#         and .git, so it also rewrites copies under .stryker-tmp and reports
#         "401 files" where the .cjs reports 41.
#
#         This matters because skills/sprint-flow/references/phase-5-ship.md
#         instructs the reader to run exactly `bash scripts/sync-version.sh` as
#         step 4 of VERSION-GATE. Following the documented procedure therefore
#         leaves two files drifting.
#
#         The fix is not to hand-maintain the same list in two places again: the
#         .sh becomes a thin wrapper that execs the .cjs, so there is exactly one
#         target list. These tests pin that single-source property rather than
#         the specific file names, so a future target added to the .cjs cannot
#         silently go missing from a second implementation.
#
# @covers AC-VERSION-SINGLE-SOURCE-01, AC-VERSION-SINGLE-SOURCE-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SH_SCRIPT="$REPO_ROOT/scripts/sync-version.sh"
  CJS_SCRIPT="$REPO_ROOT/scripts/sync-version.cjs"
}

@test "AC-VERSION-SINGLE-SOURCE-01: the .sh entry point delegates to the .cjs" {
  # Executing the .sh must run the .cjs. Asserting delegation directly is what
  # makes a second hardcoded target list unable to come back: if someone
  # reimplements the logic in bash, this fails before the lists can drift.
  run bash -c "grep -qE 'exec[[:space:]]+\"?\\\$?\{?0?[a-zA-Z_]*\}?\{?0?' '$SH_SCRIPT' || grep -q 'sync-version\\.cjs' '$SH_SCRIPT'"
  [ "$status" -eq 0 ]

  # It must not carry its own target list any more.
  run bash -c "grep -qE \"plugins/qoder/plugin\\.json\" '$SH_SCRIPT'"
  [ "$status" -ne 0 ]
}

@test "AC-VERSION-SINGLE-SOURCE-02: drift injected into every target is repaired by the .sh" {
  # The end-to-end shape of the defect: corrupt versions, run the DOCUMENTED
  # command, require every file back at the VERSION value. Runs against a copy of
  # the two scripts so the real repository is never touched.
  local work
  work="$(mktemp -d)"

  mkdir -p "$work/scripts" "$work/plugins/dsh" "$work/plugins/qoder" \
           "$work/plugins/opencode" "$work/plugins/claude-code/.claude-plugin" \
           "$work/src/npm-package/plugins/dsh"
  cp "$SH_SCRIPT" "$CJS_SCRIPT" "$work/scripts/"

  printf '0.9.9.0\n' > "$work/VERSION"

  # Minimal fixtures: only the version field matters to the sync.
  local f
  for f in \
    "package.json" \
    "plugins/dsh/package.json" \
    "plugins/opencode/package.json" \
    "plugins/qoder/plugin.json" \
    "plugins/claude-code/.claude-plugin/plugin.json" \
    "src/npm-package/package.json" \
    "src/npm-package/plugins/dsh/package.json"
  do
    printf '{"name":"x","version":"0.0.0"}\n' > "$work/$f"
  done

  # package-lock.json is the file the .sh never touched.
  printf '{"name":"x","version":"0.0.0.0","lockfileVersion":3,"packages":{}}\n' > "$work/package-lock.json"

  run bash -c "cd '$work' && bash scripts/sync-version.sh"
  local sh_status="$status"

  # Read via fs + JSON.parse rather than require(): require() resolves and caches
  # by module path, which a temp directory on Windows trips over.
  local lock dsh root
  lock="$(node -e "const fs=require('fs');try{process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version||''))}catch(e){process.stdout.write('')}" "$work/package-lock.json")"
  dsh="$(node -e "const fs=require('fs');try{process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version||''))}catch(e){process.stdout.write('')}" "$work/plugins/dsh/package.json")"
  root="$(node -e "const fs=require('fs');try{process.stdout.write(String(JSON.parse(fs.readFileSync(process.argv[1],'utf8')).version||''))}catch(e){process.stdout.write('')}" "$work/package.json")"

  rm -rf "$work"

  [ "$sh_status" -eq 0 ]
  # The two files the bash implementation silently skipped.
  [ "$lock" = "0.9.9.0" ]
  [ "$dsh" = "0.9.9" ]
  [ "$root" = "0.9.9.0" ]
}

@test "AC-VERSION-SINGLE-SOURCE-02: the .sh does not rewrite AGENTS.md under .stryker-tmp" {
  # The scope half of the defect: a `find` that only excludes node_modules and
  # .git rewrites mutation-sandbox copies too, inflating the reported count from
  # 41 to 401. Counting is the only observable signal that sync worked, so it must
  # be true.
  local work
  work="$(mktemp -d)"

  mkdir -p "$work/scripts" "$work/.stryker-tmp/sandbox-abc" "$work/real"
  cp "$SH_SCRIPT" "$CJS_SCRIPT" "$work/scripts/"
  printf '0.9.9.0\n' > "$work/VERSION"
  printf '{"name":"x","version":"0.0.0"}\n' > "$work/package.json"

  printf '# A\n\n**Version:** 0.0.0.0\n' > "$work/.stryker-tmp/sandbox-abc/AGENTS.md"
  printf '# B\n\n**Version:** 0.0.0.0\n' > "$work/real/AGENTS.md"

  run bash -c "cd '$work' && bash scripts/sync-version.sh"

  local sandboxed
  sandboxed="$(grep -c '0\.9\.9\.0' "$work/.stryker-tmp/sandbox-abc/AGENTS.md" 2>/dev/null || true)"
  local real
  real="$(grep -c '0\.9\.9\.0' "$work/real/AGENTS.md" 2>/dev/null || true)"

  rm -rf "$work"

  [ "$status" -eq 0 ]
  # The real one is synced; the sandbox copy is left alone.
  [ "$real" -ge 1 ]
  [ "$sandboxed" -eq 0 ]
}
