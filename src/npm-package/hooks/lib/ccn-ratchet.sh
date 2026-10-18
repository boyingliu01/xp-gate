#!/bin/bash
# ============================================================================
# ccn-ratchet.sh — Gate 3 baseline ratchet (sprint-20261018-quality REQ-D)
#
# The repo carries years of complex-but-alive functions. Blocking them today
# would freeze the codebase; ignoring them lets complexity grow silently. The
# ratchet splits the difference: .ccn-baseline.json records the CCN each
# known function has TODAY, and the gate only fires when a recorded function
# gets WORSE (strictly greater — equal passes). Functions with no entry are
# new code and face the live warn/block thresholds unchanged. When a function
# improves we say so and suggest refreshing the baseline, because a stale
# ceiling invites nobody to finish the job.
#
# Key = "<relative/path>::<functionName>". Rename or move = new key = treated
# as a new function. That is deliberate: fuzzy matching would hide debt moves.
# `node scripts/ccn-report.cjs --write-baseline` regenerates the file after a
# legitimate refactor.
#
# evaluate_ccn_ratchet <baseline-json> reads lizard --csv rows on stdin and
# prints "OK|WARN|BLOCK|LOWER <fn> ..." verdict lines for every function row.
# ============================================================================

evaluate_ccn_ratchet() {
  local baseline_file="$1"
  local warn_threshold="${CCN_WARN_THRESHOLD:-5}"
  local block_threshold="${CCN_BLOCK_THRESHOLD:-10}"

  local baseline_json=""
  if [ -f "$baseline_file" ]; then
    baseline_json=$(cat "$baseline_file")
  fi

  # Flatten {"path::fn": 12, ...} to "path::fn=12" lines without spawning a
  # JSON parser per commit (every spawn is expensive on Windows AV filters).
  local flat
  flat=$(printf '%s' "$baseline_json" \
    | tr -d '\n' \
    | sed 's/^[^{]*{//; s/}[^}]*$//' \
    | grep -oE '"[^"]+"[[:space:]]*:[[:space:]]*[0-9]+' \
    | sed 's/[[:space:]]//g; s/":/=/; s/"//g' || true)

  awk -v flat="$flat" -v warn="$warn_threshold" -v block="$block_threshold" '
    function fields(line, F,   cur, i, ch, q, cnt) {
      cnt = 0; cur = ""; q = 0
      for (i = 1; i <= length(line); i++) {
        ch = substr(line, i, 1)
        if (q) {
          if (ch == "\"") { if (substr(line, i + 1, 1) == "\"") { cur = cur "\""; i++ } else q = 0 }
          else cur = cur ch
        } else if (ch == "\"") q = 1
        else if (ch == ",") { F[++cnt] = cur; cur = "" }
        else cur = cur ch
      }
      F[++cnt] = cur
      return cnt
    }
    BEGIN {
      n = split(flat, kv, "\n")
      for (i = 1; i <= n; i++) { eq = index(kv[i], "="); if (eq > 0) base[substr(kv[i], 1, eq - 1)] = substr(kv[i], eq + 1) + 0 }
    }
    /^[0-9]+,/ {
      cnt = fields($0, F)
      # Column order VERIFIED against lizard 1.21.3 --csv output:
      #   NLOC, CCN, length, param_count, "fn@start-end@path", "path", name, ...
      # (An earlier draft assumed CCN was field 5 and silently compared token
      # counts — the bats fixture now pins this order with a real capture.)
      ccn = F[2] + 0
      n2 = split(F[5], parts, "@")
      name = parts[1]
      path = (n2 >= 3) ? parts[n2] : F[6]
      gsub(/\\/, "/", path)
      key = path "::" name
      if (key in base) {
        if (ccn > base[key])      printf "BLOCK %s CCN=%d baseline=%d (ratchet: worse than recorded)\n", name, ccn, base[key]
        else if (ccn < base[key]) printf "LOWER %s CCN=%d baseline=%d (improved — refresh baseline when convenient)\n", name, ccn, base[key]
        else                      printf "OK %s CCN=%d at baseline\n", name, ccn
      } else {
        if (ccn > block)     printf "BLOCK %s CCN=%d (%s exceeds block threshold)\n", name, ccn, path
        else if (ccn > warn) printf "WARN %s CCN=%d (%s new/over warn threshold)\n", name, ccn, path
        else                 printf "OK %s CCN=%d\n", name, ccn
      }
    }
  '
}
