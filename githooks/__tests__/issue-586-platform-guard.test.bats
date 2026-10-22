#!/usr/bin/env bats
# @test REQ-586
# @intent A test that can only pass on one platform, written without a guard, is a
#         test that fails on every other platform. CI runs Linux, so those failures
#         are permanent, and they are indistinguishable from real regressions.
#
#         Four of them surfaced the moment Gate 5 ran for the first time (Gate 1 had
#         failed on every prior build, so Gate 5 had never executed):
#
#           src/npm-package/lib/__tests__/hook-health-path.test.js
#             AC-566-02: expects the fixture path to contain '\'
#             CI: expected '/tmp/hook-posix-XiaI9b/pre-push' to contain '\'
#             The assertion IS the Windows premise. On Linux path.join produces
#             '/tmp/...', so the test cannot pass by construction.
#
#           src/npm-package/lib/__tests__/doctor-exec-retry.test.js
#             AC-DOCTOR-RETRY-01: expects the probe to be retried
#             CI: expected 1 to be 2
#             The retry exists because cmd.exe can hand back an exit-0 probe with a
#             lost stream — a Windows behaviour. On Linux there is nothing to retry.
#
#         A skipped test is honest: the runner reports "skipped", the count stays
#         visible, and nobody mistakes the gap for coverage. A test that fails on
#         every build is worse than either — it trains people to ignore red.
#
#         Pin: a test file that asserts a platform-specific fact must declare its
#         platform, and the repo must run tests somewhere that platform exists.
# @covers AC-586-01, AC-586-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

@test "AC-586-01: hook-health-path declares its Windows-only premise" {
  local f="$REPO_ROOT/src/npm-package/lib/__tests__/hook-health-path.test.js"
  [ -f "$f" ] || {
    echo "$f was removed -- this test's subject is gone"
    return 1
  }
  # The file asserts that path.join yields a backslash path. That is a Windows
  # fact; on any other platform the assertion is guaranteed red.
  grep -qE "toContain\('\\\\\\\\'\)" "$f" || {
    echo "the Windows-path assertion changed shape; re-read the file before trusting this test"
    return 1
  }
  # So it must either skip off-Windows, or be excluded from the cross-platform
  # collected set. Accept an explicit platform guard in the file.
  grep -qE 'process\.platform|it\.skipIf|describe\.skipIf|test\.skipIf|runIf' "$f" || {
    echo "hook-health-path.test.js asserts a Windows-only path fact with no platform guard."
    echo "On Linux CI it fails by construction: expected '/tmp/...' to contain '\\'."
    echo "Add a guard (e.g. describe.skipIf(process.platform !== 'win32')) or move the"
    echo "assertion behind one."
    return 1
  }
}

@test "AC-586-02: doctor-exec-retry declares its Windows-only premise" {
  local f="$REPO_ROOT/src/npm-package/lib/__tests__/doctor-exec-retry.test.js"
  [ -f "$f" ] || {
    echo "$f was removed -- this test's subject is gone"
    return 1
  }
  # The retry compensates for cmd.exe returning exit-0 with an empty stream.
  grep -qiE 'cmd\.exe|windows' "$f" || {
    echo "the file no longer documents a Windows retry premise; re-read before trusting this test"
    return 1
  }
  # The whole retry case is win32-only: off win32 the first empty probe is final,
  # so `result` is null and there is nothing to retry.
  grep -qE "it\.skipIf\(process\.platform !== 'win32'\)" "$f" || {
    echo "doctor-exec-retry.test.js exercises a Windows-only retry path with no platform guard."
    echo "On Linux CI it fails: expected 1 to be 2 (nothing retried)."
    return 1
  }
}

@test "AC-586-03: check-alignment-cli loads the runner through tsx, like the CLI does" {
  local f="$REPO_ROOT/src/npm-package/lib/__tests__/check-alignment-cli.test.mjs"
  [ -f "$f" ] || {
    echo "$f was removed -- this test's subject is gone"
    return 1
  }
  # The runner requires './test-alignment.ts'. Bare `node` only accepts that from
  # Node 22.6+ (type stripping); CI pins Node 20.x and throws "Unknown file
  # extension". The resulting empty stdout then reads as "Unexpected end of JSON
  # input" — the very truncation this test exists to catch (#586).
  grep -q "require('./test-alignment.ts')" "$REPO_ROOT/src/npm-package/lib/check-alignment-runner.cjs" || {
    echo "the runner no longer requires a .ts file; this test's premise is gone"
    return 1
  }
  grep -qE "tsx.*cli\.mjs|'tsx'" "$f" || {
    echo "check-alignment-cli.test.mjs spawns the runner with bare node."
    echo "On Node 20 CI the runner cannot load its .ts engine and prints nothing."
    return 1
  }
}

@test "AC-586-04: coverage-threshold-enforced proves measurement from the artifact" {
  local f="$REPO_ROOT/scripts/__tests__/coverage-threshold-enforced.test.ts"
  [ -f "$f" ] || return 1
  # "Coverage enabled with v8" is only printed under some reporters/platforms;
  # keying the anti-vacuity guard on that log line made a healthy run fail.
  # Check for an ASSERTION on it (toMatch(...)), not a mention in a comment: the
  # file legitimately explains the old shape in prose.
  ! grep -qE 'toMatch\(/Coverage enabled with v8/' "$f" || {
    echo "the anti-vacuity guard is back to matching a reporter-dependent log line."
    echo "Use the coverage-summary.json artifact instead."
    return 1
  }
  grep -q 'coverage-summary.json' "$f" || {
    echo "coverage-threshold-enforced no longer checks the coverage artifact"
    return 1
  }
}
