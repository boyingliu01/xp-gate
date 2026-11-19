# ============================================================================
# Gate 12 blob scanner -- ONE awk process for the whole change set.
#
# WHY THIS FILE EXISTS
#   The gate asked git once per file per check, and piped through tail/head/grep
#   inside the per-file loop. Measured on this machine (2026-11-19, 300 staged
#   plain-text files):
#
#       original design (4 git spawns + tail/head/grep/od per file)   4m22s
#       batching only the binary classification                       3m14s
#       batching the blob fetch but keeping tail|head in the loop     6m25s
#       this scanner                                                  0.32s
#
#   The third line is the one worth keeping: removing the git calls but leaving
#   a `tail | head | grep` per file made the gate SLOWER. Isolated costs that
#   explain it:
#       300 x `git show ":$f"`            26.2s
#       300 x `git diff --numstat -- $f`  27.0s
#       300 x `tail | head` (only)        21.8s
#   ~53s of the original 262s was git; the rest was the pipe stages, each a
#   process. The rule this encodes: nothing may be spawned inside a per-file
#   loop. One awk over one stream is O(1) processes.
#
# INPUT
#   stdin  stdout of `git cat-file --batch`, requested as `:<path>` per staged
#          file in the SAME order as the path list.
#   -v paths="a|b|c"
#          The staged paths, '|'-separated. Not newline-separated: a staged path
#          may itself contain a newline, and this gate exists to look at exactly
#          that kind of awkward input.
#
# OUTPUT
#   Three lines, `<tag>:<space separated paths>`:
#       WS:        a line ends with a space or a tab
#       NOEOF:     a non-empty blob whose final byte is not \n
#       CONFLICT:  a line is 7 x '<', '=' or '>' followed by a space or EOL
#
# FRAMING
#   git writes "<sha> blob <size>\n" then exactly <size> bytes then "\n", and
#   repeats. Reading by <size> is what makes NOEOF representable at all: the
#   body is consumed by byte count, so a shortfall on the final line IS the
#   missing newline. (The previous implementation captured the blob with $(...),
#   which strips trailing newlines -- so a correctly terminated file reported
#   its last visible character and was flagged every single time.)
#
#   Binary files are filtered out before this runs, so no body line contains a
#   NUL and `length($0) + 1` is a faithful byte count. That is the precondition
#   for the arithmetic below; do not remove the binary filter.
# ============================================================================

BEGIN {
  nu = split(paths, U, "|")
  ui = 1
  ws = ""; noeof = ""; conf = ""
}

# A lookup that failed is reported as "<name> missing" -- never a size line.
/ missing\r?$/ { ui++; next }

{
  size = $NF
  sub(/\r$/, "", size)
  if (size !~ /^[0-9]+$/) next        # not a header line; nothing to attribute

  name = (ui <= nu) ? U[ui] : ""
  ui++

  remaining = size + 0
  if (remaining == 0) {               # empty blob: no line to check, no byte
    getline
    next
  }

  bad_ws = 0
  bad_conf = 0
  ends_nl = 1
  while (remaining > 0) {
    if ((getline body) <= 0) { ends_nl = 0; break }
    n = length(body) + 1              # + the newline getline consumed
    if (n > remaining) { n = remaining; ends_nl = 0 }   # final line had no \n
    if (body ~ /[ \t]$/) bad_ws = 1
    if (body ~ /^(<{7}|={7}|>{7})([ \t]|$)/) bad_conf = 1
    remaining -= n
  }
  # git writes one newline AFTER each object. It is only there to be skipped
  # when the body itself was newline-terminated; when it was not, the next
  # getline already points at the following header and consuming a line here
  # would swallow it -- which is exactly how a blob without an EOF newline used
  # to corrupt the attribution of the file after it.
  if (ends_nl) getline

  if (bad_ws)   ws   = ws   " " name
  if (bad_conf) conf = conf " " name
  if (!ends_nl) noeof = noeof " " name
}

END {
  printf "WS:%s\nNOEOF:%s\nCONFLICT:%s\n", ws, noeof, conf
}
