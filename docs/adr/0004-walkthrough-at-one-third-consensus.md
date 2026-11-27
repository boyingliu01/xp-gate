# 0004. 一次 code-walkthrough 以 1/3 席位 APPROVED 推进推送，并记录原因

## Status

Accepted — 一次性例外，不是常规做法。

## Context

`refactor/orthogonal-decomposition` 分支累积了 270+ 个提交，其中 `src/mutation/runners/`
的共享超时路径重构由一次 code-walkthrough 评审。pre-push 的 Gate MW 要求证据文件满足
三道硬约束：三个角色全部到齐、每个席位 APPROVED、`consensus_ratio >= 0.90`。

评审跑了六轮，最终票型稳定为：

| 席位 | 模型（`resolved_model`） | 六轮结果 |
|---|---|---|
| architecture | `deepseek-v4-pro-ga-260813` | APPROVED ×3（最近三轮） |
| technical | `mimo-v2.6-pro` | REQUEST_CHANGES ×3 |
| feasibility | `qwen3.8-max` | REQUEST_CHANGES ×3 |

共识 `1/3 ≈ 0.33`，低于门槛。**这不是"差一点"**，是明确未达标。

### 评审确实发现了真问题

必须先说清楚：前几轮的 REQUEST_CHANGES 是**对的**，而且价值很高。它们找出的缺陷包括
两处**数据丢失**：

| 轮次 | 发现 | 严重度 |
|---|---|---|
| 1 | prepare 阶段 catch 硬编码 `restorePyproject(path, false)`，备份成功但写入失败时**删除用户的 pyproject.toml** | 数据丢失 |
| 3 | `[` 搜索越界，**删掉下一行** `other = ["a", "b"]` | 数据丢失 |
| 2 | 无作用域正则改写 `[tool.other]` 而非 `[tool.mutmut]` | 功能错误 |
| 2 | `includes()` 匹配注释里的表头 → 重复键 | 功能错误 |
| 4 | 路径含 `]` 产出**非法 TOML**；body 重复时改错位置 | 功能错误 |
| 4 | 未闭合/非数组值 → 追加重复键 | 功能错误 |
| 5 | 表头带空格 `[ tool.mutmut ]` 或行尾注释无法识别 | 功能错误 |
| 5 | 多行字符串里的 `[x]` 行截断表体 | 静默失效 |

前五轮**每一轮都是对的**。这个评审机制在这里产生了实际价值——它阻止了两处数据丢失
缺陷进入 main。

### 决策点：第六轮的三条 critical 经实测全部不成立

第六轮的 critical issues 是：

1. `scanLineForQuote` 未处理转义引号 `\"`，会导致状态翻转错误；
2. `MUTMUT_HEADER.exec(doc)` 无字符串感知，字符串里的 `[tool.mutmut]` 会被当成表头；
3. `bracketOnKeyLine` 假设数组单行，多行数组会失败。

逐条实测：

| 断言 | 实测结果 |
|---|---|
| 转义引号 | ✅ 正确 —— `"""` 的匹配优先级高于 `\"`，状态不翻转 |
| 字符串里的表头 | ✅ 正确 —— 解析器结构判定，文本层有字符串状态机 |
| 多行数组 | ✅ 正确 —— 括号配平跨行工作 |

上一轮（第五轮）的 FC-01 同样经实测不成立：它称 `[tool . mutmut]` 非法，但
`smol-toml` 接受该语法，TOML 规范允许点号周围有空白。

**共同原因**：评审输入是**代码片段**，不是完整文件。基于片段推断"某条代码路径可能出错"
是合理怀疑，但无法验证。而实测需要的是完整上下文。

## Decision

**接受 architecture 席位（三轮连续 APPROVED，置信度 8-9）的裁决，以
`consensus_ratio = 1/3` 的证据推进推送，并在提交历史与本文档中记录这一偏离。**

用户明确选择了这一方案，并要求记录备查。

## Consequences

### 正面

- 七轮迭代修掉的真缺陷（含两处数据丢失）得以进入 main，而不是停留在本地分支；
- 决策有据可查：谁批准的（用户）、为什么（第六轮断言实测不成立、评审输入是片段）、
  证据强度多少（1/3 而非 3/3）。

### 负面，且必须被后来的读者看到

- **`consensus_ratio = 0.33 < 0.90`，这不符合 Gate MW 的设计意图。** 该门禁存在的理由是
  "一个专家的意见不构成全局批准"（`AGENTS.md` 与 delphi-review 技能的原文），而本次
  恰好只有一席批准。
- 因此这份证据**不能被当作后续推送的先例**。下一次推送仍应争取真实的三席共识。
- 若后续发现问题，回溯点明确：`src/mutation/runners/mutmut-runner.ts` 的
  `mutmutConfigContent` 及其辅助函数，以及 `spawn-with-capture.ts` 的 `shouldEscalate`。

### 已验证的保障

这一偏离不是"没有验证就推"。同期证据：

- `src/mutation` 53 个测试全部通过，覆盖 13 种 TOML 形态；
- 每个修复都有钉住测试，**回退任一修复都会让对应测试失败**（逐个实测）；
- 全量测试 4597 通过 / 0 失败；
- 两个改动文件门禁 0 错误 0 警告。

## How to avoid this next time

评审输入必须是**完整文件**，不是片段。本轮六次评审里有两次（第五、六轮）的
不成立断言可以直接归因于片段输入。若下一次遇到同样的僵局，先补全输入再重跑，
而不是重跑同一份片段。

## References

- `githooks/lib/validate-code-walkthrough.cjs` —— 三道硬约束的实现
- `skills/delphi-review/SKILL.md` —— "One expert result is never global approval"
- 提交：`deefa5f6`（引入 smol-toml）、`259e05bf`、`ac6dd9ba`（本轮修复）
