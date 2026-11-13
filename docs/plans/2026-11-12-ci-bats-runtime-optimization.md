# CI 提速：BATS 为什么慢，以及改了什么

- 日期：2026-11-12
- 状态：第一阶段实施完成（分片 + 恢复阻塞 + 去掉 `npx` 安装陷阱）
- 触发：发布版本时发现 CI 最大瓶颈是 GitHub CI，而 GitHub CI 的最大瓶颈是 Gate 5b（BATS）。

---

## 0. 先把口径钉住：18 分 47 秒不是"BATS 有多慢"

用户实测的那次运行：

| 段 | 耗时 | 占 Gate Checks 作业 |
|---|---:|---:|
| Gate 5b（BATS 契约）单步 | **18m47s** | **81%** |
| Gate Checks 其余全部门禁 | < 2m | ~9% |
| Gate Checks 作业总计 | 22m24s | 100% |

当时的处置是给这一步加 `continue-on-error: true`——**用"不再阻塞合并"换"流水线还能用"**。
这篇记录的核心结论是：那 18 分 47 秒里，真正**执行断言**的部分很小，大头是两类可消除的开关成本：

1. **fixture 里的 `npx <tool>` 会去 registry 装包**（§1）；
2. **整个套件只能跑在一台 runner 的一个文件系统里，完全串行**（§2）。

两件都不需要删断言、不需要降低覆盖，只需要改"工具怎么找"和"用例在哪跑"。

### 0.1 测量环境（必须写在前面，否则数字会被误读）

- 本机 Windows 11 + WSL2 Ubuntu（4 核 / 8GB），**不是** GitHub runner。
- 绝对耗时与 `ubuntu-latest` 不同，**本记录只使用比例与方向**，不给"改完就是 X 分钟"的承诺。
- 本机 WSL 访问 npm registry 基本不可用（`npm view vitest` 185 秒未返回被杀），
  **这一项放大了**"npx 去 registry"的成本；GitHub runner 有代理，同一项的绝对成本更小，
  但**结构性行为完全一样**（`npx` 缺包就装）。所以下面每条修复都用"契约"而不是"秒数"来断言。
- Windows 上的 Git Bash 无法代表 Linux（单文件启停就 20 秒），**所有测量都在 Linux 上做**。

---

## 1. 根因一：fixture 里 `npx <tool>` 等于"现场装一个工具"

`githooks/adapters/typescript.sh` 的 ESLint 分支原文 `npx eslint .`；
Gate 1 入口的 Biome 分支 `npx biome check --staged .`。
`npx` 不带 `--no-install` 的契约是**缺包就下载再执行**。于是在一个只写了配置文件的
fixture 里，"跑一次 lint"变成"从 registry 装一个包再跑"。

实测（Linux/WSL，fixture 根只有 `biome.json` + `package.json` + `src/`，无 `node_modules`）：

| 调用 | 结果 |
|---|---|
| `npx biome check .` | **60 秒仍在运行，被 kill** |
| `npx --no-install eslint --version` | 3.5 秒返回 127（它不装，但**仍然问了** registry） |

套件规模：`githooks/__tests__/` 下 246 个 `.bats`，其中 97 个用例标题带 `#717`、
36 个带 `Gate`，大量用例都会走到这两条 lint 分支。串行跑一遍，每个用例把这次等待付一次。

### 修法

- `_local_bin()` 增加**有限深度向上找祖先 `node_modules/.bin`**（npm 会提升依赖到工作区根）。
  去掉 `npx` 不能顺手把搜索范围收窄——`npx` 原本免费提供了这一点。
- Biome 分支、ESLint 分支改为 **本地 bin → PATH** 两级解析，找不到就 SKIP/BLOCK 并给安装提示。
  **没有** `npx --no-install` 这一级：它防的是安装，不是 registry 查询，而这个仓库的
  `scripts/check-no-npx-probe.sh` 明确拒绝这种形状（见 §3）。
- "只有 formatter、没有 linter 规则"的 Biome 配置（`linter.enabled: false`）判为**无可 lint 内容**，
  直接 PASSED——这类 fixture 很多，之前每条都在为一个空检查等 60 秒。
  判据只看配置本身，不起工具、不联网。
- Gate 1 入口 `npx biome check --staged` 同样改三级解析（本地 bin → PATH → npx 兜底）。

这与 `AGENTS.md` 已有的 **REQ-GATE-PROBE-SHORTCUT**（`XP_GATE_NPX_PROBE` 默认关）是同一条规则：
之前它只覆盖"探测版本"，没覆盖"真正调用"。本 PR 把"调用"这一半也补上了。

---

## 2. 根因二：一个作业、一个文件系统、全程串行

即使 fixture 全部修好，18m48s 的套件仍然只能**端到端**跑在一个 runner 上——同一作业的
步骤共享文件系统，没有任何并行。

### 2.1 新结构

```
bats-contracts（矩阵作业，4 个分片，每个分片一台 runner）
  ├── shard 1/4 ── npm ci + gitleaks + node scripts/run-bats-ci.cjs --shard 1/4 --jobs N
  ├── shard 2/4
  ├── shard 3/4
  └── shard 4/4
```

- `scripts/run-bats-ci.cjs` 是分片驱动，**按实测成本**（不是文件数、不是字母序）做
  longest-processing-time-first 划分。实测表中 46 个"贵"用例，4 分片时成本极差 < 1%
  （370.4s / 368.4s / 371.3s / 368.3s）；未称重文件取**实测中位数**并**打印数量**，
  避免"新增用例悄悄压垮一个分片"。
- `--jobs`（分片内并行）只在 runner 上**真有** GNU parallel / rush 时启用：bats 的 `-j`
  依赖它们，缺了会**直接报错**而不是退化成串行。探测结果打进日志，所以"这次是并行还是串行"有据可查。
- 分片失败 = 作业失败；作业在 `quality-report` 的 `needs` 链里 → **流水线红**。
  旧步骤的 `continue-on-error: true` 随步骤一起删除。

### 2.2 收益形状

| | 改前 | 改后 |
|---|---:|---:|
| 套件执行 | 单 runner 串行 18m47s | 单分片 ≈ 370s 实测成本 ÷ 并行度 |
| 是否阻塞 | 否（`continue-on-error`） | **是** |
| 新增依赖 | — | 无（分片复用同一 bats devDependency） |

---

## 3. 让"又慢回去"不可能悄悄发生：两道守卫

1. `scripts/check-no-npx-probe.sh`（既有，guard 1）：钩子不得用 `npx --version` 探测工具。
   **本 PR 扩展（guard 2）**：`githooks/adapters/typescript.sh` 与
   `githooks/gate-entries/gate-1-entry.sh` 不得用**裸 `npx <tool>` 执行**工具
   （`--no-install` / `--yes` / `--version` 三种形状豁免）。守卫必须能失败，
   所以它是"命中即 exit 1 并报 `file:line`"，而不是一句注释。
2. `scripts/__tests__/bats-ci-shard.test.cjs`（13 例）：
   - 分片是**划分**：246 个 `.bats` 在 1/2/3/4/6/8 分片下都恰好各出现一次；
   - 成本均衡（4 分片极差 < 10%）；
   - **空分片必须非 0 退出**（"跑了 0 个"不许读成"通过"）；
   - 工作流里**没有** `npx bats`、BATS 步骤**没有** `continue-on-error`、
     矩阵确实按 `--shard ${{ matrix.shard }}` 驱动。
     这条是长期最关键的一条：当初的回归不是"某个测试慢"，而是"为了流水线可用加了一个
     `continue-on-error`"。把"阻塞"钉成工作流的性质，才能防止它被悄悄加回去。

---

## 4. 第二阶段（本 PR 不做，已定位并留证）

逐文件 profile（Linux/WSL，`timeout 45` 串行跑完全部 246 个）得到三个**与 CI 配置无关**的
套件级成本，属于"fixture 成本"问题，归第二阶段：

| 现象 | 用例 | 根因 |
|---|---|---|
| 单文件 >45s 未完成（13 个） | `gate-1-tsc-test-files`、`gate-5a-block`、`java-gate`、`typecheck-local-tsc`、`gate-m2-threshold`、`multilang-subdir-gate5a`、`issue-450/551/554c/776`、`tag-push-gate-mw`、`gate-cjs-source-detection`、`gate9-architecture` | 走到 `npx tsc` / 真实 `mvn` / 真实 lint 分支；在**没有对应工具的机器**上会去下载 |

其中三个在第一阶段已被 §1 的修复**顺带解决**（它们唯一的病根就是 lint 分支的 npx 安装）：

| 用例 | 改前 | 改后 |
|---|---:|---:|
| `gate-1-linter-missing` | 45 000 ms（被杀） | **863 ms** |
| `gate-1-biome-noop` | 45 000 ms（被杀） | **438 ms** |
| `adapter-typescript-biome-exit` | 45 000 ms（被杀） | **274 ms** |

剩下 10 个仍需第二阶段（stub `mvn` / `tsc`），它们的分片权重仍按 50 000 ms 计。
| 单文件 16–18s | `gate-1-tsc-test-files`(47s)、`changed-file-matcher`(32s)、`gate-13-slice-2`(16s) | 每个 case 跑一遍真实钩子链 |
| 单文件 9–13s | `gate-13-slice-3`、`gate-13-walkthrough-round2`、`issue-649/706`、`gate-mw-evidence` 等 | 同上 |

注意这些"超时"是**本机形状**下的超时：CI runner 有 registry 代理，同样的用例会跑完，
只是慢。因此分片表把这类用例记为 50s（**高估**），方向是"把它们拆到不同分片"——这是安全的一侧。

第二阶段的正确改法是给这些 fixture 装 stub（`bin/mvn`、`bin/npx`、`bin/tsc`），
而不是继续调 CI 的并行度。

### 4.1 权重表只覆盖 46/246 —— 这是待办，不是已解决

`MEASURED_MS` 只有 **46 条实测**，其余 **200 个套件退回 `DEFAULT_MS = 3000`**
（实测中位数）。所以：

- 分片在**已知重套件之间**确实按成本均衡（4 分片 370.4/368.4/371.3/368.3 s，
  极差 <1%，这部分数字是真的）；
- 但这 200 个按 3 s 计入，**真实成本没被测过**。一个实际跑 20 s 的套件会被当成
  3 s 摊派，结果就是"某个分片意外最长"。driver 每次运行都会打印
  `N/N suite(s) have no measured weight ...`，所以这件事不会被静默吞掉。

补齐办法：在真实 runner 上跑一次 `--all`，把每个套件的耗时回填进 `MEASURED_MS`。
在那之前，分片的**方向**是对的（重套件已分散），但**最终墙钟仍会被未称重套件支配**。
这是本 PR 不给 CI 总时长数字的第二个理由（第一个见 §0）。

---

## 5. 验证口径（本 PR 实际跑过的）

- `npx vitest run scripts/__tests__/bats-ci-shard.test.cjs` → 14 passed
- `npx vitest run scripts/__tests__/` → 618 tests, 3 failed — all three PRE-EXISTING
  (`adapters-gate-mirror-parity` ×2, `dead-plugin-test-script` ×1); confirmed by
  stashing this branch's changes and re-running: same 3 failures
- `bash scripts/check-no-npx-probe.sh` → `PASS (54 files, opt-in still gated)`，且把被禁的
  `npx --no-install eslint` 写回去会**红**（guard 2 可失败性已人工验证）
- `bash -n` 全部改动过的 shell（`typescript.sh`、`gate-1-entry.sh`、`check-no-npx-probe.sh`）
- `.github/workflows/quality-gates.yml` 可被 `js-yaml` 解析，`bats-contracts` 矩阵为 1/4..4/4
- 镜像同步：`githooks/adapters/typescript.sh` ↔ `src/npm-package/adapters/typescript.sh`、
  `githooks/gate-entries/gate-1-entry.sh` ↔ `src/npm-package/hooks/gate-entries/gate-1-entry.sh`
  字节一致

**没有**给出的结论：改完后 CI 是 X 分钟。那个数只能在真实 runner 上测得，
本机的 registry 形状与 runner 不同，按全局测量规则这里"宁可说测不出来"。

---

## 6. 分片上线后暴露出的事实：Gate 5b 一直是绿的"假绿"

`continue-on-error: true` 在这条 gate 上挂了很多轮。它的后果不是"跑得慢"，
而是**44 个套件长时间红着，而流水线一直报绿**。分片一上线、抑制一撤，
它们立刻全部冒出来——这是 gate 恢复工作，不是分片造成的回归。

上线过程本身就是一次"读日志而不是猜"的练习。每一轮的错误信息都直接说了原因：

| 轮次 | 现象 | 真实原因 | 修法 |
|------|------|----------|------|
| 1 | 4 个分片 1 秒内全红：`Test file ".../adapter-shell-scope.test.bats" does not exist` | 计划输出裸文件名，而 bats 以 `cwd=ROOT` 启动 | 计划改输出 root-relative 路径；断言改为"路径可从 ROOT 解析" |
| 2 | 分片 3：409 ok / 14 not ok | — （已大幅下降） | — |
| 3 | `gate-5a-block` 11 例红，日志里 Gate 5 是 PASS | `bats-contracts` 没装 gate 工具，fixture 跑到 `BLOCKED - archlint not installed` | 装 `gate-check` 同一套工具，并让 SETUP 步骤失败而不是 11 个 fixture 失败 |
| 3 | `gate-9-timing-unit` 7 例报"单位不配对" | 它搜的 `pre-commit` 里已没有计时代码（#798 搬进 `gate-entries/`） | 改为搜索解析 + 新增"必须找得到 body"的防真空用例 |
| 3 | `issue-537-coverage-matrix` 12 例报"契约缺失" | 同上，`languagesSource`/`coverageMatrix` 已随 Gate 6 body 搬走 | 断言改为对 preamble + 全部 entry 文件搜 |
| 3 | 34 例报 `githooks/adapters/gate-10.sh: No such file or directory` 却算 PASS | 该路径被 `.gitignore` 排除，CI 里本就不存在；`source` 失败后 `STATUS` 不变 → exit 0 | 列表改为三个**被跟踪**的副本，并新增 `AC-A-02-00` 断言每个条目先存在 |

三种"绿得没有依据"的形状，值得单独记住：

1. **搜错文件** —— `grep` 一个不包含被测代码的文件，返回 1，被读成"契约不成立"。
2. **源不存在** —— `source` 一个不存在的文件，`status` 仍是 0，被读成"gate 通过了"。
3. **列了不该存在的文件** —— 把 `gitignore` 的构建产物当成受测副本，删掉就静默少测。

失败数随每轮上线的修复单调下降，这是"抑制解除"应有的形状：

| 轮次 | 修复内容 | ok | not ok |
|------|----------|-----|--------|
| 上线前 | （`continue-on-error` 掩盖一切） | 未知 | 未知 |
| 1 | 分片跑起来后第一次诚实统计 | — | 全红（路径不解析） |
| 2 | root-relative 路径 + #798 断言迁移 | 1596 | 84 |
| 3 | needs 链 / 三个"绿得没依据"套件 | 1626 | 56 |
| 4 | 分片装 gate 工具 | 1643 | 39 |
| 5 | 工具上 PATH（`command -v` 才找得到） | 待测 | 待测 |

**"装了工具"和"gate 找得到工具"是两件事**——第 4 轮装了 archlint 并验证
`node_modules/.bin/archlint --version`，第 5 轮才发现 gate 用 `command -v`
解析而 `node_modules/.bin` 不在 runner 的 PATH 上。9 个用例失败在一个一直都在的工具上。

剩下的失败集中在 §4 记录的 fixture 成本问题（真 `mvn` / 真 `tsc` / 真 registry），
它们需要 stub，不是改断言。