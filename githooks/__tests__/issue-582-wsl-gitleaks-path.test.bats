#!/usr/bin/env bats
# @test REQ-614
# @intent Gate 8 on WSL reported **secrets detected** on a repository that contained
#         no secrets, and told the user to rotate keys.
#
#         Nothing had been scanned. Two independent defects conspired:
#
#         1. WSL has no `cygpath` (that is a Git-for-Windows/MSYS tool; the WSL
#            equivalent is `wslpath`). So `gate-8.sh` took its fallback branch and
#            passed a POSIX path — `/mnt/d/projects/<repo>/.gitleaks.toml` — to the
#            NATIVE gitleaks.exe. It could not open the file:
#
#              FTL unable to load gitleaks config, err: open /mnt/d/.../.gitleaks.toml:
#                The system cannot find the path specified.
#
#         2. gitleaks exited **1**, and Gate 8's `elif [ "$GITLEAKS_EXIT" -eq 1 ]`
#            branch is labelled "Secrets found".
#
#         Exit 1 from gitleaks means "leaks found" AND "config/IO error". #592 already
#         made exit-0-plus-FTL report ENVIRONMENT. This pins the same distinction for
#         exit 1, which is the one that produced the loudest possible wrong answer: a
#         fail-closed security gate reporting the highest-severity verdict about a
#         repository it never read.
#
#         A gate that can only say "you leaked a secret" when its scanner cannot start
#         trains people to disable it. #596 fixed the identical confusion in the shell
#         toolchain; this is the same class, in the same gate.
# @covers AC-614-01, AC-614-02, AC-614-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE8="$REPO_ROOT/githooks/gate-8.sh"
  WORK="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$WORK/bin"
  cd "$WORK" || return 1
  git init -q .
  git config user.email t@t.t
  git config user.name t
  git config core.hooksPath /dev/null
  printf '[allowlist]\n' > .gitleaks.toml
  printf 'clean\n' > notes.txt
  git add -A
}

# A gitleaks stub that behaves like the failing native binary on WSL: it cannot load
# the config because it was handed a path it does not understand, prints the FTL line
# and exits 1.
install_failing_gitleaks() {
  cat > "$WORK/bin/gitleaks" << 'STUB'
#!/bin/bash
echo "4:17PM FTL unable to load gitleaks config, err: open /mnt/d/projects/repo/.gitleaks.toml: The system cannot find the path specified."
exit 1
STUB
  chmod +x "$WORK/bin/gitleaks"
}

# A gitleaks stub that genuinely finds a leak: writes a report and exits 1.
install_leaking_gitleaks() {
  cat > "$WORK/bin/gitleaks" << 'STUB'
#!/bin/bash
report=""
for a in "$@"; do
  case "$a" in --report-path=*) report="${a#--report-path=}" ;; esac
done
if [ -n "$report" ]; then
  printf '[{"RuleID":"aws-access-token","File":"app.env","StartLine":1}]\n' > "$report"
fi
echo "leaks found: 1"
exit 1
STUB
  chmod +x "$WORK/bin/gitleaks"
}

run_gate() {
  # Prepend the stub dir; do NOT replace PATH, or `bash` itself stops resolving and
  # the case fails with "bash: command not found" for a reason unrelated to the gate.
  bash -c "
    cd '$WORK' || exit 1
    PATH='$WORK/bin:'\"\$PATH\"
    export PATH
    export XP_GATE_GITLEAKS_SOFT=0
    bash '$REPO_ROOT/githooks/gate-8.sh' 2>&1
  "
}

# ---------------------------------------------------------------------------
# AC-614-01: a scanner that cannot start is not a secret finding
# ---------------------------------------------------------------------------

@test "AC-614-01: gitleaks exit 1 with an FTL config error is reported as ENVIRONMENT, not as secrets" {
  install_failing_gitleaks
  run run_gate

  [[ "$output" != *"Secrets detected in staged files"* ]] || {
    echo "a scanner that could not load its config was reported as having found secrets"
    echo "$output"
    return 1
  }
  [[ "$output" != *"Remove the secret and use environment variables"* ]] || {
    echo "the user was told to rotate a secret that was never found"
    return 1
  }
  [[ "$output" == *"ENVIRONMENT"* ]] || {
    echo "expected an ENVIRONMENT label, got: $output"
    return 1
  }
}

@test "AC-614-01: a genuine exit-1 leak is still reported as secrets" {
  # The control, and the important half. If exit 1 were always treated as an
  # environment problem, Gate 8 could never block on an actual leaked key — strictly
  # worse than the bug.
  install_leaking_gitleaks
  run run_gate

  [[ "$output" == *"Secrets detected in staged files"* ]] || {
    echo "a real leak was not reported as secrets; got: $output"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-614-02: the config path is converted for the native binary on WSL too
# ---------------------------------------------------------------------------

@test "AC-614-02: the gate knows about wslpath as well as cygpath" {
  # cygpath is MSYS-only; WSL ships wslpath. A gate that only knows cygpath passes a
  # POSIX path to a native Windows binary on exactly the platform where that fails.
  grep -q 'wslpath' "$GATE8" || {
    echo "gate-8.sh still has no wslpath branch, so WSL hands a POSIX path to gitleaks.exe"
    return 1
  }
}

@test "AC-614-02: path conversion is attempted before the un-converted fallback" {
  # Ordering matters: the fallback is what broke. The converted path must be tried
  # first and the raw path only kept when no converter exists.
  local conv raw
  conv=$(grep -n 'wslpath -w' "$GATE8" | head -1 | cut -d: -f1)
  [ -n "$conv" ] || { echo "no 'wslpath -w' conversion found"; return 1; }
  raw=$(grep -n 'GITLEAKS_CONFIG="--config=$(pwd)/.gitleaks.toml"' "$GATE8" | head -1 | cut -d: -f1)
  [ -n "$raw" ] || { echo "the un-converted fallback disappeared"; return 1; }
  [ "$conv" -lt "$raw" ] || {
    echo "the raw POSIX path is assigned before the conversion is attempted"
    return 1
  }
}

@test "AC-614-02: the WSL conversion produces a path the native binary can open" {
  # Behavioural, with a stub `wslpath`: given /mnt/d/x it must yield D:\x, and the
  # gate must pass THAT to gitleaks rather than the POSIX form.
  mkdir -p "$WORK/tools"
  cat > "$WORK/tools/wslpath" << 'STUB'
#!/bin/bash
if [ "$1" = "-w" ]; then
  case "$2" in
    /mnt/d/*) printf 'D:\\%s\n' "${2#/mnt/d/}" | tr '/' '\\' ;;
    *) printf '%s\n' "$2" ;;
  esac
  exit 0
fi
exit 1
STUB
  chmod +x "$WORK/tools/wslpath"
  # cygpath must be ABSENT so the WSL branch is the one exercised.
  cat > "$WORK/bin/gitleaks" << 'STUB'
#!/bin/bash
for a in "$@"; do
  case "$a" in
    --config=*)
      echo "CONFIG_ARG=${a#--config=}"
      case "${a#--config=}" in
        /mnt/*) echo "POSIX_PATH_TO_NATIVE_BINARY"; exit 1 ;;
      esac
      ;;
  esac
done
exit 0
STUB
  chmod +x "$WORK/bin/gitleaks"

  run bash -c "
    cd '$WORK' || exit 1
    PATH='$WORK/tools:$WORK/bin:'\"\$PATH\"
    export PATH
    # Hide any real cygpath so the WSL path is the one under test.
    command -v cygpath >/dev/null 2>&1 && exit 77
    bash '$REPO_ROOT/githooks/gate-8.sh' 2>&1
  "
  [ "$status" -ne 77 ] || skip "host provides cygpath, so the WSL branch cannot be reached here"
  [[ "$output" != *"POSIX_PATH_TO_NATIVE_BINARY"* ]] || {
    echo "gate-8 handed a POSIX path to the native binary despite wslpath being available: $output"
    return 1
  }
}

# ---------------------------------------------------------------------------
# AC-614-03: the script stays valid
# ---------------------------------------------------------------------------

@test "AC-614-03: gate-8.sh is still syntactically valid" {
  run bash -n "$GATE8"
  [ "$status" -eq 0 ] || { echo "syntax error: $output"; return 1; }
  [ -n "$GITLEAKS_CONFIG" ] || true
}
