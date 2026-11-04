# #717 C# support — three blockers resolved before the sprint

> Date: 2026-11-03 ｜ Branch: `sprint/2026-11-03-02` ｜ Sprint: `sprint-20261103-88`
> Issue: [#717](https://github.com/boyingliu01/xp-gate/issues/717)

The three technical problems that had to be settled before C# adapter work
could start as a sprint. Each is resolved with a pinned test; the third is
recorded as a measured boundary rather than a guess.

---

## 1. Detection could never NAME csharp — **RESOLVED**

### What was wrong

`detect_project_lang()` is an exclusive first-match chain. Its extension arm
was ordered `sh → ps1 → ts → py → go → kt → java → … → swift → cpp → m → sh`.
A .NET repo that also carried one `.sh` helper reported `shell`; one carrying a
`package.json` for a JS half reported `typescript`. The C# body was never
reached — this is exactly the `dsh-aot-runner` shape in the issue (2031 lines of
C#, ~900 lines of JS).

### Why "just add a csharp arm" was not enough

Adding an arm anywhere below the `.sh` probe keeps the shadowing. The C# probes
had to move **ahead** of the TypeScript/package.json/`.sh` probes, and the reason
is structural rather than stylistic: none of the other languages ever ship a
`.csproj` / `.sln` / `Directory.Build.props`, so hoisting C# cannot steal an
existing project — the older arms are reached unchanged whenever those files are
absent (pinned by AC-717-03).

### What changed

- `has_dotnet_manifest()` — `.csproj`, `.sln`, `Directory.Build.props`,
  `Directory.Build.targets`, `global.json`. `find -maxdepth 1` rather than a glob
  loop: a directory with thousands of files would blow the argv limit.
- `has_csharp_sources()` — `.cs` anywhere, excluding `bin/`, `obj/`, `.git/`.
- C# arms hoisted to first position in `detect_project_lang()`.
- **`detect_project_langs()` (new)** — the collector. `detect_project_lang()`
  answers ONE language, which is fine for legacy routing and wrong for the gates:
  a C#+JS repo gets graded as whichever language won the chain and the other
  half is never measured. The collector prints every language present, deduped.
  This is what the per-gate file filters should be driven by going forward.

### Tests

`githooks/__tests__/issue-717-csharp-detection.test.bats` — 11 cases,
AC-717-01..04, 11/11 green. Includes the two shadowing cases, which are the
ones that would pass by accident if the ordering were wrong.

---

## 2. `.cs` was silently accepted in some places and dropped in others — **RESOLVED**

### What was wrong

`.cs` was already listed in `arch.js`'s extension map, `test-alignment.ts`'s
`UNSUPPORTED_TEST_EXTENSIONS`, the semgrep file list in `gate-9.sh`, and
`pre-commit`'s test-file classifier. The whole detection stack "knew" about C#.
But the gate file filters did not list it, so a staged `.cs` file was dropped
**before any tool saw it** — lizard parses C# natively and still reported
nothing.

Measured: `lizard --csv -C 5 Probe.cs` returns
`11,9,127,1,11,"Probe::Grade@6-16@Probe.cs"` — CCN 11 on the first try. The
issue's four over-threshold functions were always detectable; the gate filtered
them out first.

### What changed

- `cs` added to the lizard population in all five copies of `gate-3.sh`
  (`githooks/adapters/`, `githooks/`, and the three npm mirrors).
- `cs` added to Gate 4's principles population in all five copies of `gate-4.sh`.
- `cs` added to `LIZARD_EXTENSIONS` in `src/gates/common.ts` (the TS CLI path).
- **`githooks/adapters/csharp.sh` (new)** — implements the four functions
  `pre-commit` calls directly (`run_static_analysis`, `run_lint`, `run_tests`,
  `run_coverage`; #688 means there is no dispatcher in between).

### Adapter design, following two earlier incidents

- **#706 (kotlin.sh):** a failed build must not swallow `dotnet format`, which
  reads sources and needs no successful build. The build outcome is printed and
  returned separately from the analyzer verdict.
- **#703/#708 (java.sh):** "tool missing" and "tool ran and failed" need
  different fixes → different messages. No SDK is a SKIP with an install hint,
  not a BLOCK.
- `_has_test_project()` exists because `dotnet test` on a solution with no test
  project **exits 0 and prints nothing** — which reads as "all tests passed" for
  a project that has no tests. Same silent-success shape as the issue itself.

### Tests

`githooks/__tests__/issue-717-csharp-gates.test.bats` — 9 cases, AC-717-05..08,
9/9 green. Filter tests, adapter-contract tests and mirror parity; no test needs
`lizard` or `dotnet` installed (a test that needs them reports SKIP in CI, which
is the same false-green the issue is about).

---

## 3. `dotnet test` does not run inside this repo — **BOUNDED, NOT FIXED**

### What was measured

| Location | `dotnet test` |
|---|---|
| `C:\Users\think\AppData\Local\Temp\…` | **passes** |
| `D:\tmp-dnt\…`, `D:\projects\.probe-y\…`, `D:\projects\<any sibling>\…` | **passes** |
| `D:\projects\xp-gate\…` (repo root **and** every subdirectory) | **aborts** |
| `D:\projects\xp-gate\.worktrees\<any>\…` | **aborts** |
| project created inside the repo, then **copied out** | **passes** |

The abort is:

```
源"…\T.dll"的 Testhost 进程已退出，但出现错误: Unhandled exception.
System.ComponentModel.Win32Exception (5): 拒绝访问。
   at System.Diagnostics.ProcessManager.OpenProcess(...)
   at Microsoft.VisualStudio.TestPlatform.…ProcessHelper.SetExitCallback(...)
```

`dotnet build` and `dotnet format` are unaffected — only the VSTest testhost's
`OpenProcess` on its own parent fails.

### What was ruled out

Each of these was tested and does **not** reproduce it in a clean directory:

- reproducing under PowerShell instead of git-bash — same abort
- `--no-build`, `--blame-hang-timeout`, `TMP`/`TEMP` override,
  `-p:UseSharedCompilation=false` — same abort
- a plain `git init` with default hooks — passes
- `core.hooksPath` pointed at this repo's `githooks/` — passes
- copying this repo's `tsconfig.json`, `Directory.Build.props`, `global.json`,
  `.editorconfig` into a fixture — passes
- a lexically deep path on `D:` (`D:\x\a\b\c`) — passes
- **reproducing the repo root's explicit ACL deny ACE** (`Everyone:(CI)(DENY)(DC)`)
  on a clean directory — passes
- **removing that ACE from the real repo root and re-running** — still aborts
  (ACE restored afterwards; the repo's DACL is byte-for-byte as found)

So the trigger is bound to this path but is not any of the config, hook, or ACL
state that could be isolated cheaply. Likely candidates not yet tested are an
endpoint-protection filter driver or a filesystem-level access rule outside the
DACL. That is a host-environment investigation, not an xp-gate defect, and it is
out of scope for #717.

### What the adapter does about it

`run_tests()` classifies the abort **separately from a test failure**:

```bash
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -qiE 'Win32Exception|Access is denied|拒绝访问|Testhost.*已退出'; then
  echo "dotnet test could not start the test host (environment fault, not a test verdict)"
  return 2   # the "could not execute" channel, same as java.sh's G1 contract
fi
```

Returning 1 here would block every commit in a repo whose tests are fine;
returning 0 would be a lie. `2` is the existing "could not execute" channel.
`run_coverage()` has the same shape and additionally requires the
`coverage.cobertura.xml` artifact to exist before reporting a result.

### Consequence for the sprint — and what was actually proven

Two different claims are easy to conflate here, so they are stated separately:

**(a) Is the adapter logic correct?** — **Verified.** `run_tests` returns
`0` (tests pass), `1` (a test genuinely failed) and `2` (no test project, or no
SDK). All three are exercised by `issue-717-csharp-adapter-e2e.test.bats`, which
builds a real .NET project under the OS temp directory where `dotnet test`
works. 4/4 green. The "C# verdicts are real verdicts" claim therefore holds.

**(b) Can it be exercised from inside this repo's path?** — **No.** That is the
host permission fault above, not a code property. It affects only where the
smoke run can happen, not whether the logic is right.

Saying "Gate 5 is unverifiable" would be wrong about (a); saying "Gate 5 is
fully verified in place" would be wrong about (b). The delivery criterion
requires (a) plus the no-false-reporting guarantee, and does not require (b),
which is outside this repo's control.

---

## Repo state left behind

- `githooks/adapter-common.sh` + 2 npm mirrors — synced byte-identical
- `githooks/adapters/gate-3.sh`, `gate-4.sh` + 4 npm copies each — synced
  byte-identical (parity pinned by AC-717-05)
- `githooks/adapters/csharp.sh` + 1 npm mirror — synced
- Verification: `npx tsc --noEmit` → 0, `npx eslint src --ext .ts` → 0,
  targeted BATS (gate-3, gate-4, gate-activation, adapter-common, #688, #717) →
  52/52 pass
- No probe directories left in either tree; the repo-root ACL was verified
  restored to `Everyone:(CI)(DENY)(DC)`

---

## 4. 能力边界矩阵（AC-717-10）

> 这张表是与代码行为的契约。改代码时若行为变化，必须同步改这张表；AC-717-10 要求二者一致。
> 措辞上不得暗示 C# 已全量支持。

| Gate | issue #717 期望 | 本次状态 | 说明 |
|---|---|---|---|
| 1 Code Quality | `dotnet format --verify-no-changes` | **covered** | `csharp.sh` 的 `run_static_analysis`/`run_lint` |
| 3 Complexity | `lizard src/ -l csharp` | **covered** | 只差扩展名；lizard 原生解析 C# |
| 4 Principles | — | **covered（文件群体层面）** | `gate-4.sh` 补 `cs`；原则引擎本身无 C# 适配器 |
| 5 Tests + Coverage | `dotnet test --collect:"XPlat Code Coverage"` | **covered，且已验证** | 三种返回码 0/1/2 由 e2e 测试在临时目录实测；限制仅剩「在本仓库路径内不能实跑」 |
| 9 SAST | `dotnet build -c Release` | **无需改动** | `.cs` 早已在 semgrep 名单内 |
| 13 Compiler strictness | `dotnet build -warnaserror` | **covered** | `gate13_run_csharp_analysis`；接入 pre-commit worst-of 归约；0/1/3 实测 |

**doctor / init 尚不认识 C#**：`LANGUAGE_REGISTRY`（`src/npm-package/lib/language-tools.js`）没有 `csharp` 条目，
所以 `detect-languages` / `check-tools` / `install-tools` / `doctor` / `init` 不会报告或安装 .NET 工具链。
hooks 层已管辖 C# 而工具链管理层尚未跟进——这是已知的双链差异，见跟踪 issue。

**CI 与本地钩子的已知差异**：`.github/workflows/quality-gates.yml` 复制了一份独立的语言检测逻辑，本次未同步修改。
本地 pre-commit 会检查 `.cs`，CI 侧不会。这不是回归（改动前两侧都不检查），但属于已知不一致。

## 5. "无法执行" ≠ "执行失败"：链路必须能区分

R1 第一轮评审指出一个真实缺陷：**适配器返回 2 是不够的，上一层会把状态压平。**

实测链路：

| 位置 | 原行为 |
|---|---|
| `pre-commit:2249-2265` (Gate 1) | `ANALYSIS_EXIT`/`LINT_EXIT` 非 0 一律 `⏭️ SKIPPED - Code quality (tools unavailable or failed)` |
| `pre-commit:3212-3224` (Gate 5) | 非 TS 语言**任何**非 0 返回码 → `❌ BLOCKED - Tests FAILED; exit 1` |
| `githooks/lib/test-failure.sh:31` | `is_runner_infrastructure_error()` 只认 vitest 的 `Unhandled Error` |

两个后果，都是 #717 要消除的那类静默失效：

- Gate 5 那条意味着：`csharp.sh` 返回 2 会在这台机器上**阻断每一次提交**，理由与提交内容无关；
- Gate 1 那条意味着：真正跑不动的分析器和"跑完没问题"在日志里长得一样。

### 修法

1. `is_runner_infrastructure_error()` 增加 dotnet/VSTest 特征（`Win32Exception` /
   `Testhost ... 已退出` / `test host could not start`），并保留 `has_real_failure_marker`
   守卫，使真实失败仍照常阻断。
2. Gate 1 增加 rc=2 分支，显式打印 `SKIPPED - ... (csharp toolchain could not execute — NOT a pass)`。
3. `pre-commit` 的 `_detect_ext_lang` 增加 `.cs`/`.csx` 臂——否则 `PROJECT_LANGS` 里
   根本没有 `csharp` 项，适配器再正确也无从被解析到。

第 3 条是第一轮评审 CI-03 指出的矛盾点的答案：问题的根源不是"要不要重构 `_detect_ext_lang`"，
而是"它按扩展名探测，所以 `.cs` 得被列进去"。

## 6. 明确不做（各有跟踪 issue）

| 项 | 理由 |
|---|---|
| `LANGUAGE_REGISTRY` 的 csharp 条目 | 驱动 doctor/init/install-tools，另一条链路 |
| `.github/workflows/quality-gates.yml` 同步 | 已知差异，见 §4 |
| 修复 `dotnet test` 环境故障本身 | 宿主环境问题，非仓库缺陷 |

---

## 7. Rollback

The whole change lives on `sprint/2026-11-03-02` in an isolated worktree and is
not merged to main, so abandoning it costs two commands and touches nothing in
the active sprint's tree:

```bash
git worktree remove .worktrees/sprint-20261103-csharp --force
git branch -D sprint/2026-11-03-02
```

Partial rollback is per-file, and the six pieces are independent -- each is
pinned by its own tests, so reverting one turns exactly that test red:

| Change | Revert | Blast radius |
|---|---|---|
| `pre-commit` `.cs` collection arm | drop the `_detect_ext_lang "cs" "csx"` block | csharp adapter becomes unreachable; other languages unaffected |
| `pre-commit` Gate 1 rc=2 branch | drop the if-block | back to "any non-zero -> SKIPPED"; other languages unaffected |
| `lib/test-failure.sh` dotnet arm | drop the `Win32Exception` branch | dotnet testhost crash is misread as a test failure again; **vitest behaviour unchanged** (AC-717-09b) |
| `gate-3.sh` / `gate-4.sh` `cs` | remove `cs` from the alternation | .cs no longer enters Gate 3/4 population |
| `adapter-common.sh` C# arms | drop the hoisted `has_dotnet_manifest` arm | back to C# being shadowed by shell/typescript |
| `csharp.sh` | delete the file | `resolve_adapter_path` misses -> back to "no specific checks" |

The shared file (`lib/test-failure.sh`) is the only cross-language risk. It is
observed three ways: AC-717-09b's three assertions, the untouched
`gate-5-runner-error.test.bats` suite, and `xp-gate audit --tail` (gate-5
verdict/detail) plus `xp-gate retro` (first-pass rate) afterwards.

Mirrors (`src/npm-package/**`) must never be hand-reverted on one side: the
`diff` assertions in AC-717-05/06/08 fail on the next run. Repair is always
"re-copy from `githooks/`", never a manual edit.

## 8. Gate 13 C# path

Added on user direction (rather than deferred), because the issue title names
Gate 13 and a gate a language can never reach is the "silently skipped" defect
#717 removes.

`gate13_run_csharp_analysis()` joins the worst-of reduction in
`pre-commit`'s Gate 13 block. Without that call the function would exist and
never run -- the same defect one level up.

Verdicts follow the file's own contract (0 PASS / 1 FAIL / 2 BLOCK / 3 WARN),
measured: clean project -> 0; warnings in staged files -> 1 on balanced/strict
and 3 on warn-only; no SDK -> 3; `.cs` with no project -> 3; `XP_GATE_DISABLE_13=1` -> 0.

Two defects were found by measurement while building it, and both are the kind
this gate exists to catch:

1. **Incremental builds swallow the warnings.** MSBuild skips compilation when
   its outputs are newer than the sources, and a skipped compile emits no
   diagnostics. The same tree reported 2 warnings from a clean build and 0 from
   the immediately following incremental one. Fixed with `--no-incremental`;
   without it the gate would only ever work on a first run and then stay silent.
2. **Bare `dotnet build` cannot find a project in a subdirectory.** It dies with
   `MSB1003 请指定项目或解决方案文件` and produces no diagnostics at all, which
   is why an early version reported 0 for a project with two warnings.
   `gate13_csharp_entry_point()` resolves the `.sln`/`.??proj` explicitly.

The counting rule is "distinct STAGED files carrying diagnostics", not total
diagnostic instances: `dotnet build` reports the whole project, so counting
everything would make a one-line change inherit the project's back-catalog and
block on work the author never touched.

## 9. Which gates can actually REJECT a C# commit

"Covered" and "can block" are different properties, and conflating them is how a
gate that only prints gets mistaken for a gate that enforces. This is the
blocking matrix, read from the code paths rather than assumed:

| Gate | Can it reject a C# commit? | Mechanism |
|---|---|---|
| 1 Code Quality | **No** | Generic adapter branch prints `SKIPPED`/`PASSED` and falls through (`pre-commit:2278-2284`). It never `exit`s. Its job is to report honestly, not to reject. |
| 3 Complexity | **Yes** | `gate-3.sh:262` / `:303` `exit 1` on CCN over threshold. |
| 4 Principles | **Yes** | `gate-4.sh:219` `exit 1` when ERROR count > 0. |
| 5 Tests + Coverage | **Yes** | Non-TS branch blocks on any non-zero `run_tests` (`pre-commit:3212-3224`); a genuine C# test failure therefore blocks, while a testhost startup fault is excused via `handle_test_failure`. |
| 9 SAST | **Yes (semgrep verdicts)** | Blocks on ERROR/CRITICAL/HIGH severity per the #518 JSON verdict rules. |
| 13 Compiler strictness | **Yes** | `pre-commit:5102-5106` blocks when `GATE_13_STATUS` is FAIL or BLOCK. |

So a C# project is genuinely enforced: four independent gates (3, 4, 5, 13)
plus SAST can each stop a commit. Gate 1's non-blocking behaviour is the
repository-wide convention for the generic adapter branch, not something C#
introduced, and AC-717-15 pins it so the log can never claim a pass it did not
measure.

## 10. Onboarding limitation (LANGUAGE_REGISTRY)

`src/npm-package/lib/language-tools.js`'s `LANGUAGE_REGISTRY` has no `csharp`
entry, so `xp-gate check-tools`, `install-tools`, `doctor` and `init` do not
report or install the .NET toolchain. **A user onboarding a C# project through
the standard CLI flow gets no C# toolchain guidance.**

This is the one part of the request that is not solved, and it is tracked as a
follow-up issue rather than hidden. What still works without it: the hooks
themselves detect and gate C# files (that is this sprint), so a user who already
has the .NET SDK installed gets full gating. What does not: the CLI will not
tell them it is missing.

Stated plainly in `docs/CAPABILITIES.md` terms: C# is **hook-level supported**,
not **CLI-level onboarded**.

## 11. CI parity (.github/workflows/quality-gates.yml)

R2 round 1 (arch CI-01/CI-02, feas FC-01) found the sharpest defect in the whole
change, and it was mine: the local pre-commit gated `.cs` while the CI workflow
had **no csharp arm at all**. A developer would pass locally and CI would never
look -- worse than not supporting C# anywhere, because green then means
"nothing checked it".

Two things were wrong there:

1. **No `csharp` in the language-detection chain.** Fixed by adding a manifest
   check (`.sln`/`.csproj`/`.fsproj`/`.vbproj`, depth 1 only).
2. **The position mattered as much as the presence.** The chain checks
   `*.ps1` and `*.sh` before the extension fallbacks, and a .NET solution very
   often ships a `build.ps1` or `bootstrap.sh` -- so a C# repo was classified
   `powershell`/`shell` and its C# gate genuinely never ran. The new arm is
   placed **before** those, and AC-717-22 asserts the ordering rather than just
   the string's presence.

A `csharp` Gate 1 branch was added running `dotnet format --verify-no-changes`,
which blocks on violations and warns (not blocks) when the SDK is absent --
the repository convention for every language, with Gate 8 the documented
fail-closed exception.

Contract tests: `githooks/__tests__/issue-717-ci-parity.test.bats` (6 assertions,
AC-717-22), including the ordering check and a tab-indentation guard.

**Honest limit:** this makes the CI *workflow* consistent with the hooks. It does
not add a .NET SDK install step to CI, so on a runner without dotnet the C#
branch warns and skips. Adding `actions/setup-dotnet` is a separate decision with
its own cost, tracked rather than smuggled in here.
