#!/usr/bin/env bash
# Restore the archlint musl binary (WSL / glibc < 2.39).
#
# WHY: @archlinter/cli ships a glibc build that needs GLIBC_2.38+/2.39. Ubuntu
# 22.04 provides 2.35, so the gnu binary aborts at load with
#   "GLIBC_2.39' not found (required by .../cli-linux-x64/bin/archlint)"
# and Gate 6 then reports
#   "❌ BLOCKED - new high+ architecture findings"
# — a load failure wearing the face of a verdict, which is the exact defect
# family this project keeps re-learning ("not checked" must never look like a
# finding, in either direction).
#
# `npm install` and `npm ci` overwrite node_modules, so this repair is not
# permanent; the optional musl package is installed alongside and is swapped in
# here. Run it after any dependency install:
#
#   bash scripts/fix-archlint-musl.sh          # repair if needed
#   bash scripts/fix-archlint-musl.sh --check  # exit 1 if a repair is needed
#
# The swap is a byte-for-byte copy of the SAME version's musl build, so the
# analysis rules are unchanged; only the C runtime differs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GNU_BIN="$ROOT/node_modules/@archlinter/cli-linux-x64/bin/archlint"
MUSL_BIN="$ROOT/node_modules/@archlinter/cli-linux-x64-musl/bin/archlint"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

if [ ! -x "$GNU_BIN" ]; then
  printf '%s\n' "archlint: no cli-linux-x64 binary at $GNU_BIN — nothing to repair (dependencies not installed?)"
  exit 0
fi

# Can the current binary load? A loader failure exits non-zero without a version.
if out="$("$GNU_BIN" --version 2>&1)"; then
  printf '%s\n' "archlint: OK ($out) — no repair needed"
  exit 0
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  printf '%s\n' "archlint: BROKEN — run: bash scripts/fix-archlint-musl.sh" >&2
  printf '%s\n' "$out" | head -2 >&2
  exit 1
fi

if [ ! -x "$MUSL_BIN" ]; then
  printf '%s\n' "archlint: gnu build cannot load AND no musl package present." >&2
  printf '%s\n' "  install it with: npm install --save-optional @archlinter/cli-linux-x64-musl" >&2
  printf '%s\n' "$out" | head -2 >&2
  exit 1
fi

musl_out="$("$MUSL_BIN" --version 2>&1)" || {
  printf '%s\n' "archlint: musl build also fails to load:" >&2
  printf '%s\n' "$musl_out" | head -2 >&2
  exit 1
}

# Only replace when both builds are the SAME version: swapping across versions
# would silently change the rules the baseline was measured against.
gnu_ver="$(printf '%s\n' "$out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
musl_ver="$(printf '%s\n' "$musl_out" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
if [ -n "$gnu_ver" ] && [ -n "$musl_ver" ] && [ "$gnu_ver" != "$musl_ver" ]; then
  printf '%s\n' "archlint: refusing to swap across versions ($gnu_ver gnu vs $musl_ver musl)" >&2
  exit 1
fi

cp "$MUSL_BIN" "$GNU_BIN"
chmod +x "$GNU_BIN"
printf '%s\n' "archlint: replaced the gnu build with the musl build ($musl_out)"
printf '%s\n' "          (re-run after every npm install/ci — node_modules is overwritten)"
