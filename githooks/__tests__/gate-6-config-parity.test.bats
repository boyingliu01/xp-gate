#!/usr/bin/env bats
#
# @test REQ-GATE6-CONFIG-PARITY
# @intent `xp-gate check 6` and the pre-commit hook disagree about a repo with no
#         architecture config -- and the disagreement is in the permissive
#         direction.
#
#         Measured in a fixture holding only package.json + two .ts files and NO
#         .archlint.yaml / architecture.yaml:
#
#           git commit (real hook, gate-6-entry.sh):
#             ❌ ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED
#                Required configuration file (.archlint.yaml / architecture.yaml)
#                is NOT found.
#
#           xp-gate check 6 (lib/arch.js):
#             [xp-gate arch] Zero-tolerance mode -- no .architecture-baseline.json
#             [xp-gate arch] Architecture quality: 1.3/10 (Critical)
#             [xp-gate arch] Findings: 4 total, 0 high/critical
#             ✅ arch: no high/critical architecture findings
#             exit 0
#
#         Two entry points, same repo, opposite verdicts. The hook is the
#         authority ("Architecture config is REQUIRED - BLOCK if missing", with an
#         explicit .architecture-skip escape valve). `check 6` is the command a
#         user runs to pre-flight the gate, so it is exactly the command that must
#         not be more forgiving than the gate it previews.
#
#         The failure mode this creates: a developer runs `xp-gate check 6`, sees
#         green, commits, and is blocked -- or worse, learns the gate is green in
#         a repo where it never measured architecture at all, and the "1.3/10
#         (Critical)" line is the only trace that anything was scored.
#
#         Note the quality score is printed unconditionally. A 1.3/10 labelled
#         "Critical" next to "✅ no high/critical findings" is self-contradictory
#         regardless of the config question, but the config gap is the part that
#         can change a commit outcome, so it is what gets pinned here.
#
# @covers AC-GATE6-CONFIG-01 AC-GATE6-CONFIG-02
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE6="$REPO/githooks/gate-entries/gate-6-entry.sh"
  ARCHLIB="$REPO/src/npm-package/lib/arch.js"
}

@test "AC-GATE6-CONFIG-01: check 6 must not report success without a config file" {
  # Behavioural: build the same fixture the measurement used and ask the
  # standalone command. It must NOT exit 0 with a clean bill of health.
  local work="$BATS_TEST_TMPDIR/g6nc"
  mkdir -p "$work"
  printf '{"name":"p","version":"1.0.0"}\n' > "$work/package.json"
  printf 'export const base = 1;\n' > "$work/base.ts"
  printf 'export const more = 2;\n' > "$work/more.ts"

  run bash -c "cd '$work' && timeout 180 node '$REPO/src/npm-package/bin/xp-gate.js' check 6 2>&1"
  local rc=$status

  # BLOCK (like the hook) or an explicit SKIP-with-reason are both defensible.
  # What is not: exit 0 while claiming architecture was validated.
  if [ "$rc" -eq 0 ] && ! printf '%s' "$output" | grep -qiE 'SKIPPED|not found|missing'; then
    echo "check 6 exited 0 on a repo with no architecture config, while the"
    echo "pre-commit hook BLOCKS on the same repo. Output tail:"
    printf '%s\n' "$output" | tail -6
    return 1
  fi
}

@test "AC-GATE6-CONFIG-02: the standalone path actually tests for the config file" {
  # Structural, with the prose stripped FIRST. The first version of this test
  # grepped the whole file for the filenames and passed immediately -- every
  # mention in lib/arch.js is a comment or a warning string ("npx ... --config
  # architecture.yaml", "pre-0.16 files (e.g. an architecture.yaml)"), none of
  # them a check. Same false green as the coverage comment in #562: an assertion
  # satisfied by prose.
  local code
  code=$(grep -vE '^[[:space:]]*(//|[*]|/[*])' "$ARCHLIB")

  # The config names must appear in CODE, and that code must be a presence test.
  printf '%s' "$code" | grep -qE 'archlint.yaml|architecture.yaml' || {
    echo "the config filenames appear only in comments; lib/arch.js cannot be"
    echo "applying the hook's 'config REQUIRED' rule."
    return 1
  }
  # ERE, so parens and dots are escaped -- an unescaped '(' here made grep
  # fail with "Unmatched ( or (", which `set -e`-less bats turned into a
  # plain failed test rather than a loud error.
  printf '%s' "$code" | grep -qE 'existsSync|readdirSync|statSync|[.]some[(]|[.]includes[(]' || {
    echo "lib/arch.js names the config files in code but never tests for them"
    return 1
  }
}
