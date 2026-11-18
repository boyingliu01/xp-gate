#!/usr/bin/env bats
#
# @test REQ-GATE10-RULES-OFFLINE
# @intent Gate 10 spent a mean of 43.6 s per run, and the tail is entirely the
#         semgrep registry.
#
#         Measured over 420 recorded runs in .xp-gate/audit.jsonl:
#
#             p10    314 ms      p50  10231 ms      p90  180118 ms
#             <=15s  243 runs    15-60s  71        60-180s  64     >=180s  42
#             total  18320 s     mean  43620 ms
#
#         The distribution is bimodal, and the long half is not scanning work.
#         ABBA measurement on this machine, alternating arms so a load trend
#         cancels, one file, small:
#
#             A (registry, network up)     5498 ms / 5370 ms   spread 2.4%
#             B (registry, network down) 108926 ms / 108791 ms  spread 0.1%
#
#         A 20x difference with almost no within-arm spread is a real effect.
#         The 109 s is urllib3's retry backoff against semgrep.dev
#         (MaxRetryError from requests.adapters), not analysis: `--config=p/...`
#         fetches the ruleset from the registry on every invocation, and no
#         local rule file exists to reuse (~/.semgrep is 50K and holds only
#         settings).
#
#         The fix is to stop asking the network for a ruleset that has not
#         changed: fetch it once into a versioned cache and pass the FILE.
#         Measured with the same pair of files:
#
#             registry, network up     ............  5498 ms
#             registry, network down   ..........  108926 ms
#             local file, network up   ...........  5578 ms
#             local file, network DOWN   .........  5754 ms
#
#         So the offline case drops from 109 s to 5.8 s, and the online case is
#         no slower (5578 vs 5498, inside the 2.4% spread of the baseline arm).
#         Verdicts are unchanged: a command-injection file reports 1 finding
#         through either source.
#
#         Design constraints, each from a mistake this project has made before:
#
#         - A STALE cache must never silently become the verdict. The cached
#           ruleset is used for a bounded age, then refreshed; if the refresh
#           fails, the stale copy is still used but the gate says so, because
#           "checked with rules from N days ago" and "checked with current
#           rules" are different claims.
#         - No cache and no network must NOT be PASS. That is an unverifiable
#           scan, and gate 10 already has a SKIP-with-reason arm for it.
#         - The cache holds fetched rules only. It must not become a place where
#           a ruleset is edited by hand and then graded against.
#
# @covers AC-GATE10-RULES-OFFLINE-01 AC-GATE10-RULES-OFFLINE-02
# @covers AC-GATE10-RULES-OFFLINE-03
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  SCRIPT="$REPO/githooks/gate-10.sh"
}

@test "AC-GATE10-RULES-OFFLINE-01: the gate can pass a local rules file instead of the registry" {
  # The mechanism: resolve a cached file when it is fresh, else fetch it, else
  # fall back to the registry name. All three paths must exist.
  grep -q 'XP_GATE_SEMGREP_RULES_DIR\|semgrep-rules' "$SCRIPT" || {
    echo "gate-10.sh has no local ruleset cache: every run fetches p/security-audit"
    echo "from semgrep.dev, which costs 109 s when the registry is unreachable"
    return 1
  }
  grep -q 'gate10_download\|gate10_resolve_ruleset' "$SCRIPT" || {
    echo "no refresh path: the cache could never be populated"
    return 1
  }
}

@test "AC-GATE10-RULES-OFFLINE-02: a cached ruleset is used by path, not by registry name" {
  # Behavioural: drive the resolver directly. With a fresh cache present it must
  # return the FILE, because that is the only form semgrep answers without
  # touching the network.
  local work="$BATS_TEST_TMPDIR/rules"
  mkdir -p "$work/cache"
  printf 'rules:\n- id: test.rule\n  pattern: $X\n  message: m\n  severity: ERROR\n  languages: [js]\n' \
    > "$work/cache/security-audit.yml"

  cat > "$work/drive.sh" <<'DRIVER'
set -u
XP_GATE_SEMGREP_RULES_DIR="__WORK__/cache"
GATE_10_START=1
. "__WORK__/gate-10-rules.sh"
out=$(gate10_resolve_ruleset "p/security-audit" 2>/dev/null)
printf 'RESOLVED=%s' "$out"
DRIVER
  sed -i "s|__WORK__|$work|g" "$work/drive.sh"
  # Extract only the resolver so this test does not need a whole gate body.
  sed -n '/^# @@RULES-RESOLVER-START@@/,/^# @@RULES-RESOLVER-END@@/p' "$SCRIPT" \
    > "$work/gate-10-rules.sh"
  [ -s "$work/gate-10-rules.sh" ] || {
    echo "the rules resolver is not marked for extraction in gate-10.sh"
    return 1
  }

  run bash "$work/drive.sh"
  [[ "$output" == *"security-audit.yml"* ]] || {
    echo "a fresh cached ruleset was not used; expected the FILE path, got:"
    printf '%s\n' "$output"
    return 1
  }
}

@test "AC-GATE10-RULES-OFFLINE-04: the resolver is actually WIRED into the scan" {
  # The other three tests all passed against a gate that had the resolver, the
  # cache and the fallback -- but still called `--config=p/security-audit`
  # directly. Defining a function is not using it, and a test that only greps for
  # its definition cannot tell the two apart.
  #
  # This asserts the call site: the --config arguments must come from the
  # resolver, not from a literal registry name.
  grep -qE 'SEMGREP_RULES=\(--config="\$\(gate10_resolve_ruleset' "$SCRIPT" || {
    echo "the scan still uses a literal registry name; the cache is dead code:"
    grep -n 'SEMGREP_RULES=' "$SCRIPT" | head -2
    return 1
  }

  # And no literal p/... may remain in an --config assignment. The resolver's own
  # fallback returns the registry name, which is the only place it may appear.
  if grep -E '^\s*SEMGREP_RULES\+?=\(' "$SCRIPT" | grep -qE '\-\-config=p/'; then
    echo "a literal registry name remains in the scan arguments:"
    grep -E '^\s*SEMGREP_RULES\+?=\(' "$SCRIPT" | grep -E '\-\-config=p/'
    return 1
  fi
}

@test "AC-GATE10-RULES-OFFLINE-03: an unusable cache with no network is not a PASS" {
  # The fail-closed side. If the cache is empty and the fetch fails, the gate must
  # fall back to the registry NAME (letting semgrep fail on its own terms and be
  # reported as a runtime error), never invent a ruleset and never pass.
  local work="$BATS_TEST_TMPDIR/rules2"
  mkdir -p "$work/cache"

  cat > "$work/drive.sh" <<'DRIVER'
set -u
XP_GATE_SEMGREP_RULES_DIR="__WORK__/cache"
GATE_10_START=1
. "__WORK__/gate-10-rules.sh"
out=$(gate10_resolve_ruleset "p/security-audit" 2>/dev/null)
printf 'RESOLVED=%s' "$out"
DRIVER
  sed -i "s|__WORK__|$work|g" "$work/drive.sh"
  sed -n '/^# @@RULES-RESOLVER-START@@/,/^# @@RULES-RESOLVER-END@@/p' "$SCRIPT" \
    > "$work/gate-10-rules.sh"

  # Make the network genuinely unusable, so "no cache and no network" is the real
  # condition rather than "the download happened to succeed". A dead proxy is how
  # the 109 s urllib3 backoff was reproduced in the first place.
  run env HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 \
    bash "$work/drive.sh"
  [[ "$output" == *"RESOLVED=p/security-audit"* ]] || {
    echo "with no cache and no network the resolver did not fall back to the"
    echo "registry name, so semgrep cannot fail on its own terms; got:"
    printf '%s\n' "$output"
    return 1
  }
  # And it must never resolve to something empty, which semgrep would reject in
  # a way that reads as a config error rather than "no rules available".
  [[ "$output" != *"RESOLVED=" ]]; [[ "$output" == *"RESOLVED=?"* ]] && {
    echo "resolver can return empty, which is not a usable answer"
    return 1
  }
  return 0
}