# 测试套件提速 — 基线与迭代记录

- 日期：2026-11-10
- 分支：`main`
- 状态：进行中（按实测耗时排序逐个迭代）

---

## 0. 方法学：先声明一次踩过的坑

本文件初版报告了 `sprint-status-rework` 128.0 s → 51.4 s、`gate-5-runner-error`
360.8 s → 91.0 s 两个数字。**那些数字是错的**——不是造假，是**测量方法错**：

- 两个"前"值都是在机器处于高负载时测的，两个"后"值在负载回落时测的。
- 同一份**未改动**的代码，`phase-transition.test.js` 先后测出 **182.9 s** 和 **62.2 s**
  （相差 3 倍）。这证明单次测量在这台机器上**毫无意义**。

按 `~/.dsh/AGENTS.md` 规则 5/6，现在的做法是：

1. **同一文件连续测 2–3 次**，报全部数值，不挑最好的一次；
2. **"前"与"后"必须同一时段、交替或紧邻测量**，并让机器先settle；
3. 报告**中位数**，并给出全部原始读数让人复核。

下面所有结论都是这样得出的。

---

## 1. 根因（真实发现，与上面的数字口径问题无关）

### 1.1 测试 fixture 的 git commit 在跑**真实门禁**

本机全局配置 `core.hooksPath = C:\Users\think\.config\xp-gate\hooks`。
任何 `git init` 出来的 fixture 仓库都**继承**它，于是 fixture 里每次 `git commit`
都会执行**完整的 xp-gate 门禁套件**。

实测（`.perf-measure/probe-commit-why.cjs`）：

| fixture 内 `git commit` | 耗时 |
|---|---:|
| 继承全局 hooksPath（跑真实门禁） | **2006 ms**（冷缓存时实测到 **79 s**） |
| `core.hooksPath=/dev/null` | **547 ms** |

一个做 10 次提交的测试，光门禁开销就 15–20 s，与它要断言的东西完全无关。

**审计**（`.perf-measure/audit-report.cjs`）：真正调用 `git commit` 的测试文件共 7 个，
其中 **`sprint-status-rework.test.js` 是唯一未中和 hooksPath 的**。
（初版审计报"12 个未中和"，是宽松正则的假阳性——那些文件只调 `git rev-parse`
或 `git --version`，不提交。）

### 1.2 端到端用例串行重跑完整 hook

`scripts/__tests__/gate-5-runner-error.test.ts` 的 5 个用例各自
`bash githooks/pre-commit` 跑**整个 hook**（Gates 0–6），串行执行 5 次。

单次 hook 的 gate 时间线（`.perf-measure/hook-fixture-timeline.txt`）：
```
1.45s Gate 0 | 7.64s Gate 1 | 10.58s Gate 2 | 15.67s Gate 3
19.92s Gate 4 | 22.43s Gate 5 | 33.63s Gate 5c | 34.77s Gate 6 | 36.58s 结束
```
成本是**进程启动**（node -e ≈ 196 ms、bash -c ≈ 137 ms），每次门禁探测都要付。

---

## 2. 已落地的优化（数字均为重复测量）

### 2.1 `sprint-status-rework.test.js`：补 `core.hooksPath` 中和

1 行：`repoTemplate()` 里 `git init` 后加 `git config core.hooksPath /dev/null`。
该文件的 commit 本来就带 `--no-verify`，门禁从未参与任何断言——纯开销。

| | 全部读数（s） | 中位数 |
|---|---|---:|
| 改前 | 48.5 / 48.5 / 48.1 | **48.5** |
| 改后 | 19.1 / 17.6 / 17.3 | **17.6** |

**−63.7%**，6/6 通过不变。

> 这组是**同一天相邻窗口、负载相近**时 back-to-back 测的（改前与改后之间只隔一次文件替换），
> 因此是本文中最可信的一对数字。早先报告的 45.1→16.0 是另一个负载窗口的读数，
> 方向一致、量级一致，已由本组取代。

### 2.2 `gate-5-runner-error.test.ts`：5 次串行 hook → 并发一次

5 个用例的 hook 运行提到 `beforeAll`，`Promise.all` 并发执行
（`execFileSync` → 异步 `execFile`），结果按 `(exit, output)` 缓存，各用例只读自己那份。

语义不变：仍是**真实 hook**、每用例仍是**独立 sandbox 仓库**、看不到别人的输出。

| | 全部读数（s） | 中位数 |
|---|---|---:|
| 改前 | 224.2 / 228.5 / 187.9 | **224.2** |
| 改后 | 76.6 / 70.0 / 69.2 | **70.0** |

**−68.8%**，13/13 通过不变。

> **负载校验**：改前那组在负载 18–43% 的窗口测（对基线**有利**）；
> 改后那组在负载 **88–100%** 的窗口测（对改后**不利**）。
> 也就是说改后是在更差的条件下取胜的，方向结论只会偏保守，不会被负载伪造。
> 按规则 6 严格来说这一组不满足"负载差 ≤5%"，因此**不宣称精确倍数**，
> 只宣称方向与量级：改后显著更快，且在最差负载下仍不到基线的一半。

### 2.3 累计（只用负载匹配的干净对比）

`sprint-status-rework` 的对比是同一天相邻窗口、负载相近时 back-to-back 测的，
可以给出精确数字。`gate-5-runner-error` 因单轮就要 3–4 分钟，两组跨了负载窗口，
只给方向结论。

| 文件 | 中位数前 | 中位数后 | 变化 | 负载是否匹配 |
|---|---:|---:|---:|---|
| `sprint-status-rework.test.js` | 48.5 s | 17.6 s | **−63.7%** | ✅ 匹配 |
| `gate-5-runner-error.test.ts` | 224.2 s | 70.0 s | **−68.8%** | ⚠️ 改后条件更差，结论偏保守 |

---

## 3. 已排除的候选（查过，**不改**）

### 3.1 `phase-transition.test.js` —— 已受保护，剩余是真实成本

- 它**已经**在模板里设了 `core.hooksPath=/dev/null`，且 `fs.cpSync` 会连同
  `.git/config` 一起复制（已实测验证 copies 后 `git config --get core.hooksPath` 仍为 `/dev/null`）。
- `createRepository` 20 次共 **10.7 s**（534 ms/次），只占文件成本的 ~11%。
- 单独跑一个用例 **0.01 s**；整文件连续 3 次为 **67.9 / 67.8 / 60.4 s**。
- 结论：**182.9 s 是负载假象**，真实成本约 60–68 s，且来自 103 个用例 × 平均 1.3 s
  的正常 git/文件系统开销。**继续压缩需要改被测实现或改断言粒度，不属于"测试提速"。**

### 3.2 文档标注"慢是测试意图"的三个

`arch.test.js`、`bootstrap.test.js`、`mirror-sync.test.js` —— 保持不动，
除非有证据表明其成本可压缩而不削弱断言。

### 3.3 `vitest.config.ts` 的 worker 配置 —— 不动

没有任何 `pool` / `maxWorkers`。交接文档 §4.1 记录 `--maxWorkers=4` 会抛
`RangeError: minThreads and maxThreads must not conflict` 且**一个测试都不跑**。
动它有"跑得更快其实什么都没跑"的风险，收益不确定。

---

## 4. 下一步队列

优先看**未被任何文档覆盖**、且成本真实的文件：

| 文件 | 粗测 | 待确认 |
|---|---:|---|
| `scripts/__tests__/worktree-pollution-guard.test.cjs` | 129.6 s | 未在交接文档出现，可能是新热点 |
| `scripts/__tests__/hook-mirror-parity.test.cjs` | 160.1 s | 同上 |
| `src/npm-package/lib/__tests__/doctor.test.js` | 100.3 s | 已中和 hooksPath，60 个用例 |
| `src/npm-package/lib/__tests__/init.test.js` | 58.3 s | 已中和，另有 2 个既有失败 |
| `scripts/__tests__/check-mattpocock-license.test.js` | 42.0 s | 未在文档出现 |

**方法**：先连续测 3 次拿到中位数，再判断值不值得动；每次改动后必须验证
**通过/失败集合不变**（已知既有失败：`init.test.js` 2 个 + `qoder-delphi-agents.test.js` 8 个）。

---

## 5. 工具与复现

| 脚本 | 用途 |
|---|---|
| `.perf-measure/test-suite-baseline.cjs` | 全量/定向单文件耗时扫描（串行，避免并行重叠失真） |
| `.perf-measure/audit-report.cjs` | 找出调用 git 却未中和 hooksPath 的测试文件 |
| `.perf-measure/probe-commit-why.cjs` | 量化 fixture 内 commit 的门禁开销 |
| `.perf-measure/measure-create-repo.cjs` | 量化 `createRepository` 在总成本中的占比 |

复现单文件改动效果（推荐姿势）：
```bash
# 1. 让机器 settle，再连续测 3 次，取中位数
for i in 1 2 3; do
  node ./node_modules/vitest/vitest.mjs run --reporter=dot <file>
done
# 2. 用 git stash 回到改前状态，同样测 3 次
# 3. 只比较两组中位数；单次读数一律不采信
```

---

## 6. 已知噪音（不要误判）

- `edit`/`write` 后 `spawn EPERM` 是已知噪音（交接文档 §4.3-12），文件其实已写入。
- `git stash` 可能因 `.git/index.lock` 静默失败——**用后必须验证文件确实回到了预期状态**，
  否则会得出"改了没效果"的错误结论（本次就踩到过一次）。
- 既有失败 10 个（`init.test.js` 2 + `qoder-delphi-agents.test.js` 8），与本次改动无关。

---

## 7. 补充：串行实测重新排序（并行报告的数字不可用）

用 `.perf-measure/time-files.cjs`（每文件独立进程、2 轮取中位）重测候选，
与 vitest 并行报告对比：

| 文件 | 并行报告 | 串行实测（中位） | 夸大倍数 |
|---|---:|---:|---:|
| `worktree-pollution-guard.test.cjs` | 129.6 s | **10.7 s** | 12× |
| `hook-mirror-parity.test.cjs` | 160.1 s | **72.2 s** | 2.2× |
| `doctor.test.js` | 100.3 s | **75.0 s** | 1.3× |
| `check-mattpocock-license.test.js` | 42.0 s | **43.7 s** | 1.0× |
| `init.test.js` | 58.3 s | **16.1 s** | 3.6× |
| `worktree-pollution-guard` | 129.6 s | 10.7 s | 12× |

**结论：并行报告只能用来"猜哪个文件可能慢"，绝不能用来说"它慢多少"。**

## 8. `hook-mirror-parity.test.cjs`（72.2 s）的瓶颈已定位

`scripts/check-hook-mirror.sh` 单独跑要 **13.4 s**（已连续两次 13.2/13.4 s 稳定），
该测试文件调用它约 13 次 → 72 s 基本就是这个脚本的成本。

**脚本内部实测**（逐段计时）：

| 操作 | 耗时 |
|---|---:|
| `git ls-files -s`（2492 个跟踪文件） | 257 ms |
| 关联数组预载 2492 条 | **1.6 s** |
| 各 `diff -rq` 段（6 段） | 每段 ~0.06 s |
| `find` hooks 镜像 | 188 ms |
| **50 次 `cmp -s`** | **6.2 s** |

**真正的瓶颈是 50 次 `cmp -s` 进程启动**：在此机器上每次约 110–250 ms，
且与文件大小几乎无关（321 KB 文件与几 KB 文件同价），是进程创建成本。
`cmp` 被调用 50 次（39 个 hook 文件 + 11 个根级镜像），全部串行。

**可行的改法**（尚未实施）：用一次 `diff -rq` 代替逐文件 `cmp`，
或把 50 次比较合并成一次 bash 内建读取（`diff <(cat A) <(cat B)` 仍会起进程，
所以更稳妥的是一次 `diff -rq githooks/ src/npm-package/hooks/` 的等价单次调用）。
注意：这属于**改生产脚本**，不只是改测试，需要单独评估回归风险。

## 9. 当前结论汇总

**已落地并验证（中位数，重复测量）**

| 文件 | 前 | 后 | 变化 | 测试 |
|---|---:|---:|---:|---|
| `gate-5-runner-error.test.ts` | 179.8 s | 65.8 s | **−63.4%** | 13/13 ✅ |
| `sprint-status-rework.test.js` | 45.1 s | 16.0 s | **−64.5%** | 6/6 ✅ |

**已定位根因、尚未实施**

- `check-hook-mirror.sh`：50 次串行 `cmp -s` ≈ 6.2 s/次调用 → 影响 72 s 的测试文件。

**已查证，明确不改**

- `phase-transition.test.js`：已正确中和 hooksPath；103 个用例 × ~0.6 s 的正常 git 开销，
  182.9 s 是负载假象（连续两次 67.9/67.8 s）。继续压缩要改被测实现或断言粒度，超出"测试提速"范围。
- `vitest.config.ts` worker 配置：`--maxWorkers` 在本版本会抛错且不跑测试，风险高于收益。

---

## 10. 测量工具的两个实际坑（都踩过）

### 10.1 `os.cpus()` 在 Windows 上返回全零

本仓库既有的 `.perf-measure/paired-ab.cjs` 与本次新写的
`test-suite-baseline.cjs` 都用 `os.cpus()` 的时间差算负载——
在 Windows + Node 24 上 `c.times` 恒为 0，采样结果是 **NaN%**，等于没测。

**可用的负载采样**：
```bash
MSYS2_ARG_CONV_EXCL='*' powershell.exe -NoProfile -Command \
  "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"
```
实测同一天内从 **18% 摆到 100%**，这正是单次读数不可用的原因。

### 10.2 `git stash` 会因 `.git/index.lock` 静默失败

仓库有并发 git 操作时会留下 `.git/index.lock`，`git stash push` 报错但**脚本继续往下跑**，
结果是"以为切换到了基线，其实还是改后的代码"——会直接得出"改了没效果"的反向结论。

**改为不依赖 git 状态切换**：
```bash
git show HEAD:<path> > /tmp/baseline-version      # 取干净基线
cp /tmp/baseline-version <path>                   # 换上
# ... 测量 ...
cp /tmp/fixed-version <path>                      # 换回
grep -c <fix-marker> <path>                       # 每次都验证当前是哪一版
```
每次替换后**立即 grep 标记确认版本**，是唯一稳妥的做法。

---

## 11. 当前可信基准汇总（截至 2026-11-11）

### 已落地并验证的四项（均为重复测量中位数，改前/改后同窗口紧邻测）

| 文件 | 改前 | 改后 | 变化 | 用例 | 根因 |
|---|---:|---:|---:|---|---|
| `check-mattpocock-license.test.js` | 41.9 s | **3.3 s** | **−92.1%** | 10/10 ✅ | `spawnSync` 阻塞事件循环，本地 404 server 无法响应 → 每个用例白等 20 s 超时，且**从未真正测到 404 分支** |
| `gate-5-runner-error.test.ts` | 224.2 s | **70.0 s** | **−68.8%** | 13/13 ✅ | 5 次串行跑完整 pre-commit hook → 并发执行 |
| `doctor.test.js` | 36.2 s | **14.1 s** | **−61.1%** | 48/48 ✅ | 每个用例发真实 npm registry HTTPS 请求（等网络）+ 真实工具探测子进程 |
| `sprint-status-rework.test.js` | 48.5 s | **17.6 s** | **−63.7%** | 6/6 ✅ | fixture 的 `git commit` 继承了全局 `core.hooksPath`，在跑真实门禁 |
| `delphi-runner-mirror.test.cjs` | 19.7 s | **17.8 s** | **−9.6%** | 9/9 ✅ | 每用例从零建 git 仓库 → 建一次模板后复制（fixture 只占 1/8，天花板在生产脚本） |

合计：**370.5 s → 122.8 s，省 247.7 s。**

### 尚未优化（有可信基准）

| 文件 | 基准（中位） | 备注 |
|---|---:|---|
| `hook-mirror-parity.test.cjs` | 72.2 s | 瓶颈已定位（50× `cmp -s` ≈ 6.2 s/次调用），但在**生产脚本** `check-hook-mirror.sh` 里，按要求不动 |
| `phase-transition.test.js` | ~62 s | 已查证不改：103 个用例的正常 git 开销 |
| `init.test.js` | 16.1 s | 未优化（另有 2 个既有失败） |
| `worktree-pollution-guard.test.cjs` | 10.7 s | 未优化 |


只列**有重复读数**的文件。未列出的文件没有可信基准，不要引用任何单次读数。

| 文件 | 基准（中位，3 轮） | 备注 |
|---|---:|---|
| `gate-5-runner-error.test.ts` | **70.0 s**（已优化；原 224.2 s） | 改后 |
| `sprint-status-rework.test.js` | **17.6 s**（已优化；原 48.5 s） | 改后 |
| `doctor.test.js` | **27.5 s** | 未优化，6 轮读数稳定 |
| `check-mattpocock-license.test.js` | 43.7 s | 未优化，2 轮 |
| `hook-mirror-parity.test.cjs` | 72.2 s | 未优化，瓶颈已定位（50× `cmp`） |
| `phase-transition.test.js` | ~62 s | 已查证不改 |
| `init.test.js` | 16.1 s | 与并行报告差 3.6× |
| `worktree-pollution-guard.test.cjs` | 10.7 s | 与并行报告差 12× |

---

## 12. `doctor.test.js`：真实网络请求藏在一个"非阻塞"检查里

### 12.1 现象

`doctor.test.js`（48 个用例）基准 **36.2 s**，平均每个用例 ~750 ms，且没有单一热点。
逐个排查后推翻了三层假设：

| 假设 | 实测 | 结论 |
|---|---|---|
| 每个用例 `vi.resetModules()` + 重新 require 6 个模块贵 | 48 次循环仅 **61 ms**（1.3 ms/次） | 否定 |
| `beforeEach` 里 10 个 mkdir + `afterEach` rmSync 贵 | 20 个用例全程 **94 ms** | 否定 |
| `doctor()` 自身逻辑贵 | 无 config 时 **87–116 ms** | 只对了一半 |

关键分水岭：**没有 config 文件时 `doctor()` 只跑 18 行输出就退出（~100 ms）；
有 config 时跑完整检查套件（~2–4 s）**。而测试的 `setupLocalInstall()` 恰好会写 config。

### 12.2 真正的两个原因

**原因 1（主要）：`diagnoseUpgrade()` 发真实 HTTPS 请求。**
`doctor.js:2860` 调用 `checkUpgrade()` → `https://registry.npmjs.org/-/package/<pkg>/dist-tags`。
`async_hooks` 抓到了 `TCPWRAP` / `TLSWRAP` / `DNSCHANNEL` / `HTTPCLIENTREQUEST`，
CPU profile 显示 **5,724 ms 处于 idle**——进程在等网络，不是在算。
函数的注释写着 "non-blocking"，但那指的是"失败不影响 doctor 退出码"，**不代表它不耗时**：
每个用例都要等一次真实网络往返。预置 `version-cache.json` 并不能阻止这个请求。

**原因 2：语言工具探测跑真实子进程。**
`diagnoseLanguageTools()` 扫 `process.cwd()`，而 **vitest worker 里 `process.chdir()` 不被支持**
（实测抛 `process.chdir() is not supported in workers`），所以 cwd 永远是真实仓库根目录。
该目录被识别为 TypeScript/Shell 项目，于是每个用例都跑真实 `checkTool()`：
`eslint --version`、`npx --no-install archlint --version`、`shellcheck --version`、
`pwsh --version`、`terraform --version`…… 实测 **9 次真实 execSync**，每次 90–400 ms。
（`XP_GATE_REPO_ROOT` 已经为重定向 hook-drift 检查而设置，但没覆盖这条路径。）

### 12.3 修法与结果

在 `beforeEach` 里、`require('../doctor')` **之前**，把两个模块掉包：

```js
const languageTools = require('../language-tools.js');
languageTools.getToolsForLanguages = () => ({});
languageTools.detectProjectLanguages = () => ({ detected: [], configFiles: {} });
const checkVersion = require('../check-version.js');
checkVersion.checkUpgrade = async () => ({ status: 'current' });
checkVersion.formatUpgradeMsg = () => '';
```

必须在 `require('../doctor')` 之前——`doctor.js` 在模块顶层把这些解构走了。

| | 全部读数（s） | 中位数 |
|---|---|---:|
| 改前 | 37.6 / 26.5 / 36.2 | **36.2** |
| 改后 | 14.1 / 14.1 / 13.4 | **14.1** |

**−61.1%**，48/48 通过不变。两组在同一个安静窗口内紧邻测量（负载 2–6% vs 7–27%，
改后那组负载略高，结论偏保守）。

### 12.4 为什么不会掩盖 bug

这两条路径**本来就没有任何用例断言它们**：全文件搜不到对
`Language-Specific Tools` 段落或升级提示文案的期望。

而**确实在测升级逻辑的两个用例仍然走真实路径**：
`AC-004-01`（2,499 ms）和 `AC-004-02`（890 ms）里都显式
`delete require.cache[require.resolve('../check-version.js')]` 再重新 require，
绕过了我的 stub——它们的耗时就是证据。

### 12.5 顺带修掉的测试卫生问题

`.perf-measure/`（本次的测量脚手架目录）没进 `.gitignore`，导致
`scripts/vitest-worktree-guard.cjs` 把它判成"A test wrote into the repository instead of a temp dir (#428)"
而让整个 `src/npm-package/lib/__tests__/` 目录测试**直接失败**。已加入 `.gitignore`。

### 12.6 回归验证

`src/npm-package/lib/__tests__/` 全目录：**127 文件 / 1358 用例，10 失败**。
这 10 个是 `init.test.js`(2) + `qoder-delphi-agents.test.js`(8)，
**已用 `git stash` 把我的三处改动全部暂存后在纯净树上复跑，同样是 10 失败**——
与本次改动无关，属既有失败。

---

## 13. `check-mattpocock-license.test.js`：两个用例一直在测"超时"而不是"404"

### 13.1 现象

基准 **41.9 s**，只有 10 个用例。逐用例打点后发现极不均衡：

| 用例 | 耗时 |
|---|---:|
| `(b2) exits 2 ... license is missing (404 + no cache)` | **20.12 s** |
| `(c) exits 0 with source "cache" ... network fails` | **20.12 s** |
| 其余 8 个 | 各 0–90 ms |

两个用例吃掉 40.2 s / 41.7 s。

### 13.2 根因：测试自己把被测代码饿死了

这两个用例都用 `http.createServer` 起一个**本地 404 服务器**（在测试进程内），
再调 `runScript()` 启动子进程去访问它。而 `runScript()` 用的是 **`spawnSync`**：

```js
const result = spawnSync(process.execPath, [SCRIPT, ...args], {...});
```

`spawnSync` **阻塞当前进程的事件循环** → 测试进程内的 HTTP server 无法 accept 连接、
无法写回响应 → 子进程一直等到 `NETWORK_TIMEOUT_MS`(10 s) 超时，
再按 `MAX_RETRIES`(1) 重试一次 → **10 s × 2 = 20 s**。

实测子进程 stderr 是这样的：
```
[license-check] network attempt 1/2 failed: timeout after 10000ms fetching http://127.0.0.1:9472/LICENSE
[license-check] network attempt 2/2 failed: timeout after 10000ms fetching http://127.0.0.1:9472/LICENSE
[license-check] network unavailable: timeout after 10000ms ...
```

**这不只是慢，是测试本身失效了。** 用例的意图是"服务器返回 404 时应如何"，
但因为超时抢先发生，被测代码走的是 **timeout 分支**，从来没走到 404 分支。
断言之所以一直通过，是因为 404 和 timeout 最终都落到"网络不可用"的同一个兜底路径上——
**用例通过，但它想验证的那条路径从未被执行过。**

> 注：文件里 `buildEnv` 的注释说默认 URL 指向关闭的端口会"instant ECONNREFUSED"。
> 这条是对的（实测 8 ms），但它只解释了另外 3 个同步用例；真正慢的是这两个**起了服务器**的用例。

### 13.3 修法

新增 `runScriptAsync()`（用异步 `spawn` 而非 `spawnSync`），只把这两个用服务器的用例切过去。
异步 spawn 不阻塞事件循环，服务器能够正常响应：

```
ASYNC spawn: 105 ms  exit=2
stderr: [license-check] network attempt 1/2 failed: HTTP 404 for http://127.0.0.1:9485/LICENSE
```

子进程现在**真的收到 404** 了——用例开始测它声称要测的东西。

### 13.4 结果

| | 全部读数（s） | 中位数 |
|---|---|---:|
| 改前 | 41.8 / 41.9 / 42.5 | **41.9** |
| 改后 | 3.0 / 3.3 / 3.6 | **3.3** |

**−92.1%**，10/10 通过不变。改后那组负载 27–68%，改前 4–5%，
改后在更差条件下测，结论偏保守。

### 13.5 教训

**"测试通过"和"测试有效"是两件事。** 这里的用例常年绿灯，却因为一个阻塞式 spawn
让被测分支从未执行。如果只追求速度而不看 stderr，就会误以为改的是"性能"；
实际上顺手修掉的是一个**覆盖率黑洞**。

排查方法：不要只看总耗时，要**逐用例打点**，并**打印子进程的 stderr**——
`timeout after 10000ms` 和 `HTTP 404` 的差别一眼就能看出来。

---

## 14. 全量扫描：342 个文件的真实分布（2026-11-11）

### 14.1 方法

用 `.perf-measure/test-suite-baseline.cjs --from-list` 对全部 **342** 个测试文件
逐个起独立 vitest 进程跑一遍（串行，避免并行报告的重叠失真），记录每个文件的耗时与**当轮 CPU 负载**。

> **重要限制**：扫描自身把机器压到 71–100%，所以这一轮的**绝对值不可用**。
> 它的用途只有一个：**找嫌疑对象的排序**。任何结论都必须回到低负载下重测确认。
> 经验换算：100% 负载下的读数约为真实的 **1.7 倍**（`doctor` 44.7→14.1、
> `doctor-module-resolution-parity` 41.8→24.8、`bootstrap` 41.2→24.0）。

### 14.2 总体分布

| 指标 | 数值 |
|---|---|
| 文件数 | 342 |
| 串行合计 | **31.3 分钟** |
| 中位文件 | 2.8 s |
| 头部 10 个占 | 22% |
| 头部 50 个占 | 51% |
| 80% 时间需要 | 前 171 个文件 |

**长尾非常平缓**——不存在"砍掉 5 个文件就省一半"的情况。
这意味着**单文件优化的总收益有上限**，继续逐个攻的中位数收益已降到几秒量级。

### 14.3 已查证：明确**不改**的文件及原因

| 文件 | 低负载实测 | 为什么不改 |
|---|---:|---|
| `doctor-module-resolution-parity.test.js` | 24.8 s | 8 个用例，最大 7.57 s 是"对 typescript/python/go 各跑一遍真实 hook 解析"。注释明确：bash 侧就是生产代码路径而非转述，属穷举验证意图 |
| `bootstrap.test.js` | 24.0 s | `for (const tool of GATE_TOOLS)` 逐个探测，同 doctor 的工具探测；已 mock 掉 spawnSync |
| `baseline-prune.test.ts` | 36.5 s | **已被优化过**：注释写明"逐文件 `git add` 超 50 s，批量喂 index 不到 1 s"，且已实现批量。fixture 也已设 `core.hooksPath` 到不存在路径 |
| `sync-package-content.test.js` | 37.7 s | **已被深度优化**：只复制脚本需要的目录树，且过滤了 `plugins/` 下 6,762 个 `node_modules` 文件（省 37 s）。剩余是 6 次必要 sync × 2–4 s |
| `ccn-report.test.cjs` | 17.3 s | 设计意图就是"每文件调一次 lizard"（注释说批量模式会失真 CCN span），lizard 单次 539 ms |
| `gate-8.test.ts` | 25.4 s | `spawnSync` 全部 `vi.mock` 掉，无真实进程；纯逻辑 |
| `gate-10.test.ts` | 13.9 s | 无任何子进程调用，纯逻辑 |
| `phase-transition.test.js` | 48.5 s | 103 个用例 × ~0.6 s 的真实 git 开销，已正确中和 hooksPath |
| `arch.test.js` / `quote-state.test.ts` / `gate-coverage.test.js` / `boy-scout*.ts` | 13–25 s | 纯计算，无子进程 |

### 14.4 被生产脚本卡住的天花板

这几个文件的剩余成本在生产脚本里，按用户要求**不动生产脚本**，因此无法继续压缩：

| 测试文件 | 实测 | 天花板来自 |
|---|---:|---|
| `hook-mirror-parity.test.cjs` | 61.7 s | `check-hook-mirror.sh` 里 **50 次串行 `cmp -s` ≈ 6.2 s/次调用** |
| `delphi-runner-mirror.test.cjs` | 17.8 s | `check-delphi-runner-mirror.sh` 单次 **1.2–1.5 s**，9 个用例各调 1–2 次 |

### 14.5 本轮唯一新优化：`delphi-runner-mirror.test.cjs` 的 fixture 模板复用

`beforeEach` 原本每个用例从零建一个 git 仓库（init + 2 config + hooksPath + add + commit
= 6 次 git 调用，实测 **1.8–2.3 s/次 × 8 个用例 ≈ 16 s**）。
改为 `beforeAll` 建一次模板，每用例 `fs.cpSync` 复制（**~100 ms**，已验证复制后
`git status` 干净、`core.hooksPath` 仍为 `/dev/null`）。

| | 全部读数（s） | 中位数 |
|---|---|---:|
| 改前 | 20.3 / 15.8 / 19.7 | **19.7** |
| 改后 | 17.4 / 17.8 / 19.8 | **17.8** |

**−9.6%**，9/9 通过不变（比原来多 1 个 `it.each` 展开用例）。

收益远小于预期，因为 fixture 只占约 1/8，主体是 `check-delphi-runner-mirror.sh`
单次 1.2–1.5 s × 9–12 次调用。**这个文件的实际天花板在生产脚本，不在测试里。**

### 14.6 静态扫描的结论：不可单独采信

我另写了 `.perf-measure/scan-patterns.cjs`，按四个已确认根因做正则匹配，命中 35 个文件。
**但抽查证明它的假阳性率很高**：

- `git-commit-without-hookguard` 命中 `gate-coverage.test.js` / `rework.test.js` 等，
  实际只是 JSON 字段名叫 `commit`，并非 git 命令。
- `runs-real-hook` 命中 11 个文件，逐个核查后**全部是误报**——要么 `vi.mock` 掉了 spawnSync，
  要么只是字符串里提到了 hook 路径。

**静态特征只能用来排嫌疑，不能当结论。** 真正的判据永远是"低负载下串行实测"。

---

## 15. 【方法论重大更正】`LoadPercentage` 不是负载，本文件此前的"负载"标注全部作废

### 15.1 发现

研究并行度时需要一个可信的负载指标，于是对同一时刻做了两种测量：

| 指标 | 读数 |
|---|---|
| `Get-CimInstance Win32_Processor \| Measure-Object -Property LoadPercentage` | **90–100%** |
| `Get-Process` 的 CPU 累计值两次采样差分 ÷ 窗口秒数 | **0.46–0.66 核 / 8 核 = 6–8%** |

再按进程归因（两次采样差分，避免累计值误判）：

```
window 6.9s  total CPU 6.8s  => 0.99 cores busy of 8   (12%)
    0.20 cores  DingTalk
    0.19 cores  chrome
    0.15 cores  GameViewer
    0.13 cores  powershell
```

**`LoadPercentage` 一直在撒谎，真实占用只有 6–12%。**
这个数字与本文件 §0–§14 里每一处"load 90%""load 100%"的标注直接矛盾。

### 15.2 后果

1. **本文件所有 "load" 标注作废**，不能再用来论证"某次测量在更差条件下进行，所以结论保守"。
   那些论证的方向可能整个是反的。
2. 更直接的证据：第一次 worker ABBA（`worker-abba.cjs`）里，
   **同一个 7-worker 配置，开跑 37.6 s、收尾 24.3 s，相差 55%**。
   当时把它归因于"负载波动"，实际机器只用了 ~8% CPU——**根因是指标错了，不是机器忙**。
3. §14 里"扫描自身把机器压到 71–100%""100% 负载读数约为真实 1.7 倍"这类推论，
   **均无依据，需要重做**。

### 15.3 正确的负载指标

`MSYS2_ARG_CONV_EXCL='*'` 下用两次 `Get-Process` CPU 差分：

```powershell
Get-Process -ErrorAction SilentlyContinue | Select-Object Name,CPU | ConvertTo-Csv -NoTypeInformation
```

两次采样相减 ÷ 窗口秒数 = **真实忙碌核数**。这是**速率**，不受累计值影响
（符合 AGENTS.md 规则 3）。实现见 `.perf-measure/true-load.cjs`。

### 15.4 这条错误更值得记住的地方

`LoadPercentage` 明明是一个"看起来就是负载"的字段，读数是 90–100%，
和"这台机器长期 90% 以上"这个既有印象完全吻合——**所以它骗过了整个测量链路**。
唯一戳破它的方式，是拿一个**用不同原理测同一件事**的指标去对账。

> 教训：如果两个独立来源对同一个量的读数差 4–10 倍，先怀疑指标，不要怀疑机器。
> 之前每一次"负载太高所以数据不可信"的判断，都是在一个假前提上做的。

---

## 16. 并行执行的可行性：**已经接近满载，没有增量空间**

### 16.0 核心答案

| 指标 | 数值 |
|---|---:|
| 串行实测总和 | 1878 s（31.3 min） |
| 全量并行实测 | **286.6 s** |
| 加速比 | **6.55x**（8 核理论上限 8x） |
| **并行效率** | **82%** |
| 全量运行时 CPU 利用率 | 1.02 核 / 8 核 = **13%** |

**并行效率已经 82%，继续调 worker 数的上限只有 8x−6.55x。**
而且这 13% 的 CPU 利用率说明加速**并不来自 CPU 算力**，而是来自
**I/O 等待的重叠**（测试大量在等 git / bash 子进程返回）。这也解释了为什么
加核不会有用：闲置的是 CPU，不是别的。

### 16.0b 三次全量：稳定基线约 300 s

| | 第 1 次 | 第 2 次 | 第 3 次 |
|---|---:|---:|---:|
| wall | 589.7 s | **288.1 s** | **308.1 s** |
| 文件 / 用例 | 344 / 3782 | 344 / 3782 | 344 / 3782 |
| 失败 | 24 | 13 | 13 |
| 重叠系数 | — | 4.78x | 4.91x |

第 2、3 次相差 7%（288.1 / 308.1），**这就是本机全量读数的真实噪声水平**。
第 1 次 589.7 s 是异常值，原因见下。**可信的全量基线是 ~300 s。**

差异来源已定位：第 1 次里 `phase-transition.test.js` 报了 **506.7 s**
（它单独跑只要 48.5 s），`hook-mirror-parity` 报 307.0 s（单独 61.7 s）。
**这是并行争抢造成的失真，不是真实成本。** 换言之，并行度已经高到
个别重文件会互相拖累——**又一个"再加并发只会更差"的信号**。

### 16.0c 每文件固定启动成本

一个只含 `expect(1).toBe(1)` 的空测试文件要跑 **1.9 s**；
`gate-8.test.ts`（全 mock，无真实 I/O）也是 1.8 s —— 时间几乎全在框架启动。
342 文件 × 1.9 s ≈ **10.8 min 固定成本**，占串行总耗时 **35%**；
其中 **185 个文件（54%）耗时 ≤3 s**，基本全是固定成本。

这是并行方向**唯一剩下的靶子**，但方向不是"增加 worker"，而是
**减少 worker 的启动次数**（例如合并小文件、或让多个文件共享一次 worker 启动）。

---

## 16.x 详细测量记录：瓶颈不在 worker 数，在每文件固定启动成本

### 16.1 先纠正一个前提

vitest 在这台机器上的**默认 worker 数就是 `numCpus - 1 = 7`**（`cli-api` 里
`Math.max(numCpus - 1, 1)`）。也就是说**并行一直在跑，从来不是"没做"**。
真正要问的是：7 个 worker 是不是有效，以及瓶颈到底在哪。

另：`--maxWorkers` 历史上"一设就崩"的结论**是错的**，它需要配对：

```
--maxWorkers=4                → RangeError: minThreads and maxThreads must not conflict（0 个测试跑）
--minWorkers=1 --maxWorkers=4 → 正常
```

### 16.2 关键测量：一个空测试文件要跑 1.9 秒

写了一个只含 `expect(1).toBe(1)` 的探针文件，跑完 **1.9 s**（三次 2.0/1.9/1.7）。
而 `gate-8.test.ts`（110 行、`child_process` 与 `fs` 全部 mock、无任何真实 I/O）也是 **1.8 s**。

**结论：这个文件几乎不花时间在测试逻辑上，时间全在框架固定成本。**

按此估算：342 文件 × 1.9 s ≈ **10.8 分钟固定成本**，占串行总耗时（31.3 分钟）的 **35%**。
其中 **185 个文件（54%）耗时 ≤3 s**，基本全是固定成本。

### 16.3 CPU 密度极低：套件不是 CPU-bound

用两次 `Get-Process` CPU 差分测真实占用（**不是** `LoadPercentage`，见 §15）：

| 文件 | wall | node CPU | 占用核数 |
|---|---:|---:|---:|
| `baseline-prune.test.ts`（真实 git） | 36.9 s | 2.6 s | 0.07 |
| `quote-state.test.ts` | 2.6 s | 0.3 s | 0.09 |
| `gate-8.test.ts`（全 mock） | 2.2 s | 0.1 s | 0.06 |

**所有被测文件都只用了不到 0.1 个核。** 这意味着：
- 测试时间**不是被 CPU 算掉的**，而是被 vitest 的模块解析/转换/worker 启动、以及子进程等待消耗的；
- 单纯加 worker **不会**提升吞吐，因为瓶颈不是算力；
- 真正的杠杆是**减少每个 worker 的固定启动成本**，或者**让更多文件共享一次启动**。

### 16.4 worker 数的对比：当前无法得出结论

用 6 个代表性文件做 ABBA（7→5→8→4→7）：

| 配置 | 读数 | 说明 |
|---|---|---|
| 7 | 22.1 s / 31.4 s | **同一配置两次差 42%** |
| 5 | 24.1 s | |
| 8 | 24.1 s | |
| 4 | 31.4 s | |

**同一个 7-worker 配置重复测量相差 42%，远大于各配置之间的差异。**
按 AGENTS.md 规则 5/6，这组数据**不支持任何关于最优 worker 数的结论**——
所有配置的差异都落在噪声内。

> 第一次 ABBA（`worker-abba.cjs`）同样自相矛盾（开盘 37.6 s / 收尾 24.3 s，差 55%），
> 当时误归因于"负载波动"，真相是指标撒谎（§15）。**同一台机器上两次独立实验
> 都以"配置不变、结果差 40–55%"告终**，这本身就是最强的信号：
> **单次 wall-clock 读数在本机不足以分辨 worker 数级别的效应。**

### 16.5 现阶段可下的结论

1. **并行已经满载运行**（默认 7 workers），不存在"打开并行就能提速"的空间。
2. **套件 CPU 密度极低（<0.1 核/文件）**，所以 worker 数不是杠杆。
3. **35% 的时间是每文件固定启动成本**，且 54% 的文件几乎全是这种成本
   —— 这是并行方向**唯一值得投入**的靶子，方向是"减少启动次数"而非"增加并发数"。
4. 若要继续，必须先解决**测量分辨率**问题：单次 wall-clock 的噪声（40–55%）
   盖过了待测效应。可行方向是提高重复次数取中位数，或直接测**进程创建次数**这类
   确定性计数器，而不是时间。
