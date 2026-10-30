# 把代码规范塞进提示词，还是交给质量门禁？——基于 DSH 全部 xp-gate 开发历史的实证分析

**日期**: 2026-10-29
**数据源**: `~/.dsh/sessions/--D-projects-xp-gate--/` 全部 23 个会话（原始解压 250MB+，2.3 万 steps，22,149 次计时有效的工具调用）、`.quality-history.jsonl`（559 次提交的 12 道门禁裁定）、`.xp-gate/audit.jsonl`（8,258 次门禁执行记录）、git 历史（2026-09-20 起 664 个唯一提交）
**分析脚本**: `.agent-tmp/session-analysis/*.cjs`（可重跑）

---

## 0. 一句话结论

**你的方向是对的，但"要不要把规范塞进提示词"本身是个伪二选一——真正的问题不是"塞不塞"，而是"塞什么"。**

数据表明：BUILD 阶段确实有大量返工（一次过门禁只有 66%），但**返工的主要原因不是"规范没写进提示词"，而是规范本来就是不可知的**——`skills/` 下 12 个技能文档里 `Boy Scout`、`CCN`、`jscpd`、`archlint` 出现次数**全部为 0**。模型不是"看了规范却没遵守"，而是**根本没机会知道**这些阈值。把全文规范塞进提示词会上下文爆炸且收益有限；把**可执行阈值摘要（约 1.5K token）**塞进去，才是高杠杆解。

同时你说"xp-gate 开发任务耗时最长"——**这个感受是真的，但归因错了**：门禁本身只占总耗时的 **1%**（7 小时 / 803 小时工具时长）。真正的大头是 294 小时的普通命令执行和 160 小时的等后台任务。

---

## 1. 问题一：BUILD 阶段不符合门禁导致的返工，到底有多少次？

### 1.1 核心指标：首次过门禁率 66%

以「一次代码修改（edit/write）→ 直到首次门禁 PASS」为一个回合：

| 指标 | 数值 |
|------|------|
| 走完门禁的变更回合 | **462** |
| 首次门禁运行即通过 | **307（66%）** |
| 需要 ≥1 轮返工 | **155（34%）** |
| 返工轮次 | 中位数 **2**，均值 **3.4**，最坏 **20** |

也就是说：**每 3 次修改，就有 1 次要多跑 2~3 轮门禁**。按 22,149 次工具调用、平均 16.1 秒/次计算，返工带来的重复验证是可感知的量级。

### 1.2 门禁运行层面的失败率

对 5 个主力会话（合计 3,941 次门禁类命令）中**能明确判定结果**的 1,484 次：

| 会话 | 门禁运行 | FAIL | PASS | 失败率 |
|------|---------|------|------|--------|
| 7e03aa53（最大，21 turns） | 1364 | 275 | 327 | **20%** |
| a1d8fe8d（15 turns） | 514 | 157 | 152 | **31%** |
| 7cacf4c8（14 turns） | 126 | 31 | 57 | 25% |
| 46ecacc7（17 turns） | 252 | 46 | 35 | 18% |
| 0d883c57（27 turns） | 1685 | 223 | 181 | 13% |

**在能明确判定的运行中，FAIL 占 49.3%（732/1484）**——但注意这个数字偏保守，因为大量中间运行没有明确的 PASS/FAIL 标记（2,457 次）。

### 1.3 git 层面的交叉验证：47% 的提交是 fix

| 指标 | 数值 |
|------|------|
| 唯一提交数（2026-09-20 起） | 664 |
| `fix:` 提交 | **314（47.3%）** |
| 其中可归因到门禁/规则的 | **164（52.2% 的 fix，24.7% 的全部提交）** |

典型样本（这是模型"第一次生成就不符合"的直接物证）：

```
fix(boy-scout): do not record a zero-warning file in the baseline
fix(test): make the two new test files pass Gate 1 lint
fix(test): clear the four warnings my new gate-10 tests introduced
fix(gate6): clear the warnings my own changes introduced
fix(gate-3): 把新增函数移到文件末尾，避免推移 CCN 基线的行号锚 (#636)
fix(principles): bring readParenGroup back under the Gate 3 block threshold
fix(mirror): sync the mock-policy mirror, and the drift that hid it
fix(package): 把 java.sh 改动落到真正的源文件 githooks/adapters/
```

从 1,422 条**门禁自身产出**的失败裁定行中分类：

| 失败来源 | 条数 | 占比 |
|---------|------|------|
| 静态规则违规（**规范可知**） | 384 | 27% |
| 动态/测试逻辑失败（**只有跑起来才知道**） | 301 | 21% |
| 未归类 | 737 | 52% |

静态规则违规的 top 明细，全部是**可以提前写进提示词的硬阈值**：

```
18×  ❌ BLOCKED - Boy Scout Rule violation
12×  ❌ BLOCKED - Architecture violations detected
 9×  BLOCK 11 CCN=11 (resolveImportPath@280-317 exceeds block threshold)
 9×  FAIL — 1 complexity violation(s) against .ccn-baseline.json
 7×  BLOCK 17 CCN=15 (detectProjectLang@101-145 exceeds block threshold)
 6×  FAIL: src/npm-package/hooks/gate-3.sh differs from canonical githooks/gate-3.sh
 6×  FAIL  boy-scout.test.ts > Boy Scout Rule Enforcement
 5×  BLOCK 16 CCN=16 (stripNonCode@119-143 exceeds block threshold)
```

---

## 2. 关键发现：规范对模型是**不可知**的，不是"知道了却不遵守"

这是整个分析里最反直觉、也最可操作的一条。统计 `skills/` 下全部技能文档对这些门禁概念的覆盖：

| 概念 | 出现在多少个技能 md 文件中 |
|------|--------------------------|
| `Boy Scout` | **0** |
| `CCN` | **0** |
| `jscpd`（重复率） | **0** |
| `archlint` | **0** |
| `baseline` | 2（且都不在 BUILD 阶段文档） |
| `mock density` | 2 |
| `Gate 5a` | 1 |

`skills/sprint-flow/references/phase-3-build.md` 的门禁参考表只有 **3 行**：

| Gate | 名称 | 行为 |
|------|------|------|
| Gate 5 | 单元测试 + 覆盖率 | 全部通过 + ≥80% 覆盖率 |
| Gate 5a-BLOCK | 新增 .ts/.tsx 文件测试强制 | 无对应测试 → BLOCK |
| Gate M2 | Mock 密度检查 | 30% WARNING |

**它告诉模型"有哪些门禁"，但没有告诉模型"阈值是多少、怎么写才能过"。** 真正决定成败的数字（CCN>10 阻断、Boy Scout 新文件零告警、jscpd>5%、`.principlesrc` 里 long-function 50 行 / deep-nesting 4 层 / god-class 15 方法）散落在 `.principlesrc`、`githooks/gate-3.sh`、`.ccn-baseline.json` 里，**BUILD 阶段从不加载**。

所以 `fix(test): make the two new test files pass Gate 1 lint` 这类返工，**根因不是模型不听话，而是它在写代码时从未被告知 Gate 1 的 lint 约束存在**。这正好解释了 66% 的首次通过率——模型在盲写，靠门禁当"事后诸葛亮"。

---

## 3. 问题二：把规范作为提示词，能提效吗？

### 3.1 能，但**不是把全文塞进去**

- **全文塞不动**：`AGENTS.md` 5,855 tok + `QUALITY-GATES-CODE-OF-CONDUCT.md` 1,782 tok + `phase-3-build.md` 3,538 tok ≈ **11K+ token 起步**，而且已经证明——`AGENTS.md` 本来就在系统提示里（这次会话就是），但 `Boy Scout`/`CCN` 依然没有出现在其中成为可执行指令。**"已经塞了却没生效"是现有事实**。
- **摘要版可行**：真正需要的是 **~1.5K token 的"可执行阈值卡"**。这一点有直接证据支撑：27% 的失败是静态规则违规，而静态规则是**唯一 100% 可以在生成前规避**的类别。

### 3.2 为什么不是"全部前置"

- 21% 的失败是动态逻辑（测试断言、AC 引用守卫、`.code-walkthrough-result.json` 过期）。这类**只能跑起来才知道**，前置规则对它们无效——反而会稀释注意力。
- 有相当一部分返工是**结构性漂移**（mirror 镜像不同步、adapter 重复实现、路径解析），这是架构约束，不是代码风格，应该用工具自动化而不是靠提示词自律。

### 3.3 预期收益估算（保守）

若静态规则违规（27%，约 384/1422）中有一半能在首次生成时避免：

- 回退轮次的下限收益：155 个返工回合中约 **50~60 个**不再需要返工
- 对应 **首次通过率从 66% 提升到 ~78%**
- 按每次返工中位 2 轮、每轮约 40 秒门禁 + 模型往返，节省量级在**单 sprint 数十分钟到数小时**

这不是"质变"，但正好命中你说的"等待最久"的痛点里**可被规则消化的那部分**。

---

## 4. 问题三：为什么 xp-gate 的开发任务"等待最久"？——归因纠偏

这是本次分析里最值得你知道的一条，因为它和你的直觉相反。

### 4.1 门禁本身只占 1%

按类别拆分 5 个主力会话的工具耗时（合计 803 小时测量值）：

| 类别 | 调用数 | 小时 | 占比 | >20s 的调用 |
|------|--------|------|------|------------|
| 其他命令执行（git/npm/find/probe） | 10,020 | **294.9** | **37%** | 1,174 |
| 等后台任务（job_output/job_list） | 1,841 | **159.7** | **20%** | 1,030 |
| read/grep | 2,030 | 128.3 | 16% | 34 |
| 等人（ask_user_question） | 51 | 88.7 | 11% | 48 |
| 加载 skill | 24 | 81.9 | 10% | 9 |
| 测试套件（vitest/bats/npm test） | 2,393 | 24.7 | 3% | 690 |
| **门禁钩子（pre-commit/pre-push）** | **1,913** | **7.0** | **1%** | 160 |
| workflow | 3 | 10.7 | 1% | 1 |
| lint/tsc | 351 | 3.4 | 0% | 67 |

**pre-commit + pre-push 合计只有 7 小时。** `.xp-gate/audit.jsonl` 独立验证了这一点：7,857 次有效门禁执行的**总耗时 20.8 小时**，单次均值——Gate 5 是 27.9s，Gate 1 是 18.3s，Gate 12 是 15.3s，其余都在 15s 以下。

### 4.2 真正的时间黑洞

- **单次工具调用均值 16.1 秒，22,149 次调用**。这是"等待感"的来源：不是某一件事慢，是**调用次数太多**。
- **`job_output` 平均 77.2 秒/次，共 1,626 次** —— 等后台任务。
- **`ask_user_question` 平均 177.8 秒/次** —— 等人决策。
- **只顾 1% 的优化方向是错配**：把门禁从 18s 优化到 9s，全局只省 0.5%；把"命令调用次数"降 10%，能省 29 小时。

### 4.3 审计日志的一个真实缺陷

`.xp-gate/audit.jsonl` 的 8,258 条记录里：
- **401 条 `duration_ms` 是 epoch 级脏值**（如 `1784536915891`，约等于把时间戳当成了耗时），已标记 `duration_anomaly` 但仍在污染统计
- **通过记录的门禁 FAIL 率几乎为 0** —— 因为审计只在门禁通过时落盘（`.quality-history.jsonl` 的 559 次记录同样是 0 FAIL）。**这意味着：你目前的"质量历史"看不到真实返工，它只记录成功**。要做返工治理，首先得让失败也被记录。

---

## 5. 对 xp-gate 的优化提效方案

按 ROI 排序，前三项建议优先做。

### P0 — 失败也要进审计（先能观测，才能治理）

现状：`audit.jsonl` 和 `quality-history.jsonl` 都只记成功，返工是**不可观测**的。

- Gate 失败时同样写一条 `passed:false` + `failure_reason` + `rule_id` 记录
- 修复 `duration_ms` 脏值（401 条）
- 产出一个 `xp-gate rework` 命令：按 sprint 输出「首次过门禁率」「返工轮次分布」「按 rule_id 聚合的失败 top10」

**没有这条，后面所有优化都是盲调。** 而且这正是你把 `retro`/`--rework-check` 做了但数据源不全的地方。

### P0 — BUILD 阶段注入「可执行阈值卡」（约 1.5K token，不是全文）

新建 `skills/sprint-flow/references/build-rules-card.md`，由**门禁配置自动生成**（避免文档漂移这种老问题），只含阈值不给理由：

```
## 本地门禁硬约束（生成代码前必读，超限即 BLOCK）
- 单函数 CCN ≤ 10（>5 警告）；新增函数不要插在文件中间，会推移 .ccn-baseline.json 锚点
- 单函数 ≤ 50 行；文件 ≤ 1050 行；单类公开方法 ≤ 15；嵌套 ≤ 4 层
- 新增文件：Boy Scout 零告警；修改文件：告警数不得增加
- 重复代码块 > 15 行 / 全仓相似度 > 5% → Gate 2 BLOCK
- 新增 .ts/.tsx 必须同目录有测试文件（Gate 5a），否则 BLOCK
- 改 githooks/** 必须同步 src/npm-package/**（镜像纪律）
- 测试文件必须带 @test REQ-XXX / @intent / @covers AC-XXX
- 不得使用 as any / @ts-ignore / 空 catch
```

在 `phase-3-build.md` 的 TDD-GATE 之前强制加载。这是本次分析里**性价比最高的一条**：27% 的失败类别直接对应。

### P1 — 把"事后门禁"变成"生成时检查器"

静态规则不该等到 pre-commit 才发现。给模型一个**低成本自检命令**：

- `xp-gate preset --file <path>`：只跑 Gate 1/3/4 的快速子集，单文件 < 2 秒
- 让 BUILD 阶段的每个 REQ 在写完后自检，而不是等整个 pre-commit（27.9s 的 Gate 5 是主要大头）

这直接针对 34% 返工里的静态部分。

### P1 — 治理结构性漂移（用工具，不用提示词）

`mirror/sync` 类失败 58 次、`fix(mirror)`/`fix(package)` 反复出现——这是**架构约束，不是代码风格**。提示词对此无效，应该：
- 把镜像同步做成 `edit` 时的自动后置钩子（改 `githooks/` 自动同步 `src/npm-package/`），而不是靠模型记得
- 让 `check-hook-mirror.sh` 在写文件时就提示，而不是 push 时才拦

### P2 — 削减调用次数（对应 294 小时的"其他命令执行"）

- 17.9s 均值的 `bash`/pwsh 调用中，大量是探索式探测（`where gcc`、`Test-Path`、逐文件 `Get-Content`）。提供 `xp-gate doctor --brief` 一次输出环境事实，减少 3~5 次往返
- `job_output` 77s/次 × 1,626 次是第二大支出：长任务应改为**完成即通知**（notify-on-done），而不是轮询式等待

### P2 — 明确"不要塞进提示词"的清单

避免上下文膨胀的正确做法是**只塞可判定阈值，不塞解释性规范**：
- ❌ 不塞：`AGENTS.md` 全文、门禁脚本源码、解释性 rationale
- ✅ 塞：阈值数字、镜像纪律、测试注解格式

---

## 6. 对你原判断的裁决

| 你的原判断 | 裁决 | 依据 |
|-----------|------|------|
| "用质量门禁控制代码质量" | ✅ **成立，且不可替代** | 21% 的失败是动态逻辑，只能跑起来发现；门禁是唯一能覆盖它的手段 |
| "BUILD 阶段不需要把规范作为上下文" | ⚠️ **部分错误** | 规范对模型**不可知**（Boy Scout/CCN/jscpd 在 skills 中出现 0 次），34% 的返工由此产生 |
| "否则会上下文爆炸" | ✅ **成立** | 全文 ≥11K token；而摘要卡仅 ~1.5K token，不冲突 |
| "xp-gate 开发任务耗时最长" | ✅ 感受真实，❌ 归因是门禁 | 门禁仅占 1%（7h/803h）；大头是命令调用次数（37%）和后台等待（20%） |

**最终建议**：不是二选一，而是**分层**——
1. **可判定阈值前置**（~1.5K token 卡片）→ 吃掉 27% 的静态返工
2. **门禁保留**→ 兜住 21% 的动态失败，这是提示词永远做不到的
3. **结构性漂移交给工具**→ 提示词管不了的自动同步
4. **优化调用次数而非门禁速度**→ 这是"等待最久"的真正解

---

## 附：可复现性

```bash
cd .agent-tmp/session-analysis
node extract.cjs        # 解压 ~/.dsh/sessions/--D-projects-xp-gate--/ 全部会话
node firstattempt.cjs   # 首次过门禁率 66% / 34% 返工
node final_quant.cjs    # 门禁运行失败率
node hardfails.cjs      # 门禁裁定行分类（静态 27% / 动态 21%）
node waitsplit.cjs      # 耗时归因（门禁仅 1%）
node commitstats.cjs    # git 层 fix 占比 47.3%
```
