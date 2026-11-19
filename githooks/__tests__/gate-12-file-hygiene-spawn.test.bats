#!/usr/bin/env bats
#
# @test REQ-GATE12-PERFILE-SPAWN File hygiene must not spawn a process per file
# @intent Gate 12's checks each shell out of git once per file:
#
#             is_binary_staged_file "$file"            # git diff --cached --numstat
#             git show ":$file" | grep -qE '[[:space:]]$'   # trailing whitespace
#             git show ":$file" | tail -c 1           # missing EOF newline
#
#         and the binary probe runs a second time in the EOF loop, so a staged text
#         file costs FOUR process spawns. On Windows a `git show` costs ~200ms, so
#         the cost is linear in the change set and dominated by process creation,
#         not by bytes examined.
#
#         Measured 2026-11-19 on a fixture of plain text files:
#
#             300 staged files   4m22s   (~0.87 s/file)
#             100 staged files   2m36s   (~1.5 s/file, cold cache)
#               0 staged files   0.5s    (loop never runs)
#
#         The audit journal agrees: 1208 credible file-hygiene samples, median
#         4.2s, p90 41.7s, and 244 of them above 20s.
#
#         This is the "no bottleneck, no gate dominated by process spawn" half of
#         the quality objective. The fix is to ask git ONCE for all the staged
#         blobs rather than once per file per check -- `git diff --cached` already
#         returns everything needed, and `git cat-file --batch` streams blobs from
#         a single process.
#
#         These tests assert the OBSERVABLE contract (same verdicts) plus the
#         performance property (spawn count does not scale with file count), so a
#         future rewrite that keeps the spawns is caught even if it is faster on
#         small inputs where the difference is noise.
#
# @covers AC-GATE12-SPAWN-01  trailing whitespace is still detected
# @covers AC-GATE12-SPAWN-02  a missing EOF newline is still detected
# @covers AC-GATE12-SPAWN-03  clean files still pass
# @covers AC-GATE12-SPAWN-04  git invocations do not scale linearly with files
#
# ASCII only.

setup() {
  REPO="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO/githooks/adapters/gate-12-file-hygiene.sh"
  WORK="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$WORK"
  cd "$WORK" || return 1
  git init -q .
  git config user.email t@t
  git config user.name t
}

# Run the gate with record_gate_audit stubbed (it normally comes from pre-commit).
run_hygiene() {
  bash -c '
    record_gate_audit() { :; }
    export -f record_gate_audit 2>/dev/null || true
    set +u
    source "'"$GATE"'" 2>/dev/null || bash "'"$GATE"'"
  ' 2>&1
}

@test "AC-GATE12-SPAWN-01: trailing whitespace is still detected" {
  printf 'clean line\nhas trailing   \nanother\n' > bad.txt
  git add bad.txt
  run run_hygiene
  [[ "$output" == *"Trailing whitespace detected"* ]] || {
    echo "trailing whitespace was not reported; output:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-GATE12-SPAWN-02: a missing EOF newline is still detected" {
  printf 'no newline at end' > nonl.txt
  git add nonl.txt
  run run_hygiene
  [[ "$output" == *"newline"* ]] || {
    echo "missing EOF newline was not reported; output:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-GATE12-SPAWN-03: clean files still pass" {
  printf 'clean one\nclean two\n' > ok.txt
  git add ok.txt
  run run_hygiene
  [[ "$output" == *"No file hygiene issues detected"* ]] || {
    echo "a clean file was not reported clean; output:"
    printf '%s\n' "$output"
    false
  }
}

@test "AC-GATE12-SPAWN-04: git invocations do not scale linearly with file count" {
  # Count git executions via a PATH shim. The shim must be a real executable the
  # script's `git ...` calls resolve to, so it sits first on PATH.
  local shim="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$shim"
  cat > "$shim/git" <<SHIM
#!/usr/bin/env bash
printf 'x\n' >> "$BATS_TEST_TMPDIR/git-calls"
exec "$(command -v -p git || which git)" "\$@"
SHIM
  chmod +x "$shim/git"

  # 40 files: enough that a per-file spawn is unmistakable, small enough to run
  # fast. A per-file design costs >= 4 * 40 = 160 calls.
  local i
  for i in $(seq 1 40); do printf 'content %s\n' "$i" > "f$i.txt"; done
  git add -A

  : > "$BATS_TEST_TMPDIR/git-calls"
  PATH="$shim:$PATH" BATS_TEST_TMPDIR="$BATS_TEST_TMPDIR" run run_hygiene

  local calls
  calls=$(wc -l < "$BATS_TEST_TMPDIR/git-calls")
  # A fixed-cost design needs a handful; the per-file design needs >160. The
  # threshold sits well above any legitimate fixed cost and far below linear.
  [ "$calls" -lt 40 ] || {
    echo "gate 12 spawned $calls git processes for 40 files"
    echo "the cost is per file, not per run -- this is the 4m22s-per-300-files defect"
    false
  }
}

@test "AC-GATE12-SPAWN-05: a 4x larger change set does not cost 4x the runtime" {
  # AC-04 counts processes; this one measures the property the user actually
  # cares about. Both are needed: a spawn count can be gamed by a design that
  # spawns once but does O(n) work inside that process, and a wall clock alone is
  # noisy on this machine.
  #
  # Measured 2026-11-19 on 200 plain text files:
  #     per-file implementation   2m47s
  #     this implementation       7.9s        (21x)
  #
  # 200 files is the smallest size at which the two are unambiguous. At 20/80 the
  # fixed interpreter cost dominates both and a linear implementation still
  # passed -- checked by running this test against the previous implementation,
  # which is the only reason the size moved.
  #
  # The assertion is on the SLOPE, not the total: subtract the 50-file run from
  # the 200-file run. Fixed cost cancels, so a faster machine does not tighten or
  # loosen the test.
  #
  # Threshold: 4x the files must add less than 4x the 50-file runtime. The old
  # design lands far above that (its per-file cost alone is seconds), so this
  # distinguishes the shapes rather than merely trending the right way.
  mkdir -p small big
  local i
  for i in $(seq 1 50);  do printf 'line %s\n' "$i" > "small/f$i.txt"; done
  for i in $(seq 1 200);  do printf 'line %s\n' "$i" > "big/f$i.txt";   done

  _g12_time() {
    local dir="$1" t0 t1
    # Stage ONLY this directory's files, from the repo root -- the gate reads the
    # root index, so staging inside the subdirectory would leave both runs with an
    # empty (and therefore identical) change set.
    git reset -q >/dev/null 2>&1
    git add "$dir" >/dev/null 2>&1
    t0=$(date +%s%N)
    bash -c 'record_gate_audit(){ :; }; export -f record_gate_audit; bash "'"$GATE"'"' >/dev/null 2>&1
    t1=$(date +%s%N)
    echo $(( (t1 - t0) / 1000000 ))
  }

  local ms_small ms_big
  ms_small=$(_g12_time small)
  ms_big=$(_g12_time big)

  # Ignore the fixed cost: subtract the smaller run from the larger so the
  # comparison is about the SLOPE, not about interpreter startup.
  local extra
  extra=$(( ms_big - ms_small ))
  [ "$extra" -lt $(( ms_small * 5 / 2 )) ] || {
    echo "50 files: ${ms_small}ms, 200 files: ${ms_big}ms (delta ${extra}ms)"
    echo "4x the files added more than 2.5x the 50-file runtime -- the gate is still"
    echo "linear in the change set"
    false
  }
}
