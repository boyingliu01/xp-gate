#!/usr/bin/env bats
#
# @test REQ-AUDIT-STATS-PLAUSIBLE-DURATION
# @intent `audit --stats` summed implausible historical durations into its
#         averages, producing numbers no reader could act on.
#
#         Measured before the fix:
#
#           Gate      Pass%    Avg ms       Issues Avg
#           gate-1    100.0%   5842895372   0
#
#         Five hundred and eighty-four thousand hours per gate run.
#
#         The rows responsible are real and countable: 397 of them (gate-1: 191,
#         gate-11: 206, dated 2026-07-20 to 2026-10-19) whose duration_ms holds
#         an absolute epoch timestamp rather than a duration. Every one was
#         written BEFORE the `duration_anomaly` flag existed, so it carries no
#         marker -- and the aggregator trusted the marker:
#
#           if (e.duration_anomaly === true) { anomaly_count += 1 }
#           else if (typeof e.duration_ms === 'number') { ms += e.duration_ms }
#
#         A field introduced after the data it describes cannot be relied on to
#         describe the data that predates it. The plausibility bound that the
#         anomaly detector already applies (MAX_PLAUSIBLE_DURATION_MS) was not
#         applied on the aggregation path.
#
#         This matters more than one wrong number: `audit --stats` is the command
#         that produces the timing tables every performance decision in this
#         project rests on. A gate whose average is off by six orders of
#         magnitude is not a cosmetic bug in that table.
#
# @covers AC-AUDIT-STATS-PLAUSIBLE-DURATION-01
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../../.." && pwd)"
  CLI="$REPO/src/npm-package/bin/xp-gate.js"
}

@test "AC-AUDIT-STATS-PLAUSIBLE-DURATION-01: no gate average exceeds the plausibility bound" {
  # Behavioural, against the real audit log in this repository. Both halves of
  # the assertion matter: the command must produce numbers, and those numbers
  # must be physically possible.
  local out
  out=$(cd "$REPO/src/npm-package" && node "$CLI" audit --stats 2>&1) || {
    echo "audit --stats failed to run:"
    printf '%s\n' "$out" | head -3
    return 1
  }

  # 6 hours, the same bound the anomaly detector uses.
  local limit=21600000
  # The table draws its separators with U+2502 (box drawing), not ASCII pipe, so
  # splitting on '|' finds nothing. awk splits on the real character.
  local bad
  bad=$(printf '%s
' "$out" | awk -F'│' -v lim="$limit" '
    $2 ~ /^[[:space:]]*gate-[0-9]+/ {
      gsub(/[[:space:]]/, "", $2); gsub(/[[:space:]]/, "", $4);
      if ($4 ~ /^[0-9]+$/ && $4 + 0 > lim) printf " %s(%dms)", $2, $4;
    }')

  if [ -n "$bad" ]; then
    echo "these gate averages exceed the 6h plausibility bound, so the sums still"
    echo "include historical rows whose duration_ms is an epoch timestamp:$bad"
    echo ""
    echo "full table:"
    printf '%s\n' "$out" | head -20
    return 1
  fi

  # Anti-vacuity: the table must actually contain gate rows.
  printf '%s' "$out" | grep -qE 'gate-[0-9]+' || {
    echo "no gate rows parsed out of the stats table:"
    printf '%s\n' "$out" | head -10
    return 1
  }
}