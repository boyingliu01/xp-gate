# 测试内 Git / Bash 调用合并方案（候选清单）

**日期**：2026-11-11
**范围**：仅测试代码，只做**文件内**的子进程调用合并。
**硬约束**：**不做跨门禁合并** —— 每个候选都标注了归属门禁，方案只在该门禁内部减少重复调用。

---

## 0. 先说结论

真正的合并空间比预期小得多。原因有两个已查明的事实：

1. **大头已经被优化过**。`gate-runner.test.js`（38.3 s）里已经用模板复制替代了每用例 5 次 git，
   注释写明"约 700 ms 纯进程启动"。同类手法在 `delphi-runner-mirror`（我上一轮做的）也用过了。
2. **多数重复调用不是重复劳动**。测试里同一文件的多次 `bash -c` / node CLI 调用，
   参数或断言各不相同，合并会削弱测试意图——那不是优化，是降低覆盖率。

**可安全合并的只有 4 项，合计约 11–12 s。** 下面按可合并程度分三类。

---

## A 类：确定可合并（行为完全不变）

### A1. `ccn-report.test.cjs` — lizard 探测重复 3 次

| 项 | 值 |
|---|---|
| 归属门禁 | **Gate 3 复杂度（CCN）** |
| 现状 | 文件顶部第 29 行已有 `LIZARD_PRESENT` 常量；但第 486、512 行又各自 `spawnSync('lizard', ['--version'])` 一次 |
| 浪费 | 2 × 554 ms ≈ **1.1 s**（`lizard --version` 实测 465–617 ms） |
| 合并方式 | 两处复用已有的 `LIZARD_PRESENT`；`if (probe.status !== 0) return;` 改为 `if (!LIZARD_PRESENT) return;` |
| 风险 | 极低。探测的是"lizard 是否安装"，运行中不会改变 |
| 文件耗时 | 11.3 s |

> 注意：这个文件的 `@intent` 明确要求"每文件调用一次 lizard（批量模式会失真 CCN span）"。
> **本项只合并"是否存在"的探测，绝不合并真正的 lizard 测量调用。**

### A2. `ccn-baseline-analyzer-version.test.cjs` — 同一探测走了两个函数

| 项 | 值 |
|---|---|
| 归属门禁 | **Gate 3 复杂度（CCN）** |
| 现状 | `hasLizard()` 和 `currentLizardVersion()` 各自 `spawnSync('lizard', ['--version'])`；第 90、91 行连续调用两次 |
| 浪费 | 1 × 554 ms ≈ **0.55 s** |
| 合并方式 | `currentLizardVersion()` 返回 null 即等价于 `hasLizard()===false`；改为先取 version，再由它同时导出"是否可用" |
| 风险 | 低。两个函数探测的是同一件事 |
| 文件耗时 | 7.7 s |

### A3. `mirror-sync.test.js` — 17 个用例各自重建 git 仓库

| 项 | 值 |
|---|---|
| 归属门禁 | **REQ-713 镜像一致性**（独立于编译/扫描） |
| 现状 | `beforeEach` 跑 `git init` + 2 次 `git config`，17 个 `it` 各一遍 |
| 浪费 | 17 × 3 次 git × 179 ms ≈ **9.1 s**（`git config` 实测 164–198 ms） |
| 合并方式 | 与 `delphi-runner-mirror` 相同：`beforeAll` 建一次模板，`beforeEach` 用 `fs.cpSync` 复制（实测约 100 ms/次） |
| 风险 | 低，但**需逐例确认 fixture 是否被就地修改**——若某用例写文件后依赖"下个用例是干净的"，模板复制恰好满足；已在上个文件验证过该模式 |
| 文件耗时 | 13.0 s（预计降到约 6–7 s） |

### A4. `gate-8-staged-scan.test.cjs` — 两次扫描共用同一 fixture 内容

| 项 | 值 |
|---|---|
| 归属门禁 | **Gate 8 密钥扫描**（唯一的门禁，不涉及其它） |
| 现状 | `scanWith()` 被调用 2 次（`--staged` 与 `--pre-commit`），每次都从零建 git 仓库（4 次 git + 写文件） |
| 浪费 | 4 次 git × 179 ms ≈ **0.7 s** |
| 合并方式 | 建一次含已暂存密钥的仓库，两次扫描复用（两次的**扫描参数不同**，这正是要对照的东西，保留） |
| 风险 | 中低。要确认 gitleaks 扫描不修改仓库状态；且两次调用之间不能有别的用例改动 fixture |
| 文件耗时 | 6.5 s |

**A 类合计可省约 11.4 s。**

---

## B 类：不建议合并（有空间但会损害测试意图）

| 文件 | 耗时 | 为什么不合并 |
|---|---:|---|
| `gate-runner.test.js` | 38.3 s | 前 4 个用例各 6–9 s，都是**通过公共 CLI 跑真实 gate 脚本**的端到端验证。每次调用的是一个**不同的行为契约**（不同的 gate、不同的失败路径）。合并=不再验证各路径独立可用 |
| `pre-push-resolution.test.cjs` | 4.2 s | 每个 `bash -c` 断言的是不同的 resolver 行为（tier 顺序、反例、schema）。已经是 4 次最小值 |
| `resolve-upgrade-equivalence.test.cjs` | 4.5 s | 断言"升级路径 vs 全新安装路径逐项相等"，两次 bash 是对照组的两端，合并后就没有对照了 |
| `check-single-file.test.js` | 6.0 s | 2 次 node 调用测的是两种错误路径 |

**共同点**：这些文件的多次调用**不是重复劳动**，而是"同一能力的不同切面"。这类合并会让测试变快但变得不可信。

---

## C 类：已被优化过（无需再动）

| 文件 | 现状 |
|---|---|
| `gate-runner.test.js`（fixture 部分） | 已用 `gitProjectTemplate()` + `fs.cpSync`，注释记录"5 次 git ≈ 700 ms" |
| `delphi-runner-mirror.test.cjs` | 上一轮已改为模板复制，19.7 s → 17.8 s |
| `sync-package-content.test.js` | 已过滤 `plugins/` 下 6,762 个 `node_modules`（省 37 s） |
| `baseline-prune.test.ts` | 已用批量 `git update-index`（注释：逐文件 add 超 50 s → 不到 1 s） |

---

## D. 为什么"合并 git 操作"的上限很低

单次 `git config` 实测 **179 ms**（164–198），单次 `git version` **151 ms**，单次 `bash -c true` **157 ms**。
其中绝大部分是 **Windows 进程创建 + git.exe 自身读索引/查配置**，不是包装层开销。

对比 `dsh-aot-runner` 的场景：它省的是 node runner 这个**中间层**（200–220 ms → 69–76 ms）。
而测试里 `spawnSync('git', ...)` **没有中间层**，直接就是 git.exe——
native 化省不掉 git 本体那 151 ms。

所以有效的方向只有一个：**减少调用次数**，而次数能减少的前提是"这些调用真的重复"。
实测下来，真正重复的只有 A 类这 4 项。

---

## E. 执行记录

### A1 + A2 已完成（2026-11-11）

ABBA 两轮，零波动：

| | Baseline | Fixed |
|---|---:|---:|
| pass 1 | 27 s | 24 s |
| pass 2 | 27 s | 24 s |

**−3 s**。比方案的 1.65 s 估算高，原因是 `lizard --version` 实测
**690–895 ms**（首次测到 554 ms 是冷启动偏快）。实际省了 3 次探测。

用例数改前改后均为 **36 passed / 0 failed / 0 skipped**。

额外验证了 lizard 缺失时的 SKIP 路径（把 PATH 换成不含 lizard 的目录）：
- `ccn-baseline-analyzer-version`：4 tests / **4 skipped** ✅
- `ccn-report`：3 failed / 7 skipped —— **把 baseline 版放回同条件重跑，结果完全一致**，
  说明这 3 个失败是既有问题，不是本次改动引入。

### A3 已完成（2026-11-11）

`mirror-sync.test.js`：`beforeAll` 建一次模板，`beforeEach` 用 `fs.cpSync` 复制。

用**隔离测量**（只测 fixture 本身，跑 10 次取中位）得到可靠数字：

| | 每用例中位 | 全部读数 |
|---|---:|---|
| 改前 `git init` + 2 config | **2625 ms** | 1368–5031 ms |
| 改后 `fs.cpSync` 模板 | **1499 ms** | 890–2190 ms |
| 每用例节省 | **1126 ms** | |
| × 17 用例 | **约 19.1 s** | |

全文件 ABBA（4 轮）方向一致，fixed **4/4 更快**，但因 17 个用例本体各自跑真实
`git add`/`ls-files`，噪声掩盖了幅度（6–36 s）。因此以隔离测量为准。

**附带收益**：改后方差明显收窄（1.4–5.0 s → 0.9–2.2 s）。

安全性验证：
- 17/17 通过，连跑两次均全绿（无状态泄漏）
- 模板 `afterAll` 正确清理，无残留目录
- 该文件**没有任何真实 `git commit`**（唯一 `commit` 出现在注释里），
  因此不需要 `core.hooksPath` 守卫

### A4（决定不做）

`gate-8-staged-scan.test.cjs`，约 0.7 s。收益与风险不匹配，且属 Gate 8（另一个
任务正在拆分门禁的一类），决定不动。

---

## F. 整体回顾后的新发现（2026-11-11 第二轮）

A1–A3 完成后又整体扫了一遍，发现 3 个此前未记录的类别。

### F1. `crap-cli.test.js` —— 已修复，省 32–41 s（本轮最大单项）

`handleCrap()` 在**检查 coverage 是否存在之前**先调 `runLizard(opts.paths)`，
而 `--paths` 默认 `['src']`。于是"coverage 缺失"这个用例实际先扫了整个源码树：

| | 单次 lizard 扫描 | 该用例耗时 | 文件总耗时 |
|---|---:|---:|---:|
| 改前（默认 `--paths src`） | 36.3 s | 32.7 s | 31–50 s |
| 改后（`--paths <空临时目录>`） | 0.9 s | 1.4 s | 8–14 s |

ABBA 两轮：baseline 46 s / 50 s → fixed 14 s / 9 s。

**测试意图完全不变**：该用例只断言 `code === 1` 与错误信息，从不看 lizard 输出。
**生产脚本 `crap-cli.js` 未改动**——执行顺序问题本身留待专门处理。

### F2. `install-sh-deploy-manifest.test.js` —— 无优化空间（48.5 s）

单个用例 `AC-DEPLOY-06d` 占该文件 100% 的时间，它真实执行一次
`githooks/install.sh`。

追查后确认慢在**生产脚本**：install.sh 做 42 次 `cp` + 40 次 `chmod`，而本机
Git Bash (MSYS2) 的 `cp` 实测 **504 ms/次**、`chmod` **527 ms/次**（bash 内建约
210 ms/次）。82 次 × ~515 ms ≈ 42 s，与该脚本单次 81–105 s 的观测一致。

**测试侧无可合并的重复调用**（只调 1 次），且生产脚本按要求不动。

### F3. `bootstrap.test.js` —— 发现 45 s 空间，但决定**不做**

5 个用例各调一次 `bootstrap()`，每次固定触发 8 次 `checkCliTool`（本机 2.5–3.8 s/次，
因 Windows 上它经 `cmd.exe` 起子 shell），合计约 60 s。

缓存检测结果可把总耗时降到 15.4 s（省约 45 s），实测验证过：
第一个用例承担全部 8 次探测，其余 4 个 0 ms。

**但拒绝了这个方案**，原因是它会制造"假绿"：
- 这 5 个用例**都只断言 `code === 0`**，本就很弱
- 缓存后其余 4 个用例不再触发真实检测；若 `bootstrap()` 在某个 flag 下
  跳过检测逻辑，它们依然会绿
- 这与本项目在 `check-mattpocock-license` 里发现的"测试通过但从未执行目标分支"
  是同一类缺陷，不应再引入一个

`bootstrap()` 的参数解析内联在函数体内（无独立 `parseArgs`），因此无法把它
拆成"纯参数测试 + 一次集成测试"。真正的解法是给 `bootstrap()` 抽出可测的
参数解析，属生产代码重构，不在本次范围。

### F4. 已到框架成本下限的文件（无需再动）

| 文件 | 耗时 | 用例数 | 每用例 | 说明 |
|---|---:|---:|---:|---|
| `doctor-delphi.test.js` | 30.9 s | 21 | 1.5 s | ≈ 空测试文件成本 1.9 s |
| `gate-coverage.test.js` | 17.9 s | 10 | 1.8 s | 同上 |
| `arch.test.js` | 25.4 s | 35 | 0.7 s | 同上 |

每用例成本已接近 vitest 单文件固定开销（实测 1.9 s），没有内容成本可削。

---

## E2. 执行建议

建议按 A1 → A2 → A3 → A4 顺序执行，每项独立验证：

1. 改前/改后同窗口各测 3 轮取中位数
2. **用例数与失败集必须完全不变**
3. 每完成一项立即跑该文件确认

A1、A2 风险最低（纯探测复用），建议先做，拿到确定收益后
再评估 A3、A4 是否值得引入模板复制/共享 fixture 的复杂度。

**待确认**：是否四项都做？还是只做风险最低的 A1+A2（约 1.6 s）？


---

## G. 本轮累计成果

| 项 | 文件 | 门禁归属 | 收益 | 状态 |
|---|---|---|---:|---|
| A1 | `ccn-report.test.cjs` | Gate 3 复杂度 | 1.1 s | ✅ |
| A2 | `ccn-baseline-analyzer-version.test.cjs` | Gate 3 复杂度 | 0.55 s | ✅ |
| A3 | `mirror-sync.test.js` | REQ-713 镜像一致性 | **19.1 s** | ✅ |
| F1 | `crap-cli.test.js` | REQ-404 CRAP 建议型 CLI | **32–41 s** | ✅ |
| — | `gate-8-staged-scan`（A4） | Gate 8 密钥扫描 | 0.7 s | 决定不做 |
| — | `install-sh-deploy-manifest` | — | 不可优化（生产脚本） | 已查明 |
| — | `bootstrap.test.js` | — | 45 s 但会造成假绿 | 拒绝 |

**确定已落地约 53–61 s。**

所有改动仅涉及测试文件，生产脚本一行未动；已核对每个文件的 `@test` 归属，
**没有跨门禁合并**。

### 方法论教训

本轮最有价值的发现（F1、F2）都不是"合并调用"，而是**问了一句"这个耗时到底花在
哪"**：

- F1 表面是 lizard 慢，实际是**生产代码的检查顺序**让一个简单断言扫描了整个源码树
- F2 表面是测试重复建 fixture，实际是**生产脚本 82 次 `cp`/`chmod`** 撞上 MSYS2 的
  进程创建开销

而 `check-mattpocock-license` 那次（41.9 s → 3.3 s）同理：表面是网络超时，实际是
`spawnSync` 阻塞事件循环导致进程内 server 永远无法应答。

**共同的模式**：测试慢的时候，最贵的往往不是"重复调用"，而是"被调用的东西
在执行一件与断言无关的事"。先定位再合并。


---

## H. 交接与后续（2026-11-11 收尾）

本轮追查出的两个生产代码问题**按约定未修改**，已开 issue 并留下交接文档：

| Issue | 主题 | 是否可直接做 |
|---|---|---|
| [#804](https://github.com/boyingliu01/xp-gate/issues/804) | `crap` 在 coverage 缺失时先扫全源码树（10.5 s）再报错 | 可，与门禁拆分无耦合 |
| [#805](https://github.com/boyingliu01/xp-gate/issues/805) | `install.sh` 在 Windows 下 17–20 s（进程创建基线 106 ms） | **等门禁拆分落地后** |

交接文档：`docs/plans/2026-11-11-test-perf-handoff-to-gate-split.md`

### 关键联动（写进交接的原因）

另一个任务正把 `githooks/deploy-manifest.sh` 的 `DEPLOY_MODULE_FILES`
从 24 条加到 **42 条**（+18 个 `gate-entries/*`），而 `install.sh` 对每条做
`mkdir` + `cp` + `chmod` 三次外部命令。所以**拆分合入后 install.sh 会再慢约 8 s**。
这也正是不该现在就单独优化它的原因。

### 两处未做（已决定，非遗漏）

| 文件 | 潜在收益 | 拒绝原因 |
|---|---:|---|
| `bootstrap.test.js` | 45 s | 缓存检测结果会让 4/5 的用例不再触发真实检测，制造假绿 |
| `gate-8-staged-scan`（A4） | 0.7 s | 收益与风险不匹配，且属 Gate 8（拆分中的一类） |
