# TODO — 测试套件提速：主文档未覆盖的待办

**写于**：2026-11-23
**基线**：`main @ 1170c3dd`，`VERSION 0.38.125.0`
**定位**：`TODO-WSL-MIGRATION-HANDOVER.md` 的**补充**，不是替代品。

> 主文档已经覆盖：环境准备、分支状态、open issue 分簇、覆盖率棘轮、CI 红灯、
> gate-10/12/5 的长尾优化。**本文只写它没有的三件事**，全部来自
> 2026-11-16～11-23 的测试提速线（`XP_GATE_ONLY_GATE` + 镜像检查）。
>
> 本文不推送、不提交——由主控任务统一处理。

---

## 已完成（供主控核对，不重复主文档 §6.1）

| 提交 | 内容 | 受控测量 |
|---|---|---|
| `403facab` | Gate 7 checkov 同框架合批 | 104.6 s → 50.4 s（300 检查 == 300） |
| `189ae8d7`（原 `445ef110`） | 镜像检查：57 次 `cmp` → 1 次 `diff -rq` | 微基准 9094 ms → 242 ms **（主收益未生效，见 T1）** |
| `3bf9aa53`（原 `89097ab4`） | 补齐 10 个门禁的 `XP_GATE_ONLY_GATE` | 单钩子 38.3 s → 12.2 s |

`githooks/__tests__/a2-only-gate-selection.test.bats` 当前 **13/13 全绿**（今日复验）。

> 说明：`XP_GATE_ONLY_GATE` 原先只对 Gate 0–5 实现，Gate 6–13 完全忽略它，
> 而钩子横幅却承诺「未选中的门禁记为 SKIP/not_selected」。修复后横幅与行为一致。
> 这条值得记住是因为它踩的正是本项目最反复的缺陷族：**"未检查" 与 "已通过" 不可混淆**。

---

## T1 ⚠️ 最高优先级｜镜像检查的快速路径**从未对 40 个文件生效**

### 缺陷

`scripts/check-hook-mirror.sh` 里两处用了**不同的键**：

```bash
# L160  preload_diff_root：登记在「根目录」上
DIFF_ROOT_LOADED["$canonical_root"]=1

# L172  compare_pair：却按「文件所在目录」查
if [ -n "${DIFF_ROOT_LOADED[$(dirname "$canonical")]:-}" ]; then
```

`canonical_root` 是 `githooks`，而 `dirname githooks/gate-entries/gate-6-entry.sh`
是 `githooks/gate-entries` —— **永不相等，于是退回 `cmp` 逐文件 spawn**。

只有根级文件（`githooks/pre-commit`，`dirname` 恰为 `githooks`）能命中。

### 证据（不依赖 CPU 负载，可直接复现）

```bash
# 1. 文件分布
$ node -e "…解析 HOOK_MIRROR_FILES…"
HOOK_MIRROR_FILES: 59 | 含子目录: 40 | 根级: 19

# 2. 在脚本副本里给 L175 的 cmp 那行加计数器后实测
cmp 回退调用次数: 40        # 恰等于子目录文件数
```

**结论：当初「57 次 cmp 变成 1 次 diff」的说法不准确——只覆盖了 19 个根级文件，
40 个子目录文件仍在逐对启动进程。** 本机单次 `cmp` 约 111 ms，
**每次脚本运行约 4.4 s 直接损失**。

### 修法（二选一）

- **A（推荐）**：`compare_pair` 判断时沿路径**逐级向上**查找已预载的根。
- **B**：`preload_diff_root` 时把该根下**所有子目录**都登记进 `DIFF_ROOT_LOADED`。

### 验证方式（关键）

**断言调用次数，不要断言耗时。** 沿用本次的插桩手法，断言修复后
「子目录文件的 `cmp` 回退次数从 40 降到 0」。

**绝不要在测试里写 wall-clock 断言** —— 同一夹具在几分钟内测到过 6.6 s 与 12.3 s。

### 收益

每次 `check-hook-mirror.sh` 省 4–5 s × 被 12 个用例各调一次 ≈ **每个测试文件省 45–60 s**；
pre-commit 的 Gate 12b 每次提交也省同样时间。

### 风险

低。改动局限一个函数，`githooks/__tests__/gate-12-vendor-exclusion.test.cjs`、
`hook-mirror-parity.test.cjs` 现有用例可保护。

---

## T2 ｜ `hook-mirror-parity.test.cjs` 用例合并

**现状**：`scripts/__tests__/hook-mirror-parity.test.cjs`（169 行）是 3 个 `it()`
+ 1 个 `it.each([...8 项])`，合计约 12 个用例。**每个用例都完整跑一遍
`check-hook-mirror.sh`**（要在临时夹具里重建整棵镜像树）。

| 项目 | 2026-11-15 基线 | 现在 |
|---|---:|---:|
| `check-hook-mirror.sh` 单次（低负载） | ~36 s | 31 s |
| `hook-mirror-parity.test.cjs` 整体 | 98 s | **约 262 s** |

脚本本身**没有变慢**（31 s < 36 s），纯是测试规模从 3 个用例膨胀到 12 个。

**修法**：8 个 `it.each` 拒绝用例共享**一次**脚本运行，各自只断言自己那部分输出；
或改用更小的夹具（多数用例只关心 1–2 个文件）。

**目标**：262 s → 60 s 以内。**前置依赖 T1**，否则 12 × 4.4 s 的浪费会掩盖合并收益。

---

## T3 ｜ `gate-5-runner-error.test.ts` 待复测归因

我修完后实测 60–70 s，迁走前最后一次测得 **95 s**。**尚未归因**，两种可能：

1. 主干新增门禁/检查，单次钩子本身变慢；
2. 测量窗口的并发负载不同（当时确有别的任务在跑）。

**先测量再判断，不要先改代码。** 用 `XP_GATE_ONLY_GATE=5` 配合非保护分支测单次钩子，
可直接区分这两种可能。

---

## T4 ｜ 两个产品命令的 issue（与测试套件耗时分开排期）

- **#804** `crap-cli.js` 在 coverage 缺失时先扫全源码树再报错（首次提示等 10–36 s）
- **#805** `install.sh` 单次 17–20 s（82 次逐文件 `cp`/`chmod` × 106 ms 进程创建）

两者仍 **OPEN**。#805 与门禁拆分强耦合，详见
`docs/plans/2026-11-11-test-perf-handoff-to-gate-split.md`。

> 注意：这是**产品命令**耗时，不会体现在 `vitest run` 总时长里，
> 不应与 T1/T2 混在一起估算收益。

---

## 迁移到 WSL 后：T1/T2 的优先级可能要下调

主文档 §6.3 已说「先测 WSL 全量 vitest」。这里补一条**判断依据**：

T1/T2 的收益**全部来自「减少进程创建次数」**，前提是「进程创建约 100–180 ms」
（本机实测：`bash -c true` 106 ms、`cmp -s` 111–160 ms、`git config` 179 ms）。

**WSL 原生 ext4 上这个数字通常低一个数量级。** 所以：

- 若 WSL 上进程创建降到 10–20 ms → T1 的 4.4 s 会缩成 0.4–0.9 s，**优先级下调**；
- 若仍在 100 ms 量级（例如仓库放在了 `/mnt/c/`）→ T1 保持最高优先级；
- 但 T2 的「12 次重复跑脚本」问题**与平台无关**，仍值得做。

先测这两行，再决定投入：

```bash
time (for i in $(seq 100); do bash -c true; done)      # 进程创建基线
time bash scripts/check-hook-mirror.sh                 # 单次脚本成本
```

---

## 历史事故一条（避免重犯）

我曾为通过 Gate 12b 镜像检查，用**目录级 pathspec** 提交：
`git commit -- githooks/gate-entries/ src/npm-package/hooks/gate-entries/`。
`git commit <pathspec>` 取的是该路径下**所有文件的 working tree 内容**，
于是把并发任务未完成的 #821 改动一并卷进了我的提交。

**教训：提交时逐个列出文件名，不要用目录 pathspec。**
最终由该任务自己的 `2c58fd26` 承接完善，无遗留损害，但当时消耗大量时间在索引锁争抢上。

**另一条**：那个时段另一个 agent 会话在持续提交，我连续 5 次尝试都遇到
`index.lock` 被占或索引被重置（表现为 `No files changed`）。
**先探测对方是否在写**（`git status` 变更数是否增长、有无 `git commit` 进程），
等它收尾再动索引；**绝不** `rm .git/index.lock` 强删。

---

## 待主控处理

- [ ] 本文档未提交，未推送 —— 由主控任务统一 `git add` / `commit`
- [ ] 若采纳 T1，建议单独一个 commit（`fix(mirror)`），与文档改动分开
      （`docs/AGENTS.md`：不要把代码与文档混在一个提交里）
