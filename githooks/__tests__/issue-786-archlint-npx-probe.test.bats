#!/usr/bin/env bats
#
# @test REQ-GATE-PROBE-SHORTCUT Gate 6 must not answer "archlint missing" from a probe
# @intent The last surviving registry-consulting probe in the hooks was Gate 6's:
#
#           elif (cd "$PROJECT_ROOT" && npx @archlinter/cli --version) >/dev/null 2>&1
#
#         Every sibling branch above it already checks a LOCAL artefact (the package
#         entry file, _node_modules/.bin/, PATH); this one alone went to the network so it
#         could then hand control to `npx @archlinter/cli ...` anyway. It also lied
#         in the one direction that matters: on a machine with no archlint, npx
#         downloads the package, answers --version with a version string, and the
#         gate proceeds to run a tool the project never depended on.
#
#         Gate 6 is not exempt from the fail-closed rule the way Gate 8 (secrets)
#         is, so the honest outcome for a missing archlint is BLOCK with an install
#         hint, not a download. `XP_GATE_NPX_PROBE=1` keeps the old behaviour for
#         projects that deliberately rely on npx tooling, matching the documented
#         convention in src/gates/common-process.ts.
#
# @covers AC-PROBE-LOCAL-03 the archlint probe consults no registry by default
# @covers AC-PROBE-LOCAL-04 XP_GATE_NPX_PROBE=1 restores the npx fallback
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  HOOK="$REPO_ROOT/githooks/pre-commit"
  TOOLCHAIN="$REPO_ROOT/githooks/lib/toolchain-path.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/bin"
  cat > "$WORK/bin/npx" <<'STUB'
#!/bin/sh
echo "npx $*" >> "$NPX_LOG"
exit 1
STUB
  chmod +x "$WORK/bin/npx"
  export NPX_LOG="$WORK/npx.log"
  : > "$NPX_LOG"
  # A bare `$WORK/bin:$PATH` is not enough: this machine has archlint installed
  # BOTH globally (%APPDATA%/npm/archlint) and in the repo's node_modules, so the
  # cheap local branches would answer before any probe is reached and the opt-in
  # assertion would pass vacuously -- never proving the fallback still works.
  # This PATH keeps the utilities the helper needs and drops the tool.
  NO_ARCHLINT_PATH="$WORK/bin:$WORK/only-basics"
  mkdir -p "$WORK/only-basics"
  for _t in node sh bash command dirname printf; do
    if _p=$(command -v "$_t" 2>/dev/null); then
      cp "$_p" "$WORK/only-basics/$_t" 2>/dev/null || ln -sf "$_p" "$WORK/only-basics/$_t" 2>/dev/null || true
    fi
  done
  STUB_PATH="$WORK/bin:$PATH"
}

teardown() {
  rm -rf "$WORK"
}

@test "AC-PROBE-LOCAL-03: the archlint probe no longer shells out to npx" {
  # Written against the probe SITE rather than the whole file: the same file
  # legitimately runs `npx @archlinter/cli "$@"` after choosing the npx kind, and
  # its install hints tell the user to run npx themselves. What must not happen is
  # using npx to DECIDE whether archlint exists.
  run bash -c "grep -vE '^[[:space:]]*#' '$HOOK' | grep -nE 'npx +@archlinter/cli +--version'"
  [ "$status" -ne 0 ]
}

@test "AC-PROBE-LOCAL-03: the decision is made by a local-path helper" {
  run grep -nE 'archlint_locally_available|probe_npx_enabled' "$TOOLCHAIN"
  [ "$status" -eq 0 ]
}

@test "AC-PROBE-LOCAL-03: no registry access without the opt-in" {
  cd "$WORK"
  run bash -c "
    export PATH='$NO_ARCHLINT_PATH'
    export XP_GATE_NPX_PROBE=
    source '$TOOLCHAIN'
    probe_archlint_available '$WORK' >/dev/null 2>&1 || true
  "
  run grep -c 'npx' "$NPX_LOG"
  [ "$output" = "0" ]
}

@test "AC-PROBE-LOCAL-04: XP_GATE_NPX_PROBE=1 still allows the npx fallback" {
  # The opt-in exists for projects that genuinely rely on npx-provided tooling
  # (typically CI). Removing the fallback outright would trade one silent failure
  # for another, so the switch is part of the contract, not a leftover.
  cd "$WORK"
  run bash -c "
    export PATH='$NO_ARCHLINT_PATH'
    export NPX_LOG='$NPX_LOG'
    export XP_GATE_NPX_PROBE=1
    source '$TOOLCHAIN'
    probe_archlint_available '$WORK' >/dev/null 2>&1 || true
  "
  run grep -c 'npx' "$NPX_LOG"
  [ "$output" -ge 1 ]
}

@test "AC-PROBE-LOCAL-03: a project-local archlint is found without any probe" {
  # The guard must not turn Gate 6 into a permanent BLOCK: a normally installed
  # archlint is exactly what these branches exist to find.
  mkdir -p "$WORK/node_modules/@archlinter/cli/bin"
  printf '#!/bin/sh\necho 0.16.0\n' > "$WORK/node_modules/@archlinter/cli/bin/archlint.js"
  cd "$WORK"
  run bash -c "
    export PATH='$STUB_PATH'
    export NPX_LOG='$NPX_LOG'
    source '$TOOLCHAIN'
    probe_archlint_available '$WORK'
  "
  [ "$status" -eq 0 ]
  run grep -c 'npx' "$NPX_LOG"
  [ "$output" = "0" ]
}
