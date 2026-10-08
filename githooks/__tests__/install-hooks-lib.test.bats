#!/usr/bin/env bats
# @test REQ-473
# @intent 验证 hook 库（githooks/lib/*）在安装后完整可用：install.sh 落地 lib/，
#         被引用的库存在，每个库文件逐字节安装到位，且没有库 source 到安装目录之外
# @covers AC-473-03, AC-473-04 (the four earlier tests in this file predate the
#         annotation convention and pin the #473 install bug itself)

# ============================================================================
# The hook libraries under githooks/lib/ are load-bearing: pre-commit sources
# them at startup, and Gate 5's test-failure judgement (lib/test-failure.sh,
# extracted for #473) lives there. `bash githooks/install.sh` copied only the
# hook files and the adapters, never lib/, so an installed hook ran with
# "now_ms: command not found" and — once handle_test_failure went missing —
# `handle_test_failure ... || exit 1` blocked EVERY commit in that project.
#
# Two invariants are pinned:
#   1. install.sh actually lands lib/ next to the hooks it installs.
#   2. every lib/<name> the hooks source exists in the canonical directory
#      (so a future extraction cannot ship without its installer entry).
#
# The pair above is one-directional: it proves a referenced library exists in the
# repository, not that the installer carries it, and it says nothing about a
# library that sources another file. A lib file can only ever resolve paths
# against the installed tree, so a library that reaches outside the hooks
# directory (`../adapter-common.sh`, `src/…`, `scripts/…`) works in the repo and
# breaks in every project that installs it. That is the gap AC-473-03/04 close.
# ============================================================================

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SOURCE_GITHOOKS="$REPO_ROOT/githooks"
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

@test "install.sh copies githooks/lib next to the installed hooks" {
  run bash -c "cd '$TEST_DIR' && bash '$SOURCE_GITHOOKS/install.sh'"
  [ "$status" -eq 0 ]
  [ -f "$TEST_DIR/.git/hooks/pre-commit" ]
  [ -f "$TEST_DIR/.git/hooks/lib/test-failure.sh" ]
  [ -f "$TEST_DIR/.git/hooks/lib/now-ms.sh" ]
}

@test "an installed hook can source every library it references" {
  # This is the real failure mode: the reference resolves against the hook's own
  # directory, so the file must exist there, not only in the repository.
  run bash -c "cd '$TEST_DIR' && bash '$SOURCE_GITHOOKS/install.sh'"
  [ "$status" -eq 0 ]

  run bash -c "
    cd '$TEST_DIR'
    missing=0
    for ref in \$(grep -o 'lib/[a-zA-Z0-9._-]*' .git/hooks/pre-commit | sort -u); do
      case \"\$ref\" in
        *.sh|*.cjs) [ -f \".git/hooks/\$ref\" ] || { echo \"MISSING \$ref\"; missing=1; } ;;
      esac
    done
    echo \"missing=\$missing\"
  "
  [[ "$output" != *"MISSING"* ]]
  [[ "$output" == *"missing=0"* ]]
}

@test "every library the hooks source exists in the canonical githooks/lib" {
  run bash -c "
    for hook in '$SOURCE_GITHOOKS/pre-commit' '$SOURCE_GITHOOKS/pre-push'; do
      grep -o 'lib/[a-zA-Z0-9._-]*' \"\$hook\"
    done | sort -u | while read -r ref; do
      case \"\$ref\" in
        *.sh|*.cjs) [ -f '$SOURCE_GITHOOKS/'\"\$ref\" ] || echo \"MISSING \$ref\" ;;
      esac
    done
  "
  [ "$output" = "" ]
}

@test "Gate 5's handler is reachable from the installed hook" {
  # Fail-closed is only acceptable when the file is really there.
  run bash -c "cd '$TEST_DIR' && bash '$SOURCE_GITHOOKS/install.sh' > /dev/null"
  [ "$status" -eq 0 ]

  run grep -c 'handle_test_failure' "$TEST_DIR/.git/hooks/lib/test-failure.sh"
  [ "$output" -ge 2 ]

  run grep -c 'lib/test-failure.sh' "$TEST_DIR/.git/hooks/pre-commit"
  [ "$output" -ge 1 ]
}

# ============================================================================
# REQ-473 / AC-473-03, AC-473-04 -- the copy is the dependency contract (#457
# walkthrough FC-09).
#
# install.sh has no dependency manifest: it copies the whole of githooks/lib/.
# That is what keeps a lib -> lib edge working without any declaration -- every
# library lands together, so a library that sources its sibling finds it. The
# arrangement is only sound while two things stay true, and neither was
# asserted anywhere:
#   * every file in githooks/lib/ actually reaches .git/hooks/lib/ (the checks
#     above spot-check two of six, so a future whitelist-style copy would pass
#     them while dropping the rest);
#   * no library reaches OUTSIDE the installed tree. install.sh copies the three
#     hooks plus lib/, so a `source ../adapter-common.sh` or `source
#     "$ROOT/scripts/x.sh"` inside a library resolves in the repository, where
#     the tests are written, and nowhere in the installed project -- the exact
#     shape of the #473 bug, moved one directory deeper.
# ============================================================================

# Prints one line per library file whose source statements reference a path
# outside the hooks/lib installation boundary. Comment lines are dropped: a
# docstring that says "source this file: …" is not a dependency, and matching it
# was already a false positive in this suite.
find_outside_sources() {
  local lib_dir="$1"
  [ -d "$lib_dir" ] || return 0
  for f in "$lib_dir"/*; do
    [ -f "$f" ] || continue
    case "$f" in *.sh) ;; *) continue ;; esac
    sed '/^[[:space:]]*#/d' "$f" |
      grep -E '^[[:space:]]*(source|\.)[[:space:]]' |
      grep -E '\.\./|/scripts/|/src/' |
      sed "s|^|$(basename "$f"): |"
  done
}

@test "AC-473-03: install.sh lands every file under githooks/lib, byte-identically" {
  run bash -c "cd '$TEST_DIR' && bash '$SOURCE_GITHOOKS/install.sh' > /dev/null"
  [ "$status" -eq 0 ]

  # Anti-vacuity: the set compared below must be the real one, not an empty
  # loop that passes because the source directory moved.
  local source_count
  source_count=$(find "$SOURCE_GITHOOKS/lib" -maxdepth 1 -type f | wc -l)
  [ "$source_count" -ge 6 ]

  run bash -c "cd '$TEST_DIR' && for f in '$SOURCE_GITHOOKS'/lib/*; do
      [ -f \"\$f\" ] || continue
      b=\$(basename \"\$f\")
      [ -f \".git/hooks/lib/\$b\" ] || echo \"NOT INSTALLED \$b\"
      cmp -s \"\$f\" \".git/hooks/lib/\$b\" || echo \"DIFFERS \$b\"
    done"
  [ "$output" = "" ]
}

@test "AC-473-04: no library sources anything outside the installed hooks tree" {
  run find_outside_sources "$SOURCE_GITHOOKS/lib"
  [ "$output" = "" ]
}

@test "AC-473-04 anti-vacuity: the closure check fires on a library that escapes lib/" {
  # The two assertions above are green on an empty dependency graph, which is
  # today's truth. Without this fixture the pair would stay green forever,
  # including after someone adds the very edge this guards.
  FIXTURE_LIB="$TEST_DIR/fixture-lib"
  mkdir -p "$FIXTURE_LIB"

  printf '%s\n' 'source "${BASH_SOURCE[0]%/*}/../adapter-common.sh"' > "$FIXTURE_LIB/escapes_parent.sh"
  run find_outside_sources "$FIXTURE_LIB"
  [[ "$output" == *"escapes_parent.sh"* ]]

  printf 'source "$XP_GATE_ROOT/scripts/other.sh"\n' > "$FIXTURE_LIB/escapes_repo.sh"
  run find_outside_sources "$FIXTURE_LIB"
  [[ "$output" == *"escapes_repo.sh"* ]]

  # And it does not fire on a sibling edge, which IS safe: install.sh copies the
  # whole directory, so lib/a.sh -> lib/b.sh always resolves.
  printf '%s\n' 'source "${BASH_SOURCE[0]%/*}/now-ms.sh"' > "$FIXTURE_LIB/sibling_ok.sh"
  rm "$FIXTURE_LIB/escapes_parent.sh" "$FIXTURE_LIB/escapes_repo.sh"
  run find_outside_sources "$FIXTURE_LIB"
  [ "$output" = "" ]
}
