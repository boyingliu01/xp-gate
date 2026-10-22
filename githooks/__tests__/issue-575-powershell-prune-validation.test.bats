#!/usr/bin/env bats
# @test REQ-575
# @intent `.xp-gate-powershell-prune-dirs` feeds THREE denominators at once: test
#         discovery, coverage, and static-analysis scope all use
#         `_find_powershell_files`. So a bad entry does not merely fail to prune —
#         it silently shrinks all three while the config file still looks
#         reasonable, and the gate reports a clean run over less code.
#
#         Concretely: an entry `*` or `src/generated` or `../other` cannot be
#         honoured by a `-name` predicate the way the author expects.
#         `-name 'src/generated'` matches nothing (names have no separators), so
#         the directory is NOT pruned and the entry is a silent no-op. `-name '*'`
#         matches EVERY directory, so it prunes the whole tree and the gate
#         analyses nothing while still exiting 0.
#
#         The rule: only bare directory NAMES are honoured; anything with a
#         separator, a glob metacharacter, or a bare `.`/`..` is reported on
#         stderr and IGNORED. Reported, not silently dropped — an ignored entry
#         is a config error the operator has to see.
#
#         Found in the INSTALLED copy of the adapter (`~/.config/xp-gate/
#         adapters/powershell.sh`), which had drifted ahead of the repo with this
#         validation. Ported here WITH tests, which it never had anywhere.
# @covers AC-575-01, AC-575-02, AC-575-03, AC-575-04

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/powershell.sh"
  WORK="$(mktemp -d)"
  mkdir -p "$WORK/repo"
  cd "$WORK/repo" || return 1
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$WORK"
}

# Source the adapter and run discovery, keeping stderr separate so the
# operator-facing warnings can be asserted independently of the file list.
run_discovery() {
  bash -c '
    set -u
    # shellcheck disable=SC1090
    source "$1" >/dev/null 2>&1
    _find_powershell_files "*.ps1"
  ' _ "$ADAPTER" 2>"$WORK/stderr.txt"
}

@test "AC-575-01: a glob entry does not prune the whole tree" {
  # The dangerous one: `-name '*'` matches every directory. Honouring it would
  # make discovery return nothing at all while still exiting 0.
  mkdir -p src generated
  echo 'Write-Host "product"' > src/product.ps1
  echo 'Write-Host "gen"' > generated/artefact.ps1

  printf '*\n' > .xp-gate-powershell-prune-dirs

  run run_discovery
  [[ "$output" == *"src/product.ps1"* ]] || {
    echo "a glob entry pruned everything; discovery returned: $output"
    return 1
  }
  # And the operator is told why it was ignored.
  grep -q "ignoring invalid entry" "$WORK/stderr.txt" || {
    echo "the invalid entry was not reported on stderr"
    return 1
  }
}

@test "AC-575-02: an entry containing a path separator is reported and ignored" {
  # `-name` never matches a path with a separator, so honouring this entry does
  # nothing at all — a silent no-op that looks like working config.
  mkdir -p src generated
  echo 'Write-Host "product"' > src/product.ps1
  echo 'Write-Host "gen"' > generated/artefact.ps1

  printf 'src/generated\n' > .xp-gate-powershell-prune-dirs

  run run_discovery
  [[ "$output" == *"src/product.ps1"* ]]
  grep -q "ignoring invalid entry 'src/generated'" "$WORK/stderr.txt" || {
    echo "path-separator entry was not reported; stderr: $(cat "$WORK/stderr.txt")"
    return 1
  }
}

@test "AC-575-03: '.' and '..' are refused" {
  # `-name .` / `-name ..` are meaningless as directory-name predicates and
  # depend on how find traverses; refusing them is cheaper than reasoning about it.
  mkdir -p src
  echo 'Write-Host "product"' > src/product.ps1

  printf '.\n..\n' > .xp-gate-powershell-prune-dirs

  run run_discovery
  [[ "$output" == *"src/product.ps1"* ]]
  grep -q "ignoring invalid entry" "$WORK/stderr.txt"
}

@test "AC-575-04: a valid bare name is still honoured and announced" {
  # Anti-vacuity for the whole file: the validation must reject bad entries
  # WITHOUT rejecting good ones. A bare name prunes, and says so.
  mkdir -p src generated
  echo 'Write-Host "product"' > src/product.ps1
  echo 'Write-Host "gen"' > generated/artefact.ps1

  printf 'generated\n' > .xp-gate-powershell-prune-dirs

  run run_discovery
  [[ "$output" == *"src/product.ps1"* ]]
  [[ "$output" != *"artefact.ps1"* ]] || {
    echo "a valid bare-name entry did not prune; discovery returned: $output"
    return 1
  }
  grep -q "pruning directory name 'generated'" "$WORK/stderr.txt" || {
    echo "the honoured entry was not announced; stderr: $(cat "$WORK/stderr.txt")"
    return 1
  }
}
