# TODO — 交接：从 Windows + DSH 迁到台式机 WSL + DSH

**写于**：2026-11-23，Windows 侧收尾时
**基线**：`main @ 1170c3dd`，`VERSION 0.38.125.0`，tag `v0.38.125`（已推远端）
**远端**：<https://github.com/boyingliu01/xp-gate>

本文是**可执行清单**，不是历史记录。历史见 `CHANGELOG.md` 与 `docs/plans/`。

> 本文合并了并行写下的两份草稿（`TODO-HANDOFF-WSL-MIGRATION.md`、
> `TODO-WSL-MIGRATION-HANDOFF.md`），并对其中**每一条事实重新核实过**——
> 合并时发现的错误已在 §11 单独列出。读完本文可以删除那两份草稿。

---

## 0. 交接状态：一句话

**代码变更全部已提交并推送，没有需要你抢救的东西。**
迁移是"搬环境"，不是"救火"：远端 `main` 就是全部真相。

```text
本地 HEAD == origin/main == 1170c3dd
VERSION                 →  0.38.125.0
tag v0.38.125           →  已推远端
npm latest              →  0.38.125
```

**唯一未推送的是本文档本身**（以及 `docs/handover-archive/` 下归档的两份旧草稿）。
它们由主控任务统一提交——若你 clone 下来没看到本文档，说明那次提交还没做，
内容以你手头这份为准。

剩下的是**决策**（§4 分支删不删、§5 issue 怎么归簇），不是未完成的工作。

---

## 1. 到 WSL 后的第一条命令

```bash
git clone https://github.com/boyingliu01/xp-gate.git ~/xp-gate && cd ~/xp-gate

git log --oneline -1        # 应为 1170c3dd 或其后代
cat VERSION                 # 应为 0.38.125.0 或其后
git tag --points-at HEAD    # 应含 v0.38.125
git status --porcelain      # 必须为空
```

- [ ] HEAD 与 VERSION 对上
- [ ] 工作区干净

**若不是 `1170c3dd` 而是更新的提交**：正常，说明有并行工作流又提交了。
先 `git log --oneline origin/main -5` 看清楚，再决定要不要读新的 CHANGELOG 条目。

**若 `git status` 非空**：新 clone 不该有未提交文件。有的话说明上次交接没收干净，
先看 `git status` 具体是什么，别急着 `checkout` 覆盖掉。

---

## 2. 为什么迁 WSL（一句话版）

Windows 上每个进程启动约 **120–130 ms**，而本仓库测试套件重度依赖子进程
（vitest 每个测试文件、每个门的每次工具探测都是新进程）。这个税在 WSL 上小一个量级。

所以迁移的真正收益**不在"代码更快"**，而在**测试反馈循环变短**——
这也正好是当前最大的成本项（见 §6）。

---

## 3. 环境准备

### 3.1 工具链

```bash
node --version   # Windows 侧 v26.13.1，WSL 建议 20+，尽量对齐
npm --version    # Windows 侧 11.20.0
```

XP-Gate 自身是**零运行时依赖**，但门禁会调用这些外部工具。
Windows 侧全部可用（已核）：

| 工具 | 用途 | Windows |
|---|---|---|
| `lizard` | Gate 3 复杂度、crap 排名 | ✅ |
| `semgrep` | Gate 4/10 静态分析 | ✅ |
| `dotnet` / `java` / `mvn` / `gradle` | Gate 9 构建完整性 | ✅ |
| `flutter` | Dart 门禁 | ✅ |

- [ ] `lizard`、`semgrep` 装上（没有它们，对应门禁会 SKIP，不是 FAIL——但你会失去真实覆盖）

### 3.2 ⚠️ `/mnt/c` 污染——**这是 WSL 特有的坑，必须先查**

`#841` 记录了一个真实事故：Gate 7 在 WSL 里选中了 `/mnt/c` 下的 Windows `checkov` shim，
`--version` 探测**通过**，真实扫描却 `exec` 失败（126），于是 IaC 提交被**无解阻断**。

```bash
# 确认 PATH 里没有 Windows 侧的 shim
echo "$PATH" | tr ':' '\n' | grep -n '^/mnt/[a-z]/' || echo "OK: 没有 /mnt 条目"
which -a lizard semgrep checkov 2>/dev/null
```

- [ ] PATH 里没有 `/mnt/c/...`
- [ ] 上面每个 `which -a` 只返回 Linux 路径

**根因**：WSL 默认把 Windows PATH 追加到末尾。在 `/etc/wsl.conf` 里关掉：

```ini
[interop]
appendWindowsPath = false
```

改完 `wsl --shutdown` 再进。

### 3.3 DSH

按你在 Windows 侧的配置重装。DSH 侧要重新接的是：
- MCP connector（`chub` / `context7` / `semble` 等，凭据需在本机重填）
- 全局 `~/.dsh/AGENTS.md`（那份"性能测量六条硬规则"**必须带过去**，见 §7）

---

## 4. 分支与 worktree：已核实无独有内容

Windows 侧现状（`git worktree list`）：

```text
D:/projects/xp-gate         1170c3dd [main]
D:/projects/xp-gate-p1e     005a1f8e [chore/orthogonal-decomposition]
D:/projects/xp-gate-release d9f7835d [release/php-gate4]
```

用 `git cherry` 按 **patch-id** 判定（不是看提交数——它们互为重复副本）：

| 分支 | 领先 main | **真正未合入 patch** |
|---|---|---|
| `chore/orthogonal-decomposition` | 2086 | **0** |
| `release/issue-fixes` | 2080 | **0** |
| `release/php-gate4` | 2074 | **0** |

我本次独立复核了这三条：`git cherry main <branch> | grep -c '^+'` 全部为 **0**。
两个 worktree 的 `git status` 也都为空。**删除是安全的。**

三处曾疑似有价值的文件已逐项确认（`VERSION`、镜像决策文档、`cross-platform-ci.yml`），
都是 main 更新。

- [ ] 决定是否删除远端这三条分支（建议删）
- [ ] 删除本地 worktree：`git worktree remove ../xp-gate-p1e` 等

> ⚠️ **`origin/bench-benchmark` 不要合并**。它的内容是在 `gate-4.sh` 里写
> `# bench marker <ts>` 时间戳当测量脚手架，合并会污染生产文件。

### 4.1 Windows 侧的 stash 不带过来

stash **不随 clone 传递**，两个旧 stash 也不会到 WSL。已核实它们的内容都已被 main
吸收或取代（逐文件比对：main 侧普遍更长，唯一"stash 更大"的
`language-capability.js` 已被 main 拆成 `language-capability-surfaces.js`）。

**这是有意的，不要试图恢复。**

---

## 5. open issue：按簇处理，不要逐个修

**总数 96**（迁移前核实），无 milestone。

> ⚠️ 本次交接**新关了 2 个**：#732、#858。它们 0.38.83 就修好了，但当时漏了关单——
> 这次补了验证评论并关闭。所以现在是 **94 个**（若你读到时不符，以 `gh issue list` 为准）。

`docs/plans/2026-11-22-convergence-plan.md` 已按根因归簇，**6 个簇覆盖 75%**：

| 簇 | 内容 | 代表 |
|---|---|---|
| C1 产出层无第三态 | "没查"被报成"通过了" | #800 #792 #813 #851 #852 #826 |
| C2 执行面不唯一 | hook / CLI / skill 三套逻辑分叉 | #778 #715 #784 |
| C3 部署链路多份清单 | 装哪些文件手写 4 处 | #769 #771 #770 #741 #756 #837 |
| C4 语言适配器登记不全 | `.mjs` `.dart` `.objectivec` `.rs` 逐个漏 | #846 #847 #848 #829 |
| C5 工具探测口径不一致 | doctor 与门禁解析不同 | #843 #841 #832 |
| C6 性能 | 提交侧长尾 | #640 #804 #805 |
| C7 真·独立缺陷 | 可逐个修 | #838 #831 #830 |
| C8 设计/索引单 | 不是缺陷 | #789 #610 #685 #638 |

**迁移后第一件事**：给每个 issue 打簇标签。不这样做，"96 个"会继续压着你。

- [ ] 建 C1–C8 标签
- [ ] C8 标 `needs-decision` 并冻结，不让它稀释信号

> **C4 我已经踩过两次**（#732、#857、#858 都是它的实例）。这个簇的机制值得记住：
> **扩展名/适配器清单在仓库里有多份，改一份不影响另一份。**

---

## 6. 性能进度：已完成什么、下一步做什么

### 6.1 已完成（有受控测量）

| 项 | 结果 | 证据 |
|---|---|---|
| gate-5c N+1 修复 | **省 3329 ms / 17.2%**，ABBA 4/4 轮方向一致 | `docs/gate-timing-baseline.md` |
| vitest work-tree guard | 每次运行省 **132 ms** | `929d6fcf` |
| python 适配器 `coverage_runs_tests()` | 免掉重复 pytest 启动 | `61a5aef2` |
| mirror-sync 一次 `git ls-files` 读两侧 | 16.46 s → 11.59 s | `1f71457c` |
| vitest 全套（更早一轮） | 370 s → 123 s | `docs/plans/2026-11-10-test-suite-speed-baseline.md` |

### 6.2 下一步（按证据排序——**这是你在 WSL 的核心任务**）

| 目标 | 当前证据 | 建议 |
|---|---|---|
| **gate-10 长尾** | 中位 261 ms，p90 66 s，**max 216 s** | 先定位触发条件，不要全量优化 |
| **gate-12** | 中位 13.9 s，p90 49.9 s，max 143.6 s | 查是否每次全树扫描 |
| **gate-5** | 中位 16.7 s，p90 71.6 s，max 289.7 s | 查 `--coverage` 是否恒开（#640） |

### 6.3 迁移后立即要做的一次测量

Windows 上全量 vitest **从未在可接受时间内跑完**（最长跑到 6 分钟仍未见底，
机器负载长期 90–100%）。到 WSL 上第一件事就是测它：

```bash
time npx vitest run --reporter=basic
```

- [ ] 记录 WSL 全量墙钟 + 当时的负载

**如果 WSL 明显更快**，说明进程启动税确实是主因，§6.2 的优先级要重排——
先做"减少进程数"的优化，而不是"优化单个门"。
**如果差不多**，说明瓶颈不在进程启动，别在错误方向上投入。

再重测这两个慢文件与 Windows 对比：

| 文件 | Windows |
|---|---|
| `src/npm-package/lib/__tests__/mirror-sync.test.js` | 11–17 s |
| `src/npm-package/lib/__tests__/phase-transition.test.js` | 单文件 120 s 未跑完 |

---

## 6b. 覆盖率棘轮 —— 用户明确的底线要求，**未完成**

这是迁移后**最重要的功能任务**，不是性能任务。用户原话：

> 只要代码行覆盖率 90%，分支覆盖率到 80% 就可以了。
> 可以分阶段提升。
> 我还是希望 90%……因为我之前很多次在提升测试覆盖率的时候就发现了 bug

**当前状态**（`vitest.config.ts` 的 `thresholds`）：

| 指标 | 当前门槛 | 实测 | 目标 |
|---|---|---|---|
| lines | 78 | 78.78 | **90** |
| statements | 78 | 78.78 | 跟随 lines |
| functions | 84 | 84.47 | — |
| branches | 81 | 81.86 | 80（**已达标**，但要守住） |

**分阶段**（用户已同意）：85 → 88 → 90。

**三条约束，务必遵守**：

1. **门槛只在 `vitest.config.ts` 一处，且必须是扁平 shape**。vitest 1.6.1 会
   **静默丢弃**嵌套 shape（issue #561）——写成嵌套不报错，只是不生效。
2. **commit 时必须守底线**。`githooks/pre-commit` 用 sed 从 `vitest.config.ts`
   解析 `lines` 值，缺失则回落 80。用户明确要求不要移除 commit 时的覆盖率检查；
   嫌慢就优化测试速度，**不要拆掉检查**。
3. **补测试要真的构造边界条件，不是凑数字**。用户反复在提升覆盖率时发现过真实
   bug——纯为命中行数写的测试会浪费这个机会。

- [ ] 先跑一次 `npx vitest run --coverage` 确认实测值（WSL 上可能与上表不同）
- [ ] 按 85 → 88 → 90 分三步提门槛，每步单独提交

---

## 6c. BATS 分片权重（次要，纯速度）

`run-bats-ci.cjs --print-only` 当前报：

```text
300/346 suite(s) have no measured weight and use 3000 ms; shard balance is approximate
```

300 个套件全按 3000 ms 估价，分片能跑但**负载极不均衡**。补上真实权重后，
4 分片的实际收益才接近理论值。

- [ ] 补测 300 个套件的耗时权重

---

## 6d. 已调查、不要再花时间的部分

避免你重复我的弯路：

- **其余生产代码的 git 调用还有 25 处**（`doctor.js` 5、`uninstall.js` 3、
  `phase-transition.js` 3 等），但**都是一次性命令，不在循环里**，优化空间小。**已排除。**
- 以下测试**不可优化**（已查）：
  - `scripts/__tests__/gate-5-runner-error.test.ts` — 被测的就是"hook 启动失败"，
    mock 掉就不测真实行为了
  - `src/principles/__tests__/config-enforcement.test.ts` — 要起真实 rules 引擎
  - `src/mutation/__tests__/mutmut-runner.test.ts` — 已完整 mock `child_process` 和
    `fs`，那 25 处都是 mock，**无真实开销**
- **worktree guard 的 gitignore 盲区是永久限制，不要当 bug 修**。守卫读
  `git status --porcelain`，对被 gitignore 的文件不可见；关掉需要 `--ignored`，
  会把 node_modules、coverage、所有生成镜像全列出来。已有测试记录该行为。

---

## 7. 必须带过去的经验（血泪版）

### 7.1 六条性能测量硬规则
在 `~/.dsh/AGENTS.md` 里，**必须带过去**。核心是：先读被测物调用契约、
别用累计 CPU 秒推实时影响、A-B-A 不是对照必须 ABBA、负载差 >5% 的对比无效。

我这轮就因为**违反第 1 条**踩了两次（gate-5c 夹具传了它不接受的参数，
以及 req-ids 过期判定导致全程空跑），两次都是"看起来在测，实际在测空气"。

### 7.2 本仓库的结构性陷阱

| 陷阱 | 症状 | 应对 |
|---|---|---|
| **`core.hooksPath`** | 改了 `githooks/` 但没生效 | `xp-gate doctor`；`xp-gate doctor --sync-hooks` |
| **stale 适配器** | `~/.config/xp-gate/adapters/*.sh` 旧版覆盖新版 | `md5sum` 两份再信结果 |
| **镜像编辑被静默回滚** | 改了 `src/npm-package/**`，下次发布消失 | 改正本 `githooks/` `plugins/` `src/<mod>/`，再 resync |
| **CLI 读镜像不读正本** | 改 `src/principles/` 后 CLI 行为不变 | 同上——**我这个也踩了一次** |
| **多份扩展名清单** | 修一处，另一处还是漏 | 见 §5 的 C4 簇 |

### 7.2b 几个真实的、会浪费你半天的坑

**两个门禁会在同一个函数上互相矛盾。** 实测案例：`gitStatus` 同时被 Gate 6 和 Gate 3 管。
Gate 6（Boy Scout）要求 `spawnSync` 必须有 `try/catch`；Gate 3（复杂度棘轮）要求该函数
CCN = 1，而 `try/catch` 让它变 2。**加也失败，不加也失败，两条门禁都没错**——
是函数承担了两个职责。

> 门禁会贴心提示"可以刷新基线通过"。**别信**。那等于用永久豁免换一次五行拆分。
> 正确解：拆成 `runGitStatus`（带 try/catch）和保持无分支的 `gitStatus`。

**shellcheck 基线是空的，任何警告都算"新增"。** `.xp-gate/lint-baseline.json` 记录
0 个条目，所以任何暂存文件里的警告都被判新增——我曾因一行**根本没碰**的代码被拦。
修掉它，**不要写进基线**，并在四种情形验证等价（有目标文件 / 空目录 / 路径不存在 / 单文件）。

**shell 注释里别写 `# shellcheck` 开头**。我用它当说明，shellcheck 把它当**指令**解析，
报了三层语法错误。换个措辞。

**"测量方法错了" ≠ "产品坏了"。** 我验证 worktree guard 时用 `.guard-violation.tmp`
当探针，没报警就断定是自己引入了回归，开始翻 diff。实际是 `.tmp` 被 gitignore，
`git status --porcelain` 对忽略路径一无所知。**先读被测物的契约，再设计测法。**

**并行工作流会偷走你的变更集。** Gate 5 有两条分支：`Changed files:` 为空 →
判为"只有文档改动" → **跳过测试报 SKIP**；有代码文件 → 真跑测试。
我遇到两次变更集为空，原因是另一个任务在我 `git add` 之后、门禁运行之前提交了。
**后果是那次提交的代码没经过本机测试验证。** 若 WSL 上还有并行工作流，
**每次提交后手动确认测试真的跑过**，别信 Gate 5 的 SKIP。

### 7.3 本仓库的硬约定

- **禁止 `--no-verify`**（违反 `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md`）
- **工具缺失 → SKIP 不是 BLOCK**，但 **secret scanning 例外**（fail-closed）
- **VERSION 是唯一真相**，manifest 由它生成，禁止手改版本字段
- **测试必须带 `@test REQ-*` / `@intent` / `@covers`**
- **TDD 强制**：RED → GREEN
- **提交信息要长**：Gate 0 在保护分支上要求 VERSION/CHANGELOG 已暂存

### 7.4 Windows 专有的坑（迁过去自动消失，但别在 WSL 重现）

- **CRLF**：`.gitattributes` 要求 `*.sh text eol=lf`。我用 Python 写 shell 文件时
  **连续三次**把行尾改成 CRLF，hook 直接拒跑（`error: Literal carriage return`）。
  写完 shell 文件务必 `file <path> | grep -c CRLF` 确认是 0。
- **MSYS 路径**：`/tmp/...` 给 Node 是读不到的，要用 `D:/...`。
- **`git index.lock` 残留**：多工作流并发提交时偶发，`sleep 2 && rm -f .git/index.lock` 即可。

---

## 8. 已知的 CI 红灯（不是你的问题）

`XP-Gate Quality Gates` 这个 job **长期是红的**，迁移前一次推送是 65 个失败。
已核对：其中绝大多数是**环境探针差异**（CI 上 `rc=4`，本地 `rc=0`），
本地对应测试是绿的。它在我动手前就是红的。

`Cross-Platform CI`、`Mutation Testing`、`npm-publish` 三个是**绿的**。

- [ ] 迁移后**不要**把"Quality Gates 红"当成回归

另外记录一个**独立的既有缺陷**（未修）：`githooks/sprint-gate.sh:269`
（装好后镜像为 `~/.config/xp-gate/hooks/sprint-gate.sh:269`）要求 `PHASE >= 1` 时
必须有 delphi APPROVED，而 295–307 行的 stale-sprint 豁免分支永远不可达。

---

## 9. 起手式（复制粘贴）

```bash
# 1. 状态核对
git clone https://github.com/boyingliu01/xp-gate.git ~/xp-gate && cd ~/xp-gate
git log --oneline -1 && cat VERSION && git status --porcelain

# 2. 工具链
node -v && npm -v

# 3. 确认没有 /mnt/c 污染（§3.2，必做）
echo "$PATH" | tr ':' '\n' | grep '^/mnt/' || echo "OK"

# 4. 安装自身依赖并自检
npm install
node scripts/test-plugins.mjs          # 应为 0 失败
bash scripts/check-hook-mirror.sh      # 应 PASS

# 5. 第一次全量测量（§6.3，这是迁移的意义所在）
time npx vitest run --reporter=basic
```

- [ ] 第 1 步输出与 §1 一致
- [ ] 第 3 步没有 `/mnt` 条目
- [ ] 第 4 步两项都通过
- [ ] 第 5 步记录了数字

---

## 10. 交接清单

- [ ] 远端 `main` 是 `1170c3dd` 或其后代，`VERSION 0.38.125.0`
- [ ] `/mnt/c` 污染已排除
- [ ] `lizard` / `semgrep` 可用
- [ ] `test-plugins.mjs` 0 失败、`check-hook-mirror.sh` PASS
- [ ] 跑了第一次全量 vitest 并记下数字
- [ ] 决定分支/worktree 去留（§4）
- [ ] 决定 issue 归簇方案（§5）
- [ ] 把 §7.1 的六条硬规则写进新机器的 `~/.dsh/AGENTS.md`

---

## 11. 合并本文时修正的旧草稿错误

诚实记录，免得你以后被旧版本误导：

1. 旧草稿写"96 个 open issue 一个没关" —— 本次已关 **#732、#858**（补了验证评论）。
2. 旧草稿说 `#732` 属于"待修"，实际 0.38.83 就已修复并发布，只是**漏了关单**。
   这是流程缺陷，不是代码缺陷：修完、发布、验证都做了，却没关单，于是 issue 列表
   在说谎。**WSL 侧请保持"修完即关单并附证据评论"的习惯。**
3. 旧草稿把 `git cherry` 的结论写在正文但未给复核命令。本文 §4 附了可直接跑的判据。

---

## 12. 现在的最短路径

1. 先按 §9 跑一遍，拿到 I/O 与测试基线。
2. 按 §6.3 的数字决定性能方向（**别先优化门禁**）。
3. 按 §5 给 issue 归簇，然后**只做 C1 簇**——收敛计划的分析是：
   open issue 不是主要问题，**产生 issue 的速度**才是。
4. 分支/worktree 清理（§4）是纯收益，随时可做。

---

## 13. 待办事项总结（全量，按优先级）

本节把散落在各章的待办集中到一处，并**逐条标注当前状态**。
标注口径：**已验证** = 本次交接时跑过命令确认；**未验证** = 沿用先前记录，未复跑。
凡标「已验证」的，命令与输出都写在旁边，你可以自己复现。

### 13.1 事实基线（本次交接时已验证）

| 事实 | 值 | 复核命令 |
|---|---|---|
| 本地 HEAD | `1170c3dd` | `git log --oneline -1` |
| 远端 main | `1170c3dd` | `git ls-remote --heads origin main` |
| VERSION | `0.38.125.0` | `cat VERSION` |
| tag | `v0.38.125` 指向 HEAD | `git tag --points-at HEAD` |
| open issue | **94** | `gh issue list --state open --limit 200 --json number` |
| 覆盖率门槛 | `lines: 78`（扁平 shape） | `grep -A12 thresholds vitest.config.ts` |

> **一处需要更正本文 §0 的说法**：§0 写 `git status --porcelain → 空`。
> 实际有三个**未跟踪**文件（本文、`docs/handover-archive/`、
> `docs/plans/TODO-2026-11-23-test-speed-supplement.md`）。
> 已跟踪文件确实是干净的，但"空"这个描述对未跟踪文件不成立。
> 这三个文件**尚未被任何提交包含**，如要留档需另行提交。

### 13.2 P0 — 阻塞迁移的事（到 WSL 后立刻做）

- [ ] **确认 `/mnt/c` 污染已排除**（§3.2）。这是唯一会**无解阻断**的坑：`#841`
      的 checkov shim 探测通过、执行失败。命令：`echo "$PATH" | tr ':' '\n' | grep '^/mnt/'`
- [ ] **跑第一次全量 vitest 并记录负载**（§6.3）。这是迁移的**唯一价值验证点**——
      若 WSL 不比 Windows 快，说明进程启动税不是瓶颈，§6.2 的优先级要整体重排。
- [ ] 装 `lizard` / `semgrep`，否则 Gate 3/4/10 静默 SKIP（不是 FAIL，你会失去覆盖）

### 13.3 P1 — 用户明确要求的底线（未完成）

- [ ] **覆盖率棘轮 78 → 90**（§6b）。用户原话："只要代码行覆盖率 90%，分支覆盖率到 80%
      就可以了"，且"分阶段提升"。当前 lines 78（实测 78.78），branches 81（已达标）。
      路径 85 → 88 → 90，每步单独提交。
      **三条约束**：门槛只写在 `vitest.config.ts` 一处且必须扁平 shape（嵌套会被
      **静默丢弃**，issue #561）；commit 侧覆盖率检查**不许拆掉**；补测试要真构造边界
      条件，不是凑行数——用户多次在提覆盖率时发现真 bug。

- [ ] **给 94 个 issue 打簇标签**（§5）。不归簇，这个数字会持续施压。
      C1–C8 的定义见 `docs/plans/2026-11-22-convergence-plan.md`。
      C8（设计/索引单，不是缺陷）标 `needs-decision` 并冻结。

### 13.4 P2 — 性能（有证据，但别先动）

- [ ] **gate-10 长尾**：中位 261 ms，p90 66 s，max 216 s（未验证）。先定位触发条件。
- [ ] **gate-12**：中位 13.9 s，p90 49.9 s，max 143.6 s（未验证）。查是否每次全树扫描。
- [ ] **gate-5**：中位 16.7 s，p90 71.6 s，max 289.7 s（未验证）。查 `--coverage` 是否恒开（#640）。
- [ ] BATS 分片权重：300/346 套件无实测权重，全按 3000 ms 估价（§6c）。

> **已完成、不必重做**：gate-5c N+1 修复（省 3329 ms / 17.2%，ABBA 4/4 轮一致）、
> vitest worktree guard（省 132 ms）、python 适配器去重、mirror-sync 读取优化
> （16.46 s → 11.59 s）。证据在 `docs/gate-timing-baseline.md`。

### 13.5 P3 — 清理（纯收益，随时可做）

- [ ] 删除三条已合入分支：`chore/orthogonal-decomposition`、`release/issue-fixes`、
      `release/php-gate4`（§4 已用 `git cherry` 按 patch-id 复核，未合入 patch 均为 0）
- [ ] 删除两个 worktree：`../xp-gate-p1e`、`../xp-gate-release`
- [ ] **不要**合并 `origin/bench-benchmark`（会把 `# bench marker <ts>` 时间戳写进
      `gate-4.sh`）

### 13.6 已知缺陷（记录在案，未修）

- [ ] `githooks/sprint-gate.sh:269` 要求 `PHASE >= 1` 必须有 delphi APPROVED，而
      295–307 行的 stale-sprint 豁免分支**永远不可达**（§8，未验证）
- [ ] `XP-Gate Quality Gates` CI job 长期红灯（65 个失败，多为环境探针差异），
      **在我动手前就是红的，不要当成迁移回归**（§8，未验证）

### 13.7 本次会话已完成、已合入主干的工作（备查）

这部分**不需要你做任何事**，列出来是为了让你知道哪些已经不用碰。

| 内容 | 状态 | 位置 |
|---|---|---|
| `docs/ARCHITECTURE.md` 删除 7 处会漂移的数字，改为指向权威命令 | 已合入，测试全绿 | `d82370de`、`8f4cbd35` |
| 测试 `arch-doc-counts.test.cjs`（4 case，真值从代码解析） | 已合入 | 同上 |
| Phase 2 新增 Step 4b：ADR 改为强制产物 `phase-2-adr.json` | 已合入 | 同上 |
| 测试 `sprint-flow-adr-trigger.test.cjs`（4 case） | 已合入 | 同上 |
| 加固：标记配对校验、`[道个]` 量词、阈值占位符白名单 | 已合入 | `d82370de` |

本次交接时复跑确认：这两个测试文件 **8 个 case 全绿**。

> 设计意图留档：架构文档之所以"删数字"而不是"改数字"，是因为改对只解决今天，
> 下次加门禁又会错；而数字是声明、代码是事实，二者天生会分离。同理，ADR 之所以
> 从"输出清单里的一项"改成强制产物，是因为**清单里的一项只是建议，完成条件才是保证**
> （ADR-0003 记录的正是"声明了但没执行"这一类缺陷）。

### 13.8 迁移时"别踩"清单（浓缩版）

按你最容易踩的顺序排列，详细原因见 §7：

1. **先读被测物契约再设计测法**——六条硬规则第 1 条，踩了两次，两次都是"在测空气"。
2. **编辑正本再 resync 镜像**——改 `src/npm-package/**` 会被下次发布静默回滚。
3. **并行工作流会偷走变更集**——Gate 5 可能因变更集为空而报 SKIP，**提交后手动确认测试真的跑过**。
4. **`core.hooksPath` 让本地编辑失效**——改完跑 `xp-gate doctor`。
5. **shellcheck 基线是空的**——任何警告都算新增，包括你没碰的行。
6. **shell 文件别写出 CRLF**——`file <path> | grep -c CRLF` 应为 0。
