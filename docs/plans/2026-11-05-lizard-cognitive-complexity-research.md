# 圈复杂度之外：lizard 认知复杂度（CogC）能力调研与 XP-Gate 融合实践

> 一次"以工具源码为准"的能力测绘，以及它如何暴露了我们自己门禁里的一条错误假设。
>
> 关联议题：[#744](https://github.com/boyingliu01/xp-gate/issues/744)（母）、[#746](https://github.com/boyingliu01/xp-gate/issues/746)、[#747](https://github.com/boyingliu01/xp-gate/issues/747)、[#748](https://github.com/boyingliu01/xp-gate/issues/748)、[#749](https://github.com/boyingliu01/xp-gate/issues/749)、[#750](https://github.com/boyingliu01/xp-gate/issues/750)

---

## 0. 为什么写这篇

我们长期用 lizard 做 Gate 3 的复杂度门禁。用得越久越确信一件事：**CCN 抓不到"读起来累"**。

但这次调研真正的收获不是"发现了 CogC"，而是三件更意外的事：

1. **我们对 lizard 的使用率只有 3/14** —— 认知复杂度、嵌套结构数、全局代码统计全都没用。
2. **CogC 本身有实测可复现的缺陷** —— 而且缺陷形状与我自己门禁里的一条失效完全同类。
3. **我们手写的"嵌套深度"检测测错了东西** —— 它数花括号，不数控制结构。一个纯 JSON 配置对象和一段 `if > try > for > if` 得到**同一个分数**。

第 3 条是本文最想分享的部分：它不是新功能缺失，是**构念错误（construct validity）**，而且藏在一个我们已经用了很久、从未有人质疑过的规则里。

---

## 1. 先厘清概念：CCN 和 CogC 不是"粗粒度/细粒度"的关系

很多资料把认知复杂度说成"比圈复杂度更聪明的版本"。这个说法把两者的关系搞错了——**它们测的是不同的东西，而且会给出相反结论**。

### CCN 是路径计数

`if` / `for` / `case` / `catch` / 逻辑运算符各 +1。它回答的是：

> 这个函数有多少条独立的执行路径？（≈ 需要多少个测试用例才能覆盖）

### CogC 是理解成本

它不数路径，而是把三条认知心理学原理折算成分数：

- **Boehm**：复杂度随控制流结构数量增长
- **Woods**：嵌套会打断线性阅读
- **Bainbridge**：可并行处理的逻辑越少越省力

于是 SonarSource 定义了**三类增量**：

| 类型 | 规则 | 受嵌套影响 |
|---|---|---|
| **Structural** | `if`/`for`/`while`/`switch`/`catch`/三元：+1 **+ 当前嵌套层数** | ✅ |
| **Hybrid** | `else`/`else if`：+1（无嵌套惩罚） | ❌ |
| **Fundamental** | 逻辑运算符序列、`goto`、带标签 `break`、**递归** | ❌ |

### 关键是分歧

实测同一段代码的两个指标：

| 构造 | CCN | CogC |
|---|---|---|
| 5 个**扁平** case 的 `switch` | **5** | **1** |
| 3 层嵌套的 `if` | 4 | **6** |
| 30 个顺序 `if` | 31 | 30 |

**两者都对。** 一个 20 分支的消息分派 `switch` 扁平易读但测试路径多；一个 3 层嵌套的 `if` 只有 4 条路径、CogC 却已经翻倍，因为每深一层都在加租。

所以正确的关系不是"CogC 是 CCN 的升级版"，而是：**CogC = 分支数（同 CCN）+ 嵌套惩罚 + 控制流结构（CCN 没有）+ 逻辑序列（CCN 没有）**。

---

## 2. 本仓实测：两个指标的分歧有多大

在 XP-Gate 自身 277 个文件 / 4729 个函数上跑：

| 阈值 | CCN 超阈值 | CogC 超阈值 | 仅 CogC 能抓到 |
|---|---|---|---|
| >5 | 224 | 203 | **39** |
| >10 | 17 | **49** | **36** |
| >15 | 6 | 12 | 6 |
| >20 | 4 | 6 | 2 |

两个方向都有信息量：

- **CCN>5 但 CogC≤5：60 个** → CCN 在低位是噪声，CogC 正确地不报（扁平分支）
- **CCN≤10 但 CogC>10：36 个** → CCN **完全抓不到**的可读性债务

后者特别刺眼，因为我们的 `ccn-report.cjs` 的 fail-closed span 验证**只覆盖 CCN>10 的行**。也就是说这 36 个函数连验证都不会被要求。

Top 榜单印证两者测的是不同东西：

```
CogC=52  CCN=27   scripts/ccn-report.cjs::main
CogC=49  CCN=36   scripts/ccn-report.cjs::run
CogC=36  CCN=31   scripts/delphi-external-review.cjs::readConfig
CogC=35  CCN=26   scripts/ccn-report.cjs::csvRows
CogC=25  CCN=10   src/principles/adapters/import-clause.ts::parseImportClause   ← CCN 认为"还行"
CogC=22  CCN=12   dashboard/dashboard.js::renderSummary
```

`parseImportClause` 是典型：CCN=10 看着人畜无害，实际是 30 行 / 4 层嵌套 / 5 个正则。

**一个值得自省的细节**：榜单前四名里有三个在 `scripts/ccn-report.cjs` —— **也就是我们的复杂度测量引擎本身**。工具一直在给别人打分，自己却是自己的盲区。

---

## 3. CogC 的实现逻辑（源码级）

lizard 1.25 把这套规则实现在 6 个文件、936 行里：

```
cognitive_profile.py   150行  每种语言"这个词算哪类结构"
cognitive_counter.py   165行  三类增量 + 共享规则
cognitive_brace.py     239行  花括号语言：从 { } ( ) ; 推导嵌套
cognitive_actions.py   174行  关键字动作 + 前瞻消歧
cognitive_indent.py    112行  缩进语言（Python/GDScript）
lizardcognitive.py      96行  入口：注册 CogC 列
```

### 全部秘密在这一行

```python
def _structural(self):
    self._add(1 + len(self.state.frames))   # ← 1 + 当前嵌套层数
```

`frames` 是一个栈：遇到新结构压栈，体结束弹栈。"嵌套层数" = 当前还开着几个结构。

CCN 只看"遇到几个分支"，CogC 看"遇到时栈有多深"。**这就是两者分叉的全部原因。**

### 手工对账验证

以 `parseImportClause`（CCN=10）为例，按规范逐结构累加：

```
marker 三元（0层）           +1+0 = 1    → 1
if (def)（0层）              +1+0 = 1    → 2
if (braces)（0层）           +1+0 = 1    → 3
  for（1层，被 if 推深）      +1+1 = 2    → 5
    if (!part)（2层）         +1+2 = 3    → 8
    asMatch 三元（2层）       +1+2 = 3    → 11
    memberTypeOnly 三元（2层）+1+2 = 3    → 14
```

**手工 14，CCN 10，但 lizard 实测 25。** 6 个结构被嵌套惩罚膨胀成 14 分——这个"读起来累"被正确量化了。但 25 ≠ 14，说明 lizard 还有别的问题（见第 4 节）。

### `else` 为什么没有嵌套惩罚

实现上很巧妙。`if` 体结束后 frame **不立刻弹栈**，而是标记 `closing = True` 等待下一个 token：

```python
def _block_closed(self):
    if frame.braced and frame.depth == self.state.depth + 1:
        frame.closing = True   # 标记"体结束了"，但不弹栈
        break

def _resolve_closing(self, token):
    if token == 'else':
        bound = self._bind(_IF_LIKE)   # 绑定回外层 if
    if bound and token == 'else':
        self._hybrid()                 # +1，无嵌套惩罚
```

因为 `else` **复用了 `if` 的那个帧**（`_bind` 把已关闭的帧删掉），它看到的栈深和 `if` 一样。CCN 则会把 `if/else` 算成两个独立分支。

### 头部识别：`if (a && b)` 里的 `&&` 不算逻辑序列

```python
if top.phase == HEAD:
    if token == '(':
        top.phase = PAREN_HEAD     # 括号里不算结构
    elif not self.profile.paren_heads:
        top.phase = BRACE_HEAD     # Go/Rust: if a && b {
```

`phase != BODY` 时 token 直接 `return`，不进入 actions 表。这是**纯上下文感知**——CCN 完全没有这个能力。

---

## 4. 但我实测出三个缺陷（这才是重点）

引入前我做了语义对账。**先说过关的部分**，因为这决定了改造可行性：

| 构造 | 规范 | lizard 1.25 |
|---|---|---|
| `if` 嵌套 0/1/2 层 | +1/+2/+3 | 6（`1+2+3`）✅ |
| 顺序 `if` 不叠加 | 2 | 2 ✅ |
| `if x==1..4 elif` 扁平 | 4 | 4 ✅ |
| `for` + `if continue` | 3 | 3 ✅ |
| `a && b \|\| c` | 3（两段序列） | 3 ✅ |
| `switch` 5 case | **1** | **1** ✅ |
| 裸块 `{}` | 不加嵌套层 | 正确忽略 ✅ |
| `try` 不贡献嵌套阶层 | 1 | 1 ✅ |

**语义模型是对的。** 问题出在特定结构（lambda）的帧管理上。

### 缺陷 A：常量赋值箭头函数的 lambda 帧未建立

```js
function f(a) {
  const g = (x) => { if (x) { return 1; } };   // 实测 f 的 CogC = 0
  return 0;
}
```

按规范该 `if` 应有增量（至少 +1）。实测 **0**。

更糟：那个 `if` 被记到了 **`g` 自己身上**（`g` 显示 CogC=1），而函数本身按规范不计增量。**两边都错。**

### 缺陷 B：内联 callback 的计数丢失

```js
items.map((i) => { if (i) {...} })          // 实测 0
items.map(function (i) { if (i) {...} })    // 实测 0
```

`.map` / `.filter` / `.reduce` 的回调**恰恰是"读起来最累"的地方**，这里测不到。

**影响量化**：`parseImportClause` 实测 25，手工对账 14 —— 它内部有 `const push = (name) => { if (...) }`。**虚高近 1.8 倍。**

### 缺陷 C：解析失败静默为 0

```js
function f(})   // 坏语法
```
输出 `CogC=0`、`exit 0`。

**"解析失败"和"完全简单"在 CSV 里长得一模一样。**

### 缺陷 D：部分语言静默降级（无嵌套惩罚）

用一个 3 层嵌套 `if` 做探针（规范应为 `1+2+3 = 6`）：

| 语言 | 实测 CogC | 判定 |
|---|---|---|
| TS / Go / Rust / Kotlin / Swift / C++ / C# / PHP / Java / Python / **Dart** | **6** | 正常 |
| **Lua / Ruby / Fortran / Erlang** | **3** | **降级（无嵌套惩罚）** |

**这里我先犯过一个错**：我一开始凭源码注释推断"Dart 走降级路径"，实际一测 Dart 是 **6**，和 TS 一样。教训是——**注释可以过时，实测不会**。

---

## 5. 最重要的发现：我们自己的嵌套检测测错了东西

这是我们用的 `clean-code.deep-nesting` 规则的数据源（`typescript.ts`）：

```ts
if (c === '{') { depth++; if (depth > max) max = depth; }
else if (c === '}') depth--;
```

**它数花括号。** 但规则想表达的是"控制结构太深让人读不懂"。

做两个 fixture 实测：

| fixture | 结构 | 现 `nestingDepth` | lizard `-ENS` |
|---|---|---|---|
| A | 纯配置对象 `{db:{pool:{retry:{max}}}}`，控制结构只有 1 层 `if` | **5** | **1** |
| B | 真实控制流 `if > try > for > if` | **5** | **4** |

**两者都得 5。现实现完全无法区分"配置对象嵌套"和"控制流嵌套"。**

一个纯 JSON 形状的常量会被判为深嵌套；而真正该被测的 `if>try>for>if` 恰好也是 5，无法据此排优先级。

这不是精度问题，是**构念错误**：规则说"控制结构太深"，量的是花括号。而且这个错在一个我们用了很久、从未有人质疑的规则里。

**这可能是本文最值得分享的一条经验**：一个指标便宜、稳定、从不报错，不代表它测的是你以为的东西。

更讽刺的是，lizard 早就给了正确答案——`-ENS` 扩展：

```
$ lizard ns.ts -ENS --csv
8,4,30,1,8,"f@1-8@ns.ts",...,1,8,3      ← 最后一列 NS = 3
```

`-ENS` 复用的正是 CogC 那套 frame 栈，已经处理了无花括号体、`else` 绑定、Go/Rust 无括号头部等边界。我们自己写了一份，测错了构念。

---

## 6. 能力测绘：14 项能力，我们只用了 3 项

| 能力 | 现状 | 价值 |
|---|---|---|
| `--csv` / `-C` | 已用 | — |
| `-Ecognitive` + `--CogC` | 完全未用 | 高 |
| **`-ENS`** 嵌套结构数 | 完全未用 | **最高** |
| `-Eoutside` 全局代码 | 完全未用 | 中高 |
| `-a` / `-L` 参数/长度上限 | 未用 | 中（可替代自研规则） |
| `-H` / `--checkstyle` | 未用 | 中（dashboard 可复用） |
| `-t` 多线程、`-x`/`-W` | 未用 | 中 |
| `-m`、`-Ehalstead`、`-X` | 未用 | **明确不做** |

**扩展可叠加**，列按注册顺序追加，一次调用拿全：

```
lizard x.ts -Ecognitive -ENS -Ehalstead --csv
5,5,61,3,5,"seq@1-5@t.ts","t.ts","seq","seq ( a , b , c )",1,5, 7, 2, 271.41,22.67,6152.04
                                            ^^^^^^^^^^^^^^^   ^  ^
                                            签名列内含逗号    CogC NS
```

**两个解析陷阱，都必须处理**：

1. **签名列内含逗号且被引号包起来**（`"seq ( a , b , c )"`）。naive 的 `awk -F,` 会在这里撕裂，把后续所有列错位。必须用引号感知的 CSV 解析（本仓 `ccn-report.cjs` 的 `parseCsvLine` 已经是这样做的）。
2. **列数随扩展组合变化**：11 列（无扩展）/ 12（CogC）/ 13（CogC+NS）/ 16（+Halstead）。**必须按列数自适应**，硬编码会静默错位。

**性能成本（277 文件实测）**：`--csv` 5.18s → `-Ecognitive --csv` 6.65s，**+28%**。

**关键：`-Ecognitive` 不改变任何其它指标。** 实测 4736 行 vs 4736 行，CCN/token/NLOC 逐字段一致。所以**现有 982 条 CCN 基线零漂移**，改造是纯增量。

### 为什么明确不做 `-Ehalstead`

实测能用（H-volume / H-diff / H-effort），但：本质是数运算符/操作数、学术争议大、与 CCN/CogC 高度共线。我们已经有了 `crap`（CCN² × 未覆盖 + CCN），覆盖了"复杂度 × 测试覆盖"这个更可行动的组合。**再加一个理论指标只增加解释成本。**

---

## 7. 落地策略：先减法，后加法

| 顺序 | 动作 | 性质 | 风险 |
|---|---|---|---|
| **1** | `-ENS` 替换自研 `maxNesting` | **减法** + 修构念 | 中（Gate 4 warnings 漂移需评估） |
| 2 | `-Ecognitive` 采集（列数自适应） | 加法，纯增量 | 低 |
| 3 | 修 CogC 缺陷（自研 span 重算） | 加法前置 | 中 |
| 4 | `xp-gate cognition` advisory 报表 | 观测 | 低 |
| 5 | CogC 独立第二基线 | 门禁 | 高（需前三步） |

**为什么减法优先**：`-ENS` 是删 5 份重复实现 + 修正语义，可回退；CogC 门禁是加指标 + 语义存疑（缺陷 A/B 未修前虚高 1.8 倍），且**基线一旦固化难改**（棘轮只向上不向下）。

### 三条硬约束

1. **CogC 不能混进 `.ccn-baseline.json`。** 两个指标分歧是常态（60 个 CCN 判超标但 CogC 判健康，36 个反之），共用一份基线会让"哪条规则在挡我"不可读。需要独立 `.cognitive-baseline.json`，且要声明 `languages_with_nesting`（Lua/Ruby/Fortran/Erlang 不可比）。
2. **先做 advisory 报表，不做门禁。** 遵循本仓已有先例（`crap`、`rework`、`runtime-journal` 全都"永远 exit 0"），让数字先被读懂。
3. **`absent ≠ 0`。** 列数 <12 时 CogC 必须是 `null` 而不是 `0`。这条对齐本仓已经为 CCN 建立的原则（#543/#666/#737：**读不到 ≠ 没问题**）。

---

## 8. 五条可迁移的经验

抛开 lizard 和 XP-Gate，这次调研有五条对任何质量工程团队都成立的经验：

### ① 工具的默认能力往往远大于你在用的一部分

我们对 lizard 的使用率是 3/14。不是不想用，是**没有系统地盘点过**。建议定期对核心工具做一次"能力测绘"：读源码 + 实测，而不是读文档。

### ② 当工具说"没问题"时，先确认它真的测了

CogC 对坏语法返回 `0` 和 `exit 0`。这与我们门禁里已经修过的两处失效（gitleaks 不产报告→SKIP 计通过；`--root` 被忽略→读不到的树报成干净树）是**同一个形状**：把"我没读到"当成"没问题"。

**判断一个门禁是否诚实，看它失败时的行为，而不是成功时的行为。**

### ③ 语义模型对，不代表实现没有 bug

lizard 的 CogC 在 9 个语义点上都与规范一致，但在 lambda 帧管理上有 bug。**规范对账通过只是必要条件，不是充分条件**——还要测边界结构（回调、lambda、坏语法）。

### ④ 便宜、稳定、从不报错的指标，最需要怀疑

我们的 `maxNesting` 跑了很多年没出过问题。没出问题是因为**没人验证过它测的东西**。一个纯配置对象被判深嵌套，没人发现——因为大家看到告警就去"修"，而不是去问"这个数是怎么来的"。

### ⑤ 先出数，再定线

任何新指标都该先以 advisory 形态跑一段时间（永远 exit 0），让数字被读懂、缺陷被确认修好，再决定阈值和基线。**先定阈值再验证测量，是把错误固化最有效的方式。**

---

## 9. 复现材料

```bash
pip install lizard==1.25.0

# 缺陷 A：lambda 帧未建立
printf 'function f(a) {\n  const g = (x) => { if (x) { return 1; } };\n  return 0;\n}\n' > A.ts
lizard -Ecognitive -V A.ts            # f 的 CogC=0，g 的 CogC=1

# 缺陷 C：坏语法静默为 0
printf 'function f(})\n' > bad.ts
lizard bad.ts -Ecognitive --csv       # CogC=0, exit 0

# 缺陷 D：Lua 无嵌套惩罚（3 层嵌套 if 应得 6）
printf 'local function f(a) if a then if a then if a then return 1 end end end end\n' > d.lua
lizard d.lua -Ecognitive --csv        # CogC=3

# 构念错误：花括号深度 vs 控制结构嵌套
# A: 纯配置对象 -> 现实现 nestingDepth=5，lizard -ENS=1
# B: if>try>for>if -> 现实现 nestingDepth=5，lizard -ENS=4
```

---

## 10. 收尾

这次调研最有价值的产出不是"发现了一个新指标"，而是三件我们本该更早做的事：

1. **盘点工具的完整能力**（而不是只用当初引入它的那个功能）
2. **验证指标的构念**（而不是只看它有没有报警）
3. **默认怀疑"没问题"**（而不是把沉默当成通过）

CogC 本身当然有价值——它抓到了 CCN 完全看不见的 36 个函数，其中 3 个在我们自己的测量引擎里。但如果只带走一个结论，我建议带走第 5 条经验：

> **先出数，再定线。**

---

*本文所有数字均来自 XP-Gate 仓库（277 文件 / 4729 函数）与 lizard 1.25.0 的实测，可用第 9 节命令复现。*
