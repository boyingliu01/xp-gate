#!/usr/bin/env bats
# @test REQ-602
# @intent A hook that does not parse is worse than a hook that judges wrongly.
#
#         #579: hooks/pre-commit gained a stray backtick inside a Gate 5 echo:
#             echo "     ⚠️  `$new_file` — no coverage data ..."
#         The opening backtick started a command substitution, so bash failed to
#         parse the REST OF THE FILE:
#             pre-commit: line 3208: syntax error near unexpected token `('
#         The hook printed "✅ PASSED - Gate 5" and then died. Gates 6, 7, 8, 9,
#         10, 11 and 12 never ran, the quality report was never written, and the
#         commit was ALLOWED because the exit status came from the last command
#         that happened to succeed. Nothing in the output said seven gates had
#         been skipped.
#
#         Why the existing defences missed it:
#           - the BATS suites execute individual gates, but no test ever parsed
#             a whole hook file
#           - scripts/verify-xp-gate-patches.cjs checks mutation-runner patches and
#             the pre-push --timeout, not hook parseability
#           - scripts/check-hook-mirror.sh compares bytes, and a byte-identical
#             broken file passes that comparison
#
#         So the invariant is: every shell file the hook engine executes must
#         parse. This is cheap (bash -n, no execution), platform-independent, and
#         it fails loudly at the one moment the defect is still harmless.
# @covers AC-602-01, AC-602-02

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GITHOOKS="$REPO_ROOT/githooks"
}

# Every shell file the pre-commit / pre-push engine sources or executes.
engine_shell_files() {
  {
    echo "$GITHOOKS/pre-commit"
    echo "$GITHOOKS/pre-push"
    echo "$GITHOOKS/adapter-common.sh"
    echo "$GITHOOKS/hook-module-resolution.sh"
    echo "$GITHOOKS/sprint-gate.sh"
    echo "$GITHOOKS/install.sh"
    find "$GITHOOKS/lib" -maxdepth 1 -name '*.sh' 2>/dev/null
    find "$GITHOOKS/adapters" -maxdepth 1 -name '*.sh' 2>/dev/null
  } | while read -r f; do
    [ -f "$f" ] && echo "$f"
  done
}

@test "AC-602-01: every hook shell file parses" {
  local failed=0
  local -a broken=()

  while read -r f; do
    [ -n "$f" ] || continue
    if ! bash -n "$f" 2>/dev/null; then
      broken+=("${f#"$REPO_ROOT/"}")
      failed=1
    fi
  done < <(engine_shell_files)

  if [ "$failed" -ne 0 ]; then
    echo "these hook files do not parse, so the gates after the syntax error never run:"
    printf '  %s\n' "${broken[@]}"
    # Show the actual message for the first one: "syntax error near unexpected
    # token" is the signature of the #579 defect.
    echo "--- first error ---"
    bash -n "$REPO_ROOT/${broken[0]}" 2>&1 | head -3
    return 1
  fi

  # Guard against a vacuous pass: if the enumeration produced nothing (wrong
  # directory, renamed files), the loop above verified nothing at all.
  local count
  count=$(engine_shell_files | grep -c . || true)
  [ "$count" -ge 5 ] || {
    echo "only $count shell files found; the enumeration is broken, not the code"
    return 1
  }
}

@test "AC-602-02: the npm-shipped copies parse too" {
  # The installed hook is what actually runs on a user's machine (#566: it has
  # carried uncommitted code before). A file that parses in githooks/ but not in
  # the shipped copy would still break every consumer.
  local pkg="$REPO_ROOT/src/npm-package/hooks"
  [ -d "$pkg" ] || skip "no npm package hooks directory in this checkout"

  local failed=0
  while read -r f; do
    [ -n "$f" ] || continue
    if ! bash -n "$f" 2>/dev/null; then
      echo "shipped copy does not parse: ${f#"$REPO_ROOT/"}"
      bash -n "$f" 2>&1 | head -2
      failed=1
    fi
  done < <(find "$pkg" -maxdepth 2 -name '*.sh' -type f 2>/dev/null; ls "$pkg"/pre-commit "$pkg"/pre-push 2>/dev/null)

  [ "$failed" -eq 0 ]
}

@test "AC-602-01: a syntax error introduced into a hook is detected" {
  # The control. Take a real hook, inject a parse error, and prove the guard goes
  # red on it — otherwise the two cases above could be passing because bash -n is
  # never actually consulted.
  #
  # The first attempt used `$new_file` (a PAIRED backtick pair). That parses
  # cleanly — bash accepts it as command substitution and only fails at runtime —
  # so the control was testing nothing. The real #579 shape leaves an UNBALANCED
  # backtick, which is what makes the parser reject the rest of the file.
  local tmp
  tmp="$(mktemp -d)"
  local victim="$tmp/pre-commit"

  cat > "$victim" <<'BROKEN'
#!/usr/bin/env bash
CURRENT_GATE=5
echo "✅ PASSED - Gate ${CURRENT_GATE}"
echo "     ⚠️  $new_file — no coverage data (file may be excluded or not exercised)"
echo "→ Gate 6: Architecture..."
X=`echo hi
BROKEN

  run bash -n "$victim"
  [ "$status" -ne 0 ] || {
    echo "the guard did not notice a syntax error; it would not catch #579"
    rm -rf "$tmp"
    return 1
  }

  # And a correct version of the same fragment must parse, so the control is not
  # simply rejecting every file.
  cat > "$victim" <<'FIXED'
#!/usr/bin/env bash
CURRENT_GATE=5
echo "✅ PASSED - Gate ${CURRENT_GATE}"
echo "     ⚠️  $new_file — no coverage data (file may be excluded or not exercised)"
echo "→ Gate 6: Architecture..."
X=$(echo hi)
FIXED

  local fixed_status=0
  bash -n "$victim" || fixed_status=$?
  rm -rf "$tmp"

  [ "$fixed_status" -eq 0 ] || {
    echo "the corrected form also fails to parse; the control is unsound"
    return 1
  }
}
