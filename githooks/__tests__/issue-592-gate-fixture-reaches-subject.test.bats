#!/usr/bin/env bats
# @test REQ-592
# @intent `gate9-architecture.bats` reported 18 failures in CI and was almost
#         entirely red locally too. None of it was about Gate 9 — the fixture could
#         not reach the code under test. Four independent stale assumptions, each
#         enough on its own to make every assertion vacuous:
#
#         1. `export PATH="$TEST_DIR/bin:/usr/bin:/bin"` REPLACED PATH with a fixed
#            three-entry list. Neither tool the hook needs lives there:
#              Linux CI runner     -> node is /usr/local/bin
#              Windows Git Bash    -> git is "/c/Program Files/Git/..."
#            so setup() died at `git init --quiet` with status 127:
#                line 29: git: command not found
#
#         2. `pre-commit` sources ten helpers from `lib/`; the fixture copied
#            `now-ms.sh` only, so the hook stopped with
#                FATAL: cannot load .../lib/audit-sanitize.sh (missing)
#            before any gate printed anything.
#
#         3. `git init` leaves the repo on master/main, which Gate 0 treats as
#            PROTECTED:
#                ERROR: Committing to a protected branch without VERSION/CHANGELOG update.
#            and exits before Gate 1.
#
#         4. The Go case built its fixture with `touch domain/entity.go` — an empty
#            file, which golangci-lint rejects with "expected 'package', found 'EOF'",
#            so Gate 1 BLOCKed before Gate 9.
#
#         A fixture whose setup fails guards nothing, while still appearing in the
#         suite as a "test". Measured: measured 2/20 -> 20/20 after these fixes.
#
#         Pin: a gate fixture must not pin PATH to a fixed list, must copy the whole
#         lib/ directory, and must commit from a non-protected branch.
# @covers AC-592-01, AC-592-02, AC-592-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  F="$REPO_ROOT/githooks/__tests__/gate9-architecture.bats"
  PRE_COMMIT="$REPO_ROOT/githooks/pre-commit"
}

@test "AC-592-01: the fixture prepends to PATH instead of replacing it" {
  [ -f "$F" ] || {
    echo "$F is gone -- this test's subject no longer exists"
    return 1
  }
  # Comments stripped: the file documents the old fixed list in prose.
  run bash -c "sed 's/#.*//' '$F' | grep -nE 'export PATH=\"[^\"\\$]*/usr/bin'"
  [ "$status" -ne 0 ] || {
    echo "the fixture replaces PATH with a fixed /usr/bin list:"
    echo "$output"
    echo "git and node do not live there on CI (node: /usr/local/bin) or on"
    echo "Windows Git Bash (git: /c/Program Files/Git/...), so setup() dies at git init."
    return 1
  }
  bash -c "sed 's/#.*//' '$F' | grep -qE 'export PATH=\"[^\"]*\\\$PATH\"'" || {
    echo "the fixture does not prepend a stub dir to \$PATH"
    return 1
  }
}

@test "AC-592-02: the fixture copies the whole lib directory" {
  # The hook's dependency set grows. Listing files by name is what let this
  # fixture drift nine helpers behind.
  bash -c "sed 's/#.*//' '$F' | grep -qE 'cp -R? .*/lib/\\.?'" || {
    echo "the fixture does not copy githooks/lib as a directory."
    echo "pre-commit sources ten helpers from it; a hand-listed subset goes stale."
    return 1
  }
  # Anti-vacuity for the check above: the hook really does pull from lib/.
  grep -qE 'source .*lib/' "$PRE_COMMIT" || grep -qE 'lib/[a-z-]+\.sh' "$PRE_COMMIT" || {
    echo "pre-commit no longer sources anything from lib/; re-read this test"
    return 1
  }
}

@test "AC-592-03: the fixture commits from a non-protected branch" {
  bash -c "sed 's/#.*//' '$F' | grep -qE 'git (checkout|switch)[^|]*-[bBcC] '" || {
    echo "the fixture does not create/switch to a feature branch."
    echo "git init leaves it on master/main, which Gate 0 treats as protected and"
    echo "exits on: 'ERROR: Committing to a protected branch without VERSION/CHANGELOG update.'"
    return 1
  }
  # And that premise is real: the hook must still be protecting those branches.
  grep -q 'PROTECTED_BRANCHES=' "$PRE_COMMIT" || {
    echo "pre-commit no longer declares PROTECTED_BRANCHES; re-read this test"
    return 1
  }
}
