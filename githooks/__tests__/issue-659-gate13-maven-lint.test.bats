#!/usr/bin/env bats
# @test REQ-659
# @intent Gate 13 passed a Java file that javac explicitly warned about — a gate
#         that always passes is worse than one that crashes, because the user
#         believes they were guarded.
#
#         Measured repro on main 876c663b with a raw-type fixture
#         (`private List items = new ArrayList();`) and a pom declaring
#         maven-compiler-plugin 3.13.0 + <release>21</release>:
#
#           $ gate13_run_java_analysis
#                ✅ PASSED - Java compiled with -Xlint:all,-processing (no findings)
#           rc=0
#           $ gate13_javac_warning_count src/main/java/com/e/Box.java
#           javac warnings = 3      <-- the file DOES have findings
#
#         Three independent causes, all of which have to be closed:
#
#         1. `-Dmaven.compiler.compilerArgument=-Xlint:all,-processing` does not
#            take effect. `compilerArgument` is a SINGLE appended argument, so the
#            comma-separated list is not reliably passed through. Maven's own
#            output proves it: javac prints "使用了未经检查或不安全的操作 ... 请使用
#            -Xlint:unchecked 重新编译" — a message javac only emits when -Xlint was
#            NOT enabled. No `[category]` markers appear, so the detector below had
#            nothing to match.
#         2. The verdict regex only recognised the English `[WARNING]...[category]`
#            shape, with no fallback for a localised build.
#         3. `gate13_maven_injection_reliable()` returned "reliable" because the pom
#            declared a plugin version — it verified that the arguments could be
#            ASSEMBLED, never that they took EFFECT. "Can build the flag" is not
#            "the flag works", so the degraded path never engaged.
#
#         The fix follows the issue's own recommendation: stop assuming, prove it.
#         A probe compile of a known-raw-type file decides whether injection works;
#         when it does not, Gate 13 must NOT report PASS — it degrades to WARN and
#         runs the direct-javac path, which the issue measured as correct (3).
#
#         Every assertion here is on observable SCRIPT BEHAVIOUR (function verdicts
#         and source invariants), not on the exact wording of a message, so the
#         tests keep meaning after the prose is edited.
# @covers AC-670-32, AC-670-33, AC-670-34, AC-670-35

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
  TMP="$BATS_TEST_TMPDIR"
}

load_gate() {
  # shellcheck source=/dev/null
  source "$GATE"
}

# AC-670-32: injection effectiveness is PROVEN by a probe, not assumed from the pom.
@test "AC-670-32: a probe compile verifies -Xlint actually took effect" {
  [ -f "$GATE" ]
  # The probe must exist as a callable function and must use a raw-type fixture --
  # the one shape measured to produce [rawtypes] only under -Xlint.
  grep -qE '^gate13_maven_lint_effective\(\)|^gate13_maven_probe' "$GATE" \
    || { echo "no injection-effectiveness probe"; return 1; }
  # And the probe has to actually search for the marker, not merely run mvn.
  run grep -c 'rawtypes' "$GATE"
  [ "$output" -ge 1 ]
}

# AC-670-33: with injection unproven, the Maven path must never return PASS.
@test "AC-670-33: unreliable injection degrades to WARN and never PASS" {
  load_gate
  # gate13_maven_injection_reliable() must consult the probe result, so a pom that
  # merely declares a plugin version is no longer automatically "reliable".
  local body
  body=$(sed -n '/^gate13_maven_injection_reliable()/,/^}/p' "$GATE")
  printf '%s\n' "$body" | grep -qE 'gate13_maven_lint_effective|probe' \
    || { echo "injection_reliable() never consults the probe"; return 1; }

  # Structural invariant: in the Maven branch, the PASSED verdict must be
  # unreachable while `degraded` is set. The repository's own convention is that
  # a degraded run returns GATE13_WARN before reaching the PASS echo.
  local mvn_branch
  mvn_branch=$(sed -n '/── Maven path ──/,/── Gradle path ──/p' "$GATE")
  local degrade_line pass_line
  degrade_line=$(printf '%s\n' "$mvn_branch" | grep -n 'if \[ "$degraded" -eq 1 \]' | tail -1 | cut -d: -f1)
  pass_line=$(printf '%s\n' "$mvn_branch" | grep -n 'PASSED - Java compiled' | cut -d: -f1)
  [ -n "$degrade_line" ] && [ -n "$pass_line" ] || { echo "anchors missing"; return 1; }
  [ "$degrade_line" -lt "$pass_line" ] \
    || { echo "PASS is reachable in degraded mode"; return 1; }
}

# AC-670-34: a raw-type finding is detected even without a `[category]` marker.
@test "AC-670-34: raw-type findings are counted from javac's localised output" {
  load_gate
  # javac's non-English hint is the tell that -Xlint was not in effect, and the
  # code is still defective. That output must count as a finding, not as clean.
  local sample
  sample="[INFO] --- compiler:3.13.0:compile (default-compile) @ e ---
[WARNING] /src/main/java/com/e/Box.java 使用了未经检查或不安全的操作。
[WARNING] 有关详细信息, 请使用 -Xlint:unchecked 重新编译。"
  run gate13_count_lint_findings "$sample"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ] || { echo "localised javac warnings counted as 0"; return 1; }

  # The English marker shape must still be counted, and a clean build must be 0.
  run gate13_count_lint_findings "[WARNING] /src/Box.java:[7,20] unchecked call as a member of the raw type List"
  [ "$output" -ge 1 ]
  run gate13_count_lint_findings "[INFO] BUILD SUCCESS"
  [ "$output" -eq 0 ]
}

# AC-670-35: fail-closed regex -- an unknown category still counts.
@test "AC-670-35: any bracketed -Xlint category counts, not a fixed allow-list" {
  load_gate
  # A future JDK adds a category the allow-list does not know about; the detector
  # must still see it rather than silently reporting zero. Fail-closed is the
  # project's stated policy (#499/#570) and applies here too.
  run gate13_count_lint_findings "[WARNING] /src/A.java:[1,1] something odd [future-category]"
  [ "$output" -ge 1 ] || { echo "unknown category counted as 0"; return 1; }
}
