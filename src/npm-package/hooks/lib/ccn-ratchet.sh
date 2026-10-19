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

# Convert lizard CSV rows to unit-separator-delimited fields.
#
# The CSV is only ever parsed once, here, with the quote rules written out in
# one place; downstream code then reads positional fields with no quoting to
# worry about. gawk arrays are pass-by-value, so a helper function CANNOT fill
# a caller-visible array, and `split($0, F, ",")` tears apart lizard's quoted
# signature column (signatures contain commas). Both of those were live bugs:
# every lookup fell through to the "new function" branch, so recorded
# functions were graded against the flat threshold instead of their baseline.
#
# Output columns (this is real lizard 1.21.3 --csv output, 11 columns):
#   1 NLOC, 2 CCN, 3 token_len, 4 param_count, 5 48 (location size),
#   6 fn@start-end@path, 7 path, 8 name, 9 signature, 10 start, 11 end
#
# The separator is ASCII Unit Separator written via sprintf so the byte never
# has to survive a shell/awk escape round trip: -F'\001' is NOT a reliable way
# to name a control character (gawk treats the argument as a regex, and the
# literal backslash path silently yields a separator that matches nothing, so
# every row is read as a single field).
CSV_FS=$'\x1f'

csv_to_unit_separated() {
  awk '
    function emit(line,   cur, i, ch, q, nf) {
      nf = 1; cur = ""; q = 0
      for (i = 1; i <= length(line); i++) {
        ch = substr(line, i, 1)
        if (q) {
          if (ch == "\"") { if (substr(line, i + 1, 1) == "\"") { cur = cur "\""; i++ } else q = 0 }
          else cur = cur ch
        } else if (ch == "\"") q = 1
        else if (ch == ",") { f[nf++] = cur; cur = "" }
        else cur = cur ch
      }
      f[nf] = cur
      out = f[1]
      for (i = 2; i <= nf; i++) out = out FS_OUT f[i]
      print out
    }
    # Build the 0x1F byte from its numeric code: shell escapes into awk strings
    # are fragile across gawk/mawk/Windows builds, but printf to an awk variable
    # is unambiguous.
    BEGIN { FS_OUT = sprintf("%c", 0x1F) }
    { emit($0) }
  '
}

evaluate_ccn_ratchet() {
  local baseline_file="$1"
  local warn_threshold="${CCN_WARN_THRESHOLD:-5}"
  local block_threshold="${CCN_BLOCK_THRESHOLD:-10}"

  # Capture stdin up front: it is consumed twice (baseline rows and verdicts).
  local awk_input
  awk_input=$(cat)

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

  # Convert the CSV rows once into position-only fields, then grade them. The
  # CSV quote rules live in csv_to_unit_separated and nowhere else; see the
  # comment there for why parsing in-place inside awk does not work.
  # Columns: $1 NLOC, $2 CCN, $3 token_len, $4 param_count, $5 location size,
  #          $6 fn@start-end@path, $7 path, $8 name, $9 signature,
  #          $10 start, $11 end
  local csv_rows
  csv_rows=$(printf '%s\n' "$awk_input" | csv_to_unit_separated || true)

  # Only function rows survive the conversion with a numeric CCN, which is what
  # the $2 guard below keys on.
  printf '%s\n' "$csv_rows" | awk -F"$CSV_FS" -v flat="$flat" -v warn="$warn_threshold" -v block="$block_threshold" -v anon_marker="(anonymous)" -v anon_short="(anon)" '
    BEGIN {
      n = split(flat, kv, "\n")
      for (i = 1; i <= n; i++) {
        eq = index(kv[i], "=")
        if (eq > 0) base[substr(kv[i], 1, eq - 1)] = substr(kv[i], eq + 1) + 0
      }
    }
    # FIELD INDEXING: $1 NLOC, $2 CCN, $3 token_len, $4 param_count,
    # $5 location size, $6 fn@start-end@path, $7 path, $8 name,
    # $9 signature, $10 start, $11 end.
    # Those two lines are the entire column contract. Earlier revisions read
    # CCN out of the identity column and name/path out of a shifted column, so
    # nothing ever matched its baseline entry and every recorded function was
    # graded as new code against the flat thresholds.
    # NOTE: this awk program is single-quoted in shell. The two hazards that
    # silently broke earlier revisions: an apostrophe anywhere below, and a
    # bare double-quote pair that the shell re-pairs across the awk text. The
    # anonymous marker is therefore passed in as a -v value, not written inline.
    $2 ~ /^[0-9]+$/ {
      ccn = $2 + 0
      n2 = split($6, parts, "@")
      name = parts[1]
      path = (n2 >= 3) ? parts[n2] : $7
      gsub(/\\/, "/", path)
      # Anonymous callbacks are keyed by position: a file holds many of them and
      # the baseline would otherwise keep only the last one parsed, so every
      # other callback was graded against the number of a different function.
      is_anon = 0
      if (name == anon_marker) is_anon = 1
      if (name == anon_short) is_anon = 1
      start = (n2 >= 3) ? parts[2] : $10
      sub(/-.*/, "", start)
      key = is_anon ? (path "::" anon_marker "@" start) : (path "::" name)
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
