#!/usr/bin/env bats

# Gate MW evidence identity — the commit must be HEAD or an ANCESTOR of it.
#
# Before this, the only accepted commit was the exact HEAD. Two consequences, both
# measured on 2026-11-26:
#
#   1. a review went stale the moment anything was committed after it, so a day of
#      work could not be pushed without re-reviewing everything;
#   2. a branch that had NEVER been pushed needed one review of its whole history.
#      The unpushed branch here had 223 files / 26713 changed lines; the review prompt
#      budget is 40 KB, so that is ~27 reviews minimum and the push was effectively
#      impossible. Batching was not merely awkward, it could not be done.
#
# Accepting an ANCESTOR is the correct rule, not a relaxation: the evidence names the
# commit the review saw, and that commit IS inside the pushed range.
#
# Test matrix:
#   - evidence for the exact HEAD                        → PASS
#   - evidence for HEAD~1 (an ancestor)                  → PASS
#   - evidence for a commit that is neither              → BLOCK
#   - evidence for a different branch                    → BLOCK

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"
VALIDATOR="$SOURCE_GITHOOKS/lib/validate-code-walkthrough.cjs"

# The seats are READ from the repository's .delphi-config.json (seeded as
# <requested> / <resolved> pairs below), so this stays a test of the COMMIT rule.
# Hardcoding them made the failure look like a rule violation when the real cause was
# a changed seat -- measured, when the technical seat moved from g-glm-5.3.
seat_models() {
  node -e '
    const fs = require("fs"), os = require("os"), path = require("path");
    const p = path.join(os.homedir(), ".config", "xp-gate", ".delphi-config.json");
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    const prof = d.profiles[d.active_profile];
    for (const role of ["architecture", "technical", "feasibility"]) {
      const e = prof.experts[role];
      console.log(role + "=" + (e && e.model ? e.model : ""));
    }
  ' 2>/dev/null
}


setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR" || exit 1
  git init -q -b work .
  # A throwaway repository: the machine's GLOBAL hooks must not run here, or the
  # fixture commits are gated by the project's own pre-commit chain.
  git config core.hooksPath /dev/null
  git config user.email t@example.com
  git config user.name t
  printf 'a\n' > a.txt && git add a.txt && git commit -qm one --no-verify
  printf 'b\n' > b.txt && git add b.txt && git commit -qm two --no-verify
  local line role model
  while IFS= read -r line; do
    role="${line%%=*}"; model="${line#*=}"
    case "$role" in
      architecture) export SEAT_ARCH_MODEL="$model" ;;
      technical)    export SEAT_TECH_MODEL="$model" ;;
      feasibility)  export SEAT_FEAS_MODEL="$model" ;;
    esac
  done <<< "$(seat_models)"
  # resolved_model only has to be DISTINCT across seats and stable per run.
  export SEAT_ARCH_RESOLVED="resolved-architecture"
  export SEAT_TECH_RESOLVED="resolved-technical"
  export SEAT_FEAS_RESOLVED="resolved-feasibility"
  export HEAD_SHA="$(git rev-parse HEAD)"
  export PARENT_SHA="$(git rev-parse HEAD~1)"
  export BRANCH="$(git rev-parse --abbrev-ref HEAD)"
}

teardown() {
  cd /
  rm -rf "$TEST_DIR"
}

# write_evidence <file> <commit> <branch>
write_evidence() {
  local file="$1" commit="$2" branch="$3"
  local now expires
  # Stamped in the PAST: the validator compares against a `now` it reads itself, and a
  # timestamp taken moments later made it fail as "in the future" (intermittent).
  now="$(date -u -d '-5 minutes' +%Y-%m-%dT%H:%M:%SZ)"
  expires="$(date -u -d '-5 minutes +1 hour' +%Y-%m-%dT%H:%M:%SZ)"
  cat > "$file" <<JSON
{
  "verdict": "APPROVED",
  "mode": "code-walkthrough",
  "timestamp": "${now}",
  "expires": "${expires}",
  "rounds_used": 1,
  "consensus_ratio": 0.9,
  "channel": "external",
  "fallback_reason": "bats fixture",
  "findings_addressed": ["fixture"],
  "commit": "${commit}",
  "branch": "${branch}",
  "experts": [
    {"role": "architecture", "verdict": "APPROVED", "confidence": 8,
     "result_type": "delphi_expert_result",
     "requested_model": "${SEAT_ARCH_MODEL}", "resolved_model": "${SEAT_ARCH_RESOLVED}",
     "channel": "external"},
    {"role": "technical", "verdict": "APPROVED", "confidence": 8,
     "result_type": "delphi_expert_result",
     "requested_model": "${SEAT_TECH_MODEL}", "resolved_model": "${SEAT_TECH_RESOLVED}",
     "channel": "external"},
    {"role": "feasibility", "verdict": "APPROVED", "confidence": 8,
     "result_type": "delphi_expert_result",
     "requested_model": "${SEAT_FEAS_MODEL}", "resolved_model": "${SEAT_FEAS_RESOLVED}",
     "channel": "external"}
  ]
}
JSON
}

@test "evidence for the exact HEAD is accepted" {
  write_evidence ev.json "$HEAD_SHA" "$BRANCH"
  run node "$VALIDATOR" ev.json "$HEAD_SHA" "$BRANCH" "$(date -u -d '+30 minutes' +%Y-%m-%dT%H:%M:%SZ)" "$TEST_DIR"
  [ "$status" -eq 0 ] || { echo "OUTPUT: $output" >&2; false; }
}

@test "evidence for an ANCESTOR of HEAD is accepted" {
  # The reviewed commit is inside the pushed range: the review did see this code.
  write_evidence ev.json "$PARENT_SHA" "$BRANCH"
  run node "$VALIDATOR" ev.json "$HEAD_SHA" "$BRANCH" "$(date -u -d '+30 minutes' +%Y-%m-%dT%H:%M:%SZ)" "$TEST_DIR"
  [ "$status" -eq 0 ] || { echo "OUTPUT: $output" >&2; false; }
}

@test "evidence for a commit that is neither HEAD nor an ancestor is BLOCKED" {
  # Without this case the rule degenerates into "any commit passes" -- the two PASS
  # cases above would both be satisfied by accepting everything.
  write_evidence ev.json "0000000000000000000000000000000000000000" "$BRANCH"
  run node "$VALIDATOR" ev.json "$HEAD_SHA" "$BRANCH" "$(date -u -d '+30 minutes' +%Y-%m-%dT%H:%M:%SZ)" "$TEST_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" == *"commit does not match HEAD"* ]]
}

@test "evidence for a foreign branch is still BLOCKED" {
  write_evidence ev.json "$HEAD_SHA" "some-other-branch"
  run node "$VALIDATOR" ev.json "$HEAD_SHA" "$BRANCH" "$(date -u -d '+30 minutes' +%Y-%m-%dT%H:%M:%SZ)" "$TEST_DIR"
  [ "$status" -ne 0 ]
  [[ "$output" == *"branch does not match"* ]]
}
