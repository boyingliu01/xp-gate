#!/usr/bin/env bats
# @test REQ-G9-ENTRY-POINT-EXISTS
#
# @intent Gate 9's pack check asked "would npm publish something" and reported it
# as "the package is sound". Those are different questions, and the gap between
# them shipped a broken tarball.
#
# Measured 2026-11-22 on a project declaring
#
#     { "main": "dist/nonexistent.js", "files": ["dist"] }
#
# whose dist/ held only tsconfig.tsbuildinfo. `npm pack --dry-run` shipped
# `dist/tsconfig.tsbuildinfo` and `package.json`; inspectPackedFiles saw one
# non-manifest file and passed the check. The gate printed:
#
#     tsc:     PASS
#     pack:    PASS  npm pack: 2 file(s) included
#     imports: PASS
#     Overall: PASS
#
# That tarball contains no JavaScript at all, so every require() of the published
# package throws MODULE_NOT_FOUND -- and build integrity called it healthy.
#
# These cases pin the decision logic by calling the exported function, rather than
# shelling out to npm.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  # The helper sits beside the module so it can use a relative import. A Windows
  # absolute specifier is rejected by ESM (ERR_UNSUPPORTED_ESM_URL_SCHEME).
  HELPER="$REPO_ROOT/src/build-integrity/__entry-probe.mts"
  cat > "$HELPER" <<'MTS'
import { missingEntryPoints } from './entry-points.js';
const [manifestJson, presentCsv] = process.argv.slice(2);
const present = new Set(presentCsv === '' ? [] : presentCsv.split(','));
console.log(JSON.stringify(missingEntryPoints(JSON.parse(manifestJson), present)));
MTS
}

teardown() {
  rm -f "$HELPER"
}

entry_probe() {
  node "$REPO_ROOT/node_modules/tsx/dist/cli.mjs" "$HELPER" "$1" "$2" 2>/dev/null | tail -1
}

@test "a main entry the package does not contain is reported" {
  run entry_probe '{"main":"dist/nonexistent.js"}' 'dist/tsconfig.tsbuildinfo,package.json'
  [ "$status" -eq 0 ]
  [ "$output" = '["dist/nonexistent.js"]' ]
}

@test "a main entry that is present is not reported" {
  run entry_probe '{"main":"dist/index.js"}' 'dist/index.js,package.json'
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}

@test "an extensionless main resolves to its .js file" {
  run entry_probe '{"main":"dist/index"}' 'dist/index.js'
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}

@test "a bare specifier is not treated as a path" {
  run entry_probe '{"main":"some-dependency"}' 'package.json'
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}

@test "a missing export leaf is reported" {
  run entry_probe '{"exports":{".":{"require":"./dist/a.js","types":"./dist/a.d.ts"}}}' 'dist/a.js'
  [ "$status" -eq 0 ]
  [ "$output" = '["./dist/a.d.ts"]' ]
}

@test "every missing entry is reported" {
  run entry_probe '{"main":"dist/a.js","types":"dist/a.d.ts"}' 'package.json'
  [ "$status" -eq 0 ]
  echo "$output" | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c)).on("end", () => {
      const arr = JSON.parse(d);
      if (arr.length !== 2) { console.error("expected 2, got " + d); process.exit(1); }
    });
  '
}

@test "a manifest without entry points is silent" {
  run entry_probe '{"name":"p","version":"1.0.0"}' 'package.json'
  [ "$status" -eq 0 ]
  [ "$output" = '[]' ]
}
