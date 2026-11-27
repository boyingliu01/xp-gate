# 0005. 走查中"不成立但会反复出现"的发现，记录在这里

## Status

Accepted

## Context

code-walkthrough 是多模型评审，同一份 diff 常被三席从不同角度质疑。大多数发现是真的
——本分支修复的 11 个缺陷里有 6 个是 fail-open，其中两处会**删除用户文件**。

但也有一类发现：**推理合理、实测不成立**。它们不是噪声，而是"看起来像缺陷的正确设计"，
每一个都值得回答，且在下一次评审中会被**重新提出**——因为评审每次看到的都是同一份代码。

截至 2026-11-26，已驳回 16 条。把每一条的验证方法写下来，比每次重新推导便宜。

## The findings, and why each does not hold

| 席位断言 | 实测 | 结论 |
|---|---|---|
| C# 正则漏掉 raw/verbatim 字符串，花括号会漏计 | 四种字面量形态的花括号**全部清除** | 不成立。C# 引号配对总是形成闭合区间，`""` 转义等价两个相邻字面量 |
| PHP 未闭合 heredoc 保留原文是"泄漏" | 保留是**有意**的：未闭合是语法错误，暴露才对 | 不成立；已补测试钉住两侧 |
| `parseArgs` 遇到未知参数死循环 | 4 参数 3 次迭代，正常终止 | 不成立。`for` 的 `i++` 保证前进 |
| `lizard` 缺失应 BLOCK | `AGENTS.md`：「Tool missing → SKIP, not BLOCK」 | 不成立。与 6 个 gate 的约定一致 |
| `currentWarnings[file] \|\| 0` 把缺失当 0 | `analyzeWarningsForFiles` 预置每个被请求文件为 0 | 不成立。键永不为 undefined |
| `findDuplicateModel` 只做精确匹配即可被绕过 | `resolved_model` 层**忽略大小写**比较，且有测试 | 不成立。`requested_model` 只是提前检查 |
| `expandEnvPlaceholder` 调用 `process.exit` | CLI 脚本的**有意**行为，有测试 | 不成立。缺密钥就该退出 |
| `DEFAULT_PROMPT_BUDGET_BYTES` 有 TDZ | 模块正常加载，导出值 40000 | 不成立。在函数体内求值 |

## The rule this suggests

**驳回必须附实测。** 上表每一行的"实测"列都可以复现——复现方式就是该条目的价值。
一个没有实测的驳回，只是把评审的怀疑换了个说法。

两条防止误判的常规做法：

1. **先跑一次真实调用**，再读代码推断。`node -e "require(...)"` 就能排除一半的
   "模块加载时崩溃"类断言。
2. **查测试再下结论**。`expandEnvPlaceholder` 的 exit 行为、`resolved_model` 的大小写
   去重，都已经有测试直接覆盖；重写它们就是推翻已被钉住的决定。

## Consequences

- 每批走查结束时，把驳回条目追加到本表，而不是只写在提交信息里 —— 提交信息按提交
  分散，本表按"会被重复提出"聚合。
- 本表**不是**"评审不可信"的记录。同一批里，三席独立发现 `maskLiterals` 的模板插值
  限制、`init-baseline` 的静默失败，都是真的。驳回率与评审质量无关，与代码成熟度有关：
  项目越老，"看起来错但其实对"的地方越多。

## References

- `docs/adr/0004-walkthrough-at-one-third-consensus.md` — 一次共识不足的走查
- `AGENTS.md` 的 `DELPHI SEATS` 节 — 三厂商席位约束
