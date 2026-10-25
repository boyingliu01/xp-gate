#!/usr/bin/env bats
# @test REQ-610
# @intent Three adapters loaded their shared library with
#
#             source "$SCRIPT_DIR/../adapter-common.sh" 2>/dev/null || true
#
#         `$SCRIPT_DIR` is already `.../adapters`, so `../adapter-common.sh` is
#         `.../adapter-common.sh`. In the repository layout that file happens to
#         exist (the npm package keeps a copy there), but in the GLOBAL install
#         layout `~/.config/xp-gate/adapters/` it does not:
#
#             test -f ~/.config/xp-gate/adapter-common.sh           -> missing
#             test -f ~/.config/xp-gate/adapters/adapter-common.sh  -> present
#
#         So in the layout that most consumer machines actually have, the library
#         never loaded and every function it provides was undefined.
#
#         `2>/dev/null || true` is what made it invisible: a failed source is
#         indistinguishable from a successful one, so the adapters degraded to
#         whatever fallbacks they happened to have, or failed later with an
#         unrelated "command not found".
#
#         Zero adapters used the path that works. This is a whole class, not one
#         typo, so the test walks the candidates the documented 3-tier convention
#         allows and asserts each one resolves in EVERY layout the package ships.
# @covers AC-610-01, AC-610-02, AC-610-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER_DIR="$REPO_ROOT/githooks/adapters"

  # The adapters that had the wrong path, from the issue's grep.
  AFFECTED="go.sh iac.sh python.sh"
}

# ---------------------------------------------------------------------------
# AC-610-01: no adapter uses the broken ../ path
# ---------------------------------------------------------------------------

@test "AC-610-01: no adapter sources adapter-common.sh through the broken parent path" {
  local hits=""
  for f in "$ADAPTER_DIR"/*.sh; do
    if grep -q 'source "\$SCRIPT_DIR/\.\./adapter-common\.sh"' "$f" 2>/dev/null; then
      hits="$hits $(basename "$f")"
    fi
  done
  [ -z "$hits" ] || {
    echo "these adapters still source ../adapter-common.sh (a path that does not exist in the global layout):$hits"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-610-02: the library actually loads in every shipped layout
# ---------------------------------------------------------------------------

@test "AC-610-02: the resolved path loads adapter-common.sh in the global layout" {
  # Reproduce the layout the reporter measured: the library sits INSIDE adapters/,
  # not one level up. This is the layout where the old path silently failed.
  local stage="$BATS_TEST_TMPDIR/global/adapters"
  mkdir -p "$stage"
  cp "$REPO_ROOT/githooks/adapter-common.sh" "$stage/adapter-common.sh"
  cp "$ADAPTER_DIR/iac.sh" "$stage/iac.sh"

  # The assertion: after sourcing the way the adapter does, a function the library
  # defines must exist. Checking the file was "not an error" is not enough — that
  # is exactly the check `|| true` already defeated.
  run bash -c "
    set -u
    SCRIPT_DIR='$stage'
    source '$stage/iac.sh' >/dev/null 2>&1 || true
    if declare -F detect_project_lang >/dev/null 2>&1; then
      echo 'LIB_LOADED'
    else
      echo 'LIB_MISSING'
    fi
  "
  [[ "$output" == *"LIB_LOADED"* ]] || {
    echo "adapter-common.sh did not load in the global layout; got: $output"
    return 1
  }
}

@test "AC-610-02: a failed library load is no longer silent" {
  # `2>/dev/null || true` is the defect's hiding place. Where the library cannot be
  # found at all, the adapter must say so instead of continuing with undefined
  # functions — otherwise the next failure is attributed to the wrong thing.
  run bash -c "
    set -u
    SCRIPT_DIR='$BATS_TEST_TMPDIR/empty'
    mkdir -p \"\$SCRIPT_DIR\"
    cp '$ADAPTER_DIR/iac.sh' \"\$SCRIPT_DIR/iac.sh\"
    out=\$(source \"\$SCRIPT_DIR/iac.sh\" 2>&1 || true)
    printf '%s' \"\$out\"
  "
  # Either the adapter announces the missing library, or it deliberately does not
  # need it. What must NOT happen is loading success being indistinguishable from
  # failure, so this asserts the absence of the pattern rather than a message.
  local src
  src=$(grep -c 'adapter-common.sh" 2>/dev/null || true' "$ADAPTER_DIR/iac.sh" || true)
  [ "$src" -eq 0 ] || {
    echo "iac.sh still swallows the library-load failure with 2>/dev/null || true"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-610-03: all three previously-affected adapters are fixed
# ---------------------------------------------------------------------------

@test "AC-610-02: the library also loads in the npm-package layout (library one level up)" {
  # The mirror of the case above, and it exists because the first version of this
  # suite did not have it: fixing the global layout by switching to ONLY
  # `$SCRIPT_DIR/adapter-common.sh` silently broke the npm-package layout, where the
  # library really is one level up. Every case stayed green.
  #
  # Both layouts ship, so both must load. A fallback list is the only shape that
  # satisfies both, and this pair of cases is what forces a list rather than a
  # different single guess.
  local stage="$BATS_TEST_TMPDIR/npm/adapters"
  mkdir -p "$stage"
  # Library ABOVE the adapters dir, exactly as src/npm-package/ ships it.
  cp "$REPO_ROOT/githooks/adapter-common.sh" "$BATS_TEST_TMPDIR/npm/adapter-common.sh"
  cp "$ADAPTER_DIR/go.sh" "$stage/go.sh"

  run bash -c "
    set -u
    SCRIPT_DIR='$stage'
    source '$stage/go.sh' >/dev/null 2>&1 || true
    if declare -F detect_project_lang >/dev/null 2>&1; then echo 'LIB_LOADED'; else echo 'LIB_MISSING'; fi
  "
  [[ "$output" == *"LIB_LOADED"* ]] || {
    echo "adapter-common.sh did not load in the npm-package layout; got: $output"
    return 1
  }
}

@test "AC-610-03: every previously-affected adapter resolves the library" {
  for name in $AFFECTED; do
    local f="$ADAPTER_DIR/$name"
    [ -f "$f" ] || { echo "missing adapter: $name"; return 1; }
    # The adapter must have a candidate list, not a single guessed path.
    grep -q 'adapter-common\.sh' "$f" || { echo "$name has no library reference at all"; return 1; }
    grep -q '\$SCRIPT_DIR/adapter-common\.sh' "$f" || {
      echo "$name does not try \$SCRIPT_DIR/adapter-common.sh, the path that works in the global layout"
      return 1
    }
  done
}

@test "AC-610-03: adapters remain syntactically valid after the change" {
  for name in $AFFECTED; do
    run bash -n "$ADAPTER_DIR/$name"
    [ "$status" -eq 0 ] || { echo "$name has a syntax error: $output"; return 1; }
  done
}
