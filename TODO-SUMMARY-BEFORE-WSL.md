# TODO — 待办总结（迁移 WSL 前）

**写于**：2026-11-23
**基线**：`main @ 1170c3dd`，`VERSION 0.38.125.0`，与 `origin/main` 同步
**本文性质**：只做**待办事项总结**。不推送、不改代码——推送由主控任务统一处理。

---

## 0. 先确认：当前没有"抢救项"

```text
本地 HEAD == origin/main == 1170c3dd
VERSION                  == 0.38.125.0
npm latest               == 0.38.125   （registry 直查确认）
工作区                    == 干净（仅暂存了 4 个交接文档，未提交）
open issue               == 94
```

**迁移是搬环境，不是救火。远端 main 就是全部真相。**

> 注：`npm view` 在本机会返回 `0.38.83`，那是**本地元数据缓存**。
> 用 `curl https://registry.npmjs.org/-/package/@boyingliu01%2Fxp-gate/dist-tags` 查才是真值。
> 这一点我一开始读错了，已核实纠正。

---

## 1. 待办总表（按优先级）

| # | 事项 | 类型 | 状态 | 阻塞后续？ |
|---|---|---|---|---|
| A | 覆盖率 78% → 90% | **功能** | 未开始 | 是——用户明确的底线要求 |
| B | WSL 上重测性能基线 | 测量 | 未开始 | **是**——它决定 C 的优先级 |
| C | 提交侧长尾优化（gate-5/10/12） | 性能 | 部分完成 | 否 |
| D | 96→94 个 open issue 归簇 | 治理 | 未开始 | 否 |
| E | 分支/worktree 收口 | 清理 | 已核实，待决策 | 否 |
| F | BATS 分片权重 | 性能（次要） | 未开始 | 否 |

---

## 2. A — 覆盖率棘轮（迁移后最重要的**功能**任务）

用户原话：

> 只要代码行覆盖率 90%，分支覆盖率到 80% 就可以了。可以分阶段提升。
> 我还是希望 90%……因为我之前很多次在提升测试覆盖率的时候就发现了 bug

**当前门槛**（`vitest.config.ts:156-161`，已核实）：

| 指标 | 当前 | 目标 |
|---|---|---|
| lines | 78 | **90** |
| statements | 78 | 跟随 lines |
| functions | 84 | — |
| branches | 81 | 80（**已达标，守住即可**） |

**三条硬约束**：

1. **必须是扁平 shape**。vitest 1.6.1 对嵌套的 `thresholds.global` **静默丢弃**——
   写成嵌套不报错，只是完全不生效。这条是真实事故（仓库曾在 60.08% 上声称 80% 门槛，
   每次提交都 exit 0）。
2. **commit 时必须守底线**。`pre-commit` 用 sed 从 `vitest.config.ts` 解析 `lines`，
   缺失则回落 80。**不要移除 commit 时的覆盖率检查**——嫌慢就提速，不要拆检查。
3. **补测试要构造真实边界条件，不是凑行数**。用户多次在提覆盖时发现真实 bug，
   为命中行数写的测试等于浪费这个机会。

- [ ] WSL 上跑 `npx vitest run --coverage` 确认实测值（可能与上表不同）
- [ ] 按 85 → 88 → 90 分三步，每步单独提交

---

## 3. B — WSL 性能基线重测（**必须先做，它决定 C 的顺序**）

Windows 上全量 vitest **从未在可接受时间内跑完**（5 次尝试，最长 6 分钟仍未见底）。
我本次实测也印证：`timeout 600 npx vitest run` 跑满 600 秒才结束。

```bash
time npx vitest run --reporter=basic     # 记录墙钟 + 当时负载
```

- [ ] 记录 WSL 全量墙钟与负载
- [ ] 重测两个慢文件做对照：
      `src/npm-package/lib/__tests__/mirror-sync.test.js`（Win: 11–17 s）
      `src/npm-package/lib/__tests__/phase-transition.test.js`（Win: 120 s 未跑完）

**判据**：如果 WSL 明显更快 → 进程启动税是主因，C 应先做"减少进程数"；
如果差不多 → 瓶颈不在进程启动，**别在错误方向投入**。

> ⚠ Windows 侧历次记录的"负载 90–100%"**已被证伪**：`LoadPercentage` 读数 90–100%，
> 而用 CPU 差分实测只有 6–12%（我复测 32.8%）。
> WSL 换了测量工具，**基线必须重测，不要沿用 Windows 数字**。

---

## 4. C — 提交侧长尾优化

**已完成**（有受控测量）：

| 项 | 收益 | 提交 |
|---|---|---|
| gate-5c N+1 修复 | **3329 ms / 17.2%**，ABBA 4/4 轮一致 | `docs/gate-timing-baseline.md` |
| vitest work-tree guard | 每次运行 132 ms | `929d6fcf` |
| python `coverage_runs_tests()` | 免一次重复 pytest 启动 | `61a5aef2` |
| mirror-sync 单次 `git ls-files` | 16.46 s → 11.59 s | `1f71457c` |
| vitest 全套（更早一轮） | 370 s → 123 s | `2026-11-10-test-suite-speed-baseline.md` |

**待做**（近 7 天实测，n=门禁记录数）：

| 门禁 | 中位 | p90 | max |
|---|---|---|---|
| gate-5 | 18.5 s | 64.1 s | **289.7 s** |
| gate-10 | 0.28 s | 48.5 s | **215.6 s** |
| gate-3 | 0.58 s | 22.6 s | 181.7 s |
| gate-12 | 11.8 s | 47.3 s | 143.6 s |

> **关键判断**：中位不高，**p90 与 max 差 5–10 倍**。
> 你感受到的"慢"是**长尾**，不是中位。
> 完成判据应是 **p90 降到 <30 s、max <60 s**，而不是"中位降 X%"。

- [ ] gate-10：先定位"何时变成 200 秒"，不要全量优化
- [ ] gate-12：查是否每次全树扫描
- [ ] gate-5：查 `--coverage` 是否仍恒开（#640）

---

## 5. D — 94 个 open issue：按簇处理，不要逐个修

**45 天实测：开 181、关 85，净 +96**（现为 94，有其他工作流在关）。
在这个速率下，"逐个修"必然修不完。

**根因证据**（近 45 天，15,387 条门禁记录）：

| 指标 | 数值 |
|---|---|
| SKIP 占比 | 10%（1583 条） |
| **SKIP 无任何原因** | **35%（559 条）** |
| 无原因大户 | gate-6 (153)、gate-10 (125)、gate-4 (92)、gate-7 (83) |

> 45 天前这个比例是 **49%**，现在降到 35%——**有并行工作在修，方向是对的。**
> 但它仍然是"没查"被记成"查了没问题"的直接证据，违反
> `AGENTS.md` 里最高优先不变式。

**6 个簇覆盖大部分 issue**（详见 `2026-11-22-convergence-plan.md`）：

| 簇 | 代表 issue |
|---|---|
| C1 产出层无第三态 | #800 #792 #813 #851 #852 |
| C2 执行面不唯一 | #778 #715 #784 |
| C3 部署链路多份清单 | #769 #770 #771 #741 #837 |
| C4 语言适配器登记不全 | #732(已关) #846 #847 #848 #829 |
| C5 工具探测口径不一致 | #843 #841 #832 |
| C6 性能 | #640 #804 #805 |
| C7 真·独立缺陷 | #838 #831 #830 #754 |

- [ ] 建 C1–C8 标签，给 94 个 issue 归簇
- [ ] C8 索引单（#789 #610 #685 #638）标 `needs-decision` 冻结

**与 WSL 直接相关**：#841 Gate 7 在 WSL 里可能选中 `/mnt/c` 下的 Windows checkov shim，
`--version` 通过但真实扫描 exec 失败（126）。**迁过去一定会遇到，先查 `which checkov`。**

---

## 6. E — 分支与 worktree：已核实，等你决策

**已核实结论（`git cherry` 按 patch-id 判定，不是看提交数）**：

| 分支 | 领先 | 真正未合入 patch | 版本 | 结论 |
|---|---|---|---|---|
| `chore/orthogonal-decomposition` | 2086 | **0** | — | 内容已在 main |
| `release/issue-fixes` | 2080 | **0** | 0.38.75 | 内容已在 main，无独有内容 |
| `release/php-gate4` | 2074 | **0** | 0.38.74 | 内容已在 main，无独有内容 |

**远端只有 5 条分支**：`main`、`chore/orthogonal-decomposition`、
`feat/arch-doc-guard`、`fix/gate-6-layer-config-forms`、`fix/gate-6-yaml-forms-811`。

**仅本地存在的**：`release/issue-fixes`、`release/php-gate4`
（各自 `git cherry` 未合入 patch = 0，**不会因迁移丢内容**）。

**worktree 3 个**（其中 2 个指向上述冗余分支）。

- [ ] 决定是否删除 `release/issue-fixes`、`release/php-gate4` 与对应 2 个 worktree
- [ ] 决定是否删除远端 3 条已无独有内容的分支
- [ ] **`origin/bench-benchmark` 不要合并**——内容是往 `gate-4.sh` 写
      `# bench marker <ts>` 时间戳当测量脚手架，会污染生产文件

> **注意**：之前存在的两条 `wip/*` stash 转分支已被另一个工作流删除。
> 两个 stash 本身仍在本机（`stash@{0}` 11-19、`stash@{1}` 11-13），
> 已逐个核实内容被 main 吸收或取代（stash 侧文件普遍更短）。**不要恢复。**

---

## 7. F — BATS 分片权重（次要）

`run-bats-ci.cjs --print-only` 报：

```text
300/346 suite(s) have no measured weight and use 3000 ms; shard balance is approximate
```

- [ ] 补测 300 个套件耗时权重
- [ ] WSL 上确认分片能**真并行**（`which flock`；Git for Windows 不提供，这是迁移动机之一）

---

## 8. 已调查、不要再花时间

- 其余生产代码 25 处 `git` 调用（`doctor.js` 5、`uninstall.js` 3 等）**都是一次性命令，不在循环里**
- 不可优化（已查）：`gate-5-runner-error.test.ts`（被测就是 hook 启动失败）、
  `config-enforcement.test.ts`（要起真实 rules 引擎）、
  `mutmut-runner.test.ts`（已完整 mock，无真实开销）
- **worktree guard 的 gitignore 盲区是永久限制**，不要当 bug 修

---

## 9. 最后三条提醒

1. **WSL 上别跨环境探测**。`githooks/AGENTS.md` 记录过：WSL 改变 `$HOME`、
   解释器和文件可见性，曾产生"假的产品缺陷"诊断。**在 WSL 里就只在 WSL 里测。**
2. **仓库必须在 Linux 原生路径**（`~/`），不能在 `/mnt/c`——否则 CRLF、权限、
   大小写、inotify 全部失效。
3. **多个 agent 同时动一个仓库时，提交前先 `git status` 确认暂存区只有你的文件。**
   本次交接撞到过两次：一次是并发提交把我暂存的文件连带提交（提交信息与内容不匹配），
   一次是我写的交接草稿被另一路同时归档。这不是理论风险。

---

## 10. 相关文档

| 想了解 | 看 |
|---|---|
| 完整交接（环境准备、坑清单） | `TODO-WSL-MIGRATION-HANDOVER.md` |
| 收敛计划、6 个已拍板决策 | `docs/plans/2026-11-22-convergence-plan.md` |
| 架构正交分解（4 根因） | `docs/plans/2026-11-09-architecture-orthogonal-decomposition.md` |
| 测试套件提速全记录 | `docs/plans/2026-11-10-test-suite-speed-baseline.md` |
| 门禁耗时基线 | `docs/gate-timing-baseline.md` |

> `docs/plans/` 有 109 份文档，相当一部分结论已被后续测量推翻。
> **看到旧数字，先确认它有没有被更新的测量取代**（负载指标就是活例子）。
