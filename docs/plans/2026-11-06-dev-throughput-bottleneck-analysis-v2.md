# xp-gate 开发吞吐瓶颈分析 v2（干净负载实测，最终版）

**日期**: 2026-11-06
**目的**: 前作 `2026-11-05-dev-throughput-bottleneck-analysis.md` 的所有测量都在 CPU 100% 负载（CorpLink/GameViewer 等后台进程占满）下进行，数字被负载噪声污染，导致瓶颈归因反复漂移。本报告在**重启后干净负载（CPU ~24%）**下重测，给出可复现的最终结论。
**任务目标**: 诊断瓶颈 → 优化瓶颈。

---

## 0. 结论先行（一句话）

**xp-gate 测试变慢的真实瓶颈，是测试代码里未被 mock 掉的真实子进程调用（尤其是 `init.test.js` 的 `checkDeps` 工具探测，带 15s/120s 超时），叠加 bats 套件的固定启动开销。它既不是"进程创建税"（已被证伪），也不是"迁移 WSL 能解决"（收益被高估）。**

---

## 1. 必须先纠正的三个假结论（这是本报告存在的意义）

前一轮诊断在 100% CPU 负载下反复漂移，得到过这些**错误**结论，逐一证伪：

| 假结论 | 当时的"证据" | 干净负载下的真相 | 判定 |
|---|---|---|---|
| "进程创建 378ms，是瓶颈" | `grep` 启动 378ms | `grep` 不是独立 exe，是 MSYS 内部程序；378ms 是**用 `date +%s%N` 包裹测量的自污染**（每次多起 2 个 date 进程）。干净测：node=92ms、git=64ms、MSYS 内 fork=1.8ms | **证伪** |
| "迁移 WSL 提速 10-20 倍" | Windows 进程 378ms vs WSL 2ms | 真实 fork 差距仅 ~1.8 倍（1.8ms vs 1ms），且慢在 `npx`/`npm`/工具探测，与 OS 无关 | **证伪** |
| "bats 10 个慢用例占 72%" | 抽样 10 文件，样本偏向 gate-m2-threshold | 全量 226 文件，慢是**普遍形态**（147/226 文件调完整钩子），非极端长尾 | **证伪** |
| "单文件 2s / 两文件 281s" | 负载污染 + 文件名错误 | 单文件 2-21s 量级，两文件 ≈ 两者之和，无超线性 | **证伪** |

**核心教训**：在负载波动的机器上，任何单次 `date +%s%N` 读数都不可复现。本报告所有数字均为**多次取中位数**，且在确认 CPU 负载 <30% 后测得。

---

## 2. 干净负载下的决定性实测数据

### 2.1 进程创建成本（低负载，各测 7-9 次取中位）

| 操作 | 中位数 | 波动 |
|---|---|---|
| `node -e 1` | **92 ms** | 80-107 |
| `git --version` | **64 ms** | 62-71 |
| `bash -c true`（MSYS 内 fork） | **1.8 ms** | — |
| bats 空目录启动 | **1,553 ms** | 1,381-1,673 |

> 对比：100% 负载时 `node -e 1` 中位数是 **505 ms**。负载把一切测量放大了 ~5 倍，这正是前一轮"瓶颈"反复漂移的根因。

### 2.2 bats 套件全量成本

| 项目 | 值 |
|---|---|
| 测试文件数 | 226 个 `.bats` |
| 用例总数 | 1,512 个 `@test` |
| 平均用例数/文件 | 6.7 |
| **抽样单文件墙钟均值** | **7 s/文件**（11 个文件等距抽样） |
| **外推全量墙钟** | **≈1,714 s ≈ 28.6 分钟** |
| 空目录启动开销 | 1.5 s/次（占单文件 ~20%） |
| 调用完整钩子的文件 | **147/226（65%）** |

**结论**：bats 慢是**普遍形态**，不是少数慢文件。65% 的文件在测试里真实调用 pre-commit/pre-push，每个用例都付一次完整钩子成本。启动开销（1.5s）只占 ~20%，**主力成本是真实执行钩子**。

### 2.3 vitest 侧：真正的异常点

| 文件 | 墙钟 | 说明 |
|---|---|---|
| `src/npm-package/lib/__tests__/init.test.js` | **383,125 ms（6.4 分钟）** | 27 个测试，平均 **14 s/测试** |
| `src/npm-package/scripts/__tests__/sync-package-content.test.js` | 79,943 ms（80s） | 次慢 |
| 其余 ~446 个文件 | 几十 ms ~ 几 s | 正常 |

`init.test.js` 的 per-test 分解（verbose 报告）：

```
injectKarpathyPrinciples is idempotent  46,758 ms  ← 最慢
init --full takes installLocal path     20,875 ms
init --core-only logs final             21,330 ms
init --core-only template dir           21,287 ms
init prints header                      18,094 ms
... 约 15 个测试都在 14-22 秒
```

---

## 3. 真正的根因（定位到代码行）

### 根因 1：`init.test.js` 未 mock `checkDeps`/`autoInstallDeps`

`src/npm-package/lib/__tests__/init.test.js` 的测试大量调用真实的 `init()`，只 mock 了 `git clone` 和 `git config`，**没有 mock 依赖探测**。

`src/npm-package/lib/detect-deps.js` 里的探测带超时：

```js
// 第 138 行
const execOpts = { ..., timeout: 15000 };   // 15 秒超时
// 第 559 行
cp.spawnSync(..., { timeout: 120000, ... }); // 120 秒超时！
// 第 356 行注释：某工具在 Windows 上 "blocks its spawnSync for ~3.4s"
```

`init()` 第 67/75 行调用 `checkDeps(platform)` → `autoInstallDeps(platform)`，会真实地用 `spawnSync` 探测 gitleaks/lizard/semgrep 等十几个 CLI 工具。每个探测在 Windows 上阻塞数秒，**没有被 mock 时，每个 `init()` 调用就真实跑一遍**，于是 27 个测试 × 平均 14 秒 = 383 秒。

**修复方向**：在测试的 `beforeEach` 里 mock `checkDeps` 和 `autoInstallDeps`（或 mock `detect-deps.js` 模块），让工具探测不真实执行。这是**纯测试代码改动，风险极低，收益 6 分钟**。

### 根因 2：bats 65% 的文件真实调用完整钩子

`147/226` 个 bats 文件在测试里真实执行 pre-commit/pre-push。每个用例都付一次完整钩子成本（钩子内部有 `npx tsx` 冷启动 3.9s、`npx tsc` 4.6s、以及 Gate MD 的 19×grep）。

**修复方向**（按 ROI 排序）：
1. **钩子加 `XP_GATE_ONLY_GATE` 测试模式**——环境变量跳过与断言无关的 Gate，一个断言只付一个 Gate 的成本。
2. **同文件用例共享一次钩子运行**——`gate-5a-block.test.bats` 的 16 个用例若共享 fixture 和一次钩子执行，可省 ~15 倍。

### 根因 3（次要）：`npx` 冷启动

`pre-push` 里 `npx tsx` 冷启动 3.9s、`npx tsc` 4.6s。改成 `node node_modules/.bin/tsx` 或直接 `node --experimental-strip-types` 可省每次 ~3s。

---

## 4. 明确的、可验收的优化行动（不再漂移）

按 ROI 排序，每条带验收口径：

### A1（已落地并验证）：mock 掉 `init.test.js` 的工具探测

- 改动：在 `init.test.js` 的 `beforeEach` 里加 `vi.spyOn(childProcess, 'execSync').mockImplementation(() => '')`，让 `init()` 的 `checkBash`/`printCliToolStatus`/`probeGitleaksNotice` 里的工具探测不再真实执行。
- **实测验证**：`init.test.js` 从 **383s → 167s**（省 216s = 56%），27 测试全绿。
- **剩余问题（未解决，见 §7）**：167s 里仍有约 150s 是「测试间串扰」——`init --core-only succeeds` 测试执行 `installLocal` 后污染环境，导致后续 `--full`/`--core-only` 系列测试变慢（单测 536ms，完整套件 24s）。这是独立的第二个问题，需单独修。

### A2（中 ROI，钩子侧）：给 pre-push/pre-commit 加定向 Gate 环境变量

- 改动：`XP_GATE_ONLY_GATE=<gate>` 让钩子只跑指定 Gate
- 预期：bats 全量从 1714s → 可定向到单 Gate（如只跑 Gate 5a 时 <100s）
- 验收：`XP_GATE_ONLY_GATE=5a bash githooks/pre-commit` 只输出 Gate 5a 结果

### A3（次要）：npx → 本地二进制

- 改动：`pre-push`/`pre-commit` 里的 `npx tsx`/`npx tsc` 改直接调用
- 预期：每次钩子省 ~3-4s
- 验收：钩子内无 `npx` 冷启动（`npx tsx --version` 不再出现）

### 暂不做：迁移 WSL

干净数据证明 WSL 的真实收益只有 ~1.8 倍（进程 fork 1.8ms vs 1ms），而慢在 `npx`/`npm`/工具探测，与 OS 无关。**迁移 WSL 的收益被前一轮高估，暂不做，除非 A1-A3 落地后仍不满足。**

---

## 7. 新发现：`init.test.js` 的第二个问题（测试间串扰）

A1 落地后，`init.test.js` 从 383s → 167s，但剩余 167s 里约 150s 不是测试逻辑本身，而是**测试间串扰**：

| 证据 | 结果 |
|---|---|
| `--full takes installLocal` 单独跑（`-t`） | **536ms** |
| 同上，在完整套件里 | **24,356ms（45 倍）** |
| 元凶测试 | `init --core-only succeeds in git repo`（执行 `installLocal` 后污染环境） |
| 污染机制 | 待定位（怀疑 `TEMPLATE_DIR`/`CONFIG_DIR`/`ensureTuiRegistration` 的全局副作用，或 `installModuleRuntimeDeps` 的 `package.json` 写入未隔离） |

**根因定位方法（已验证）**：`-t "core-only succeeds|installLocal path"` 复现——`--core-only succeeds` 之后 `--full` 从 536ms 跳到 16s。

**这是 A1 的后续工作**：修复串扰后，`init.test.js` 预期可降到 <10s（27 个测试 × 单测均 500ms）。收益另约 150s。

---

## 5. 数据可复现方法

```bash
# 确认负载（应 <30%）
powershell -c "Get-CimInstance Win32_Processor | Select LoadPercentage"

# 进程创建成本（7 次取中位）
node -e 'const{execFileSync}=require("child_process");const v=[];for(let i=0;i<9;i++){const s=Date.now();execFileSync(process.execPath,["-e","1"]);v.push(Date.now()-s)}v.sort((a,b)=>a-b);console.log("node med="+v[4]+"ms")'

# bats 单文件墙钟
time ./node_modules/.bin/bats githooks/__tests__/gate-parsing.test.bats

# init.test.js 墙钟（隔离）
npx vitest run src/npm-package/lib/__tests__/init.test.js --reporter=basic
```

---

## 6. 附：本轮验证过的、之前被冲掉的修复（需重新落地）

前一轮在并发会话下做的改动已被 `git checkout` 冲掉，本报告记录其内容供重新落地：

1. **`pre-push` Gate MD 的 19×grep → 单次读入 + bash 内建计数**：语义等价（40 个真实文件 + 边界用例 0 差异），保留"前缀重叠重复计数"行为。⚠️ 但实测**没有降低耗时**（因为真实成本不在 grep，而在钩子整体），列为低优先级。
2. **`gate-m2-threshold.test.bats` 补 `prepush-score.py`**：修复前 10 个用例从未到达 Gate MD（全部 fail-closed 却仍报通过），属**测试有效性缺陷**，与性能无关。
3. **`issue-717-ci-parity.test.bats` 的 YAML 用例**：`node -e "..."` 双层引号转义 bug，JS 字符串提前闭合，任何平台必失败。改用脚本文件绕开引号层。
4. **`issue-717-gate9-gate34-real.test.bats`**：fixture 里 `git commit` 触发全局安装的真实钩子被 Gate 6 阻断，`&&` 短路。用 `GIT_CONFIG_*` 隔离 hooksPath。

> 以上 3/4 是**让测试正确**，1/2 是**性能/有效性**，均不影响"提速"这个主目标。A1-A3 才是提速的正解。
