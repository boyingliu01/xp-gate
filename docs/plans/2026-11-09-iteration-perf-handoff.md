# 迭代性能优化 — 新任务交接

**日期**: 2026-11-09
**分支**: `main` @ `3e215679`
**版本**: `0.37.2.0`（npm 已发布 0.37.2，三个包齐全）
**用途**: 上一个任务已多轮迭代，上下文污染。本文只记录**新任务接手必须知道的事实、已完成项、未完成项、以及踩过的坑**。不重复 CHANGELOG。

---

## 1. 当前状态（2026-11-09 实测）

| 项 | 值 | 验证方式 |
|---|---|---|
| `main` HEAD | `3e215679` | `git log --oneline -1` |
| 与 `origin/main` | 完全一致（0/0） | `git rev-list --left-right --count origin/main...main` |
| 工作区 | 干净 | `git status --short` 无输出 |
| `VERSION` | `0.37.2.0` | `cat VERSION` |
| npm latest（三个包） | 全部 `0.37.2` | `npm view <pkg> version --registry=https://registry.npmjs.org` |
| 全量测试 | 324 文件 / 3625 通过 / 2 跳过 | `./node_modules/.bin/vitest run --reporter=dot` |

**重要**：`main` 是干净可接手的基线。新任务从这里开始，不要基于任何 worktree。

### 其他 worktree（不属于本任务，别动）

| 路径 | 分支 | 状态 |
|---|---|---|
| `D:/projects/xp-gate-iter` | `feat/gate10-sastd` | **6 文件 / 564 行未提交**，sastd 守护进程 WIP |
| `D:/projects/xp-gate-merge` | `merge/gate-6-and-cli-perf` | 1 个未合并的纯文档提交 `6872f109` |

`xp-gate-iter` 那份 WIP **现在提交不了**：它新增的 `AC-SASTD-06` 没登记在 `specification.yaml`，`ac-reference-guard` 会红。要提交得先确认归属。这是那个任务的决定，别代劳。

---

## 2. 已完成（不要重做）

### 2.1 测试用例提速（已落地并发布）

| 文件 | 前 | 后 | 手法 |
|---|---|---|---|
| `phase-transition.test.js` | 85.0 s | 49.9 s | 每文件建一次 git 模板，用例 `cpSync` |
| `sprint-status-rework.test.js` | 80.5 s | 40.7 s | 同上 |
| `gate-runner.test.js` | 54.5 s | 22.9 s | 同上 |
| `doctor.test.js` | 67.5 s | 35.1 s | 补丁 `child_process` **模块对象** |

`src/npm-package/lib` 分组：**152.8 s → 113.2 s**。

**不要再优化这些**：`arch.test.js`（7.3–10.1 s，真实基线扫描，是回归守卫）、`bootstrap.test.js`（~1.4 s/例，真实 PATH 探测，故意不用 mock）、`mirror-sync.test.js`（无明显热点）。它们慢是**测试意图**，不是缺陷。

### 2.2 门禁执行提速（已落地并发布）

- **typecheck 不再走 npx**（`e05425eb`）：`npx tsc --version` 1941 ms → 本地 `node node_modules/typescript/bin/tsc` 234 ms。一次 `run_typescript_typecheck` **17,357 ms → 12,278 ms**。
- **Biome 分支退出码修复**（`4c6a7655`）：`biome check . | head -50` 之后的 `$?` 恒为 0，失败分支是死代码。本仓库无 `biome.json` 所以从不触发，中招的是下游 Biome 用户。

### 2.3 单源真理 / 缺陷治理（已落地并发布）

- `96f241a0` — `gate-registry.sh` 的 `blocks` 列对 2 个门禁是错的，原测试把错误值当规格。
- `236f1b49` — Gate 12b 之前只认 canonical 路径，镜像单独被改（v0.27.3 事故形态）会被放行。
- `47330fc0` — `sync-version.sh` / `.cjs` 两份实现已漂移：bash 版**不处理** `package-lock.json` 和 `plugins/dsh/package.json`，还多扫 360 个 `.stryker-tmp` 副本（报 401 而非 41）。已改成 `.sh` 薄包装 `exec` `.cjs`。

---

## 3. 未完成（新任务的起点）

### P1 — 镜像重复：429 文件 / ~30,404 行（**最大的一块**）

| 镜像对 | 文件数 |
|---|---|
| `githooks/adapters` ↔ `src/npm-package/adapters` | **293**（含嵌套 `adapters/plugins/`） |
| `src/principles` ↔ `src/npm-package/principles` | 107 |
| `githooks/lib` ↔ `src/npm-package/hooks/lib` | 21 |
| `src/build-integrity` ↔ `src/npm-package/build-integrity` | 8 |

当前 **0 漂移**，且有防线（`check-hook-mirror.sh`、`sync-mirrors --write`、CI `mirror-parity`、Gate 12b 双向）。

**方案与取舍已写在 `docs/plans/2026-11-08-mirror-duplication-decision.md`，三个问题等用户拍板**：
1. 选 A（补防线）/ B（移出 git，prepack 生成）/ C；
2. `mirror-parity` CI 能否把语义从「两文件相等」改成「生成可复现」；
3. 是否先做 A 的防线。

技术约束：npm `files` 只能引用包内路径，所以 `src/npm-package/` **物理上必须**有镜像；开放的只是「是否纳入 git」。

### P2 — 门禁执行成本（已量化，未优化）

TypeScript 改动一次提交的时间线（约 70 s 理想 / 142 s 实测）：

| 段 | 成本 |
|---|---|
| 启动 + Gate 0 | 7 s |
| Gate 1 静态分析 + ESLint | 19 s（typecheck 占大部分，已优化 5 s） |
| Gate 2 jscpd | 4 s |
| Gate 3 complexity | 8 s |
| Gate 4 Principles | 2 s |
| **Gate 5 测试 + 覆盖率** | **24 s** |
| Gate 6 archlint | 6 s |

**待办**：
- Gate 1 还有 `run_test_file_pass` 会再跑一次 `--listFiles`（6.5 s）+ 可能的第三次 tsc。
- Gate 5 覆盖率策略：CI 已在 `.github/workflows/quality-gates.yml:538` 跑覆盖率，pre-commit 是否需要再跑。

### P3 — 遗留 issue（诊断文档已列出，未处理）

#738（CLI 编号 9/10 双轨）、#715（Gate 6 pre-commit BLOCK vs CLI PASS）、#778（三条执行路径互不一致且无测试）、#769（registry 不被任何安装链部署；只修了 `blocks` 列那一半）。

---

## 4. 必读的坑（每条都真的踩过）

### 4.1 测量类

1. **报告数字不能当基线。** 门禁自己写的 `duration_ms=4.0 s`，而 `git commit` 实际 57.9 s —— 53.9 s 未被记录。同理 `vitest --reporter=json` 的 per-file 时间在并行下互相重叠（求和 500.9 s vs 墙钟 111 s），**不可用**。
2. **单次提交时间不可信。** 三次实测 223 / 145.6 / 145.6 s，中位数与优化前 142 s 持平。省下的 5 s 真实存在（17.4 s → 12.3 s 可重复），但小于机器噪声。**机器长期 CPU 90–100%，见 `~/.dsh/AGENTS.md` 六条硬规则。**
3. **并行度已饱和。** vitest 默认 8 workers（本机全核）。`--maxWorkers=4` 会抛 `RangeError: minThreads and maxThreads must not conflict` 且**一个测试都不跑**——我曾据此误报「13.5× 提速」。

### 4.2 代码类

4. **`core.hooksPath` 指向安装副本**（`C:\Users\think\.config\xp-gate\hooks`）。改 `githooks/` **本地不生效**，必须 `xp-gate doctor --sync-hooks`。我因此让一次镜像漂移的探针提交**真的通过了**。
5. **`const { spawnSync } = require('child_process')` 是解构**，事后替换 `cp.spawnSync` **无效**（两次尝试 68.8 s → 67.5 s，等于没改）。必须补丁模块对象本身，且在 require 之前。
6. **POSIX 管道 `$?` 是末端命令的状态**。`tool | head` 之后取不到工具的退出码。
7. **编辑 `githooks/` 后同步镜像**：`node src/npm-package/scripts/sync-package-content.js --fix`，再 `bash scripts/check-hook-mirror.sh` 验证。
8. **改 skill 文档要同步 6 个镜像树**，`sync-package-content.js` **只覆盖 4 个**。实测跟踪状态：

   | 镜像树 | git 跟踪 | 说明 |
   |---|---|---|
   | `src/npm-package/skills` | 67 文件 | 需 `sync-package-content.js` |
   | `src/npm-package/plugins/qoder/skills` | 67 文件 | 同上 |
   | `plugins/qoder/skills` | 67 文件 | **要手动 `cp`** |
   | `plugins/claude-code/skills` | 1 文件 | 只有 `sprint-flow/SKILL.md` 被跟踪 |
   | `plugins/opencode/skills` | 1 文件 | 同上 |
   | `plugins/dsh/skills` | 0 文件 | 纯构建产物 |

   漏同步会被 `skills-mirror-parity.test.cjs` 抓住（我这轮就被抓过一次）。

### 4.3 流程类

9. **测试里的 AC 编号必须能在 `specification.yaml` 解析**，否则 `ac-reference-guard` 红。新需求先登记 REQ + AC，再写测试。我这轮登记过 `REQ-GATE-INTEGRITY` 和 `REQ-VERSION-SINGLE-SOURCE`。
10. **不要 `--no-verify`。** 不要手改 `package.json` 版本（用 `node scripts/sync-version.cjs`）。代码与文档**分两次提交**。
11. **仓库有并发 git 操作**，会撞 `.git/index.lock`。删掉重试即可。
12. **`edit`/`write` 后的 `spawn EPERM` 是已知噪音**，文件其实已写入——用 `read` 或 `node --check` 复核，别重试。

### 4.4 环境类

13. **`bats` 在 `./node_modules/.bin/bats`**，`command -v bats` 找不到。
14. **`python` 是真实解释器**（`python3` 是 WindowsApps 桩）。避免用 Python heredoc 处理含 `\n`、`\(`、`\)` 的 JS/sed 文本——会被吞。
15. **npm 传播有 1–8 分钟延迟**：元数据先到、tarball 后到，期间 `npm install` 报 404/`notarget`。**必须以 tarball 返回 200 为准**，别只看 CI 日志的 "success"。
16. **本机 npm 配的是淘宝镜像** `registry.npmmirror.com`，比官方滞后。查已发布版本必须加 `--registry=https://registry.npmjs.org`，否则会得出「未发布」的错误结论。

---

## 5. 关于 10% 目标

**工程上不可达。** 仅启动 + Gate 0 就要 7 s，已超过 65 s 场景 10% 的预算（6.5 s）。现实目标约 **50%**（70 s → 30–35 s）。要真到 10% 必须**减少门禁数量**——这是产品决策，不是工程问题。新任务里先和用户确认这条边界，避免为一个不可能的目标长期优化。

---

## 6. 已知但未修

- **Gate 6 挡住所有 TypeScript 提交**：现有架构债（`doctor.js` cyclomatic 50、`computeAnomalies` cognitive 16、若干 CodeClone/DeepNesting）。仓库状态问题，不是本轮引入的。
- **`./undefined/version-cache.json`**：某次测试里 `homedir()` 被打桩成 `undefined` 的落地残留。已 gitignore，不影响发布。
- **`adapter_flat` 排序 bug**：已定单独 issue，本轮不修。

---

## 7. 参考资料

| 文档 | 内容 |
|---|---|
| `docs/plans/2026-11-08-iteration-speed-diagnosis.md` | 三个工作流的完整量化 + 优先级 ②→③→① |
| `docs/plans/2026-11-08-mirror-duplication-decision.md` | 镜像方案 A/B/C 与待决三问 |
| `docs/plans/2026-11-08-wsl-migration-handoff.md` | 上一份交接（WSL 迁移视角，部分已过时） |
| `CHANGELOG.md` §0.37.1 / §0.37.2 | 已发布的改动明细 |
