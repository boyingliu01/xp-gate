# XP-Gate 功能必要性审计 v2 — 修正版

**日期:** 2026-11-16（v2，修正 v1 的方法论缺陷）
**触发:** 用户指出 v1 的两个前提错误 —— (1) 假设门禁本身无缺陷；(2) 对 skill 层评估最弱。
**状态:** v1 的多数结论被推翻或大幅削弱。本文取代 v1。

---

## 0. v1 错在哪（方法论复盘）

v1 的推理链是：

> `audit.jsonl` 显示 Gate X 运行 1,268 次、失败 0 次 → Gate X 无用

**这条链有一个未验证的前提：门禁在正常运行。** 如果门禁根本不看那些文件、或看错了函数体、或从不退出非零，那么"零失败"证明的是"它没在工作"，而不是"它没必要工作"。

用户是对的。仓库当前有 **75 个 open issue**，其中直接推翻 v1 前提的至少 10 个。我这次先验证代码，再下结论。

**v1 中仍然成立的结论**（经代码复核）：
- Gate 4 在 `.principlesrc` 下**结构性无法阻断**（无 `severity: error` 规则）—— 已复核代码，成立
- `gateTimings` 从未落盘 —— 已复核，成立
- audit duration 被 epoch 污染 —— 已复核，成立

**v1 中已被推翻的结论**：见 §2。

---

## 1. 复现验证（这次先验证，再断言）

### 1.1 #732 —— 四个门禁对 .cjs/.mjs/.mts/.cts 完全失明

代码（`githooks/adapters/gate-3.sh:366`、`gate-4.sh:79`、`gate-10.sh:132`）的扩展名正则**不含** `mjs|cjs|mts|cts`。实跑验证：

```
a.cjs    gate3 MISSED | gate4 MISSED | gate10 MISSED
a.mjs    gate3 MISSED | gate4 MISSED | gate10 MISSED
a.mts    gate3 MISSED | gate4 MISSED | gate10 MISSED
a.cts    gate3 MISSED | gate4 MISSED | gate10 MISSED
a.ts     gate3 SEEN   | gate4 SEEN   | gate10 SEEN
```

> **对 v1 的直接影响：** 这个仓库有大量 `.cjs`（`scripts/*.cjs`、所有 `.bats` 的辅助 js）。Gate 3/4/10 对它们的"零命中"**不是质量好，是根本没扫**。

### 1.2 #754 —— Gate 4 的函数体提取会抓错内容

直接调用 `TypeScriptAdapter.extractFunctions()` 复现：

```
simpleFn(a: number): number
  lines=4  nesting=1   code="{ if (a > 0) { return 1; } return 0; }"     ← 正确

objReturn(a: number): { warnings: number; errors: number }
  lines=1  nesting=0   code="{ warnings: number; errors: number }"       ← 抓成了类型注解
```

**真实函数体（含 3 个 `if`）被完全丢弃。** issue 称全仓 54 个函数受影响。这意味着 Gate 4 的 long-function / deep-nesting / god-class 对这些函数**从未生效**。

### 1.3 #800 / #792 / #813 / #784 —— "没查"被报成"查了没问题"

这是一整类缺陷，不是个案：

| issue | 表现 |
|---|---|
| #800 | 语言不支持时门禁全 SKIP，报告仍给 **PASS** |
| #792 | `hasPythonSignal` 深度>4 就当"没有 Python"，最后仍 `✅ healthy` |
| #813 | `architecture.yaml` 存在时层检查**恒记 SKIP**（实测通过也记 SKIP） |
| #784 | Gate 6 打印 `❌ BLOCKED` 但**没有任何路径退出非零**，违规照落库 |
| #791 | Gate 10 有 82 次 >60s，**100% passed=True** |

**这是本次分析最重要的结构性发现：**

> **xp-gate 和 skill-cert 犯的是同一个错误 —— 把"未测量"渲染成"测量过且合格"。**
> 在 xp-gate 里是 SKIP→PASS；在 skill-cert 里是 0/0 → 0.0 分 → FAIL。
> 两者方向不同，根因相同：**缺少 NOT_MEASURED 第三态。**

---

## 2. v1 结论的修正

| 门禁 | v1 结论 | v2 修正 | 依据 |
|---|---|---|---|
| Gate 3 复杂度 | **可移除**（零命中） | **先修再议** — 对 .cjs 失明，lizard 有 3 个计数缺陷(#747) | 零命中是"没扫"不是"没必要" |
| Gate 4 Principles | **降级** | **部分维持** — 阻断能力缺失成立；但"无用"不成立，它根本没正确解析 | #754 使 54 个函数从未被检查 |
| Gate 10 SAST | 保留 | **保留，但要修"慢即假通过"** | #791: 82 次超时 100% passed |
| Gate 6 架构 | v1 未重点评估 | **最高风险** — fail-open(#784) + 恒 SKIP(#813) | 喊 BLOCK 却不退出 |
| Gate 8 密钥 | 保留 | **维持保留，但 v1 的"零命中=好事"要打折** | #793 误诊 detect-secrets-hook |
| Gate 5 测试 | 保留 | **维持** | 这是少数真正执行并判定的门禁 |

**修正后的核心判断不再是"哪些能删"，而是：**

> **xp-gate 当前最大的问题不是功能冗余，而是 75 个 open issue 里大量属于 fail-open / 静默失明 / 状态混淆。在这个状态下，任何"这个门禁没用"的结论都不可信 —— 因为你无法区分"它检查了没发现"和"它没检查"。**

---

## 3. Skill 层评估（v1 的空白，本次重点）

按用户要求，不采信 skill-cert 的执行日志，而是审它的**设计依据、原则和实现**。

### 3.1 skill-cert 的核心设计主张

L2 指标：`with-skill vs without-skill` 归一化增益：

```
Δ = (with_avg - without_avg) / without_avg,  Δ ≥ 20% 为 PASS
```

这个设计**方向是对的** —— 它恰好回答用户的问题："模型自己能不能做，skill 是否还有增量"。这是全部 xp-gate 技能存废的关键判据。

**但实现有三个使它无法回答这个问题的缺陷。**

### 3.2 缺陷 A：`with_skill` 分支只送进去 SKILL.md 的前 20 行 / 1000 字符

`engine/runner.py:145-152`：

```python
with open(skill_path, encoding="utf-8") as f:
    lines = f.readlines()
    skill_header = "".join(lines[:20])[:1000]      # ← 20 行 / 1000 字符
skill_context = f"Skill file: {skill_path}\n{skill_header}\n\n---\nTask: {input_text}"
```

实跑验证（delphi-review，33,744 字节）——实际注入的 1000 字节**全是 YAML frontmatter**：

```
'Skill file: skills/delphi-review/SKILL.md\n---\nname: delphi-review\n
 version: 1.1.0\ndescription: >\n  Performs multi-round anonymous expert
 consensus review...'
```

**没有任何工作流指令被送达。** 对照组（without_skill）只有任务文本。

**这对真实 skill 意味着什么：**

| Skill | 大小 | L2 实际可见 | |
|---|---|---|---|
| delphi-review | 45,164 B | **2.2%** | |
| sprint-flow | 21,634 B | **4.6%** | |
| test-driven-development | 11,280 B | 8.9% | |
| grilling | 2,064 B | 48.4% | |
| grill-with-docs | 262 B | 100% | |

**结论：L2 对体积大的 skill 只测了它们的"描述和触发短语"，测不到它们的核心价值。** 一个 skill 最有价值的部分（工作流、约束、模板）恰恰 95%+ 被截断。

> **推论（对用户问题的直接回答）：** 用当前 skill-cert 去判"skill 是否还有必要"，**系统性地低估所有大 skill 的价值**，并**系统性高估小 skill 的价值**。delphi-review / sprint-flow 这类最需要评估的 skill，恰好测得最不准。

### 3.3 缺陷 B：0/0 被渲染成 0.0 分

`engine/metrics.py:138-142`：

```python
trigger_results = [r for r in eval_results if r.get("category") == "trigger"]
if not trigger_results:
    return 0.0        # ← 没有样本，返回 0 分而非"未测量"
```

真实产物 `results/SKILL-result.json` 给出了这个后果：

```json
"verdict": "FAIL",
"metrics": {"l1_trigger_accuracy": 0.0, "l2_...": 0.0, ...},
"coverage_at_abort": 0.3877,
"fail_reason": "Coverage 0.39 below block threshold (0.5)..."
```

而报告正文写的是：

```
### L2: With/Without Skill Delta — 0% FAIL
评测结果: 输出增益: 0.0% (With: 0%, Without: 0%) — FAIL (阈值≥20%)
分析: 增益极低（<5%），Skill 未明显提升模型输出质量，模型本身可能已有相关能力
```

**这次评测根本没跑任何 eval，却生成了"技能未提供足够价值，建议增强核心功能"的结论性建议。**

对比：同文件的 L4 在样本不足时**正确地返回 `None`**（`engine/stability.py:273`）。说明作者知道这个模式，只是没有统一应用到 L1/L2。

### 3.4 缺陷 C：L2 在缺少一组时静默改判为"通过率绝对值"

`engine/metrics.py:236-245`：

```python
if not with_skill or not without_skill:
    if not eval_results:
        return 0.0
    return self._weighted_avg_pass_rate(eval_results)   # ← 不是增益，是绝对值
```

计算后果：

```
只有 with_skill 结果，pass_rate 0.95 / 0.92
→ L2 = 0.935 → 阈值≥0.20 → PASS
```

**一个从未与无 skill 基线对比过的 skill，可以拿到 L2 = 93.5% 并判 PASS。**

再叠加缺陷 A（只送前 1000 字符），就出现最坏组合：

> **一个 45KB 的 skill，只送进 2.2% 内容，如果没有生成 without 组，还能拿到 L2 PASS。**
> 这个 PASS 与"skill 是否提供价值"没有任何关系。

### 3.5 缺陷 D：唯一的测试无法发现 A

`tests/test_runner.py:493` 用了 **3 行**的临时 skill 文件：

```python
skill_file.write_text("line1\nline2\nline3\n")     # 18 字符
assert "line1" in result
```

测试断言"内容被读取"，但 18 字符 < 1000、3 行 < 20，**永远走不到截断分支**。测试通过与否与缺陷无关。

### 3.6 skill-cert 本身的设计质量（公允部分）

不是全盘否定：
- **L2 的 idea 是对的**，而且是回答"skill 还有必要吗"的正确判据
- **with/without 对照、多模型漂移、LLM-as-judge temp=0** 的方向都对
- **L4 正确处理了样本不足**（返回 None），说明"不可测"的概念存在
- `_L2_CATEGORY_WEIGHTS`、F1 处理正负样本等细节是认真的

问题集中在**执行层的两个具体失误**（截断、单组回退）和**一个状态语义缺失**（0/0）。

---

## 4. 修正后的总体结论

### 4.1 对用户原问题的回答

> "xp-gate 是否可以考虑精简？"

**方向要改。** 当前不该做"删功能"，该做"修 fail-open"。

理由：在 75 个 open issue 里有至少 10 个属于"未检查却报通过"的状态混淆时，**任何一个门禁的"零命中"都无法解释**：
- 可能是真的没问题
- 可能是它没扫那些文件（#732）
- 可能是它抓错了代码（#754）
- 可能是它 SKIP 了但仍显示 PASS（#800/#813）
- 可能是它喊 BLOCK 但没退出（#784）

**精简决策所需的信息，当前系统无法提供。** 先修状态语义，才能做精简。

### 4.2 建议的优先级

**P0 — 加第三态 NOT_CHECKED（一个改动解决一类问题）**
- 影响 #800/#792/#813/#784 及其同族
- 报告里"没查"与"查了没问题"必须长得不一样
- 这是精简的前提，不是可选项

**P0 — 修 Gate 4 提取缺陷（#754）**
- 54 个函数的检查从未生效；在修复前，Gate 4 的"零命中"数据无效

**P0 — 修扩展名正则（#732）**
- 一行 regex 覆盖 .cjs/.mjs/.mts/.cts
- 修完后重新统计 Gate 3/4/10 命中率，**v1 的"零命中"结论需要全部重算**

**P1 — Gate 6 fail-open（#784）**
- 唯一"喊 BLOCK 但不拦"的门，风险最高

**P1 — skill-cert 三处修复**
- `runner.py:149` 改为全文注入（或按 token 预算截断）
- `metrics.py:138` 引入 NOT_MEASURED
- `metrics.py:240` 单组时返回 None 而非绝对值

### 4.3 关于"模型变强会替代什么"

v1 的这个判断**仍然成立且被强化**：

- **会贬值**：风格/复杂度类主观判断（Gate 3/4 的规则本意）
- **不会贬值**：真实执行类验证（Gate 5/9/8）—— 模型会**声称**，不能**执行**
- **新增一条**：**状态可信性**。模型和工具都会犯错，但用户需要知道"到底查没查"。这类"元信息"价值随工具变复杂而**上升**，不下降。

---

## 5. 本次仍未验证的部分（诚实边界）

1. **75 个 issue 只读了约 15 个**。剩下 60 个可能还有推翻结论的。
2. **修复 #732 后 Gate 3/4/10 的真实命中率未知** —— 需要用修复后的代码重新跑历史变更集才能得到。
3. **skill-cert 未实际执行** —— 本次是代码与设计审读，不是运行验证。它的 30+ engine 模块只深读了 metrics/runner/stability 三个。
4. **L2 截断是否有意为之**（比如为省 token）—— 代码无注释、无文档、无测试，无法判断。若是刻意设计，也应显式记录并让小 skill 与大 skill 的结论不可比。
5. **未做时间/工效测量** —— 本机 CPU 100%，按全局规则不做 A/B。

---

## 6. 建议的下一步

按用户"先 open issue 和代码重新审视"的指示，本轮已做。建议下一步：

1. **修 P0 三项**（NOT_CHECKED / #754 / #732），这是所有后续精简决策的地基
2. **修完后用历史变更集回放**，重算每道门禁的真实命中率 —— 那时 v1 那张表才有意义
3. **skill-cert 修完后，对 12 个 skill 实跑一次**，特别关注 delphi-review 与 sprint-flow 这两个"最受影响"的样本
4. 只有在 1-3 完成后，才谈"哪个 skill 可以删"
