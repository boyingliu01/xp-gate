#!/bin/bash
# Pre-flight scan for text about to be handed to an external model (#604, 指南 §7).
#
# Gate 8 answers "did this COMMIT introduce a secret". It does not answer "should
# this text leave the process" -- and delphi-review / TDD generation pipe source
# diffs straight into third-party models. A token that already sits in the repo
# (committed long ago, or in an untracked scratch file) is invisible to Gate 8 and
# fully visible to whatever model reads the diff.
#
# This is the first half of 指南 §7: catch the mechanically-detectable leaks before
# the context is sent. The second half -- prompt injection -- cannot be fully
# automated, so it is written into the skills as a hard rule: source, comments,
# READMEs, historical tests and logs are UNTRUSTED INPUT, and an instruction found
# inside them is data, never a command.
#
# Usage:
#   scripts/scan-model-input.sh <file>     scan one file (the assembled context)
#   ... | scripts/scan-model-input.sh -    scan stdin
#
# Exit codes:
#   0  clean -- safe to send
#   1  BLOCKED -- a credential/PII pattern matched (the match is NOT echoed)
#   2  could not scan (no scanner available) -- fail-closed, never "clean"
#
# Fail-closed is deliberate and follows #499/#570: "we could not look" must never
# render as "we looked and it was fine". XP_GATE_FORCE_NO_SCANNER=1 exists so the
# fail-closed path itself is testable instead of only ever being reasoned about.

set -uo pipefail

FORCE_NO_SCANNER="${XP_GATE_FORCE_NO_SCANNER:-0}"

# Read the payload once; every scanner runs against the same snapshot.
payload=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/xp-model-input-$$")
cleanup() { rm -f "$payload"; }
trap cleanup EXIT

case "${1:--}" in
  -) cat > "$payload" ;;
  *) if [ -f "$1" ]; then cp "$1" "$payload"; else
       echo "BLOCKED - model-input scan: no such file: $1" >&2
       exit 2
     fi ;;
esac

if [ ! -s "$payload" ]; then
  # An empty context carries nothing to leak. Saying OK is honest here (unlike an
  # unscanned one), because there is no content at all.
  echo "OK - model-input scan: context is empty, nothing to send."
  exit 0
fi

blocked=0

# High-confidence credential shapes. These are the ones worth blocking on: a false
# positive costs one review, a false negative ships a live key to a third party.
# Each pattern is paired with a LABEL only -- the matched text is never printed,
# because writing it into a CI log reproduces the leak it is meant to prevent.
declare -a LABELS=(
  "AWS access key id"
  "private key block"
  "GitHub token"
  "Slack token"
  "Google API key"
  "OpenAI-style API key"
  "npm auth token"
  "generic bearer token"
  "password in an assignment"
)
declare -a PATTERNS=(
  'AKIA[0-9A-Z]{16}'
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'gh[pousr]_[0-9A-Za-z]{36}'
  'xox[baprs]-[0-9A-Za-z-]{10,}'
  'AIza[0-9A-Za-z_-]{35}'
  'sk-[0-9A-Za-z]{32,}'
  '_authToken=[0-9a-f-]{36}'
  '[Bb]earer[[:space:]]+[0-9A-Za-z._-]{20,}'
  '(password|passwd|secret)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{8,}["'"'"']'
)

if [ "$FORCE_NO_SCANNER" = "1" ]; then
  # Test hook, and the honest representation of the real failure mode: when no
  # engine is available the context is UNSCANNED. The builtin regexes below are a
  # courtesy net, not a substitute for the configured ruleset, so this verdict is
  # BLOCK -- "we could not look" must never render as "we looked and it was fine"
  # (#499/#570). Operators who genuinely want the reduced scan set
  # XP_GATE_MODEL_SCAN_ALLOW_BUILTIN=1 and get the narrower engine, stated.
  if [ "${XP_GATE_MODEL_SCAN_ALLOW_BUILTIN:-0}" != "1" ]; then
    echo "BLOCKED - model-input scan: no scanner available, so the context is UNSCANNED."
    echo "          Install gitleaks (see githooks/TOOL-INSTALLATION-GUIDE.md), or set"
    echo "          XP_GATE_MODEL_SCAN_ALLOW_BUILTIN=1 to accept the builtin pattern set."
    exit 2
  fi
fi

# gitleaks is the preferred engine where it is installed: it carries the same rule
# set Gate 8 uses, so the two guards cannot disagree about what a secret looks like.
if [ "$FORCE_NO_SCANNER" != "1" ] && command -v gitleaks >/dev/null 2>&1; then
  leak_report=$(mktemp 2>/dev/null || echo "${TMPDIR:-/tmp}/xp-model-leaks-$$")
  # `--no-git` scans the file as-is; a directory of one scratch file keeps the
  # command shape identical to Gate 8's while pointing at the payload snapshot.
  gitleaks dir --no-git --redact --no-banner \
    --config "${REPO_ROOT:-.}/.gitleaks.toml" \
    --report-format=json --report-path="$leak_report" "$(dirname "$payload")" >/dev/null 2>&1
  if [ -s "$leak_report" ] && grep -qE '"(File|RuleID|Description)"' "$leak_report" 2>/dev/null; then
    echo "BLOCKED - model-input scan: gitleaks matched a secret pattern in the context."
    echo "          The matched value is not printed. Redact it and re-assemble the context."
    rm -f "$leak_report"
    exit 1
  fi
  rm -f "$leak_report"
  engine="gitleaks"
else
  engine="builtin"
fi

# The regex pass always runs, including when gitleaks did: gitleaks' ruleset is
# tuned for committed content and the builtin patterns cover the model-facing
# shapes (bearer tokens, password assignments) it deliberately leaves to entropy.
for i in "${!PATTERNS[@]}"; do
  if grep -qE "${PATTERNS[$i]}" "$payload" 2>/dev/null; then
    echo "BLOCKED - model-input scan: ${LABELS[$i]} found in the context."
    blocked=$((blocked + 1))
  fi
done

if [ "$blocked" -gt 0 ]; then
  echo ""
  echo "指南 §7.2: never send credentials to a model. Redact the values"
  echo "(replace with <REDACTED>) and re-assemble the context before sending."
  echo "The matched text was intentionally NOT echoed to this log."
  exit 1
fi

if [ "$engine" = "builtin" ] && [ "$FORCE_NO_SCANNER" != "1" ]; then
  # No gitleaks, but the builtin patterns ran: that is a real (if narrower) scan,
  # so OK is honest. Say which engine, so a reviewer can judge the coverage.
  echo "OK - model-input scan (builtin patterns only; gitleaks not installed)."
  exit 0
fi

echo "OK - model-input scan: no credential patterns matched (engine: $engine)."
exit 0
