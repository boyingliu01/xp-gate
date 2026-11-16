# XP-Gate 门禁可用性矩阵（地毯式验证）

**日期:** 2026-11-16
**范围:** pre-commit 8 道脚本门禁 × 12 种语言 + pre-push 6 道门禁
**方法:** 真实 fixture + 真实工具链 + 按 pre-commit 的真实调用契约 source 门禁
**前置约束（来自用户）:** 在精简之前，先确认每道门禁有效；无效的先修。本报告只做**验证**与**测量**，不含精简建议。

---

## 0. 先说结论

| | |
|---|---|
| **真正可靠可用** | Gate 3（复杂度）、Gate 8（密钥）、Gate 10（SAST）、Gate 12（文件卫生） |
| **能用但语义有缺陷** | Gate 4（告警不能阻断）、Gate 7（无文件也报 PASS）、Gate 6（无配置即不检查） |
| **部分语言待确认** | Gate 13（Java 恒降级、C#/Go/Dart 无编译器路径） |
| **未独立验证** | pre-push 六道门禁（单体、无单项开关，见 §5） |

**验证过程中共确认 3 个测试方法错误 + 2 个此前未知的行为问题**，均已在下文标注归属，避免把"我测错了"当成"产品坏了"。

---

## 1. 验证方法（以及我踩的坑）

### 1.1 调用契约

我**没有**自己拼装调用参数，而是照抄 `pre-commit` 的取值方式：

```bash
CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)   # 换行分隔
PROJECT_LANG=$(detect_project_lang)                                 # adapter-common.sh
source "$AUDIT_SCRIPT_DIR/lib/native-path.sh"                       # pre-commit:670
source "$GATE_DIR/$gate.sh"
```

> **踩坑 1（我的错）**：最初我用 `tr '\n' ' '` 把 `CHANGED_FILES` 转成空格分隔，
> 导致每道门禁的 `grep -E '\.ts$'` 都匹配失败，整张矩阵全是 SKIP。
> **契约是换行分隔的。** 这直接造成了一轮错误结论。

> **踩坑 2（我的错）**：Gate 6 用 `exit 3` 表达 verdict。我一开始读 `GATE_6_STATUS`
> 变量，永远读不到，误判为"超时"。实际它 1.1 秒就正常退出了。
> **各门禁的 verdict 机制不一致**（见 §4），验证必须同时看退出码和状态变量。

> **踩坑 3（我的错）**：Gate 3 的 PowerShell 分支依赖 `to_native_path()`
> （`lib/native-path.sh`）。我在 harness 里没有 source 它，导致门禁拿到 POSIX 路径
> `/d/projects/...ps1`，pwsh 报"无法识别为脚本文件"，再被 `|| true` 吞掉 → 报 SKIP。
> **这正是已有测试 `issue-598` 用注释明确警告过的依赖**，我第一轮没读它。
> 补上 source 后，PowerShell 正确 BLOCK 了 3 个 CCN=6 的函数。

**教训（与全局规则第 1 条一致）**：五次"产品缺陷"里，三次其实是调用方式错。剩余两次是真问题，见 §3。

### 1.2 Fixture 设计

13 个 fixture，每个语言注入**该门禁应当能发现的**缺陷（5 层嵌套 / 重复代码 / 硬编码密钥 / Dockerfile 明文 ENV 等），并带最小工程清单文件（`tsconfig.json` / `pyproject.toml` / `go.mod` / `pom.xml` …）以确保 `detect_project_lang` 走对分支。语言检测实测 **12/12 正确**（`iac` 返回 `unknown` 属预期——IaC 不是编程语言，由独立脚本处理）。

---

## 2. 门禁 × 语言 可用性矩阵

`BLOCK` = 正确检出缺陷并阻断；`PASS` = 正常运行未发现缺陷；`SKIP` = 主动跳过；`WARN-nocfg` = 无配置不检查；`NX` = 该语言无对应编译路径。

| 语言 | 检出 | G3 复杂度 | G4 Principles | G6 架构 | G7 IaC | G8 密钥 | G10 SAST | G12 卫生 | G13 编译严 |
|---|---|---|---|---|---|---|---|---|---|
| cpp | cpp | **BLOCK** | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | PASS | PASS | PASS |
| csharp | csharp | **BLOCK** | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | PASS | PASS | NX |
| dart | dart | SKIP | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | SKIP | PASS | NX |
| go | go | **BLOCK** | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | PASS | PASS | NX |
| iac | unknown | SKIP | SKIP | WARN-nocfg | **BLOCK** | PASS | SKIP | PASS | NX |
| java | java | **BLOCK** | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | PASS | PASS | DEGRADED |
| kotlin | kotlin | **BLOCK** | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | SKIP | PASS | NX |
| objectivec | objectivec | **BLOCK** | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | SKIP | PASS | NX |
| powershell | powershell | **BLOCK** | SKIP | WARN-nocfg | PASS⚠️ | PASS | PASS | PASS | NX |
| python | python | **BLOCK** | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | PASS | PASS | NX |
| shell | shell | SKIP | SKIP | WARN-nocfg | PASS⚠️ | PASS | SKIP | PASS | NX |
| swift | swift | **BLOCK** | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | PASS | PASS | NX |
| typescript | typescript | **BLOCK** | PASS⚠️ | WARN-nocfg | PASS⚠️ | PASS | PASS | PASS | NX |

⚠️ = 见 §3 语义问题。SKIP 的合理性逐条核对如下。

### 2.1 每个 SKIP 是否合理（逐条核对）

| 位置 | SKIP 原因 | 判定 |
|---|---|---|
| G3 × dart / shell | 扩展名正则不含 `.dart`/`.sh` | **合理**（lizard 不支持）. 但属已知覆盖缺口 |
| G3 × iac | 无源码文件 | 合理 |
| G4 × iac / shell / powershell | 无匹配文件 | 合理 |
| G10 × dart/kotlin/objectivec/shell | SAST "no supported language files" | **合理**（semgrep 无对应规则集） |
| G10 × iac | 无代码文件 | 合理 |
| G13 × 所有非 C/C++/Java/C# | 无该语言编译分析路径 | **合理但需记录**：Go/Dart/Swift/C++/Kotlin 里只有 cpp 走了编译检查 |

**结论：矩阵中所有 SKIP 都验证过原因，没有发现"该查却跳过"的情况。**

---

## 3. 确认的语义缺陷（真问题，非测量误差）

### 3.1 Gate 4：检出告警但永不阻断 —— 结构性

对注入 5 层嵌套的 TS 文件，principles 引擎**确实检出**：

```
warning | clean-code.deep-nesting | line 1
info    | clean-code.magic-numbers | line 2  (×3)
```

但门禁输出是：

```
✅ PASSED - Principles checker (no errors found).
ℹ️  2 warnings found (will be handled by Boy Scout Rule).
```

**根因**：`gate-4.sh` 只在 `severity == "error"` 时 `exit 1`，而 `.principlesrc` 中
**`"severity": "error"` 出现次数 = 0**（实测 grep 计数为 0）。

**反向验证（关键，避免把"配置问题"误判成"工具坏了"）**：同一 fixture、同一文件，只把
`deep-nesting` 的 `severity` 从 `warning` 改成 `error`，Gate 4 立刻阻断：

```
❌ BLOCKED - 2 principle ERROR(S) found
```

**所以 Gate 4 的检出能力是好的，阻断能力是配置出来的。** 且 checker 是**自读**
`<git toplevel>/.principlesrc` 的（`src/principles/config.ts:193`），gate 不传 `--config`。
这一条最初被我误判过——见下方踩坑 4。

> **后果**：Gate 4 在当前配置下**不可能阻断任何提交**。它在 1,226 次历史运行中只失败过 1 次，
> 原因在此，不是"代码质量好"。
> 这与 #754（函数体提取抓成类型注解）叠加后，Gate 4 的实际防护接近为零。
>
> **处置建议（不属本次范围）**：二选一——把关键规则提为 `error`，或明确降级为 advisory 并移出阻断链。
> 现在的状态是最坏的：**报告说 PASS，实际有告警，用户无法区分**。

> **踩坑 4（我的错）**：为验证 Gate 4 我曾直接修改 xp-gate 仓库自己的 `.principlesrc`，
> 测试却仍然全绿——因为临时 fixture 仓库里没有 `.principlesrc`，checker 用的是**内建默认值**。
> 一度以为"改配置无效"，实际是**测试没建对前置条件**。修法：fixture 内 `cp .principlesrc`。

### 3.2 Gate 7：没有 IaC 文件却报 `✅ PASSED`

11 种非 IaC 语言的输出均为：

```
✅ PASSED - No IaC files detected in changes.
```

**这正是 #800 描述的缺陷类**：`没有文件可查` 与 `查了没问题` 被渲染成同一句 PASS。
（对照组：只有 `iac` fixture 真正 BLOCK 了 Dockerfile 明文 ENV，说明工具本身有效。）

### 3.3 Gate 6：无 `architecture.yaml` 时不检查

12/12 语言输出：

```
⚠️  No layer config (architecture.yaml) — layer boundaries NOT checked.
exit 3
```

**这是有意的 fail-loud 设计**（注释明写"never a silent pass"），比静默 PASS 好。
但结合 #784（喊 BLOCK 不退出）和 #813（恒记 SKIP），Gate 6 是三态里最混乱的一道。
本次矩阵能确认的只有：**它至少不会假装检查过**。

### 3.4 Gate 13 Java：恒降级，不阻断

Java fixture 实跑：

```
⚠️  DEGRADED - Maven compiler-arg injection unreliable
⚠️  DEGRADED - Java compiled but lint enforcement was NOT applied; no conclusion drawn
rc=3
```

**这是预先声明的降级路径**，不是 bug。但意味着**Java 项目的编译严格性检查当前恒为报告态**。

---

## 4. 各门禁 verdict 机制不一致（新增发现）

验证过程中发现，8 道门禁用了 **3 种不同**的 verdict 表达方式：

| 机制 | 门禁 | 说明 |
|---|---|---|
| 状态变量 `GATE_N_STATUS` | G3, G4, G7, G8, G10, G12 | 主流 |
| 退出码 `exit N` | G6 (exit 3), G13 (return 0/1/2/3) | 契约不同 |
| 两者混用 | G3 (状态变量 **且** `exit 1`), G8 (10 处 `exit 1`) | 边界不清 |

**影响**：任何外部消费者（`xp-gate check`、CI、插件、以及本次验证）都必须**逐门禁特殊处理**，
无法用一个统一的读取器判断结果。这会让"门禁是否有效"的自动化审计本身变得不可靠——
我本人就在第一轮因此误判 Gate 6 为超时。

> **建议（需设计确认）**：Gate 13 已定义了清晰的 `0=PASS/1=FAIL/2=BLOCK/3=WARN` 契约，
> 其余门禁应对齐到同一契约，或统一提供状态变量。**这是"门禁可用性可被自动验证"的前提。**

---

## 5. pre-push 门禁（未做独立矩阵，理由说明）

pre-push **没有 `XP_GATE_ONLY_GATE` 这类单项开关**，是一个包含 20+ 段落的单体脚本
（Gate M / M-Python / M-Go / M-Java / M-Kotlin / M2 / ML / UI / MW / S），
且执行高度依赖前置状态（`hook-module-resolution.sh` schema 校验、mirror parity、sprint state）。

**我没有为它拼造 mock 去跑矩阵** —— 那正是本次前几轮错误的来源。改用其自带测试套件做证据：

```
githooks/__tests__/pre-push-source-filter.test.bats  → 2/2 ok
githooks/__tests__/gate-m2-threshold.test.bats        → 10/10 ok
合计 12/12 通过
```

**观测到的成本**：这两个测试文件耗时 **158 秒**，其中 `gate-m2-threshold` 单文件 **161 秒**
（首次测量 158s，二次单测 161.7s，同一量级）。M2 本身只是读 `.mockpolicyrc` 数 mock 密度，
这个耗时不成比例，**建议作为性能问题单独排查**（不是本次结论）。

**能力缺口（应记录为已知边界）**：pre-push 无法被逐门禁验证，因此它的可用性
**只能通过测试通过率间接说明，不能像 pre-commit 那样给出矩阵**。若后续要做完整精简决策，
需要先给 pre-push 增加与 pre-commit 对齐的单项执行开关。

---

## 6. 耗时数据（下一阶段规划的输入）

**测量条件**：本机 CPU 负载采样 **32%**（每次运行前采样）。每组 3 次，取 P50 与均值。
组内波动小（如 gate-10/python：9,731 / 9,666 ms，差 0.7%），数据可用。
**未做 A/B 对比**，因此这些是**绝对成本**，不是"优化前后"差异。

| 门禁 | TS P50 | Py P50 | Go P50 | 三种语言均值 | 占 8 门禁合计 |
|---|---|---|---|---|---|
| **Gate 10 SAST** | 10,485 | 9,731 | 10,887 | **10,368 ms** | **32.4%** |
| **Gate 4 Principles** | 4,086 | 4,327 | 4,176 | **4,196 ms** | **13.1%** |
| **Gate 12 卫生** | 3,751 | 3,556 | 3,385 | **3,564 ms** | **11.1%** |
| **Gate 13 编译严** | 2,648 | 2,586 | 2,638 | **2,624 ms** | **8.2%** |
| **Gate 3 复杂度** | 2,161 | 1,842 | 1,962 | **1,988 ms** | **6.2%** |
| **Gate 8 密钥** | 1,952 | 1,722 | 2,045 | **1,906 ms** | **6.0%** |
| **Gate 7 IaC** | 998 | 972 | 991 | **987 ms** | **3.1%** |
| **Gate 6 架构** | 763 | 752 | 726 | **747 ms** | **2.3%** |
| **合计** | | | | **32,022 ms** | 100% |

### 6.1 关键读数

1. **Gate 10 单独占 32.4%**，是第二名的 2.5 倍。若只优化一项，就是它（与 #791 "225 条规则解析 5.9s" 吻合）。
2. **Gate 4 排第二（13.1%），但它当前不可能阻断（§3.1）** —— 这是"高成本 + 零防护"的组合。
3. **Gate 6 最便宜（2.3%）** —— 即使它的三态语义混乱，成本不构成负担。
4. **合计 ≈ 32 秒/次提交**。注意这**不含** Gate 1/5/9（需要语言工具链与真实测试，未在本矩阵内测量），
   历史遥测显示 tests-coverage 单项 p50 ≈ 11 秒，实际提交总成本约为此表的 1.5–2 倍。

### 6.2 数据可信度声明

- 与历史 audit 遥测横向对比：本次 Gate 3 ≈ 2.0s vs 历史 p50 0.89s；Gate 8 ≈ 1.9s vs 历史 1.96s；
  Gate 4 ≈ 4.2s vs 历史 0.70s。**Gate 3/4 明显高于历史**，可能因 fixture 在 Windows 临时目录、
  git 索引为新建，冷启动开销被计入。**这些数字适合做门禁之间的相对比较，不宜直接与历史 p50 对比。**
- 本次**没有**使用当前机器负载做 A/B 时间对比（遵守全局规则 5/6）。

---

## 7. 交付物：可复跑的验证骨架

**已固化为仓库测试：** `githooks/__tests__/gate-availability-matrix.test.bats`（7 用例，77.8s，全绿）

```bash
bash node_modules/bats/bin/bats githooks/__tests__/gate-availability-matrix.test.bats
```

它锁定三件事：

| 用例 | 锁的是什么 |
|---|---|
| AC-806-01 | **调用契约**：`CHANGED_FILES` 必须换行分隔（并**反证**空格拼接会导致 0 匹配） |
| AC-806-02 | Gate 3 在 TS 上 **BLOCK**、在 shell 上 **SKIP**（后者记录为已知覆盖缺口） |
| AC-806-03 | Gate 8 **BLOCK** 真实 PAT |
| AC-806-03 | Gate 4 **PASS 但报 warning**（当前缺陷，故意锁定） |
| AC-806-03 | Gate 4 在 `severity:error` 下 **BLOCK**（**反证**：证明上一条是配置所致，非 checker 失明） |
| AC-806-03 | Gate 7 无 IaC 文件时打印 **PASSED**（当前缺陷，故意锁定） |

**设计意图**：§3 的语义缺陷现在是有红灯的断言。修复 Gate 4 / Gate 7 时，这两个用例会变红，
强制做一次有意识的更新，而不是让行为悄悄翻转。

核心是三段契约（脚本位于 `/tmp/gt/`，未提交）：

```bash
# 1. 真实文件清单（换行分隔，不可 tr 成空格）
CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

# 2. 真实语言检测
PROJECT_LANG=$(detect_project_lang)

# 3. 真实依赖链
source "$AUDIT_SCRIPT_DIR/lib/native-path.sh"
source "$GATE_DIR/$gate.sh"
rc=$?; grep -aoE "❌ BLOCKED|✅ PASSED|⏭️  SKIPPED" "$LOG"
```

---

## 8. 边界与未完成项

1. **Gate 1 / 5 / 9 未纳入矩阵** —— 它们依赖各语言真实工具链（eslint/ruff/govet、vitest/pytest、tsc/mvn），
   在 fixture 里跑真实测试成本高且结果受环境影响；本次只用历史遥测（§6.1）作参照。
2. **pre-push 六道门禁未做矩阵** —— 无单项开关，见 §5。
3. **Gate 13 的 C#/Go/Dart/Swift/Kotlin** 均无编译分析路径，矩阵显示 `NX`；
   是否属于设计意图需对照其设计文档确认。
4. **未验证 #732/#754 修复后的效果** —— 这两个 issue 确认存在且会导致"零命中"，
   但本次验证用的是 `.ts` fixture，未覆盖 `.cjs/.mjs` 失明场景与 54 个函数提取缺陷的量化。
5. **耗时未与历史 p50 校准**，见 §6.2。

---

## 9. 修复记录（2026-11-16 后续执行）

§3 确认的两个语义缺陷已修复，采用 TDD：先改测试到 RED，再改实现。

### 9.1 Gate 7：`没有文件可查` 不再渲染成 `PASSED`（#800）

**改动**：`githooks/gate-7.sh` 的无 IaC 分支由 `PASSED / GATE_7_STATUS=PASS`
改为 `SKIPPED / GATE_7_STATUS=SKIP`，并同步到 3 个镜像副本
（`githooks/adapters/`、`src/npm-package/`、`src/npm-package/hooks/`）。

**为什么必须改状态变量而不只是文案**：质量报告读的是 `GATE_7_STATUS`，
而同一次运行又写着 `scanned_files: 0`。原文案与状态变量**互相印证了一个未覆盖的 PASS**，
这正是 `xp-gate gate-coverage` 里 SKIP/FAIL 四态的初衷。

**验证**：
- `gate-7.test.bats` 原断言 `= "PASS"`（缺陷被测试固化），已改为 `= "SKIP"`。
- 新增 anti-vacuity 用例：真实 Dockerfile 改动仍然会走扫描路径，
  防止"一律 SKIP"也能通过测试。

### 9.2 Gate 4：从"永不阻断"到"生产阻断、测试降级"

**第一步（提级）**：`.principlesrc` 把 4 条规则由 `warning` 提为 `error`：
`deep-nesting`、`long-function`、`missing-error-handling`、`code-duplication`。
`magic-numbers` 保持 `info`——它单独占 1,699/1,979（86%）条命中，提级会让门禁变成噪音。

**第二步（发现阻断面过大）**：全仓实测提级后 271 条 error，其中
**220 条（81%）落在 64 个测试文件里**。实测只改 `gate-10.test.ts` 一个测试文件
就立刻被 8 条 error 挡住——等于日常测试开发停摆。

**第三步（补上缺失的能力）**：`severity` 原本是**每条规则一个全局值**，
无法表达"生产阻断、测试建议"这对正当需求。新增 `overrides` 路径作用域：

```json
"overrides": [
  { "paths": ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts"],
    "rules": { "clean-code.missing-error-handling": "warning",
               "clean-code.code-duplication": "warning" } }
]
```

实现位置是 `analyzer.ts` 的中心重映射（**不是**改 14 个规则文件），
所以新规则不可能忘记遵守它。关键不变量：

| 约束 | 为什么 |
|---|---|
| 只允许**放宽**，禁止提级 | 否则一个随手写的 glob 就能把 advisory 规则变成阻断器 |
| **不抑制**违规，只改 severity | `reported but advisory` 与 `nothing found` 必须仍可区分 |
| 非法条目丢弃并告警 | 配置写错不能让 Gate 4 崩溃，也不能静默无效 |
| 同时匹配 POSIX 与 Windows 路径 | Gate 4 在 Windows 上收到原生路径，glob 是 POSIX 写的 |

**效果实测**：

| | 提级后、无 overrides | 加 overrides 后 |
|---|---|---|
| 生产代码 error | 51 条 / 25 文件 | **51 条 / 25 文件**（不变，仍然阻断） |
| 测试文件 error | 220 条 / 64 文件 | **6 条 / 4 文件**（仅 `long-function`） |

单个测试文件 `gate-10.test.ts`：**8 error → 0 error**，24 条 findings 全部保留（16 info + 8 warning）。

端到端确认：

```
测试文件  src/__tests__/a.test.ts   → ✅ PASSED   (rc=0)
生产文件  src/prod.ts               → ❌ BLOCKED  (rc=1)  2 principle ERROR(S)
```

**故意没有给 `long-function` 加例外**：那 6 条（63/57/53 行，实为 2 个唯一函数 + 镜像）
是真 smell，留作下一轮还债；它们只在有人改动那 4 个文件时才阻断，符合 Boy Scout 本意。

### 9.3 过程中发现的三个"假缺陷"（都是我自己的错，记录下来）

1. **注释里的 glob 闭合了块注释**：我在 JSDoc 里写 `` `**/__tests__/**` ``，
   其中的 `*/` 提前终止注释，导致 `__tests__/**` 被当作代码 → `tsc` 报
   `Member '__tests__' implicitly has an 'any' type`。改为行注释。
2. **全局安装副本掩盖本地修改**：Gate 4 在 fixture 里回退到
   `$HOME/.config/xp-gate/modules/principles`，那是**旧副本**，
   所以我的实现"看起来没生效"。`md5sum` 确认后才真相大白。
   这正是 `githooks/AGENTS.md` 反复警告的那个陷阱——我原以为只影响 adapters，实际 principles 模块同样如此。
3. **vitest worker 禁止 `process.chdir()`**：6 个新测试全红，
   但原因是测试写法，不是实现。改用显式 `--config` 路径，与本仓既有测试一致。

### 9.4 仍未完成

1. **`long-function` 的 6 条测试债**未还（见 9.2）。
2. `src/principles/__tests__/warnings-baseline-budgets.test.ts` 有 **2 个既有失败**，
   已用 `git stash` 验证与本次改动无关：失败指向 `src/build-integrity/gate-10.ts`
   的基线预算与当前 warning 数不符，而该文件当时正被**并行工作**修改。
3. `.warnings-baseline.json` 未随 severity 变更重算——提级会改变 warning 计数，
   下一次 Gate 6 运行可能需要重新生成基线。
