# 迭代速度基线（Iteration Speed Baseline）

**日期**: 2026-11-07
**目标**: 把「改一行 → 提交 → 推送」的迭代时间压缩到当前的 **10%**
**状态**: 基线已实测，优化方案待批准

---

## 0. 结论先行

两个场景的实测基线（端到端：编辑 → `git commit` 通过 pre-commit → `git push` 通过 pre-push）：

| 场景 | 基线（中位） | 目标（10%） |
|---|---|---|
| **场景一**：改一行 hook 脚本 | **~65 s** (commit 42 s + push 24 s) | **≤ 6.5 s** |
| **场景二**：改一段 TypeScript | **~150 s** (commit 124 s + push 26 s) | **≤ 15 s** |

关键发现：**两个场景的成本结构完全不同**，不能用同一个办法解决。

- 场景一的成本几乎全部是**固定开销**（Gate MP 镜像比对 10–32 s，几乎每次 push 都跑全树扫描）。
- 场景二的成本主要来自**四个门禁反复重扫同一棵树**（Gate 1 ESLint、Gate 5 vitest、Gate 6 archlint、Gate 10 semgrep）。

---

## 1. 测量方法

### 1.1 环境

| 项 | 值 |
|---|---|
| 平台 | Windows 11 + Git Bash (MSYS2) |
| Node | v24.22.1 / npm 11.19.1 |
| 仓库 | `D:\projects\xp-gate` @ `1340b991`（main），VERSION 0.37.0.0 |
| 工作副本 | 独立 worktree `D:\projects\xp-gate-bench`（`bench/iteration-speed` 分支） |
| `core.hooksPath` | `D:/projects/xp-gate/githooks`（worktree 共享同一套 hook） |
| 工具链 | shellcheck / eslint / jscpd / lizard / semgrep / gitleaks / archlint 均已安装 |

> 用独立 worktree 是为了不污染主工作区，同时共享同一套 hook 与 `node_modules`。
> 注意：`git commit` 会用 HEAD 内容覆盖已暂存文件，所以每次迭代都必须**真的产生一次内容变更**再提交。

### 1.2 测量口径

- **时间轴**：`git add` 之前 → `git commit` 返回 → `git push` 返回。
- 单次读数噪声大（同机负载波动 2–5 倍，参见 `2026-11-06-dev-throughput-bottleneck-analysis-v2.md` 的核心教训），因此**逐门禁中位数**取自审计日志的 30 次提交样本，端到端取多次实测。
- 数据来源：`.xp-gate/audit.jsonl`（逐门禁 `duration_ms`）、`.xp-gate/reports/pre-push/*.json`（push 各门禁）。

### 1.3 场景一（hook）的合法性约束

改 hook 脚本要过 **Gate 12b（镜像一致性）**，所以一行改动实际要同步到三份文件：

```
githooks/gate-4.sh                     ← canonical
src/npm-package/hooks/gate-4.sh        ← mirror (hooks/)
src/npm-package/gate-4.sh              ← mirror (root)
```

这是真实工作流成本，**必须计入**，不能省略。

### 1.4 场景二的 push 端

改 TS 后 push 会触发 Gate M（增量变异测试）+ Gate MW（代码走查证据）。MW 需要
`.code-walkthrough-result.json` 与**当前 HEAD** 精确匹配、未过期、且三个席位的
`requested_model` 与 `.delphi-config.json` 一致——即一次真实的 Delphi 评审产物。

---

## 2. 逐门禁基线（pre-commit，30 次提交中位）

| Gate | 名称 | 中位 | 说明 |
|---|---|---:|---|
| 1 | Code Quality (ESLint/shellcheck) | **20.9 s** | 全树 ESLint；TS 改动时最贵 |
| 5 | Tests + Coverage (vitest) | **17.7 s** | 相关测试子集 + v8 覆盖率 |
| 6 | Architecture (archlint) | **9.7 s** | 全树扫描 + baseline ratchet |
| 9 | Build Integrity (tsc+pack) | **5.1 s** | |
| 2 | Duplicate Code (jscpd) | **4.9 s** | |
| 12 | File Hygiene | **4.7 s** | 含 Gate 12b 镜像比对 |
| 11 | Sprint Flow | **3.2 s** | 非 sprint 项目也付 ~2.6 s |
| 13 | Compiler Strictness | **2.7 s** | 无 C/C++ 文件也付 3 s |
| 8 | Secret Scanning (gitleaks) | **1.6 s** | |
| 0 | Version Consistency | **1.0 s** | |
| 7 | IaC Security | **0.9 s** | |
| 3 | Complexity (lizard) | **0.8 s** | |
| 4 | Principles | **0.6 s** | |
| **合计** | | **≈66 s** | 不含 hook 启动开销 |

### 2.1 一次真实 TS 提交的逐门禁时间线（worktree 实测）

```
gate-0    1.1 s   gate-1   37.2 s   gate-2    3.7 s   gate-3   11.3 s
gate-4    2.3 s   gate-5   15.3 s   gate-6   15.3 s   gate-8    2.9 s
gate-9    8.1 s   gate-10  26.1 s   gate-11   2.0 s   gate-12   2.5 s
gate-13   3.0 s                     → 合计 130.8 s
```

**Gate 1 / 3 / 5 / 6 / 10 五项合计 ≈ 105 s，占 80%。** 它们在测同一件事——"这棵树有没有问题"——
只是各自用不同的工具把整棵树（或大量无关文件）重扫一遍。

> Gate 3（lizard）本该是 diff 作用域（日志里确实是 `SKIP — no changed source files`），
> 但在有 TS 变更时实测跳到 11–25 s，说明该路径存在全树回退。

---

## 3. 场景一（hook）成本分解

| 阶段 | 中位 | 占比 | 性质 |
|---|---:|---|---|
| pre-commit 全链 | 42 s | 65% | 与场景二相同的一套门禁 |
| Gate MP（镜像一致性） | **10–32 s** | 35–50% of push | **全树 `diff -rq` 扫描，与本次改动无关** |
| Gate MW（走查证据） | <1 s | — | 读 JSON 校验 |
| Gate M / M2 / ML / UI / S | ≈0 | — | 全部 SKIP |
| **合计** | **~65 s** | | |

**Gate MP 是场景一最大的单点浪费**：每次 push 都对比全部 47 组镜像 + 5 个目录树
（`adapters/`、`principles/`、`mutation/`、`mock-policy/`、`plugins/*/src/`），
即使本次只改了一个与镜像无关的文件。实测单次 `check-hook-mirror.sh` 稳定 10–11 s。

---

## 4. 场景二（TypeScript）成本分解

| 阶段 | 中位 | 占比 |
|---|---:|---|
| pre-commit 全链 | ~102 s | 80% |
| Gate M（增量变异） | 常 SKIP | — |
| Gate MP | 10–32 s | 20% |
| **合计** | **~150 s** | |

场景二的 TS 改动**不触发 Gate M**（日志明确 `No changed TypeScript source files. SKIP — Gate M.`），
因为变异测试只对**被测的** TS 源文件生效，而 `src/architecture/version-parser.ts` 走了
pre-commit 里 Gate 5 的"相关测试子集"路径。

---

## 5. 浪费模式分类（这是优化的靶子）

按"可否在不降低检出能力的前提下消除"排序：

| # | 模式 | 实例 | 可回收 |
|---|---|---|---|
| W1 | **全树扫描与 diff 无关** | Gate MP 全树 diff、Gate 6 archlint 全树、Gate 1 全树 ESLint | 高 |
| W2 | **同一份工作被重复计算** | Gate 1 / 3 / 5 / 6 / 10 各自重新解析全树 | 高 |
| W3 | **无内容可检却起完整工具** | Gate 13 无 C/C++ 仍选编译器（3 s）、Gate 11 非 sprint 项目仍跑（2.6 s）、Gate 7 无 IaC（0.9 s） | 高 |
| W4 | **每次跑都付的固定启动税** | 25 处 `node -e`、68 处 `git` 子进程（每个 60–200 ms） | 中 |
| W5 | **证据门禁绑定到精确 HEAD** | Gate MW 要求 walkthrough 的 commit == HEAD，改一行就作废 | 需重新设计，非纯性能问题 |

> W2 是最大的一笔：**一次迭代要把同一棵树完整解析 5 遍**。
> 这不是"某个门禁慢"，而是"五个门禁各自为政"。

---

## 6. 目标与判定标准

| 指标 | 基线 | 目标 | 判定方式 |
|---|---:|---:|---|
| 场景一 端到端 | ~65 s | ≤ 6.5 s | 同机、同 worktree、≥5 次取中位 |
| 场景二 端到端 | ~150 s | ≤ 15 s | 同上 |
| **检出能力** | — | **不降低** | 每个被优化/跳过的门禁都必须有"仍然能拦住真实缺陷"的回归用例 |

**硬约束**：10% 不是靠"少跑门禁"达成的。任何"这次改动不相关所以不跑"的判定，
都必须由一个**可执行的用例**证明它在缺陷真实存在时会跑、会拦。
否则就是把门禁偷偷关掉，用速度换取假绿——这是本项目明文禁止的失败形态。

---

## 7. 下一步

方案设计见 `2026-11-07-iteration-speed-optimization-design.md`（待 Delphi 评审）。

优化必须按"风险 × 收益"排序，且每一项都要落到可测量的数字上：

1. **先止血固定开销**（W1/W3）：Gate MP 只比对本次改动的镜像家族；无内容可检的门禁直接短路。
2. **再消除重复计算**（W2）：把"解析一次、多方复用"引进来（例如一次 ESLint/tsc 的前端产物复用）。
3. **最后处理证据门禁**（W5）：Gate MW 绑定 HEAD 的语义需要重新论证，不是纯性能改动。

---

## 附录 A：复现方式

```bash
# 1. 建独立 worktree（不污染主工作区）
git worktree add /d/projects/xp-gate-bench -b bench/iteration-speed HEAD
# 2. 共享 node_modules（Windows junction，避免重装 285 MB）
powershell -c 'New-Item -ItemType Junction -Path "D:\projects\xp-gate-bench\node_modules" -Target "D:\projects\xp-gate\node_modules"'
# 3. 场景一：一行 hook 改动（同步三份镜像）
for f in githooks/gate-4.sh src/npm-package/hooks/gate-4.sh src/npm-package/gate-4.sh; do
  printf '\n# bench marker %s\n' "$(date +%s)" >> "$f"
done
# 4. 计时
time (git add -A && git commit -m bench && git push -q origin bench/iteration-speed:refs/heads/bench-benchmark)
```

**逐门禁数据**直接从 `.xp-gate/audit.jsonl` 读取（每个 gate 一条 `duration_ms`），
不需要额外埋点。

## 附录 B：本次测量中发现的既有缺陷（未修复，超出本任务范围）

| # | 缺陷 | 影响 |
|---|---|---|
| D1 | `githooks/gate-12-file-hygiene.sh` 缺 `# shellcheck shell=bash`，自身有 6 处 shellcheck 告警 | 任何提交只要暂存了含此文件变更的 .sh 集合，Gate 1 直接 BLOCK |
| D2 | `.xp-gate/lint-baseline.json` 内容是 `{}`（且被 gitignore） | Boy Scout 基线为空 ⇒ shellcheck 的 11 处既存告警会把所有 .sh 提交 BLOCK |
| D3 | `githooks/gate-2.sh`、`gate-5.sh`、`gate-6.sh` 不存在 | 向它们追加内容会**创建新文件**，导致 shellcheck 报"缺少 shebang"，且 Gate 12b 报镜像缺失 |
| D4 | Gate 13 用 g++ 做"编译器严格度"检查，但仓库无 C/C++ 源文件 | 每次固定 ~3–5 s 无产出（g++ 0.5s + javac 2.4s + dotnet 0.7s 全为工具探测） |
| D5 | Gate 11 在非 sprint 项目仍起子进程跑 `sprint-gate.sh` | 每次固定 ~2.6 s，只为打印 `{"decision":"skip"}` |
| **D6** | **Gate 10 用 `--config=p/security-audit`（registry 引用），每次联网拉规则；本机 `semgrep.dev` read timeout，一路重试到 180 s 超时** | **每次 TS 提交白付 100–200 s，且实际什么都没扫，然后降级 SKIP**。审计日志里 Gate 10 的 200 s 样本即由此产生 |
| **D7** | **Gate 5 跑 `vitest run --coverage`，即使只跑 1 个测试文件也给整棵树插桩** | **单测试文件 5.1 s → 34.7 s**。算出的 0.12% 覆盖率被 hook 用"字符串匹配错误文案"吞掉（#473 的已知 workaround），既慢又无意义 |

> D6 与 D7 是本次基线测量中**收益最大**的两项，它们不是"慢"，而是"做了无用功还号称跑过"。
