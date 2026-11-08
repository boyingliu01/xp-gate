# 覆盖率门禁重新设计（Gate 5）

**日期**: 2026-11-07
**前置**: `2026-11-07-incremental-gates-postmortem.md`
**核心问题**: 增量测试 + 全量覆盖率统计 = 算出一个必然错、然后必须被丢弃的数字。门禁要不要挪到 pre-push？

---

## 0. 结论先行

你的直觉**方向是对的，但结论可以更精确**：

> **不是「把覆盖率挪到 pre-push」，而是「把两个不同的问题拆到两层」。**

理由：覆盖率的**全局**正确性要求全量套件，而全量套件在本仓库**实测跑了一小时以上仍未结束**。
把它塞进 pre-push 只是把这段等待从 commit 挪到 push，**总量没变，而且必然催生 `--no-verify`**。

真正该做的是把覆盖率拆成两个不同的问题：

| 层 | 问题 | 门禁 | 何时跑 | 阈值 | 现状 |
|---|---|---|---|---|---|
| **A. 本次改动的质量** | "你这几行新代码被测到了吗？" | **Changed-line coverage**（已实现，`lib/diff-coverage.sh`） | **pre-commit**，增量 | 行 ≥90% / 分支 ≥85% | **存在但被跳过** ⚠️ |
| **B. 整棵树没退化** | "全局覆盖率有没有掉？" | **Global floor**（`vitest.config.ts` thresholds 78/78/84/81） | **CI**（已如此） | ratchet | 已在 CI 生效 |

**A 才是 commit 时该问的问题**，而且它**本来就是增量的**——只看本次改动的行。
**但它现在被 `PARTIAL_TEST_RUN` 整个跳过了**（见 §1.3），所以 commit 时实际什么都没检查。

**B 是整棵树的健康度**，天然需要全量，天然属于 CI（已有 `npm run test:coverage` 在 quality-gates.yml L538-553）。

**所以"要不要挪到 pre-push"的答案是：不挪，但有两件事必须修：**
1. 把 A 修好（让它真的执行），且让它别再付 v8 的 ~22 s 固定开销
2. 认清 B 只能留在 CI，直到全量套件时长问题被解决

---

## 1. 现状：一个自相矛盾的三层结构

### 1.1 实测数字

| 调用 | 实测 | 说明 |
|---|---:|---|
| `vitest run <1 test file>` | **11.5 s** | 增量测试选择（#286） |
| `vitest run <1 test file> --coverage` | **47.1 s** | **+35.6 s 纯浪费** |
| 全量 `vitest run` | **>15 min（未跑完）** | 本机实测超时 |

**+35.6 s 的来源**：`vitest.config.ts` 的 `coverage.include = ['src/**/*.{ts,js}', 'plugins/**/*.ts']`，
覆盖范围是 **632 个源文件**，而这次只执行了 1 个。

> **注意（实测更正）**：初稿写"632 个文件全部插桩"，后续实测证明**插桩数量不是成本来源**——
> 限定到 0 个文件仍 +26 s。真正的成本是 v8 provider 的固定采集开销。见 §2.2。

### 1.2 现有三层，各自都在"正确地做错误的事"

```
① 测试选择    #286 smart selection  →  只跑相关测试        ✅ 正确
② 覆盖率统计  coverage.include      →  插桩全部 632 文件    ❌ 与①矛盾
③ 阈值判定    PARTIAL_TEST_RUN      →  降级为 WARN + 吞错误  ⚠️ 被迫的补丁
```

**②③ 是 ① 的副作用。** 没有 ①（跑全量）时，②的覆盖率是有意义的、③的判定也是对的。
有了 ① 之后，②必然算出极低数字，③只能把它降级——`pre-commit:3728` 写着：

```bash
if [ "${PARTIAL_TEST_RUN:-false}" = "true" ]; then
  echo "⚠️  Partial coverage ${COVERAGE_PERCENT}% (subset test run, not full suite)."
```

日志实测输出 `⚠️  Partial coverage 0.12% (subset test run, not full suite)`。

### 1.3 最讽刺的一点：唯一的"真门禁"被①关掉了

`pre-commit:3753`：

```bash
if declare -f compute_diff_coverage >/dev/null 2>&1 \
   && [ "${PARTIAL_TEST_RUN:-false}" != "true" ] \
   && [ -f "coverage/coverage-final.json" ]; then
```

**Changed-line coverage（#600，本就是增量、本就只看改动行）在 smart selection 启用时被整个跳过。**

已核实三条增量路径**全部**置 `PARTIAL_TEST_RUN=true`：
- `pre-commit:3305`（改动的测试文件）
- `pre-commit:3354`（related tests）
- `pre-commit:3600`（另一条子集分支）

而 `:3366` 的"无相关测试 → 跑全量"这条路径**不设**该标志，所以 diff coverage 只在
"改动了一个源文件、但找不到任何相关测试"时才会执行——**那恰恰是它最该执行、也最容易
被全量跑法拖垮的场景**。

也就是说：**能拦住"改了代码没写测试"的那个门禁，恰恰在绝大多数提交里不执行。**
而执行的那个（全局覆盖率）算出的是无意义的 0.12%，然后被降级。

> **净效果**：commit 时付了 +35.6 s，**既没有得到增量门禁的保护，也没有得到全局覆盖率的保护。**

---

## 2. 重新设计

### 2.1 决策一：pre-commit 去掉 `--coverage`，只保留测试执行

```diff
- TESTS_OUTPUT=$(run_node_bin vitest vitest.mjs run --coverage $SMART_TARGETS 2>&1)
+ TESTS_OUTPUT=$(run_node_bin vitest vitest.mjs run $SMART_TARGETS 2>&1)
```

**收益**：11.5 s vs 47.1 s，**每次 TS 提交省 ~35 s**。

**代价**：`coverage/coverage-final.json` 不再由 pre-commit 生成 → diff coverage 无数据。

**这正是决策二存在的理由。**

### 2.2 决策二：diff coverage 需要覆盖率数据，但 v8 provider 有 ~22 s 固定开销

**原假设（已被实测推翻）**：以为 `--coverage.include=<改动文件>` 能把开销降到 +2~4 s。**不是。**

**实测（Windows + v8 provider）——三个不同测试文件、三种插桩范围，全部复现同一现象**：

| 测试文件 | 无覆盖率 | 限定插桩该文件 | 插桩 **0 个文件** | 固定开销 |
|---|---:|---:|---:|---:|
| `src/architecture/version-parser` | 8.3 s | 30.0 s | 34.4 s | **~22–26 s** |
| `src/principles/analyzer` | 17.8 s | 40.3 s | — | **~22 s** |
| `src/rules/index` | 6.4 s | 20.8 s | — | **~14 s** |

**关键证据：`--coverage.include="nonexistent/**"`（一个文件都不插桩）仍然 +26 s。**
这排除了"插桩越多越慢"的假设——**开销与插桩文件数无关**。

其它已排除的因素：
- 去掉 `html` reporter（只留 json）：25.2 s，**无实质改善**
- 关闭 `globalSetup`（`XP_GATE_SKIP_WORKTREE_GUARD=1`）：34.4 s，**无改善**
- 换到自定义 `reportsDirectory`：24.4 s，**无改善**

**原因**：`@vitest/coverage-v8@1.6.1` 通过 `NODE_V8_COVERAGE` 在**进程/线程级**采集所有已加载
模块的字节码覆盖，`coverage.include` 只过滤**报告输出**，不过滤**采集行为**。所以限定范围
省下的只是报告阶段，采集阶段的固定开销一分没省。

> **这条实测推翻了本设计初稿的核心假设**（"限定插桩就能把开销降到 +2~4 s"）。记录下来是因为
> 它是一个典型陷阱：`--coverage.include` 的语义看起来是"只覆盖率这些文件"，实际是"只**报告**这些文件"。

### 2.2.1 那么 diff coverage 的数据从哪来？

三条路，按推荐度排序：

| 方案 | pre-commit 增量 | 开销 | 问题 |
|---|---|---|---|
| **A. istanbul provider** | ✅ | 实测 **5.2 s**（`--coverage.provider=istanbul`） | 需安装 `@vitest/coverage-istanbul`（当前缺）；istanbul 是源码插桩，只插被测试执行的模块 → `include` 限定**真正生效** |
| B. v8 + 接受固定开销 | ✅ | ~30 s | 相比现状 47 s 只是少了一半，达不到 10% 目标 |
| C. pre-commit 不跑覆盖率，diff coverage 移到 pre-push/CI | ❌ | 0 | commit 时无增量保护（回到现状的病症） |

**推荐 A**：istanbul 的核心优势不是"快 6 倍"这个数字，而是**它按需插桩**——只对测试实际
import 的模块插桩，`coverage.include` 对它是真约束。这样"只测改动文件"才是真的只付改动文件的成本。

**待验证（实施前必须做）**：
1. `@vitest/coverage-istanbul` 加入 devDependencies 后，单文件实测开销是否仍是 ~5 s。
2. istanbul 与 v8 对**同一改动**算出的 diff coverage 结论是否一致（数字可以不同，**判定必须一致**）。
3. CI 的全量覆盖率继续用 v8（现状不动），只有 pre-commit 的增量路径换 istanbul。

### 2.3 决策三：全局覆盖率只留在 CI（不做任何迁移）

现状已经如此（`quality-gates.yml` L538-553 跑 `npm run test:coverage`）。

**为什么不挪到 pre-push**：

| 方案 | 每次迭代成本 | 保护效果 |
|---|---|---|
| 现状（pre-commit 跑无效覆盖率） | **+35 s/次，0 保护** | 无 |
| 挪到 pre-push（全量覆盖率） | **+15 min/次**（全量套件跑不完） | 有，但没人会等 |
| **本设计（pre-commit 只做 diff，CI 做全局）** | **+2~4 s/次，有增量保护** | commit 级 + CI 级 |

**关键判断**：全量套件在本机**实测跑了一小时以上仍未结束**（`vitest run` 无覆盖率，被手动终止）。
把它放 pre-push 的实际后果不是"更慢"，而是**所有人开始用 `--no-verify`**——这正是
`QUALITY-GATES-CODE-OF-CONDUCT.md` 要防的事。
**一个没人愿意等的门禁等于没有门禁，且会腐蚀其他门禁的可信度。**

> **这也回答了"要不要挪到 pre-push"**：挪过去的前提是"全量套件跑得动"。**它跑不动。**
> 所以在解决套件本身的时长之前，任何"把覆盖率放到 pre-push"的方案都会立刻退化成
> `--no-verify`。**先修套件时长，再谈放在哪。**

### 2.4 决策四：`PARTIAL_TEST_RUN` 的降级逻辑可以删除

一旦 pre-commit 不再做全局阈值判定（改由 CI 做），`pre-commit:3728` 那段
"检测到低覆盖就降级 WARN + 匹配错误文案吞掉"的代码就没有存在理由了。

**这是一笔债务清理**：那段代码存在的唯一原因是"在错误的层做了错误的判定，然后补救"。
层修对了，补丁就该删。

---

## 3. 最终形态

```
pre-commit（每次 commit，增量）
  ├─ 测试选择        #286 smart selection              ✅ 保留
  ├─ 执行测试        相关测试，无 --coverage            ✅ 决策一
  ├─ 覆盖率数据      仅当有改动行需要判定时才生成        ✅ 决策二
  └─ Changed-line    ≥90% 行 / ≥85% 分支，BLOCK          ✅ 复活
      （全局阈值不在这里判定）

pre-push（每次 push）
  └─ 不含覆盖率（不做本设计的改动）

CI（每次 PR / main）
  └─ 全量套件 + 全局阈值 78/78/84/81，BLOCK             ✅ 已有，不变
```

### 3.1 成本对照（按实测重算）

| | 现在 | 方案 A（istanbul） | 方案 B（v8 保持） |
|---|---:|---:|---:|
| pre-commit 测试阶段（1 个测试文件） | 47.1 s | **~11–13 s**（5.2 s 待复核） | ~30 s |
| 增量保护（改了行没测） | **无**（被跳过） | **有**（BLOCK） | 有 |
| 全局退化保护 | 无（pre-commit 无效，靠 CI） | CI 不变 | CI 不变 |

> **方案的真正分水岭不是"快多少"，而是 v8 的固定开销能不能消掉。** 实测证明
> `--coverage.include` 消不掉它（插桩 0 个文件仍 +26 s）。所以：
> - 若 istanbul 复核确认 ~5 s → 方案 A，**复用现有 diff-coverage 实现，一行 provider 参数之差**
> - 若 istanbul 也不达标 → 方案 B，但那样 pre-commit 只能从 47 s 降到 30 s，
>   **达不到 10% 目标**，此时应转而讨论"commit 时不跑覆盖率"（方案 C），并接受
>   "增量覆盖率保护只在 CI 生效"这个退让

---

## 4. 必须验证的性质（TDD-RED 清单）

按项目 AGENTS.md 的 TDD 强制要求，实施前这些用例必须先红：

1. **provider 切换不改结论**：同一改动，istanbul 与 v8 算出的 diff coverage **判定**一致
   （具体百分比可以不同）。
2. **改了行没写测试必须 BLOCK**：新增 5 行无测试代码 → diff coverage 门禁 FAIL。
3. **改了行有测试必须 PASS**：同上但补测试 → PASS。
4. **无覆盖率数据不是 PASS**：`coverage-final.json` 缺失 → 按 #570 的既有约定处理（fail-closed 或明确 WARN）。
5. **`.d.ts` / 纯常量文件不被算 0%**：沿用既有 `NA` 语义（`diff-coverage.sh` 已实现）。
6. **全局阈值仍是 CI 的责任**：本地 pre-commit 不因全局 78% 未达标而 BLOCK。
7. **smart selection 启用时 diff coverage 真的会跑**：这是本设计的核心，也是现在唯一的空洞——
   必须有测试证明它在 `PARTIAL_TEST_RUN=true` 下不再被跳过。

---

## 5. 待你拍板的问题

1. **要不要引入 `@vitest/coverage-istanbul`**：这是方案 A 的前提。代价是新增一个 devDependency；
   收益是 pre-commit 覆盖率从 ~30 s 降到 ~5 s。**我建议先做一次 30 分钟的验证再定，
   而不是现在就赌它快**（本设计已经因为一个未验证的假设返工过一次）。
2. **diff coverage 的阈值**：现在是行 ≥90% / 分支 ≥85%。commit 级用 90% 会不会太严导致日常被拦？
   （可考虑 commit 级降为 80%，CI 保持 90%）
3. **如果 istanbul 也不达标，接受"commit 不做覆盖率、只在 CI 做"吗**：
   这是方案 C。它意味着"改了行没写测试"在 commit 时不再被拦，只能等 CI。
   **这是一个真实的保障退让，必须你明示接受，我不会默认选它。**
4. **全量套件 >1 h 这件事本身**要单独立项——它不只是覆盖率问题：
   - 它让"覆盖率回本地"永远不可能
   - 它让"pre-push 加任何全量校验"永远不可能
   - `2026-11-06-dev-throughput-bottleneck-analysis-v2.md` 指出 `init.test.js` 单文件 6.4 分钟
   **这是本次所有讨论的根上那块石头。**

---

## 6. 不做的事

- 不降低全局阈值（78/78/84/81）。
- 不在 pre-commit 跑全量套件。
- 不删除 `coverage` 报告生成能力（CI 仍需）。
- 不用"覆盖率算不出来就跳过"作为方案——那正是现在的病症。
