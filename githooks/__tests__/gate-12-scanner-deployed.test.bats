#!/usr/bin/env bats
# @test REQ-G12-SCANNER-DEPLOYED
#
# @intent Gate 12 answers three content checks -- trailing whitespace, missing EOF
# newline, and merge conflict markers -- through ONE awk program,
# githooks/lib/gate-12-blob-scan.awk. The adapter resolves it against its own
# directory chain so a global install and the tracked tree both work:
#
#     for _g12_dir in "${GATE_DIR:-}" "$(dirname BASH_SOURCE)/.." ".../../.."; do
#       [ -f "$_g12_dir/lib/gate-12-blob-scan.awk" ] && { GATE_12_SCANNER=...; break; }
#     done
#
# Measured 2026-11-20 on a fixture with a global install:
#
#   - a file with no trailing newline committed as PASS
#   - a file with a merge conflict marker committed as PASS
#   - `bash -x` showed GATE_12_SCANNER= (empty) before _g12_scan_blobs
#
# The manifest DEPLOY_MODULE_FILES listed every other lib/ file -- .sh, .cjs, .py,
# .ps1 -- and not the .awk, so a global install never received it. All three
# resolved paths missed, awk -f "" failed, and the call site's `|| return 0` turned
# that failure into "no findings". The gate has been reporting PASS for content it
# never read. This is the exact shape the project forbids: "not checked" recorded as
# "passed".
#
# After adding the manifest entry, the same fixtures produce WARN (missing newline)
# and BLOCK (conflict marker).

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  MANIFEST="$REPO_ROOT/githooks/deploy-manifest.sh"
  SCANNER="$REPO_ROOT/githooks/lib/gate-12-blob-scan.awk"
}

# @covers the scanner file exists in the tree
@test "the gate 12 awk scanner exists" {
  [ -f "$SCANNER" ]
}

# @covers deployment ships it
@test "the deploy manifest declares the gate 12 scanner" {
  run grep -c "lib/gate-12-blob-scan.awk" "$MANIFEST"
  [ "$output" = "1" ]
}

# @covers the general rule, not just this one file
@test "every lib/ file the adapters reference is declared in the manifest" {
  # A path literal is enough: adapters name their libraries as "$dir/lib/<file>".
  # Anything referenced but undeclared is a file that ships in the repo and not in
  # an install -- invisible until a gate silently stops checking.
  local missing="" f ref base
  for f in "$REPO_ROOT"/githooks/adapters/*.sh "$REPO_ROOT"/githooks/gate-entries/*.sh; do
    while IFS= read -r ref; do
      [ -z "$ref" ] && continue
      base=$(basename "$ref")
      [ -f "$REPO_ROOT/githooks/lib/$base" ] || continue
      grep -q "lib/$base'" "$MANIFEST" || missing="$missing lib/$base"
    done < <(grep -oE 'lib/[A-Za-z0-9._-]+' "$f" 2>/dev/null | sort -u)
  done
  # Deduplicate for a readable message.
  missing=$(printf '%s\n' $missing | sort -u | tr '\n' ' ')
  if [ -n "$(echo $missing)" ]; then
    echo "Referenced but not deployed:$missing"
    return 1
  fi
}

# @covers the scanner actually answers the three questions
@test "the scanner reports trailing whitespace, missing EOF newline and conflicts" {
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  cd "$tmp" || return 1
  git init -q -b scanprobe .
  git config user.email a@b.c
  git config user.name a

  printf 'ok\n' > clean.txt
  printf 'trailing \n' > ws.txt
  printf 'no newline at end' > noeof.txt
  printf 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\n' > conflict.txt
  git add -A

  local out
  out=$(STAGED_FILES=$(printf '%s\n' clean.txt ws.txt noeof.txt conflict.txt) \
    bash -c '
      _paths=$(printf %s "$STAGED_FILES" | tr "\n" "|")
      printf "%s\n" "$STAGED_FILES" | sed "s/^/:/" \
        | git cat-file --batch 2>/dev/null \
        | awk -v paths="$_paths" -f "'"$SCANNER"'" 2>/dev/null
    ')

  echo "$out" | grep -q '^NOEOF: noeof.txt' || { echo "scanner missed EOF newline: $out"; return 1; }
  echo "$out" | grep -q '^CONFLICT: conflict.txt' || { echo "scanner missed conflict: $out"; return 1; }
}
