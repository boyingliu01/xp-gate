#!/usr/bin/env bats
#
# @test REQ-IAC-SYNTAX
# @intent Gate 1 reported PASS for a Terraform file that terraform itself refuses
#         to parse.
#
#         Measured, gate 1 against a one-file fixture:
#
#           resource "aws_security_group" "broken" {
#             ingress {
#               from_port = 22
#           }
#
#         Gate 1 output:
#           ── Checking iac ──
#           Running static analysis for iac...
#           Running lint check for iac...
#           ✅ PASSED - Language-specific code quality checks.
#
#         terraform, on the same file:
#           Error: Unclosed configuration block
#             on bad.tf line 1, in resource "aws_security_group" "broken":
#
#         The adapter runs checkov and tflint. Both are SECURITY scanners -- they
#         ask "is this configuration dangerous", never "is this configuration
#         parseable". A file nothing can parse has no dangers to report, so the
#         scanners pass it, `iac_scans_completed` is non-zero, `exit_code` is 0,
#         and the gate reports a positive verdict.
#
#         This is the family this whole investigation keeps finding: the gate ran
#         a check, so it reported "checked". The check it ran cannot answer the
#         question the language's own toolchain answers in 1.6 s.
#
#         `terraform validate` is the parse+type layer and is the direct analogue
#         of tsc for TypeScript and the compiler for C++ -- which Gate 1 already
#         does for those languages. IaC was the gap.
#
# @covers AC-IAC-SYNTAX-01
# @covers AC-IAC-SYNTAX-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  IAC="$REPO_ROOT/githooks/adapters/iac.sh"
  MIRROR="$REPO_ROOT/src/npm-package/hooks/adapters/iac.sh"
}

@test "AC-IAC-SYNTAX-01: the IaC adapter runs a syntax/type validation step" {
  # Structural: some invocation of terraform's own validation must exist. Without
  # it the security scanners are the only thing standing between an unparseable
  # file and a green gate.
  run grep -nE 'terraform[^|]*validate|validate[^|]*terraform' "$IAC"
  [ "$status" -eq 0 ] || {
    echo "the IaC adapter never calls terraform validate, so a file terraform"
    echo "cannot parse reaches the security scanners, which pass it."
    echo "scanners present in the adapter:"
    grep -oE '(checkov|tflint|hadolint|kube-score|terraform [a-z]+)' "$IAC" | sort -u
    return 1
  }
}

@test "AC-IAC-SYNTAX-02: an unparseable .tf file BLOCKS rather than passing" {
  # Behavioural, and the one that matters.
  #
  # The first version of this test grepped the output for /error|syntax|parse/
  # and passed -- because checkov DOES print
  #
  #   Parsing errors: 1
  #   Error parsing file ...\bad.tf
  #
  # while the adapter still exits 0. Measured:
  #
  #   $ run_static_analysis bad.tf ; echo $?
  #   rc=0
  #
  # The text was present and the verdict was still a pass. Asserting on the text
  # measured the scanner's vocabulary, not the gate's decision -- the same error
  # family as everything else in this sweep. The exit status IS the decision.
  command -v terraform >/dev/null 2>&1 || skip "terraform not installed"

  local dir="$BATS_TEST_TMPDIR/tfbad"
  mkdir -p "$dir"
  cat > "$dir/bad.tf" <<'TF'
resource "aws_security_group" "broken" {
  ingress {
    from_port = 22
}
TF

  # `run` captures the status of the last command in the bash -c, which is
  # run_static_analysis itself.
  run bash -c "cd '$dir' && . '$IAC' && run_static_analysis 'bad.tf'"
  local out="$output"
  local rc="$status"

  if printf '%s' "$out" | grep -qE '✅ PASSED'; then
    echo "the adapter reported PASSED for a file terraform cannot parse:"
    printf '%s\n' "$out" | tail -8
    return 1
  fi

  if [ "$rc" -eq 0 ]; then
    echo "the adapter exited 0 for an unparseable Terraform file (rc=$rc)."
    echo "Gate 1 turns a non-zero return into a BLOCK, so exit 0 here means the"
    echo "commit passes while terraform refuses to read the file:"
    printf '%s\n' "$out" | tail -8
    return 1
  fi
}

@test "anti-vacuity: the security scanners are still invoked" {
  # The fix must ADD a validation layer, not replace the security scanners. A
  # gate that stopped looking for dangerous configuration would pass the two
  # tests above while losing the thing they were never about.
  grep -q 'checkov' "$IAC"
  grep -qE 'tflint|hadolint|kube-score' "$IAC"
}