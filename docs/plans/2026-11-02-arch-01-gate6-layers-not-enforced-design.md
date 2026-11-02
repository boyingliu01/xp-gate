# ARCH-01 设计 v2：#686 Gate 6 必须暴露 architecture.yaml 死配置

- 日期：2026-11-02
- Issue：[#686](https://github.com/boyingliu01/xp-gate/issues/686)（父单 #685）
- Sprint：`sprint/2026-11-02-01`
- 目标版本：0.35.20.0
- **v2 说明**：v1 经 delphi 三模型评审 5 轮未达共识（1/3 批准），自检后确认 v1 有实质缺陷。
  v2 基于两项新实测事实重写，并修正 v1 的三处错误（见 §10）。

---

## 1. 问题陈述（比 issue 正文更严重）

Gate 6 对 `architecture.yaml` 只做存在性检查（`pre-commit:4019`），调用 archlint 时从不传
`--config`（`pre-commit:4066/4069`）。

**但真正的问题在 `pre-commit:4318-4328`**：Gate 6 在配置缺失时阻断提交，并打印推荐做法：

```bash
echo "   Or architecture.yaml for custom Clean Architecture layer definitions:"
echo "     layers:"
echo "       - name: api"
echo "         paths: [\"src/api/**\"]"
echo "       - name: domain"
echo "         paths: [\"src/domain/**\"]"
echo "         allowed_imports: [domain]"
```

**这个格式是无效的**（见 §2 实测）。于是 Gate 6 在做一件比"漏检"更糟的事：

> 它阻断提交 → 教用户写一份**顶层 `layers:`** 的配置 → 用户照做 → 提交通过 →
> 用户以为分层已被校验 → 实际上那份配置被静默忽略。

这是一条**完整的、自动化的、把用户引向虚假安全感的生产线**。

---

## 2. 实测勘察（推翻 issue 正文与 v1 设计的前提）

issue 正文称「archlint 0.16.0 的 schema 根本没有 `layers` 键」。**实测下来这个说法不对，
真实情况更微妙**：

### 2.1 分层检测器存在，但不可用

```
$ archlint detectors list
│ layer_violation  ┆ Layer Violation  ┆ ❌ disabled  ┆ A dependency that violates defined architectural layers │
```

检测器**存在**，默认 disabled。README（`node_modules/@archlinter/cli/README.md:186-194`）
给出的正确格式是 **`rules.layer_violation.layers`**，不是顶层 `layers:`。

### 2.2 但无论怎么配置，它都不产出任何结果

fixture：`src/domain/a.ts` 非法 `import` `src/infra/db.ts`，`allowed_imports: []`。
这是教科书式的层违规。测试了 7 种组合：

| # | 配置 | 调用方式 | 结果 |
|---|---|---|---|
| 1 | 顶层 `layers:`（**Gate 6 教用户的格式**） | `-c architecture.yaml scan .` | 无 layer 结果，exit 0 |
| 2 | `rules.layer_violation.layers` + `**/domain/**` glob | `scan .` | 无 layer 结果，exit 0 |
| 3 | 同上 + `enabled: true` | `scan .` | 无 layer 结果，exit 0 |
| 4 | 同上 | `-d layer_violation scan .` | 无 layer 结果，exit 0 |
| 5 | 精确路径 `src/domain`（非 glob） | `-d layer_violation scan .` | 无 layer 结果，exit 0 |
| 6 | 精确路径 + `enabled: true` | `-d layer_violation scan .` | 无 layer 结果，exit 0 |
| 7 | `src/domain/**` glob + `enabled: true` | `-d layer_violation scan .` | 无 layer 结果，exit 0 |
| — | 任意配置 | `-A scan .`（全开所有检测器） | **`grep -ci layer` = 0 次** |

**结论：`layer_violation` 在 `@archlinter/cli@0.16.0` 中是可见、可配置、可指定、
但运行后静默无输出的检测器。**

### 2.3 archlint 对未知键静默容忍

顶层 `layers:` 是未知键，archlint **不报错、不警告、exit 0**。这意味着：

- "补上 `--config`"不会报错，会得到一个**看起来修好、实际仍不检测**的状态
- 任何"探测 archlint 是否接受配置"的做法都会返回"接受"，是**恒真守卫**

---

## 3. v1 的三处错误（评审未达共识的原因）

| # | v1 的错误 | v2 的修正 |
|---|---|---|
| E1 | AC-4 断言 `classify_coverage_reason('layers_config_not_enforced')` 非 covered | **这是恒真断言**。`classify_coverage_reason()` 第 590 行是 `*) echo "unknown"`，任何未知 reason 都自动非 covered，测试永远通过、与实现对错无关。v2 改为断言**具体返回值** `unknown` + 断言 Gate 6 真的把 reason 写进 `GATE_6_LANG_REASONS` |
| E2 | 假设给 `.archlint.yaml` 场景挂 reason 会让 gate-coverage 变红 | **读错了消费者**。`gate-coverage.js:165` 读的是 `entry.status === 'SKIP'`，不是 reason。挂 reason 不会让 gate-coverage 变红。v2 明确这一点，并把 AC-2 的验证改为直接断言 quality report 的 reason 字段 |
| E3 | 只处理"报告层面"，没处理"终端教用户写错配置" | v2 把 `pre-commit:4318-4328` 的错误示例列为**首要修复对象**——这是缺陷的入口，不改它，用户会持续被引向无效配置 |

---

## 4. 设计

### 4.1 首要修复：停止教用户写无效配置

把 `pre-commit:4318-4328` 的示例改为**实测可用的** `.archlint.yaml` 格式：

```bash
echo "   Recommended: create .archlint.yaml (archlint's own config format):"
echo "     rules:"
echo "       god_module:"
echo "         severity: high"
echo "       cyclic_dependency:"
echo "         severity: high"
echo ""
echo "   NOTE: layer-boundary rules (architecture.yaml) are NOT enforced by"
echo "   archlint 0.16.0 — its layer_violation detector produces no results even"
echo "   when enabled. See #686 / #690 / #692."
```

**并停止推荐顶层 `layers:` 格式。** 如果保留 `architecture.yaml` 的说明，必须同时
说明"分层当前不被校验"，不能像现在这样暗示它有效。

### 4.2 三状态判定（保留 v1 的 D3，但理由修正）

在 Gate 6 per-language 循环前判定配置形态：

| 状态 | 条件 | 行为 |
|---|---|---|
| `native_only` | 只有 `.archlint.yaml` / `.architecturerc` | 通用坏味道已校验；reason = `layers_config_not_enforced` |
| `layers_declared` | 存在 `architecture.yaml` | WARN「分层规则未被任何检测器消费」；同上 reason |
| `both` | 两者都在 | 同 `layers_declared` |

### 4.3 终端输出必须自身无法被误读（修正 v1 最弱的一环）

v1 只加一行 WARN 然后仍打印「架构检查通过」。用户只看终端时依然会误读。
**v2 要求：终端里出现分层未校验时，PASS 结论必须带上限定词。**

```
     ⚠️  分层规则未校验：architecture.yaml 声明的层边界当前不被任何检测器消费
         （实测 archlint 0.16.0 的 layer_violation 启用后亦无输出）
         本次仅校验了通用架构坏味道（循环依赖 / 上帝类 / 死代码）。
     ✅ Architecture validation passed (generic smells only — layers NOT checked)
```

关键：**括号里的限定词必须在同一行**，不能被日志滚动冲掉，也不能靠读者去别处查报告。

### 4.4 静态判定，不做探测

基于 §2.3：任何探测都返回"接受"，是恒真守卫。判定完全基于文件存在性。
将来 archlint 支持分层，需要**主动的能力声明**（如配置里显式
`layer_enforcement: true`），而不是靠"探测没报错"推断。这一点写进注释，
防止后来者用探测法"简化"。

### 4.5 不改 status 为 FAIL

分层未校验是「未测量」，不是「测得违规」。改成 FAIL 会阻断所有写了
`architecture.yaml` 的项目——惩罚正确的配置行为，逼用户删配置。

但注意 §4.3：WARN + 限定词 + reason 三者必须同时到位，否则就是 v1 的漏洞。

### 4.6 诚实边界

本设计**不声称**修复分层校验。唯一价值：**让 Gate 6 不再为未测量的维度报绿，
且不再教用户写无效配置。**

---

## 5. 验收标准（v2，全部具备判别力）

| AC | 断言 | 为什么有判别力 |
|---|---|---|
| AC-1 | fixture「`architecture.yaml` 存在」→ 终端输出**同时**含「分层规则未校验」与「layers NOT checked」 | 两个独立字符串，任一处措辞丢失即红 |
| AC-2 | fixture「仅 `.archlint.yaml`」→ quality report 的 Gate 6 reason **等于** `layers_config_not_enforced` | 断言具体值，不是"非 covered" |
| AC-3 | `classify_coverage_reason 'layers_config_not_enforced' 'PASS'` 输出**恰为** `unknown` | 断言精确返回值；若有人把它加进白名单，此测试红 |
| AC-4 | `pre-commit` 中**不再出现**顶层 `layers:` 的推荐示例 | `grep` 断言；若有人恢复旧文案即红 |
| AC-5 | 既有 Gate 6 测试全绿 | 回归保护 |

**AC-3 的变异验证**：把 reason 从 case 分支里删掉后，它仍会落到 `*)` 返回
`unknown` —— 所以 AC-3 **必须配合 AC-2 才有意义**（AC-2 证明 reason 真的被写入了）。
两者是一对，单独任何一个都不足以证明功能。这一点写进测试注释。

---

## 6. 写作用域与同步

| 文件 | 改动 |
|---|---|
| `githooks/pre-commit` | 配置缺失示例文案 + Gate 6 三状态 + 新 reason + PASS 行限定词 |
| `githooks/__tests__/arch-gate6-layers-not-enforced.test.bats` | 新增（AC-1..AC-4） |
| `src/npm-package/` | 由 `sync-package-content.js` 同步，**不手改** |

**#683 的教训**：改完必须同步，且 `grep` 一遍 `__tests__/` 有无断言副本内容。

---

## 7. 不做的事

- ❌ 不实现分层规则检测（ARCH-03/05/15 范围）
- ❌ 不把 status 改成 FAIL
- ❌ 不用"探测 archlint 是否接受"判断（恒真守卫）
- ❌ 不启用 `layer_violation`（实测无输出，启用只是把问题藏更深）
- ❌ 不重构 Gate 6 其它分支

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 用户以为分层已被校验 | §4.3 限定词进同一行；AC-1 钉住 |
| 移除 `architecture.yaml` 推荐示例引起困惑 | 保留说明但明确"当前不校验"，指向 #690/#692 |
| 影响既有 Gate 6 测试 | AC-5 强制全绿 |
| 同步遗漏 | 复用 #683 镜像守卫 |

---

## 9. 决策记录

| 决策 | 选择 | 理由 |
|---|---|---|
| D1 | 只报未校验，不补 `--config` | archlint 静默忽略配置，补参数产生"假装已修" |
| D2 | WARN 而非 FAIL | 未测量 ≠ 违规；FAIL 惩罚正确配置 |
| D3 | `native_only` 也挂 reason | 生效维度 ≠ 用户预期维度，正是本 issue |
| D4 | 静态判定 | 探测恒为"接受" |
| D5 | 不启用 layer_violation | 实测无输出 |
| **D6** | **改推荐示例优先于改报告** | 示例是缺陷入口；不改它，用户持续被引向无效配置 |
| **D7** | **PASS 行带限定词** | 用户只看终端；报告层面的 reason 无法阻止误读 |

---

## 10. v1 → v2 变更摘要

- 新增 §1 的「Gate 6 主动教用户写无效配置」——这是 v1 完全遗漏的、也是本 issue 最严重的部分
- 修正 AC-4 的恒真断言（E1）
- 修正对 gate-coverage 消费者的错误假设（E2）
- 新增 §4.3「终端输出必须自身无法被误读」（E3）
- 新增 D6/D7 两条决策
- 新增 §5 的「AC-3 必须配合 AC-2」说明

---

## 11. 评审反馈处理（R2 delphi-review，真实意见）

**背景**：前 4 次评审只有票型没有正文（#709），属于盲飞。修复取文渠道后拿到真实意见，
逐条处理如下。

### 11.1 已证伪的质疑（T-01，Expert B）

> **T-01**：`layer_violation` 可能只是缺 parser flag（`--ts`/`--js`），
> 若属实则本设计永久禁用了一个有效特性。

**已证伪，证据三条**：

1. `archlint scan --help` 中**没有任何** `--ts`/`--js`/parser 类参数（只有 `-r/-f/-j/--no-diagram`）。
2. 补上 `tsconfig.json` 后仍 0 次 layer 命中。
3. 换用真实大型 TS 项目（`src/npm-package/lib`，60+ 文件、真实 import 图）后，
   `-A` 全开仍 0 次真实 layer 命中（唯一含 "layer" 字样的是 god_module 建议文本里的
   "Consider creating a layered architecture"，非检测结果）。
4. **决定性**：`archlint -d layer_violation scan .` 明确指定只跑该检测器，
   返回的却是 **Code Clone** —— 该 ID 被静默忽略并回退到默认检测器集。

即：不是配置问题，是检测器不可用。

### 11.2 采纳的改进

| 来源 | 意见 | 采纳方式 |
|---|---|---|
| A-1 / F1 | 设计依赖 archlint 0.16.0 的实测行为，但未固定版本、无回归测试；archlint 升级后 WARN 会变成误导 | **新增 §4.7 版本护栏**：断言 archlint 版本；版本变化时测试失败并提示复核本设计 |
| A-2 / T-02 | AC-1 依赖人读字符串（中文 + 英文），措辞微调或本地化即破 | **改为机器可读标记** `[WARN:LAYERS_UNCHECKED]`，AC 断言该标记而非散文 |
| A-3 | 未说明 `architecture.yaml` 格式非法（YAML 语法错误）时的行为 | **§4.2 补一句**：语法错误仍按 `layers_declared` 处理（因为存在性判定不解析内容），并在文档写明 |
| T-03 | 三状态中 `layers_declared` 与 `both` 行为完全相同，属冗余 | **合并为两状态**：`layers_config_present` / `native_only` |
| F2 | AC-3 断言 `unknown` 依赖「不在白名单」这一实现细节，语义模糊：若把该 reason 加进白名单（表示"已报告"），AC-3 就红了——但那可能是对的 | **§5 明确 covered 的语义**：covered = 「该维度已被测量且通过」，"已报告未校验"不构成测量，故必须非 covered。AC-3 断言精确值 `unknown` 并加注释说明语义 |
| F3 | §4.3 输出过长，CI 日志换行可能把 PASS 与限定词分开 | **缩短为单行**，限定词紧贴状态词，且用机器标记承载语义 |

### 11.3 新增 §4.7 版本护栏

设计依赖「archlint 0.16.0 的 layer_violation 不产出结果」这一实测事实。
若上游修复，本设计的 WARN 会变成**错误的**警告。

护栏方式：测试中读取 `@archlinter/cli` 的 `package.json` version，
断言主版本为 `0.16`；不匹配则测试失败，提示「archlint 已升级，请复核 #686 的
§2.2 实测结论是否仍成立」。

这不是防御性代码，而是把**一个会过期的假设**变成**一个会主动报错的假设**。

### 11.4 修正后的验收标准

| AC | 断言 | 判别力 |
|---|---|---|
| AC-1 | `architecture.yaml` 存在 → 终端输出含 `[WARN:LAYERS_UNCHECKED]` 标记 | 机器可读，不受措辞/本地化影响 |
| AC-2 | 仅 `.archlint.yaml` → quality report 的 Gate 6 reason **等于** `layers_config_not_enforced` | 断言具体值 |
| AC-3 | `classify_coverage_reason 'layers_config_not_enforced' 'PASS'` 输出**恰为** `unknown`，并在测试注释写明 covered 的语义 | 精确值；加注释防误加白名单 |
| AC-4 | `pre-commit` 中不再出现顶层 `layers:` 推荐示例 | grep 断言 |
| AC-5 | 既有 Gate 6 测试全绿 | 回归 |
| **AC-6** | archlint 主版本为 0.16 时通过；非 0.16 时失败并提示复核本设计 | 防止假设静默过期 |

**AC-3 与 AC-2 必须配对**：AC-3 单独是恒真（未识别 reason 自动落 `unknown`），
AC-2 证明 reason 真的被写入。两者合起来才有意义，写进测试注释。
