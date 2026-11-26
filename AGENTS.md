# PROJECT KNOWLEDGE BASE

**Updated:** 2026-11-17

## WHY THIS FILE LOOKS DIFFERENT

This file used to carry gate tables, CLI command lists, line counts, adapter
counts, directory trees and test-suite totals. All of it was **true when
written and false within weeks** — measured: the `pre-commit` line count went
from 6168 to 1166 in a single commit (#798), the adapter directory changed 94
times in 90 days, and this file itself changed 81 times in 30 days, making it the
fourth most-churned file in the repo it was supposed to describe.

Worse, hand-copying generated facts created **competing sources of truth**. For
"how many languages does Gate 4 cover", three sources disagreed at once:
`gate-list`'s hardcoded prose said 9, `src/principles/adapters/` held 14, and the
docs said 14. Only one can be maintained; the other two are debt.

So the rule is now:

> **If a command can answer it, this file does not state it.**
> **If only a human can know it — intent, constraint, scar tissue — it is here.**

Everything quantitative lives in the code and is reachable through the commands
listed below. Nothing here should need updating when a gate is added, a file is
split, or a count changes.

---

## XP-GATE IN ONE PARAGRAPH

Deterministic git quality gates, AI-driven multi-expert review (Delphi), a
6-phase Sprint Flow pipeline, npm zero-install distribution, and cross-platform
plugins (Claude Code / OpenCode / Qoder / DSH). Gates run on commit and on push;
each is only as valuable as its ability to say "not checked" honestly, which is
the single theme most of this file's warnings come back to.

## WHERE TO LOOK — ASK THE TOOL, NOT THIS FILE

| You want to know | Run |
|---|---|
| Every gate, its name, aliases, what runs it | `xp-gate gate-list` |
| **All** gates incl. push-only, and whether each can run standalone | `xp-gate gate-capability` |
| The thresholds that can block you, with evidence pointers | `xp-gate gate-rules` |
| Which gate is NAME ↔ which FILE decides it | `githooks/gate-registry.sh` (the authority) |
| Execution order | `XP_GATE_ORDER` in `githooks/gate-driver.sh` |
| Compliance per gate (PASS / DEBT / SKIP / FAIL) | `xp-gate gate-coverage` |
| Languages detected and which tools are present | `xp-gate detect-languages` |
| Which hooks actually execute, and drift direction | `xp-gate doctor` |
| All CLI subcommands | `xp-gate --help` |
| What the last runs did | `xp-gate audit --tail` / `xp-gate rework` |
| Whether the plugin bundles agree | `node scripts/test-plugins.mjs` — the cross-platform twin; no `.sh` variant exists (#486) |

**`gate-list` omits push-only gates** — use `gate-capability` for the full set.

## ARCHITECTURE INTENT — THE PARTS THAT CANNOT BE RE-DERIVED

### Order is data, never layout (#798)

Gate bodies live in `githooks/gate-entries/gate-<KEY>-entry.sh`, one file each,
wrapped in `gate_<KEY>_run()`. Their order is the `XP_GATE_ORDER` list.

**To reorder gates, edit that list. Do not move code.**

Why this is not negotiable: the order used to BE the physical order of inline
blocks in a 6341-line file. A reorder attempt also moved the hook's epilogue,
after which *every gate past it silently stopped running* — while `bash -n`
passed, the line count looked right, and five ordering tests stayed green. Gate
5a stopped blocking commits and only a behavioural fingerprint noticed
(`scripts/record-hook-behaviour.cjs`). **A structural test cannot prove a gate
still runs; only behaviour can.**

### Gate bodies `return`; they do not `exit`

The driver converts a non-zero return into the hook's exit status, so the EXIT
trap still fires on the same status. A top-level `exit` inside a `gate_N_run()`
body bypasses the driver's single exit point. Sub-shell exits (`( ... )`,
`$( ... )`) are deliberately left as `exit` — do not "fix" those.

### SKIP must be recorded, not merely printed

A gate that cannot run must set `GATE_N_STATUS="SKIP"` **and** write an audit
line. The recurring failure in this codebase is prose saying "SKIPPED" while the
status variable keeps its pre-gate value and the journal records a pass — or
records nothing, leaving the gate indistinguishable from one the chain does not
contain.

This is the most repeated defect family here (#806 D2, G1a ×4, G11a, G12a). The
principle behind all of them: **"not checked" must never be indistinguishable
from "passed"**, in either direction — machine or human. When a gate cannot
evaluate something, say so with a reason, and never let the absence of a verdict
score as a positive one.

The corollary matters when reading results: a green `gate-coverage` row with no
reason attached is a bug, not a pass. SKIP must always carry why.

### Some things are declarations, never name lists

When behaviour depends on a language's capabilities, the **adapter declares it**
(e.g. `coverage_runs_tests() { return 0; }` when its coverage step already runs
the suite); the hook never asks "is this language X". Hand-maintained language
lists drift and always miss the next adapter — that mistake was patched twice
(#794). **The default must be the safe side**: an adapter that does not declare
its extra capabilities gets the conservative treatment (double-checking costs
time; not checking costs verification).

The same reasoning drives Gate 1's duplicate-analysis detection: it compares the
two function *definitions* rather than naming languages, because a list of names
can only ever cover what someone remembered.

### One clock, and never fabricate a duration

Duration fields come from `githooks/lib/now-ms.sh` only. A second millisecond
clock, or an `|| 0` fallback on a failed measurement, produces numbers that look
real and are wrong — and every future optimisation decision inherits them. When a
duration cannot be measured it is omitted, never zeroed: **"instant" and "not
measured" must not look alike.**

### A gate must never wait on the network

Probing for a tool by running `npx --yes <tool> --version` *installs what it was
asked to detect* — it changes the environment it is measuring. Off by default
(`XP_GATE_NPX_PROBE=1` to enable). Likewise `record_gate_audit` must resolve a
local binary only: a network fallback per gate once cost 180 s per blocked commit.

### Input short-circuit before tool probe

Ask "is there anything here to check?" (cheap, from the change set) before "is
the tool installed?" (expensive). **Every short-circuit ships with a
"must NOT be short-circuited" test** — a predicate written against the *project*
instead of the *change set* silently turns "checked" into "checked nothing".

## TRAPS — THINGS THAT LOOK FINE AND ARE NOT

**`core.hooksPath` means your edit may have no effect.** With a global install,
git runs `~/.config/xp-gate/hooks/`, not `githooks/`. Editing here changes
nothing until you sync (`xp-gate doctor --sync-hooks`). This was all of #451 and
it reads as "my edit does nothing".

**Stale adapters override fresh ones.** `githooks/adapters/*.sh` resolve through
a 3-tier chain, so an old `~/.config/xp-gate/adapters/<lang>.sh` wins over the
tracked file. Measured once: a stale 77-line Kotlin adapter reported "Gradle
compilation failed" while the tracked version printed two real findings. **An
adapter is stale until proven otherwise — `md5sum` both copies before believing a
hook-vs-direct-call difference.** CI has no global copy, so if CI disagrees with
local, suspect the local install first.

**`githooks/adapters/` holds two unrelated kinds of file.** Language adapters and
gate scripts (`gate-3.sh`, `gate-10.sh`, …) share one directory and one mirror,
so they travel and drift together. Read the name, not the location.

**Mirror edits get silently reverted.** `githooks/**` and `plugins/*/src/**` are
canonical; `src/npm-package/**` holds byte-identical mirrors regenerated at
prepack. Editing only the mirror means the next publish rolls your change back —
that shipped as a real bug once. Edit canonical, then resync.

**Duplicate analyses hide in plain sight.** Some adapters define
`run_lint() { run_static_analysis; }`, so a gate that runs both does the identical
work twice and prints identical findings twice. Measured at ~30% of one gate's
runtime.

**Never probe across environments.** Windows is the whole development loop; every
gate tool is installed natively. WSL changes `$HOME`, the interpreter and file
visibility at once and produced a false product-defect diagnosis that survived
several rounds. When a probe and reality differ, you are measuring the
difference, not the product.

## CONVENTIONS

- **No `--no-verify`, ever.** Process violation per
  `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md`.
- **Tool missing → SKIP, not BLOCK — except secret scanning**, which is
  fail-closed: a security gate that cannot run must not report success.
- **VERSION is the single source of truth**; manifests are generated from it and
  drift is blocked. Never hand-edit a version field.
- **Adapters and hooks are edited canonically, then resynced.** Both directions
  are guarded by `xp-gate sync-mirrors` (dry-run by default; `--write` to repair).
- **Tests carry mandatory annotations**: `@test REQ-XXX`, `@intent`, `@covers`.
- **TypeScript strict, always** — no `as any`, `@ts-ignore`, `@ts-expect-error`,
  empty `catch`, or `print()`.
- **TDD mandatory**: RED → GREEN → REFACTOR. The failing test comes first.
- **Verify in-session and record it.** An unverified change is invisible to the
  traceability chain.
- **Three gates skip on main/master pushes by design** (pre-reviewed via PR).
  That is intentional; do not "fix" it.

## PUSH RHYTHM — the walkthrough gate makes batching expensive

Gate MW (code walkthrough) is the one gate whose cost GROWS with how long you
wait, and its shape is easy to work against without noticing:

- **The evidence names the commit the review saw.** It must be that commit or an
  ANCESTOR of HEAD — never an unrelated one.
- **It expires in one hour.** Review, then push; a review that sits overnight is
  worthless.
- **A review's input budget is 40 KB per expert** — roughly two source files.

Measured 2026-11-26, on a branch that had never been pushed: **223 files,
26 713 changed lines, 300+ commits**. At 40 KB per review that is ~27 reviews
minimum, and the first push could not be performed at all. Three branches were
sitting in that state.

**So: push at least once per work session.** Concretely:

- Push after a coherent unit (one gate change, one refactor with green tests),
  not after a day of work.
- A branch that has never been pushed is the WORST case, not the safest: its
  first push must review everything on it at once. `git log @{u}..HEAD` failing
  with "no upstream configured" is the warning sign.
- If a review is rejected and you commit fixes, push promptly — each new commit
  on top would otherwise need its own review before the one you have can be used.

This is not a rule about discipline for its own sake. Batching genuinely costs
MORE here: 27 reviews for one push of a large branch, versus one review per push
when each push is small. **Small pushes are the cheaper option, and the gate is
built to say so.**

## MEASUREMENT DISCIPLINE

This machine runs at 90–100% CPU, so noise routinely exceeds the effect being
measured. Each rule below corresponds to a real wrong conclusion:

1. **Read the call contract before designing the measurement.** A wrong call
   method yields numbers unrelated to real performance — the more plausible the
   better.
2. **Prefer the subject's own tooling.** A hand-written baseline is lighter than
   the real implementation and UNDERSTATES the gain.
3. **Use real-time occupancy, not accumulated CPU seconds.**
4. **Attribute with multiple samples.** One snapshot is not a parent-child fact.
5. **A-B-A is not enough — use ABBA and record per-arm load.** A monotonic
   A→B→A is a time trend, not a treatment effect.
6. **Wait for load to drop, and report it.** Comparisons whose per-arm load
   differs by >5% are invalid.

**Prefer "not measurable" over a confidently wrong direction.** A wrong
conclusion is worse than none: it drives decisions — disabling security software,
abandoning a working optimisation — on a false premise.

## AGENT RUNTIME DISCIPLINE — 工具调用效率（P2, 2026-10-30 诊断）

> 依据 `docs/plans/2026-10-30-dev-speed-diagnosis.md`：正确计入的 251.7 h 中，工具延迟占
> 146.0 h（58%），远高于模型延迟 105.7 h（42%）。三条规则直接压的是这块。

**规则 1 — 读/搜一律用原生工具，shell 只用于“执行”**
- 读文件用 `read`，按路径找文件用 `glob`，搜内容用 `grep`。**禁止** `cat`/`Get-Content`/
  `type`/`head`/`tail`/`sed -n`/`Select-String`/`findstr`/`grep`/`rg`/`Get-ChildItem`/
  `find`/`ls` 去读取或搜索内容——这些会各起一个 pwsh/bash 进程，单次往返 10–30 s，
  而原生工具是毫秒级且可并行。shell 只留给真正的执行（构建、测试、git、脚本）。
- 现状（2026-11-02 复测，最近 3 天）：纯读取/搜索的 shell 调用已从 32.7% 降到 ~0.2%。
  目标 <5%（已达成，保持）。

**规则 2 — 独立调用必须同一步并发**
- 任何 ≥2 个**互不依赖**的调用，必须放进同一个 assistant 消息里并发发出，不得一个一个发。
  工具契约已支持同一 block 内多个 `invoke`。串行只在有数据依赖时才允许。
- **判据：发下一条消息前自查「这一批里有没有 2 个调用互不依赖？有就并进去」。**
- 典型该并发的清单（这张表就是为了免去判断）：
  - 读多个已知路径的文件；`grep` + `glob` + `read` 组合摸底
  - 多个互不相干的 `git` 查询（`status` / `log` / `diff` / `config`）
  - 检查多个环境事实（版本、路径、端口、开关）
  - 写完后并行跑**互不依赖**的校验（`lint` ∥ `tsc` ∥ 定向测试）
  - 查多个不同目录/多个候选位置
- **不能并发的**：后一个调用的参数依赖前一个的输出（先 `rev-parse` 再 `git show <sha>`）；
  有写冲突的操作（同一文件、同一 git 索引）。
- 现状（2026-11-02 复测，最近 3 天）：calls/step=**1.086**，仅 **5.1%**（283/5528）
  的步骤做到批量。目标 calls/step **≥2.0**。按 2.0 折算约可省 **2764 次**往返，
  是四条规则里**最大**的一笔未兑现收益。

**规则 3 — 后台任务用完成通知，禁止阻塞轮询**
- 长任务用 `run_in_background` 起 job，收到完成通知再取结果；**禁止** `job_output`
  设 `wait:true` 反复阻塞等待，也禁止 `sleep` 轮询。需要结果时再用短超时取一次。
- 现状（2026-11-02 复测，最近 3 天）：`job_output` 阻塞 >30 s **96 次 / 8.9 h**，其中
  **显式 `wait:true` 103 次**；字面 `sleep` 166 次 / 6.9 h；CI 轮询 236 次 / 4.9 h。
  这三项合计约占工具忙碌时长的 **22–27%**，是当前**最大**的可回收项。
- 目标：阻塞式 `job_output`（>30 s）与字面 `sleep` 各自下降 **≥50%**。

> **实测入口（规则 1–3 的唯一可信来源）**
> ```bash
> xp-gate runtime-journal --days 3          # 一屏摘要
> xp-gate runtime-journal --days 3 --json   # 机器可读，可做 A/B
> ```
> 该命令直接读 agent 会话日志，永远 exit 0（是诊断不是门禁）。**任何“规则已生效”的
> 结论必须以它的数字为准，而不是以规则是否存在为准**——2026-11-02 的复核就发现：
> 规则 1 生效（纯读取 shell 32.7% → 0.2%），而规则 2/3 几乎没有执行。

**规则 4 — 契约先测（发布流水线类改动）**
- 触及打包/发布/插件产物的改动，先写集成/契约测试（范式见 `plugins/dsh/src/contract.test.ts`），
  让“`npm pack --json` 被 stdout 污染”这类问题在本地就红，而不是等发布 CI 用 `jq` 语法错误才发现
  （0.32.2 的 dsh 插件正是这样漏发的）。
- 现状（2026-11-02）：本规则**没有时间型指标**——它的产物是「发布前就红」，不是「更快」。
  该有的度量是缺陷逃逸次数：0.32.2 的 dsh 插件 1 次漏发（契约测试引入前）。
- 目标：触及打包/发布的改动，契约测试先于实现提交；漏发次数保持 **0**。
  验证方式不是 `runtime-journal`（它只测工具调用效率），而是发布前
  `npm pack --json` + 契约测试是否真的跑过。

## WHEN YOU CHANGE SOMETHING

- Reordering gates → edit `XP_GATE_ORDER`.
- Adding a gate → a registry row in `githooks/gate-registry.sh` is what makes it
  real; prose elsewhere does not.
- Changing a hook → check `xp-gate doctor` afterwards, or you may have changed
  nothing.
- Changing a gate's verdict logic → the pinning test is the deliverable. Prove it
  goes red without the fix; "it passes now" is not evidence.
- **This file needs no update for any of the above** — only when you learn a new
  invariant, trap or measurement lesson worth passing on.