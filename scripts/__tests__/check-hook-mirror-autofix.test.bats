#!/usr/bin/env bats
#
# @test REQ-MIRROR-AUTOFIX A repairable stale mirror tells the truth about what it did
# @intent When `src/npm-package/adapters/` is stale, `check-hook-mirror.sh`
#         regenerates it and then fails unconditionally. The regeneration works,
#         so the NEXT run passes -- but the run that did the repair reported the
#         same failure as a repository that is still broken.
#
#         That is the defect shape this repository keeps fixing: the reported
#         state and the actual state disagree. It cost a real push: the mirror was
#         repaired on the spot, the push was blocked anyway, and the only way to
#         discover the repair had worked was to run the check a second time.
#
#         The failure itself must stay. CI depends on it -- a stale tree is what
#         gets committed if nobody looks -- and the source says so. What changes is
#         that the two situations stop looking identical:
#
#           non-interactive (XP_GATE_MIRROR_AUTOFIX unset/0) -> exit 1, as before
#           interactive     (XP_GATE_MIRROR_AUTOFIX=1)        -> repair, exit 0
#
#         A generator that CANNOT reproduce is not repairable by regenerating, so
#         the interactive allowance must not cover it: that stays a hard failure.
#
#         Scope note: these tests exercise the adapters block of the real script,
#         extracted verbatim from the source rather than re-implemented, so they
#         fail when the real logic changes. A fixture spanning the whole script
#         would copy seven megabytes of trees per test (~40 s per run measured on
#         this machine) and timed the suite out; the script's other checks are
#         covered by the full run in CI.
#
# @covers AC-MIRROR-AUTOFIX-01
# @covers AC-MIRROR-AUTOFIX-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$REPO_ROOT/scripts/check-hook-mirror.sh"
  FIXTURE="$(mktemp -d)"

  mkdir -p "$FIXTURE/githooks/adapters" \
           "$FIXTURE/src/npm-package/adapters" \
           "$FIXTURE/src/npm-package/scripts"

  # One canonical adapter. Small on purpose: the assertion is about behaviour,
  # not about how many files exist.
  printf '#!/usr/bin/env bash\necho canonical\n' > "$FIXTURE/githooks/adapters/demo.sh"
  chmod +x "$FIXTURE/githooks/adapters/demo.sh"

  write_reproducing_generator
  node "$FIXTURE/src/npm-package/scripts/generate-mirrors.cjs"
  build_probe
}

teardown() {
  [ -n "${FIXTURE:-}" ] && [ -d "$FIXTURE" ] && rm -rf "$FIXTURE"
}

# A generator that reproduces the canonical tree exactly.
write_reproducing_generator() {
  cat > "$FIXTURE/src/npm-package/scripts/generate-mirrors.cjs" <<'GEN'
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..');
const src = path.join(root, 'githooks', 'adapters');
const dst = path.join(root, 'src', 'npm-package', 'adapters');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
  fs.chmodSync(path.join(dst, f), 0o755);
}
GEN
}

# A generator that always produces a tree that still differs, so regenerating
# can never reach consistency. Models a generator DEFECT, not a stale copy.
write_broken_generator() {
  cat > "$FIXTURE/src/npm-package/scripts/generate-mirrors.cjs" <<'GEN'
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..', '..');
const src = path.join(root, 'githooks', 'adapters');
const dst = path.join(root, 'src', 'npm-package', 'adapters');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
  fs.writeFileSync(path.join(dst, f), fs.readFileSync(path.join(src, f), 'utf8') + '\n# extra\n');
  fs.chmodSync(path.join(dst, f), 0o755);
}
GEN
}

# Extract the helpers and the adapters block from the REAL script, so the tests
# run the production logic. Nothing here re-implements the check.
#
# The block is delimited by its own landmarks rather than by "the first fi": the
# adapters section contains TWO top-level if-statements (create the tree if it is
# missing, then compare it), and stopping at the first one extracts a probe that
# silently passes every test -- which it did before this was corrected.
build_probe() {
  local start stop
  start="$(grep -n '^# P1-E step 1' "$SCRIPT" | head -1 | cut -d: -f1)"
  # The block ends where the next section's comment begins; slicing to there
  # covers BOTH top-level if-statements in the adapters section (create the tree
  # if missing, then compare it and decide what a mismatch means).
  stop="$(grep -n '^# Executable bits must match' "$SCRIPT" | head -1 | cut -d: -f1)"

  [ -n "$start" ] && [ -n "$stop" ] || { echo "could not locate the adapters block" >&2; return 1; }

  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    sed -n '/^fail() {/,/^}/p' "$SCRIPT"
    sed -n '/^is_interactive_mirror_run() {/,/^}/p' "$SCRIPT"
    sed -n "${start},$((stop - 1))p" "$SCRIPT"
  } > "$FIXTURE/probe.sh"

  # An extract that came out empty would make every assertion below meaningless.
  [ -s "$FIXTURE/probe.sh" ] || { echo "probe extraction produced nothing" >&2; return 1; }
  grep -q 'is_interactive_mirror_run' "$FIXTURE/probe.sh" || { echo "helpers missing from probe" >&2; return 1; }
  grep -q 'tree_diff' "$FIXTURE/probe.sh" || { echo "adapters block missing from probe" >&2; return 1; }
}

stale_the_canonical_tree() {
  printf '\n# drift\n' >> "$FIXTURE/githooks/adapters/demo.sh"
}

@test "AC-MIRROR-AUTOFIX-01: non-interactive keeps the hard failure on a stale tree" {
  stale_the_canonical_tree

  run env XP_GATE_MIRROR_AUTOFIX=0 bash -c "cd '$FIXTURE' && bash probe.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"stale"* ]]
}

@test "AC-MIRROR-AUTOFIX-01: interactive repairs the tree and exits 0" {
  stale_the_canonical_tree

  run env XP_GATE_MIRROR_AUTOFIX=1 bash -c "cd '$FIXTURE' && bash probe.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"REGENERATED"* ]]

  # The repair must be real, not merely claimed.
  run diff "$FIXTURE/githooks/adapters/demo.sh" "$FIXTURE/src/npm-package/adapters/demo.sh"
  [ "$status" -eq 0 ]
}

@test "AC-MIRROR-AUTOFIX-02: a consistent tree is silent about regeneration" {
  run env XP_GATE_MIRROR_AUTOFIX=1 bash -c "cd '$FIXTURE' && bash probe.sh"
  [ "$status" -eq 0 ]
  [[ "$output" != *"REGENERATED"* ]]
}

@test "AC-MIRROR-AUTOFIX-02: an unreproducible generator stays a hard failure even interactively" {
  write_broken_generator
  stale_the_canonical_tree

  run env XP_GATE_MIRROR_AUTOFIX=1 bash -c "cd '$FIXTURE' && bash probe.sh"
  [ "$status" -ne 0 ]
}
