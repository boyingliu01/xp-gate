#!/usr/bin/env bats
#
# @test REQ-GATE2-ABSOLUTE-PATH
# @intent `check 2 <absolute path>` reported ZERO clones on a project full of them,
#         because jscpd does not apply its glob ignore rules to an absolute scan
#         root -- so the ignore matched everything and nothing was left to compare.
#
#         Measured, three byte-identical 342-byte files (a.js, b.js and
#         .xp-gate/reports/r.js, a copy that SHOULD be ignored):
#
#           jscpd . --ignore "**/.xp-gate/**"                    Found 2   (correct)
#           jscpd <absolute path> --ignore <same full set>      Found 0   (silent)
#           jscpd . --no ignore at all                          Found 3
#
#         The full set is what the gate actually passes for a project with no
#         jscpd.conf.json, and `check 2 <path>` passes an absolute path whenever
#         the target is not the current directory. So the gate's own default path
#         produced an empty report on a fixture whose duplicate is unmissable.
#
#         A zero-clone report and a scan that compared nothing look identical in
#         the output. That is the defect: not a wrong number printed, but a
#         correct-looking number produced by not looking.
#
#         Fixed by scanning '.' with `cwd` set to the target whenever the target
#         IS the current directory, which is the shape jscpd's ignore rules
#         support.
#
# @covers AC-GATE2-ABSOLUTE-PATH-01
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  RUNNER="$REPO/src/npm-package/lib/gate-runner.js"
  FIX="$(mktemp -d)"
}

teardown() {
  rm -rf "$FIX"
}

# Write three byte-identical files large enough to clear jscpd's min-token floor.
_write_triple() {
  node -e '
    const fs = require("fs");
    const path = require("path");
    const root = process.argv[1];
    const block = "function duplicate(a, b, c) {\n  const x = a + b;\n  const y = b * c;\n  const z = x * y;\n  if (z > 10) { return z - x; }\n  return z + y - a;\n}\n";
    const body = block.repeat(3);
    fs.mkdirSync(path.join(root, ".xp-gate", "reports"), { recursive: true });
    fs.writeFileSync(path.join(root, "a.js"), body);
    fs.writeFileSync(path.join(root, "b.js"), body);
    // The copy: identical bytes, but under the directory the gate must ignore.
    fs.writeFileSync(path.join(root, ".xp-gate", "reports", "r.js"), body);
  ' "$FIX"
}

@test "AC-GATE2-ABSOLUTE-PATH-01: scanning the current directory still finds the real duplicate" {
  _write_triple
  printf '{"name":"fixture","version":"1.0.0"}\n' > "$FIX/package.json"

  # Drive the real registry entry, from inside the fixture, exactly as
  # `xp-gate check 2` does after its own cd.
  local out
  out=$(cd "$FIX" && node -e '
    const r = require(process.argv[1]);
    r.GATE_REGISTRY["2"].run(process.cwd());
  ' "$RUNNER" 2>&1 || true)

  # The control: without the fix this is "Found 0" -- a clean-looking report.
  if printf '%s' "$out" | grep -qE 'Found 0'; then
    echo "the scan compared nothing: three identical files, zero clones reported."
    echo "output tail:"
    printf '%s\n' "$out" | tail -5
    return 1
  fi

  printf '%s' "$out" | grep -qE 'Found [1-9][0-9]*' || {
    echo "expected the a.js/b.js duplicate to be reported; got:"
    printf '%s\n' "$out" | tail -5
    return 1
  }

  # And the ignored copy must not ADD a clone: 1 clone / 2 files, not 3.
  if printf '%s' "$out" | grep -qE 'Found 3'; then
    echo "the .xp-gate copy was scanned as source (3 clones); the ignore set is not applied"
    return 1
  fi
}