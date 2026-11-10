# 圈复杂度之外：lizard 认知复杂度（CogC）能力调研与 XP-Gate 融合实践

> 一次"以工具源码为准"的能力测绘，以及它如何暴露了我们自己门禁里的一条错误假设。
>
> 关联议题：[#744](https://github.com/boyingliu01/xp-gate/issues/744)（母）、[#746](https://github.com/boyingliu01/xp-gate/issues/746)、[#747](https://github.com/boyingliu01/xp-gate/issues/747)、[#748](https://github.com/boyingliu01/xp-gate/issues/748)、[#749](https://github.com/boyingliu01/xp-gate/issues/749)、[#750](https://github.com/boyingliu01/xp-gate/issues/750)

---

## 0. 为什么写这篇

我们长期用 lizard 做 Gate 3 的复杂度门禁，并长期相信一件事：**CCN 抓不到"读起来累"**。

写完之后我们对这句话做了复核（§2），结论是：**在这个代码库上它不成立**。
`CogC>10 且 CCN<=10` 的函数有 **0 个**——凡是 CogC 认为难读的，CCN 都已经报了警。

但**这并不等于"CCN 一直在冤杀代码"**（§2.3.1）。CCN 从来不是可读性指标，
它数的是"需要多少条测试路径"。那 1236 个"CogC 觉得不难读"的函数，
用测试覆盖的标准看一分都没冤。真正的结论是：**两个指标测的是不同的东西，谁也替代不了谁。**

这件事本身成了本文最想分享的东西：**我们对一个工具的信心里，有一部分是没有验证过的**。

调研真正的收获是四件事：

1. **我们对 lizard 的使用率只有 3/14** —— 认知复杂度、嵌套结构数、全局代码统计全都没用。
2. **CogC 本身有实测可复现的缺陷** —— 而且缺陷形状与我自己门禁里的一条失效完全同类。
3. **我们手写的"嵌套深度"检测测错了东西** —— 它数花括号，不数控制结构。一个纯 JSON 配置对象和一段 `if > try > for > if` 得到**同一个分数**。
4. **我最初关于"CCN 看不见可读性债务"的判断是错的** —— 复现不出来，原因是我把 lizard 的列读反了（§2.4）。

第 3 条是唯一得到落地验证的部分：构念错误（construct validity），藏在一个用了很久、从未被质疑的规则里，
已在 [#749](https://github.com/boyingliu01/xp-gate/issues/749) 修正并合入 main。
第 4 条是另一种更常见的错误：**结论方向由采集细节决定，而不是由事实决定**。
两条放在一起，正好说明为什么"先出数"之后还得"先怀疑自己的数"。

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
| 5 个**扁平** case 的 `switch`（`a(); break;`） | **7** | **1** |
| 3 层嵌套的 `if` | 4 | **6** |
| 30 个顺序 `if (x === N) return N;` | 33 | 30 |

（表格为 2026-11-10 用 lizard 1.25.1 逐个 fixture 复核后的实测值。）

**两者都对。** 一个 20 分支的消息分派 `switch` 扁平易读但测试路径多；一个 3 层嵌套的 `if` 只有 4 条路径、CogC 却已经翻倍，因为每深一层都在加租。

所以正确的关系不是"CogC 是 CCN 的升级版"，而是：**CogC = 分支数（同 CCN）+ 嵌套惩罚 + 控制流结构（CCN 没有）+ 逻辑序列（CCN 没有）**。

---

## 2. 本仓实测：两个指标的分歧有多大

> **本节于 2026-11-10 重写。** 初版的表格（"仅 CogC 能抓到 36 个"）**复现不出来**，原因见 §2.4。
> 下面所有数字都是重测的，测量口径与脚本见 §2.5，任何人都能跑出同样的结果。

### 2.1 测量口径

744 个文件（`git ls-files '*.ts' '*.tsx' '*.js' '*.cjs' '*.mjs'），lizard 1.25.1，逐文件调用
（`ccn-report.cjs` 在 #737 里学到：批量传参会串列）。

bucket 划分直接复用 `ccn-report.cjs` 的 `bucketFor()`：`src/npm-package/**` 与
`plugins/*/src/**` 是 prepack 生成的镜像，重复计数会让每个重构看起来都像两个热点；
测试文件单列。**镜像不参与结论。**

另外剔除 2315 行 `suspect_parse` 记录（`NLOC<=2 且 CCN>=10`）——那正是 §4 缺陷 C 的签名，
真实的函数不会是"2 行 112 个分支"。剩下 11312 行。

### 2.2 相关性

| 组合 | 全仓 (n=11312) | production (n=1365) |
|---|---|---|
| CCN ~ CogC | r=0.828, r²=**68.5%** | r=0.754, r²=**56.9%** |
| CCN ~ NS | r=0.630, r²=39.7% | r=0.627, r²=39.3% |
| NS ~ CogC | r=0.679, r²=46.1% | r=0.626, r²=39.2% |

CCN 与 CogC 的重合度是 57–69%，**不是独立指标**。原因在 §1 已经说清：CogC =
分支数（同 CCN）+ 嵌套惩罚 + 结构数，分支数那一项本来就撑起了大半方差。指出这一点
不是要否定 CogC，而是为了避免把它当成"CCN 看不见的另一半"——它看见的多半是 CCN 也看见的。

### 2.3 分歧：只有一个方向存在

| 分歧方向 | 全仓 | production |
|---|---|---|
| `CCN>10` 且 `CogC<=10` | **1236** | **356** |
| `CogC>10` 且 `CCN<=10` | **0** | **0** |
| `CCN>5` 且 `CogC<=5` | 4188 | 514 |
| `CogC>5` 且 `CCN<=5` | **0** | **0** |

**`CogC>10 且 CCN<=10` 是 0 个 —— 一个都没有。** 220 个 `CogC>10` 的函数里，CCN 最小也是 11。
production 里同样：49 个 `CogC>10`，CCN 最小值 11。

这条结论与初版正相反，而且反转得很彻底：

- 初版说"CCN 完全抓不到 36 个可读性债务" → **实测没有这种函数**。
  凡是 CogC 觉得难读的，CCN 都已经超过了 10，Gate 3 本来就会拦。
- 真实的分歧全部在另一个方向：**1236 个函数 CCN>10 但 CogC<=10**，占全部 CCN>10 的 85%。

### 2.3.1 这是不是说明 CCN 错了？

**不是。** 这一点必须写清楚，否则上面那行 1236 很容易被读成"Gate 3 一直在冤杀代码"。

先说两个不同的问题：

| | 状态 |
|---|---|
| **CCN 的计算** | 完全正确。`add_condition` 纯累加，数分支数，符合 McCabe 定义（§3 有源码）。 |
| **CCN 是否衡量可读性** | **它从来就不是可读性指标。** CCN 回答的是"这个函数有多少条独立路径（≈需要多少测试用例）"。 |

所以"CCN>10 但 CogC<=10"的 1236 个函数，**用测试覆盖的标准看一分都没冤**：

```js
function dispatch(kind) {
  switch (kind) {
    case "a": return 1;   case "b": return 2;   case "c": return 3;
    case "d": return 4;   case "e": return 5;   case "f": return 6;
  }
  return 0;
}
// 实测 CCN=11  CogC=1  NLOC=7
```

这个函数读起来一眼就懂（CogC=1），但**确实需要 6 个以上的测试用例**才能覆盖。
Gate 3 拦它，拦的是测试风险，不是可读性。我把它叫"误报"是用错了尺子。

反过来，只用 CogC 会放过真正需要担心的代码：

```js
if (!user) return;        // 4 个平铺守卫
if (!user.id) return;     // 实测 CCN=6  CogC=3
if (!user.email) return;  // CogC 完全不管，但这里有 4 条路径要测
db.write(user);
```

而三目链 `a ? 1 : b ? 2 : ...` 实测 CCN=3、**CogC=15** —— CogC 在这里报警得比 CCN 重得多。

**结论：两个指标测的是不同的东西，谁也替代不了谁。**
CCN 该和测试覆盖一起用（本仓的 `xp-gate crap` = CCN² × (1−coverage) + CCN 就是在做这件事），
CogC 该回答"有多难跟着读"，NS 该回答"嵌套有多深"（#749 已把 `deep-nesting` 改成这个）。

### 2.3.2 三分法：每个函数该做什么

把 production 桶里触发任一阈值的 399 个函数按"CCN 高不高 / CogC 高不高"交叉分类：

| 类别 | 判据 | 数量 | 该怎么办 |
|---|---|---|---|
| **A. 分支多但扁平** | `CCN>10` 且 `CogC<=10` | **350** | 不重构，**补测试**。典型是 `switch` 分派、映射表、平铺守卫 |
| **B. 多路径且难读** | `CCN>10` 且 `CogC>10` | **49** | **重构**。两个指标一致指认，是真正的热点 |
| **C. CCN 看不见的难读** | `CCN<=10` 且 `CogC>10` | **0** | （本仓当前不存在；一旦出现说明真出了 CCN 盲区） |
| **D. 深嵌套但路径少** | `NS>4` 且 `CCN<=10` | **0** | （#749 修完后已清零） |

补充数据：**仅 CCN 触发 349 个，仅 CogC 触发 0 个，仅 NS 触发 0 个，多指标同时触发 50 个。**

A 类里 CCN 最高的几个，全部是短小的查表/映射函数：

```
CCN=59  CogC=3   NS=1  NLOC= 4   scripts/generate-hook-resolution.cjs::render
CCN=44  CogC=2   NS=1  NLOC= 3   scripts/generate-deploy-manifest.cjs::renderProjection
CCN=43  CogC=2   NS=0  NLOC= 3   src/gates/test-layers.ts::analyzeTestLayers
CCN=43  CogC=7   NS=2  NLOC= 6   src/principles/analyzer.ts::analyze
```

A 类平均 NLOC 只有 **5.3**，317/350 个嵌套不超过 2 层。把 `render` 拆成十个小函数
不会让它更好读（它已经够短了），只会让调用链更长；它缺的是测试。

B 类才是该动手重构的，而且清单很集中：

```
CCN=112 CogC=96  NS=2  scripts/ccn-report.cjs::main
CCN= 79 CogC=53  NS=4  scripts/ccn-report.cjs::run
CCN= 84 CogC=36  NS=3  scripts/delphi-external-review.cjs::readConfig
CCN= 33 CogC=29  NS=3  src/principles/adapters/control-nesting.ts::advanceNestingState
CCN= 36 CogC=27  NS=5  src/principles/adapters/control-nesting.ts::locateControlBody
CCN= 21 CogC=25  NS=3  src/principles/adapters/import-clause.ts::parseImportClause
```

前两名仍然都在 `scripts/ccn-report.cjs` —— **复杂度测量引擎自己就是全仓最该重构的代码**。

### 2.3.3 对落地策略的含义

这个三分法直接支持一个**更保守**的策略，而不是"用 CogC 替换 CCN"：

- **不要**把 CogC 做成替换 CCN 的门禁。它放过的 4 个平铺守卫、它误伤的短查表函数，都会出问题。
- CogC 的正确用途是**给 CCN 的高分做分诊**：349 个只被 CCN 拦下的函数里，
  绝大多数不需要重构，需要的是测试。这才是 #748 报表真正的价值定位。
- 真正的重构候选只有 49 个（B 类），可控、可排期。

换句话说：**CogC 不是用来"抓得更多"的，是用来"罚得更准"的。**

### 2.4 初版为什么错了

初版表格写 `>10` 行有 17 个 CCN 超标、49 个 CogC 超标、36 个"仅 CogC 抓到"。
本轮用**报告自己指定的 lizard 1.25.0**、在**报告提交时的 commit** 上重跑，得到
`CCN>10` 2028 个、`CogC>10` 72 个、`CogC>10 且 CCN<=10` **0 个**。三个数字全对不上。

最可能的原因是当时的采集把列读错了：**`-ENS` 与 `-Ecognitive` 同时传入时，多出来的
一列按命令行参数顺序排列**。

```console
$ lizard t.ts -Ecognitive -ENS --csv     # ……,10,4   → [11]=CogC=10  [12]=NS=4
$ lizard t.ts -ENS -Ecognitive --csv     # ……,4,10   → [11]=NS=4    [12]=CogC=10
```

同一份代码，两个参数顺序换来两套列位置。读错一列就会得到一张看起来很像样、但把 NS
当 CogC 的表格。初版 `>10` 行还自相矛盾：CCN 超标 17、CogC 超标 49，却写"仅 CogC 能抓到 36 个"。
两者之差是 49−17=32，不是 36——同一张表里的数字对不上自己的减法，
这是采错列的第二个征兆。

**教训比结论更值钱**：一个指标看起来"抓到了别的指标抓不到的东西"，先别急着高兴，
先确认两件事——它的列/口径读对了没有，以及它与原指标的相关性有多高。
r²=68.5% 的两个指标，本来就不太可能各自抓到对方的大片盲区。

### 2.5 复现

```bash
# 逐文件调用，列顺序固定为 -Ecognitive 在前
for f in $(git ls-files '*.ts' '*.tsx' '*.js' '*.cjs' '*.mjs'); do
  lizard -Ecognitive -ENS --csv "$f"      # [0]=CCN [11]=CogC [12]=NS
done
```

### 2.6 Top 榜（production 桶，实测）

```
CogC= 96  CCN=112  NLOC=43   scripts/ccn-report.cjs::main
CogC= 53  CCN= 79  NLOC=41   scripts/ccn-report.cjs::run
CogC= 36  CCN= 84            scripts/delphi-external-review.cjs::readConfig
CogC= 29  CCN= 33            src/principles/adapters/control-nesting.ts::advanceNestingState
CogC= 27  CCN= 36            src/principles/adapters/control-nesting.ts::locateControlBody
CogC= 25  CCN= 21            src/principles/adapters/import-clause.ts::parseImportClause
CogC= 22  CCN= 30            dashboard/dashboard.js::renderSummary
```

榜单前两名都在 `scripts/ccn-report.cjs` —— **复杂度测量引擎自己就是全仓最复杂的代码**。
这不是新问题（初版也观察到了），但值得记一笔：工具一直在给别人打分，自己却始终在榜外。

注意 `main` 现在是 CCN=112 / NLOC=43，而初版写的是 CCN=27。这个函数在这段时间被大幅改写
（43 行里塞了 112 个分支），数字变化是代码真的变了，不是口径问题。

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

   > **而且列序随参数顺序变化**（2026-11-10 补测）。两个扩展同时传入时，多出来的列按命令行出现顺序排列：
   >
   > ```console
   > $ lizard t.ts -Ecognitive -ENS --csv   # ……,10,4  → [11]=CogC=10  [12]=NS=4
   > $ lizard t.ts -ENS -Ecognitive --csv   # ……,4,10  → [11]=NS=4    [12]=CogC=10
   > ```
   >
   > 同一份代码，换个参数顺序就换一套列位置。本文初版就是把这两列读反了（§2.4）。
   > 要么固定参数顺序并在代码里写明，要么按 `--csv` 的列宽做校验——**不能只靠"13 列"这个数**。

**性能成本（60 文件抽样实测）**：`--csv` 1061ms → `-Ecognitive --csv` 1364ms，**+28.6%**。

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

1. **CogC 不能混进 `.ccn-baseline.json`。** 两个指标确实会分歧（实测 514 个 CCN>5 但 CogC≤5、0 个反之，见 §2.3），共用一份基线会让"哪条规则在挡我"不可读。需要独立 `.cognitive-baseline.json`，且要声明 `languages_with_nesting`（Lua/Ruby/Fortran/Erlang 不可比）。
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

CogC 本身有价值，但不是初版以为的那种价值。实测下来它**没有**抓到任何 CCN 漏掉的函数
（`CogC>10 且 CCN<=10` 为 0 个）。它的价值是**分诊**，不是替代：

| 类别 | 数量 | 动作 |
|---|---|---|
| CCN 高 / CogC 低 | 350 | 不重构，补测试 |
| CCN 高 / CogC 高 | 49 | 重构 |
| CCN 低 / CogC 高 | 0 | — |
| NS 高 / CCN 低 | 0 | — |

所以正确的落地姿势不是"用 CogC 换掉 CCN"——那会放过平铺守卫的多路径风险，
也会误伤短小的查表函数。CCN 回答"要测多少"，CogC 回答"有多难读"，NS 回答"嵌多深"，
三个问题三个指标，不能互相顶替。

如果只带走一个结论，我建议带走第 5 条经验：

> **先出数，再定线。** 而且出数之后，先怀疑自己的数——也包括"某个指标抓到了别人抓不到的东西"这种让人高兴的数。

---

*本文 §2 的数字来自 XP-Gate 仓库 744 文件 / 11312 个有效函数（已剔除 2315 行 `suspect_parse`）
与 lizard 1.25.1 的实测，复现命令见 §2.5。其余各节标注的数字沿用报告写作时的实测，
其中涉及"CogC 能抓到 CCN 抓不到的函数"的表述已在 §2 更正。*
