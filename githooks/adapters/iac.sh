#!/usr/bin/env bash

# IaC (Infrastructure as Code) adapter for quality gates
# Supports: Terraform (.tf), Kubernetes (K8s *.yaml), Docker, CloudFormation
# Tools: checkov (primary), hadolint (Docker), kube-score (K8s)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# #597: the library can be beside the adapters or one level up, depending on how
# the package was installed:
#   global install   ~/.config/xp-gate/adapters/adapter-common.sh   (inside)
#   npm package      src/npm-package/adapters/../adapter-common.sh  (above)
# The old single "$SCRIPT_DIR/../adapter-common.sh" only ever matched the second,
# so in the global layout the library never loaded - and "2>/dev/null || true"
# made that indistinguishable from success, leaving every shared function
# undefined with no warning.
for _ac_candidate in \
  "$SCRIPT_DIR/adapter-common.sh" \
  "$SCRIPT_DIR/../adapter-common.sh"; do
  if [ -f "$_ac_candidate" ]; then
    # shellcheck source=/dev/null
    source "$_ac_candidate"
    break
  fi
done
unset _ac_candidate

# Detect IaC files in changed files
detect_iac_files() {
  local files="$1"
  local tf_files=""
  local yaml_files=""
  local dockerfile_files=""
  
  for file in $files; do
    case "$file" in
      *.tf)
        tf_files="$tf_files $file"
        ;;
      *.yaml|*.yml)
        # Check if it's inside .github/workflows/ (GitHub Actions)
        if echo "$file" | grep -q "\.github/workflows/"; then
          # Pass directly to checkov as a GitHub Actions file
          yaml_files="$yaml_files $file"
        # Check if it's a K8s manifest (has apiVersion and kind)
        elif grep -qE "^(apiVersion|kind):" "$file" 2>/dev/null; then
          yaml_files="$yaml_files $file"
        fi
        ;;
      Dockerfile|*.dockerfile|Dockerfile.*)
        dockerfile_files="$dockerfile_files $file"
        ;;
    esac
  done
  
  echo "TERRAFORM:$tf_files"
  echo "KUBERNETES:$yaml_files"
  echo "DOCKER:$dockerfile_files"
}

run_static_analysis() {
  local changed_files="$1"
  # Gate 1 calls this with NO argument (githooks/gate-entries/gate-1-entry.sh
  # does `G1A_OUTPUT=$(run_static_analysis 2>&1)`) and routes by $CURRENT_LANG
  # instead. An empty $1 therefore means "everything the gate already decided is
  # in scope", not "nothing to do" -- fall back to the staged set the gate keeps
  # in $CHANGED_FILES. Without this, `detect_iac_files ""` finds no files,
  # `has_iac` is false, and the function returns 0 before reaching any check.
  #
  # Measured: through the hook, Gate 1 printed "✅ PASSED - Language-specific
  # code quality checks." for an unparseable .tf file; called directly with the
  # filename it returned 1. The adapter was fine; the argument was empty.
  if [ -z "$changed_files" ] && [ -n "${CHANGED_FILES:-}" ]; then
    changed_files="$CHANGED_FILES"
  fi
  local iac_files=$(detect_iac_files "$changed_files")
  
  # Check if any IaC files are present
  local has_iac=false
  if echo "$iac_files" | grep -qE "TERRAFORM:.*[^\s]|KUBERNETES:.*[^\s]|DOCKER:.*[^\s]"; then
    has_iac=true
  fi
  
  if [ "$has_iac" = false ]; then
    return 0  # No IaC files, skip
  fi
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   GATE: IaC Security Scan"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  local exit_code=0

  # ── Parse/type validation, before the security scanners ────────────────────
  #
  # checkov and tflint are SECURITY scanners. They answer "is this configuration
  # dangerous", never "is this configuration parseable" -- and a file nothing can
  # parse has no dangers to report, so they pass it. Measured on a one-file
  # fixture whose closing brace was missing:
  #
  #   checkov:  "Parsing errors: 1 / Error parsing file ...\bad.tf"   exit 0
  #   adapter:  "✅ PASSED - Language-specific code quality checks."   exit 0
  #   terraform: "Error: Unclosed configuration block"                 exit 1
  #
  # So the gate reported a positive verdict for a file its own toolchain refuses
  # to load. Gate 1 does exactly this parse step for TypeScript (tsc) and C++
  # (the compiler); IaC was the gap.
  #
  # Scope is deliberately narrow:
  #   - only when .tf files are in the change set (input short-circuit first)
  #   - only when terraform is resolvable locally (no network -- a gate must
  #     never install what it was asked to detect)
  #   - `-backend=false` so init cannot reach for a remote state backend
  #   - a bounded timeout, and a failure to RUN is reported as such rather than
  #     scored as "found nothing"
  # `iac_files` is the three-line TERRAFORM:/KUBERNETES:/DOCKER: summary that
  # detect_iac_files returns; take the Terraform line and drop the prefix.
  local _tf_list
  _tf_list=$(printf '%s\n' "$iac_files" | sed -n 's/^TERRAFORM://p')
  if [ -n "${_tf_list// /}" ] && command -v terraform >/dev/null 2>&1; then
    local _tf_attempted=0 _tf_bad=0
    local _tf_dir
    # Validate once per distinct directory: terraform resolves a whole module
    # directory, so validating file by file would re-init the same module N times
    # and report the same error N times.
    #
    # The list is split on whitespace deliberately (detect_iac_files emits
    # space-separated paths) but goes into an ARRAY rather than straight into a
    # `for`, so each element stays one path and a directory name containing a
    # space cannot become two. shellcheck's SC2086 is right that a bare unquoted
    # expansion here would be a latent word-splitting bug.
    local _tf_dirs=()
    local _tf_f
    while IFS= read -r _tf_f; do
      [ -n "$_tf_f" ] || continue
      local _tf_d
      _tf_d=$(dirname "$_tf_f")
      # Dedupe without relying on IFS: compare against what is already there.
      local _tf_seen=0 _tf_e
      for _tf_e in ${_tf_dirs[@]+"${_tf_dirs[@]}"}; do
        [ "$_tf_e" = "$_tf_d" ] && { _tf_seen=1; break; }
      done
      [ "$_tf_seen" -eq 0 ] && _tf_dirs+=("$_tf_d")
    done <<TFEOF
$(printf '%s\n' "$_tf_list" | tr ' ' '\n' | sed '/^$/d')
TFEOF
    for _tf_dir in ${_tf_dirs[@]+"${_tf_dirs[@]}"}; do
      [ -d "$_tf_dir" ] || continue
      _tf_attempted=$((_tf_attempted + 1))
      local _tf_out _tf_rc
      # Validate FIRST, without init.
      #
      # `terraform validate` answers the parse/type question on its own; it only
      # needs init to resolve the provider SCHEMA, and a file that does not parse
      # never gets that far. Measured on the unclosed-block fixture:
      #
      #   terraform validate, no init       0.27 s  -> "Unclosed configuration block"
      #   terraform init + validate         4.8 s   -> same answer
      #
      # So init was 94% of the cost of a verdict it did not influence. It is run
      # only when validate says it cannot proceed without it ("Missing required
      # provider" / "Module not installed" / an uninitialized-directory warning),
      # which is the clean-file case where the provider schema really is needed.
      #
      # `-backend=false` keeps init off any remote state backend: a gate must
      # never wait on the network.
      if command -v timeout >/dev/null 2>&1; then
        _tf_out=$( cd "$_tf_dir" && timeout 120 terraform validate -no-color 2>&1 )
        _tf_rc=$?
        if [ "$_tf_rc" -ne 0 ] && printf '%s' "$_tf_out" | grep -qiE 'must be initialized|Missing required provider|Module not installed|run .terraform init'; then
          ( cd "$_tf_dir" && timeout 120 terraform init -backend=false -input=false -no-color >/dev/null 2>&1 )
          _tf_out=$( cd "$_tf_dir" && timeout 120 terraform validate -no-color 2>&1 )
          _tf_rc=$?
        fi
      else
        _tf_out=$( cd "$_tf_dir" && terraform validate -no-color 2>&1 )
        _tf_rc=$?
        if [ "$_tf_rc" -ne 0 ] && printf '%s' "$_tf_out" | grep -qiE 'must be initialized|Missing required provider|Module not installed|run .terraform init'; then
          ( cd "$_tf_dir" && terraform init -backend=false -input=false -no-color >/dev/null 2>&1 )
          _tf_out=$( cd "$_tf_dir" && terraform validate -no-color 2>&1 )
          _tf_rc=$?
        fi
      fi
      if [ "$_tf_rc" -ne 0 ]; then
        _tf_bad=$((_tf_bad + 1))
        echo "   ❌ terraform validate rejected $_tf_dir:"
        printf '%s\n' "$_tf_out" | grep -vE '^\s*$' | head -12 | sed 's/^/      /'
      fi
    done
    if [ "$_tf_attempted" -gt 0 ] && [ "$_tf_bad" -gt 0 ]; then
      echo "   ❌ $_tf_bad Terraform module(s) failed validation."
      exit_code=1
    fi
    if [ "$_tf_attempted" -eq 0 ]; then
      echo "   ⚠️  .tf files staged but no containing directory could be resolved;"
      echo "       syntax validation did not run."
    fi
  fi
  # #803: counts scanner/file pairs that actually ran, independent of their
  # verdict. `exit_code == 0` answers "did anything fail?"; it cannot answer "did
  # anything run?", and using it for both made a clean scan indistinguishable from
  # a missing toolchain.
  local iac_scans_completed=0
  
  # Try checkov first (recommended - supports multiple platforms)
  # Resolve to an executable that actually RUNS, not merely one that exists. On
  # MSYS2/Git Bash pip leaves an extensionless `checkov` shim whose shebang
  # hands a MSYS path to the Windows interpreter, which fails every time:
  #   can't open file 'D:\\c\\Users\\...\\Scripts\\checkov'
  # `command -v checkov` still succeeds, so a presence-only probe picks the
  # broken shim and the gate reports "the scanner crashed" on IaC commits that
  # are perfectly fine. Probing the version is the only way to tell the two
  # apart; checkov.cmd is the form that works here.
  #
  # A timeout wraps the probe because the failure mode being screened for is a
  # shim that does not answer. Observed breakage exits 2 at once, but a hung
  # wrapper must not block the commit forever. `timeout` is absent on stock
  # macOS, so it is used only when available; the probe is a local version
  # print either way.
  local checkov_bin=""
  local _checkov_candidate
  local _checkov_seen_nonexec=0
  local _checkov_probe
  for _checkov_candidate in checkov checkov.exe checkov.cmd; do
    command -v "$_checkov_candidate" >/dev/null 2>&1 || continue
    if command -v timeout >/dev/null 2>&1; then
      # #803: the budget must exceed the cost of the thing being timed. It was 20 s,
      # and `checkov --version` measures 22.4 s on Windows with a cold pip cache
      # (python startup + imports, not network). So the probe timed out, checkov was
      # screened out as unusable, and the gate spent the commit pretending the tool
      # was not installed — while checkov 3.3.30 was on PATH and passing the very
      # file being committed.
      #
      # The probe exists to catch a shim that does not answer (#596), which is a
      # hang, not a slow start. A tool that answers in 25 s is not a broken shim, and
      # a false "not installed" is the more expensive error here: it silences a
      # scanner that works. Generous, still bounded.
      _checkov_probe="timeout 60 $_checkov_candidate --version"
    else
      _checkov_probe="$_checkov_candidate --version"
    fi
    if $_checkov_probe >/dev/null 2>&1; then
      checkov_bin=$(command -v "$_checkov_candidate")
      break
    fi
    _checkov_seen_nonexec=1
  done
  # "Not installed" and "installed but unusable" both end up without a scanner,
  # and the fallbacks below keep the gate useful -- but they are not the same
  # situation, and silently treating a broken install as absent hides a lost
  # scanner. Say which one it is.
  if [ -z "$checkov_bin" ] && [ "$_checkov_seen_nonexec" -eq 1 ]; then
    echo "     ⚠️  checkov is on PATH but none of its forms could be executed;"
    echo "         treating it as unusable and falling back to other scanners."
    echo "         Reinstall with: pip install -U checkov"
  fi
  if [ -n "$checkov_bin" ]; then
    echo "Running checkov IaC security scan..."

    # checkov 3.x exits 0 on "found failures" (we parse the output for those),
    # so the status cannot be the only signal. It is still NOT discardable:
    # exit 2 means checkov itself crashed -- e.g. AttributeError from a broken
    # detect_secrets dependency -- and a crashed scanner has not judged
    # anything. Counting a traceback as findings invents security issues; a
    # traceback that happens to lack the marker reports a clean pass. Both are
    # wrong, so a crash is tracked separately and answered as "unusable" (#552).
    local checkov_log=$(mktemp)
    local checkov_args="--compact"
    local CHECKOV_CRASHED=0
    local checkov_scan_count=0

    # Record a checkov run's exit status and flag a crash. Codes 0 and 1 are
    # normal (1 = findings); anything else, or any traceback in the log, is the
    # tool failing rather than reporting.
    #
    # $2 is how many FILES this run covered, not how many runs happened. Since
    # one launch can now scan a whole batch (#805), counting launches would make
    # a 3-file commit report "1 file(s) scanned" — true about processes, false
    # about coverage, and the completion message is what a reader trusts when
    # deciding whether the gate looked at everything.
    record_checkov_run() {
      local status=$1 covered=${2:-1}
      checkov_scan_count=$((checkov_scan_count + covered))
      # #803: a checkov run counts as a completed scan even when it reports a
      # failure — the point of this counter is "a scanner looked", which is what
      # distinguishes a clean scan from a missing toolchain.
      iac_scans_completed=$((iac_scans_completed + 1))
      if [ "$status" -ne 0 ] && [ "$status" -ne 1 ]; then
        # Batching makes the crash LESS specific but never less visible: one
        # status covers the whole batch, so a crash distrusted all of it. Saying
        # "on a batch of N" is honest about that; naming one file would imply we
        # know which one failed, which a batched call cannot tell us.
        CHECKOV_CRASHED=1
        echo "     ⚠️  checkov exited $status on a batch of $covered file(s) — the scanner failed, this is not a finding"
      fi
    }

    # Run checkov once per BATCH of same-framework files instead of once per file.
    #
    # Measured 2026-11-15 (Windows/Git Bash, load 2.2-4.9 of 8 cores): checkov's
    # cost is python startup + framework import, not scanning. Three real
    # workflows cost 106.2 s as three launches and 30.6 s as one, for the same
    # 300 checks. A 4-line file still cost 19.9 s, which is the proof that the
    # constant dominates.
    #
    # The argument form matters and is NOT obvious: `--file A --file B` scans only
    # A (verified — it reported 116 checks, the single-file count), while
    # `--file A B` scans both, per checkov's documented `-f FILE [FILE ...]`
    # signature. So the paths must be expanded into ONE --file list.
    #
    # Only files that exist are passed: the old loop skipped missing ones
    # individually, and handing checkov a path that disappeared between detection
    # and scanning would turn a benign race into a scanner error.
    scan_checkov_batch() {
      local framework_arg=$1
      shift
      local batch=""
      local covered=0
      local file
      for file in "$@"; do
        if [ -f "$file" ]; then
          batch="$batch $file"
          covered=$((covered + 1))
        fi
      done
      [ "$covered" -gt 0 ] || return 0
      # Intentional word splitting: checkov takes the file list positionally
      # after ONE --file, and each path here has already been through the
      # adapter's own detection (no spaces in the glob patterns it produces).
      # shellcheck disable=SC2086
      "$checkov_bin" --file $batch $checkov_args $framework_arg >> "$checkov_log" 2>&1
      local status=$?
      record_checkov_run "$status" "$covered"
      return 0
    }

    # Run checkov on all detected IaC files
    local tf_files=$(echo "$iac_files" | grep "TERRAFORM:" | sed 's/TERRAFORM://')
    local k8s_files=$(echo "$iac_files" | grep "KUBERNETES:" | sed 's/KUBERNETES://')
    local docker_files=$(echo "$iac_files" | grep "DOCKER:" | sed 's/DOCKER://')

    if [ -n "$tf_files" ]; then
      echo "Scanning Terraform files..."
      # shellcheck disable=SC2086
      scan_checkov_batch "" $tf_files
    fi

    if [ -n "$k8s_files" ]; then
      local gh_files=""
      local k8s_only=""
      for file in $k8s_files; do
        if echo "$file" | grep -q "\.github/workflows/"; then
          gh_files="$gh_files $file"
        else
          k8s_only="$k8s_only $file"
        fi
      done

      if [ -n "$k8s_only" ]; then
        echo "Scanning Kubernetes manifests..."
        # shellcheck disable=SC2086
        scan_checkov_batch "--framework kubernetes" $k8s_only
      fi

      if [ -n "$gh_files" ]; then
        echo "Scanning GitHub Actions workflows..."
        # shellcheck disable=SC2086
        scan_checkov_batch "--framework github_actions" $gh_files
      fi
    fi

    if [ -n "$docker_files" ]; then
      echo "Scanning Dockerfiles..."
      # shellcheck disable=SC2086
      scan_checkov_batch "" $docker_files
    fi

    # Print captured output then check for failures
    cat "$checkov_log"

    # A crash is answered before any parsing. The traceback is not evidence of
    # anything: its text decides the verdict if we let grep see it.
    if [ "$CHECKOV_CRASHED" -eq 1 ]; then
      rm -f "$checkov_log"
      echo ""
      echo "❌ BLOCKED - checkov could not run (the scanner crashed, so nothing was scanned)."
      echo "   This is NOT a security finding. Fix the environment, usually:"
      echo "     pip install -U checkov detect-secrets"
      echo "   (A common cause is a detect_secrets version whose FileType enum lacks JSON.)"
      echo "   To accept the risk for this commit: XP_GATE_IAC_SOFT=1"
      if [ "${XP_GATE_IAC_SOFT:-}" = "1" ]; then
        echo "⚠️  XP_GATE_IAC_SOFT=1: unusable scanner downgraded to WARN"
        return 3
      fi
      return 2
    fi

    local failed_count=$(grep -c "FAILED for resource" "$checkov_log" 2>/dev/null || true)
    rm -f "$checkov_log"

    if [ "$failed_count" -gt 0 ]; then
      echo "❌ $failed_count security issue(s) found by checkov across $checkov_scan_count file(s). Blocking commit."
      exit_code=1
    fi
    echo "checkov scan completed ($checkov_scan_count file(s) scanned)."
    return $exit_code
  fi
  
  # Fallback to individual tools if checkov not available
  
  # Try hadolint for Docker
  local docker_files=$(echo "$iac_files" | grep "DOCKER:" | sed 's/DOCKER://')
  if [ -n "$docker_files" ] && command -v hadolint >/dev/null 2>&1; then
    echo "Running hadolint for Dockerfiles..."
    for file in $docker_files; do
      if [ -f "$file" ]; then
        hadolint "$file" 2>&1 | tail -20
        iac_scans_completed=$((iac_scans_completed + 1))
        local hadolint_exit=${PIPESTATUS[0]}
        if [ $hadolint_exit -ne 0 ]; then
          exit_code=$hadolint_exit
        fi
      fi
    done
  fi
  
  # Try kube-score for Kubernetes
  local k8s_files=$(echo "$iac_files" | grep "KUBERNETES:" | sed 's/KUBERNETES://')
  if [ -n "$k8s_files" ] && command -v kube-score >/dev/null 2>&1; then
    echo "Running kube-score for Kubernetes..."
    for file in $k8s_files; do
      if [ -f "$file" ]; then
        kube-score score "$file" 2>&1 | tail -20
        iac_scans_completed=$((iac_scans_completed + 1))
        local kube_exit=${PIPESTATUS[0]}
        if [ $kube_exit -ne 0 ]; then
          exit_code=$kube_exit
        fi
      fi
    done
  fi
  
  # Try tflint for Terraform
  local tf_files=$(echo "$iac_files" | grep "TERRAFORM:" | sed 's/TERRAFORM://')
  if [ -n "$tf_files" ] && command -v tflint >/dev/null 2>&1; then
    echo "Running tflint for Terraform..."
    for file in $tf_files; do
      if [ -f "$file" ]; then
        tflint --chdir "$(dirname "$file")" 2>&1 | tail -20
        iac_scans_completed=$((iac_scans_completed + 1))
        local tflint_exit=${PIPESTATUS[0]}
        if [ $tflint_exit -ne 0 ]; then
          exit_code=$tflint_exit
        fi
      fi
    done
  fi
  
  # If no tools available but IaC files detected, warn user
  #
  # #803: this branch used to test `[ $exit_code -eq 0 ]`, which conflates "every
  # applicable scanner ran and found nothing" with "no scanner ran at all". They
  # are opposite statements about the same commit, and only one of them is a
  # toolchain problem.
  #
  # The conflation is not theoretical. On a host where `checkov --version` takes
  # longer than the probe's own `timeout 20` (measured 22.4 s on Windows with a
  # cold pip cache), checkov is screened out as unusable and the gate falls back
  # to hadolint / kube-score / tflint -- none of which inspects a GitHub Actions
  # workflow. All three iterate zero files, exit_code stays 0, and a workflow that
  # checkov passes with 116 checks reported PASSED was reported as "no scanning
  # tools available" and BLOCKED, with an install hint for a tool already working.
  #
  # So track "did any scanner actually run" separately, and say which scanners ran.
  if [ "$iac_scans_completed" -eq 0 ]; then
    echo "⚠ IaC files detected but no scanning tools available."
    echo "  Install checkov (recommended) or individual tools:"
    echo "  - checkov: pip install checkov"
    echo "  - hadolint: https://github.com/hadolint/hadolint"
    echo "  - kube-score: https://github.com/zegl/kube-score"
    echo "  - tflint: https://github.com/terraform-linters/tflint"
    echo ""
    echo "  Per QUALITY-GATES-CODE-OF-CONDUCT.md: tool unavailable = BLOCK, not SKIP"
    return 1
  fi

  # Scanners ran and none of them found anything. That is a PASS, and it must not
  # be reported as a missing toolchain: a gate that blocks a clean scan teaches
  # its reader that the gate is broken, and the next honest commit looks like the
  # one that needed a bypass.
  echo "IaC scan completed: $iac_scans_completed scanner file(s) checked, no findings."
  return $exit_code
}

run_lint() {
  # IaC linting is handled by run_static_analysis
  run_static_analysis "$1"
}

run_tests() {
  # IaC typically doesn't have unit tests in the traditional sense
  # Could add integration tests with terratest (Go) or pytest (Python)
  echo "IaC tests not configured"
  return 0
}

run_coverage() {
  echo "IaC coverage not available"
  return 0
}
