# XP-Gate 门禁质量矩阵（第一轮完整扫描）

生成日期：2026-11-19  
版本：v0.38.24.0  
数据源：`.xp-gate/audit.jsonl`（15,482 条记录，剔除 391 条 `duration_anomaly`）＋ 真实钩子 fixture 实测

---

## 一、有效性：每个门禁对所有支持的语言是否都能正常检测

验证方法：**暂存一个已知缺陷，问门禁是否给出真实判定**。这是 AGENTS.md 反复强调的缺陷族——「断言的对象与被断言的对象不是同一件事」。

| 门禁 | 验证方式 | 结论 |
|---|---|---|
| **0** version-consistency | 无暂存上下文 | ✅ SKIP + 明确原因 |
| **1** code-quality | debugger / any / eslint 配置 | ⚠️ **已修** — 15 条阻断路径不记判定 |
| **2** duplicate-code | 重复代码 + 无配置项目 | ⚠️ **已修** — 扫自己的产物、需联网 |
| **3** complexity | 高圈复杂度函数 | ✅ BLOCK |
| **4** principles | 5 层嵌套 | ✅ WARNING 报出（交给 Boy Scout） |
| **5** tests-coverage | 全路径（前轮已验） | ✅ |
| **6** architecture | 无架构配置 | ⚠️ **已修** — 两套实现判定相反 |
| **7** iac-security | 开放安全组 `0.0.0.0/0` | ✅ BLOCK |
| **8** secret-scanning | GitHub token / 干净代码 | ✅ BLOCK / PASS 双向 |
| **9** build-integrity | 缺 tsconfig / 有 tsconfig | ✅ SKIP+原因 / PASS |
| **10** sast | 命令注入 | ✅ BLOCK |
| **11** sprint-flow | 非 sprint 项目 | ✅ SKIP + 原因 |
| **12** file-hygiene | CRLF 行尾 | ✅ WARN（不阻断，符合设计） |
| **13** compiler-strictness | C++ 未使用变量 | ✅ FAIL + BLOCK |

**有效门禁：14/14 全部能给出真实判定**（其中 3 个在本次扫描中被发现并修复）。


### 门禁 1 × 15 语言（第三轮补全）

门禁 1 是 commit-only（`check 1` 恒定 SKIP），所以探针必须驱动真实 `pre-commit`。
新增 `scripts/probe-gate1-languages.sh`，每门语言种一个该语言工具链必须报出的缺陷：

```
PASS: 15   SKIP: 0   FAIL: 0
```

| 语言 | 植入的缺陷 | 判定 | 证据 |
|---|---|---|---|
| python | 未定义名 | BLOCK（门禁 1） | `RUFF ERRORS detected` |
| go | 声明未使用 | BLOCK（门禁 1） | `typechecking error` |
| shell | 引用未赋值变量 | BLOCK（门禁 1） | `never_defined_variable_xyz is referenced but not assigned` |
| powershell | 赋值给未定义变量 | BLOCK（门禁 1） | `PSUseDeclaredVarsMoreThanAssignments` |
| java | 类型不匹配 | BLOCK（门禁 1） | 编译器报错 |
| kotlin | 返回类型不匹配 | BLOCK（门禁 1） | `Analysis failed with 1 weighted issues` |
| iac | 未闭合块 | BLOCK（门禁 1） | `Error: Unclosed configuration block` |
| dart | 类型不匹配 | BLOCK（门禁 1） | `A value of type 'String' can't be assigned` |
| php | 未定义变量 | BLOCK（门禁 1） | 检出 |
| swift | 返回类型不匹配 | BLOCK（门禁 1） | 检出 |
| flutter | 类型不匹配 | BLOCK（门禁 1） | 同 dart |
| typescript | 语法错误 | BLOCK（**门禁 9** 先拦） | `Build integrity check failed` |
| csharp | 类型不匹配 | BLOCK（**门禁 4** 先拦） | `1 changed C# file(s) with compiler warning` |
| cpp | 未声明标识符 | BLOCK（**覆盖率**先拦） | `Could not determine cpp coverage` |
| objectivec | 未声明标识符 | BLOCK（**门禁 5** 先拦） | `Tests FAILED` |

**11 个由门禁 1 亲自检出，4 个被更早顺序的门禁拦下**——都是有效判定，归属不同。

> 这份矩阵的价值不在于「全绿」，而在于它**逼出两个真实缺陷**：
> IaC 缺语法验证层、以及 IaC 适配器在钩子里从未拿到文件列表。
> 后者尤其值得记：上一版修复正确、测试也绿，但生产路径根本不带参数，**修复从未执行过**。

### 本轮修复的三个缺陷

#### 门禁 6：`check 6` 比它自己的钩子更宽松

同一仓库（有 package.json 和 .ts 文件，无架构配置）：

```
git commit（真实钩子）           xp-gate check 6（预演命令）
❌ ARCHITECTURE CONFIG MISSING    ✅ arch: no high/critical findings
   - COMMIT BLOCKED                 exit 0
```

**两个入口给出相反判定，且分歧方向是更宽松的那一侧。** 而 `check 6` 正是用户用来预演门禁的命令，它最不该比门禁本身更宽容。

#### 门禁 1：会阻断，却把「通过」写进日志

```
❌ BLOCKED - 'debugger' statements detected:
src/bad.ts:2:  debugger;
    Gate 1: Code Quality                          PASS
```

提交确实被拦住了，但**被记录的判定是 PASS**——这些分支从不给 `GATE_1_STATUS` 赋值，于是保持函数开头设的 `"PASS"`。

逐条扫过全部 `return 1` 后：**15 条**阻断路径从未设置状态。

> 一个**确实发现了问题**的检查，被记录成没发现。控制台与日志互相矛盾，而事后被反复查阅的是日志。

#### 门禁 2：把自己生成的文件互相比对

| 路径前缀 | 命中数 |
|---|---|
| `.xp-gate` | **4949** |
| `src/npm-package` | 1923 |
| `plugins` | 1306 |
| `skills` | 1152 |

关于工具自身输出的发现，比它被告知要检查的源码加起来还多。

---

## 二、高效性：是否在合理时间内完成，有无明显瓶颈

### 修复后的耗时排序（审计最近 400 条记录）

| 门禁 | p50 | p90 | 说明 |
|---|---|---|---|
| **12** file-hygiene | 34.2s | 53.2s | 只扫暂存文件；批量提交时慢，是真实工作量 |
| **5** tests-coverage | 20.0s | 75.2s | 读已有覆盖率报告 |
| **1** code-quality | 18.3s | 33.5s | tsc + eslint 真实执行 |
| **0** version-consistency | 16.2s | 25.6s | |
| **9** build-integrity | 5.1s | 8.7s | |
| **6** architecture | 4.9s | 7.7s | archlint 扫描 |
| **2** duplicate-code | **3.7s** | 6.0s | **原 p50 52s，降 93%** |
| 11 / 8 / 7 / 13 / 12b / 3 | 0.6-2.8s | ≤3.9s | |
| **10** semgrep | 0.4s | 52.3s | **双峰，见下** |
| 12c / 4 | 0.2-0.3s | ≤10.8s | |

### 修复后的耗时基线（`xp-gate audit --stats` 全量，修复后重采）

| 门禁 | 平均耗时 | 通过率 | 说明 |
|---|---|---|---|
| **5** tests-coverage | 35.5s | 100% | 读已有覆盖率报告 |
| **10** semgrep | 42.2s | 100% | **历史均值被旧样本拉高，近期 ≤0.4s（见下）** |
| **1** code-quality | 16.3s | 100% | tsc + eslint 真实执行 |
| **12** file-hygiene | 14.0s | 83.9% | 只扫暂存文件 |
| **6** architecture | 12.6s | 100% | archlint 扫描 |
| **2** duplicate-code | 5.3s | 100% | **原 52s，降 90%** |
| **11** sprint-flow | 4.3s | 99.8% | |
| **3** complexity | 2.9s | 99.8% | |
| **13** compiler-strictness | 2.8s | 100% | |
| **12c** | 2.7s | 100% | |
| **4** principles | 1.9s | 99.9% | |
| **0** version-consistency | 1.6s | 98.7% | |
| **12b** | 0.8s | 100% | |

> 这张表本身就是本轮修好的两个缺陷的产物：修复前 `audit --stats` 完全无法运行
> （`require is not defined`），修复后又报出「gate-1 平均 5842895372 ms」
> （历史坏值被求和）。**测量工具自身没有被验证过，它给出的所有数字都不可信**——
> 这是本轮最值得记住的一条。

### 两个已消除的瓶颈

| 问题 | 修复前 | 修复后 | 手段 |
|---|---|---|---|
| 门禁 2 扫自己的产物 | 52 s / 3886 克隆 | **5.3 s / 829 克隆** | 排除 `.xp-gate`、排除 `.md` |
| 门禁 10 semgrep 规则集 | 平均 43 s，25% 超 60 s | **0.28 s** | 规则集本地缓存 |
| `audit --stats` 求和历史坏值 | 5842895372 ms | **16282 ms** | 套用 6 小时合理性上限 |

### 门禁 10 的双峰分布，以及为什么它不是缺陷

23 个样本里 14 个低于 0.5 秒、9 个在 21-66 秒，p90 因此高达 52.3 秒。
按时间切开就清楚了：

```
06:48 之后   7 次   均值 0.28 秒
06:48 之前  16 次   均值 21.22 秒
```

**分界点正是缓存修复上线的那一刻。** 慢样本全是修复前的历史数据，最近 8 次
运行全部 ≤0.4 秒。所以「p90 52 秒」不是当前性能，是缓存修复前后的混合。

> 这与历史上的 gate-5 p99 是同一类陷阱：**不按版本/改动分段统计的数字，会把
> 已经修好的问题当成现存瓶颈**，据此做优化决策就是白花力气。

### 历史 p99 的解读（重要）

早期数据里 gate-5 p99 = 423 秒、gate-12 max = 1043 秒。**这些是旧版本遗留**：
当时门禁会自己跑全量测试；现版本读取已有覆盖率报告。

> 用历史 p99 做容量规划会严重高估。必须按版本分段统计。

---

## 三、高质量：是否符合 xp-gate 自身的要求和意图

对照 AGENTS.md 的核心原则逐条检查：

| 原则 | 状态 |
|---|---|
| SKIP 必须被记录，不能只打印 | ✅ 门禁 9/11 均正确记录 SKIP+原因 |
| 门禁体用 `return` 不用 `exit` | ✅ |
| 「没检查」不可与「通过」无法区分 | ⚠️ **门禁 1 违反**（已修） |
| 门禁不得等待网络 | ⚠️ **门禁 2 违反**（`npx -y`，已修） |
| 输入短路先于工具探测 | ✅ |
| 一个时钟，不伪造耗时 | ✅ |
| 两套实现不得分歧 | ⚠️ **门禁 2、门禁 6 违反**（均已修，并加一致性测试） |
| 镜像三处一致 | ⚠️ **门禁 MP 只查工作区**（已修，见下） |
| 门禁链不得静默跳过 | ⚠️ **驱动未点名未到达的门禁**（已修） |

**最突出的系统性风险：同一个门禁存在两套独立实现且互不关联。**

- 门禁 2：钩子用 `githooks/lib/jscpd-run.sh`，CLI 用 `src/npm-package/lib/gate-runner.js`，忽略集互不相干
- 门禁 6：钩子用 `gate-6-entry.sh`，CLI 用 `lib/arch.js`，判定规则相反

这两处都产生了真实误判，且都因为「改了一边、测另一边没变化」才被发现。

### 3.1 第二轮补充：三个「检查对象选错了」

第一轮修的是**判定逻辑写错**。第二轮发现更隐蔽的一族：**判定逻辑没错，
但检查的不是它声称在检查的东西**。

**（1）门禁 MP 查工作区，不查将要推送的内容**

`check-hook-mirror.sh` 比较磁盘上的 canonical 与 mirror。它能发现「镜像忘了重新生成」，
**发现不了「镜像重新生成了但忘了 `git add`」**——因为那时它读的目录已经是正确的。

在同一个 repo 上受控复现：

```
工作区比较:  一致  → PASS    （这正是门禁 MP 允许推送的原因）
已提交比较:  不一致 → FAIL   （这才是真正会被发布的东西）
```

实测后果：本会话有两次提交，`githooks/gate-driver.sh` 与 `githooks/gate-7.sh`
改了、镜像重生了、门禁 MP 报 PASS、推送成功，而**提交里的镜像仍是修复前的版本**：

```
git show HEAD:src/npm-package/hooks/gate-driver.sh | grep -c "NOT reached"
0
```

npm 发布的是 `src/npm-package/**`，所以每个使用者拿到的都是**未修复的门禁**，
而仓库里看起来已经修好了。

**（2）门禁 7 加载全局适配器，而不是仓库自己的**

解析顺序是全局优先，理由是「与 `route_to_adapter()` 保持一致」——**而那个函数在
#688 已被删除**（零生产调用者的调度器）。理由消失了，顺序留了下来，并且有一条
测试以 `(route_to_adapter parity)` 为名在保护它。

实测：仓库 v0.38.26，全局 v0.38.9（**落后 17 个版本**），6 个适配器不一致。
给 fixture 放入它自己的 `adapters/iac.sh` 并标记，门禁 7 依然打印

```
IaC adapter resolved from: /c/Users/think/.config/xp-gate/adapters/iac.sh
```

**（3）驱动 fail-fast 后，未运行的门禁被显示成 SKIP**

报表给 `XP_GATE_ORDER` 里每个门禁都打一行。门禁 1 失败后驱动 `exit`，
后续门禁体从未被调用，于是保持着函数开头的 `GATE_N_STATUS="SKIP"` 初值。

一个**从未被提问**的门禁，报表回答了「跳过」。现在会明确点名：

```
⚠️  Chain stopped at Gate 1 — these gates were NOT reached: 2 3 8 10 7 5 6 4
```

这条修复在本轮**当场抓到了自己**：提交时门禁 0 拦下，旧输出只会显示一串 SKIP，
新输出直接指出 `Chain stopped at Gate 0`。

### 3.2 「修了一半，注释却说修好了」

`xp-gate audit` 有四个入口。其中三个仍在 `require()` 一个 `.ts` 模块：

```
$ xp-gate audit --stats
Error computing stats: require is not defined in ES module scope
```

而这个缺陷**已经写在同一文件的注释里**——`evalGateAuditModule()` 存在就是为了
解决它，注释明确写着四个入口「were ALL unusable」以及为什么没人发现（CI 会回退到
`npx tsx`，坏路径从未被执行）。**但四个里只改了一个。**

> **被自己的注释描述成「已完成」的半成品修复，比没修更糟**——下一个读者相信那段
> 注释，于是不再去看。

### 3.3 一个字段不能用来描述比它更早的数据

`audit --stats` 报出 `gate-1 平均 5842895372 ms`。原因是 397 条历史记录的
`duration_ms` 存的是**绝对时间戳**，它们写于 `duration_anomaly` 标志位存在之前，
身上没有标记，而聚合器只信那个标记：

```js
if (e.duration_anomaly === true) { ... }
else if (typeof e.duration_ms === 'number') { ms += e.duration_ms }   // 坏值直接进入求和
```

异常检测器本来就用 6 小时上限拦这类值，**聚合路径没有用**。

10-20 之后的 10130 条记录零坏值——**写入侧早已修好，读取侧的聚合没有设防**。

### 3.4 门禁 3 把函数体扫到了文件末尾，任何人改这三个文件都无法提交

落地上面的门禁 4 修复时撞上的。**在干净的 HEAD 上同样失败**（用 detached
worktree 单独验证过，与本轮改动无关），所以这是一个先于我存在的 P0：
`src/principles/adapters/java.ts`、`typescript.ts`、`analyzer.ts` 只要出现在变更集里，
门禁 3 就报复杂度回归，而**没有修复路径**——除非伪造基线。

关键对照：lizard 自己的 CSV 与 `.ccn-baseline.json` **数值完全一致**，是
`ccn-report.cjs` 的复算把它们全改错了。

| 函数 | lizard | 基线 | 复算 |
|---|---|---|---|
| extractInterfaces | 3 | 3 | **24** |
| extractClasses | 3 | 3 | **8** |
| extractBracedBlock | 6 | 6 | 7 |
| braceDepth | 5 | 5 | 6 |
| maskCode | 1 | 1 | 2 |

四个原因**依次互相遮挡**——每修好一个，下一个才浮现。修复过程中阻断数
5 → 4 → 1 → 0，正是这个结构的证据：

1. **`stripNonCode` 不认识正则字面量。** `extractInterfaces` 里
   `/(?:public)?\s*interface\s+(\w+)\s*\{/g` 的 `\{` 被当成真括号，函数体永远无法
   配平，扫描一路跑到 EOF，把后面约 90 行算进这个函数。
2. **`else` 被当成分支 token。** 实测 lizard 1.26.1：`if(x){} else {}` 与
   `if(x){}` 同为 CCN 2，`if / else if` 有没有尾部 `else` 都是 3——它根本不数 `else`。
3. **`findDeclarationLine` 把调用当声明。** `if (!isRuleEnabled(rule.id)) return;`
   在声明之前就匹配上了，于是 `isRuleEnabled` 的函数体被取成**调用它的那个函数**，
   CCN 6 而非 2。同类：方法上方的文档注释 `reads adapter.extractInterfaces()` 也抢先命中。
4. **lizard 自己漏算箭头函数体里的 `&&`。** 这是复算**更正确**的一处：
   `[a,b].filter(q => q && q.trim())` lizard 报 CCN 1，实际 2。基线记录了 lizard
   的漏洞，所以只刷新了 `java.ts::extractClasses` 这一条（3 → 4），记录真实值。

第 4 点是三类原因里唯一该改基线而不是改代码的：前三个是测量把代码读错了，
这一个是被测量的工具漏读了代码。

> 这与 3.2 是同一族缺陷：`ccn-report.cjs` 里 `#544` 的注释详细描述了「量测引擎
> 不一致」并声称已用 `--csv-verified` 修好，但 `stripNonCode` 仍然不认识正则字面量。
> **注释描述的是意图，不是状态**——判断依据只能是「回退修复后测试是否精确变红」。

### 3.5 门禁 5：一个「永不失败」的测试，和五种各说各话的 SKIP

门禁 5 此前从未按语言验证过，而它的耗时排第二（35.5s），验证成本高，于是
「跑得动」被当成了「跑得对」。本轮做了 9 语言夹具，**每个夹具带一个故意失败的测试**。

选失败测试而不是缺失测试，是因为「跑不了」和「没找到问题」从外面看一模一样——
`githooks/AGENTS.md` 的裁决契约整段都在讲这件事。失败断言是唯一能让两者分开的输入。

**Bug 1：Go 套件失败了，门禁报 PASSED。**

```bash
go test -coverprofile=coverage.out ./... 2>/dev/null   # 退出码从未捕获
TOTAL_COVERAGE=$(go tool cover -func ...)
if [ -n "$TOTAL_COVERAGE" ] && (( TOTAL_COVERAGE < 80 )); then return 1; fi
COV_EXIT=$((COV_EXIT || 0))                            # 无条件零
```

实测夹具只有一个断言 `Add(1,1)==3`：

```
--- FAIL: TestDeliberatelyFailing (0.00s)
FAIL    p       0.044s
coverage: 100.0% of statements
Go coverage: 100.0%
PASSED - Coverage check completed.
```

失败测试只能通过它**顺带留下的覆盖率数字**抵达裁决，而失败的测试照样覆盖得满。
往下十行的 `shell` 分支做同一件事、却写对了（`COV_EXIT=$((COV_EXIT || $?))`）——
**相邻两个适配器、相反的正确性**，这正是它长期没被发现的形状，也是门禁 3 那个
缺陷的同一个形状。

**Bug 2：除了 TypeScript，每个 SKIP 都被记成 PASS。**

门禁靠 grep 一句话来判断「到底跑了没有」：

```bash
printf '%s' "$TESTS_OUTPUT" | grep -q "No test runner installed locally"
```

那是 **TypeScript 适配器的措辞**。其余语言的措辞各不相同，于是每一个都被记成通过：

| 适配器 | 它说的话 | 门禁给的判定 |
|---|---|---|
| typescript | `No test runner installed locally` | SKIP ✓ |
| shell | `bats not available, skipping shell test suite` | **PASSED** |
| php | `No phpunit.xml(.dist) found -- test suite not discoverable` | **PASSED** |
| powershell | `No Pester tests found` | **PASSED** |
| swift | `No Swift test framework detected` | **PASSED** |
| objectivec | `No Objective-C test framework detected` | **PASSED** |

一份措辞清单只能装下**有人记得读过的那些句子**——这正是本代码库到处在删
手写语言列表的原因。改为**声明式契约**：适配器输出一次 `XP_GATE_TESTS_SKIPPED`，
门禁读这个标记；旧的 TS 句子保留为兼容回退。

**Bug 3：TypeScript 项目声明了自己的测试命令，适配器不读。**

`run_tests()` 只探 `node_modules/.bin/{vitest,jest}`，都没有就报
`No test runner installed locally` ——而这个理由**经常是假的**，因为 Node 18+ 自带
`node --test`。实测 `"test": "node --test"` 且断言故意失败的夹具：报 SKIP，
提交走过去，测试从未运行。改为把项目声明的 `scripts.test` 当兜底（本地执行、不装任何东西，
不是适配器头部警告的 npx 问题）；具名 runner 仍然优先，现有项目的输出形状不变。

**Bug 4：委托给 CI 的门禁，六行之后报 PASSED。**

shell 适配器把测试委托给 CI，并明确说「Not checked by this gate -- verified on
push/PR instead」，然后门禁无条件打印 `PASSED - Coverage check completed.`。
委托本身是对的（239 个 bats 套件串行实测 18m47s，所以由 CI 承担），
错的只是**契约为它自己写了判决**。与「SKIP 必须记录、不能只打印」同族，极性相反：
SKIP 打印了，然后 PASS 盖在上面。

**修复后的 9 语言矩阵**（`XP_GATE_ONLY_GATE=5` 隔离）：

| 语言 | 判定 | 说明 |
|---|---|---|
| typescript | BLOCK | 声明式 runner 生效 |
| python | BLOCK | `assert 2 == 3` |
| go | BLOCK | 修复后 |
| powershell | BLOCK | Pester `Expected 3, but got 2` |
| java | BLOCK | |
| cpp | BLOCK | |
| dart | BLOCK | |
| php | BLOCK | |
| shell | 委托 CI（已诚实标注） | 不再是假 PASSED |

**探针自己也错了两次**，两次都表现为「像产品缺陷的探针缺陷」：

- 第一次把输出赋值写在 `( … )` 子 shell 里，全部语言报 `NONE`；
- 第二次只 stage 一个非源码文件，门禁 5 正确地判「无代码变更跳过」，
  探针把它记成产品缺陷。**门禁是对的，夹具是错的。**

第三次才是真的：改用 `XP_GATE_ONLY_GATE=5` 隔离后，发现此前 python 和 java 的
「失败」其实是 Gate 1 的 Ruff / lint 先拦下了，门禁 5 根本没被走到——
**探针在为一个它没观察到的裁决作证**。

---


### 3.6 门禁 2：一个文件都没分析，判定干净

`classify_jscpd_run` 从一行决定判定：没解析出「Found N clones」且 N>0，就归 `clean`。

「Found 0 clones」= 「没找到重复」，**只有当确实分析了东西时才等于「没有重复」**。
jscpd 把区别写在 stderr 上，却仍 exit 0：

```
Warning: jscpd analyzed no files: check the paths and the --format,
--ignore and --pattern filters
Found 0 clones.
```

2026-11-19 在 Dart 夹具上实测：表格是 `Total: 0 files / 0 lines / 0 tokens`，
门禁打印 `PASSED`，汇总记 PASS。

第二种形态更隐蔽——只有一行时间：

```
$ jscpd --ignore "**/*" lib.dart ; echo $?
time: 0.156ms
0
```

旧兜底把它也归成 `clean`，注释写「leave the gate's verdict as it was」，
但它留下的 verdict 就是 PASS。

两种形态现在都归 `no_files` → SKIP 带原因。**SKIP 而非 BLOCK**：项目可能合理地
不含 jscpd `--format` 覆盖的类型，阻断等于因格式清单惩罚一门语言。

两条反向守卫防止矫枉过正，这是本系列反复强调的：

| 测试 | 钉住的行为 | 没有它会怎样 |
|---|---|---|
| -06 | 有内容但无法解析的报告仍算「扫描发生过」 | 每种不认识的格式都变 SKIP，门禁对任何 jscpd 改版失效 |
| -02 | 真扫了真文件、0 克隆，仍是 `clean` | 把静默通过换成永久跳过 |

**分类器内部的顺序也是契约**：非零退出压过 no-files（崩溃是更具体的事实，
叫它 no_files 会把它藏起来）；解析出的「Found N clones」压过空报告检查
（那是扫描发生过的证据）。


### 3.7 门禁 9：承诺了「有人没构建」，只兑现了一种情况

`GATE_9_UNVERIFIED` 的注释写着「a value means *this commit contains code nobody
built*」，聚合段也要求 unverified 部分「必须说出来」。但**只有 Gradle 分支在赋值**。

一个 Go 文件带类型错误，同时跑门禁 9 和 13：

```
→ Gate 9: Build integrity...
     ℹ️  Not a TypeScript project - skipping build integrity check
     ⏭️  SKIPPED - Build integrity (not a TypeScript project)
⏭️  Gate 9 skipped in 0s (nothing was verified)

ℹ️  No staged C/C++ source files -- nothing to compile
Gate 13 (PASS) completed in 1s
```

`go build` 对同一份文件报错。**没有门禁构建它，也没有门禁说明这一点。**

这与门禁 5 的「五种 SKIP 措辞只有一种被识别」是同族：**机制存在、文档成立、只接了一个入口**。

修复改为遍历 `PROJECT_LANGS`（权威语言来源），记录变更集里实际涉及、又不是 TS/Java
两半覆盖的语言。三处输出都补上：

| 位置 | 之前 | 之后 |
|---|---|---|
| PASS 提示 | 只有 Gradle | 任何未构建语言 |
| SKIP 行 | `(nothing was verified)` | `no build-integrity half for: go:no_build_integrity_half` |
| journal | 只有 Gradle | 任何未构建语言 |

改动前，一个纯 Go 提交和一个纯文档提交的 SKIP 行**完全一样**——这是最需要修的一点。

### 我差点第三次交付「绿得毫无意义」

第一版测试通过时，修复**一行都没执行**：测试桩没设 `PROJECT_LANGS`，而它只在门禁 0 的
`.xp-gate-config.json` 分支里赋值，循环因此空转。补上变量后才真正变红。

端到端更糟：探针的 `CHANGED_FILES` 是空的（上一次提交已消耗掉变更），
所以「没报警告」看起来像修复失效。加 `bash -x` 才看到
`GATE_9_UNVERIFIED=go:no_build_integrity_half` **早已算对**——
只是那条警告的条件是 `STATUS = PASS`，而 Go 提交走 SKIP。

**这是连续第三轮「症状是探针缺陷、穿着产品缺陷的衣服」。** 三次的形态各不相同
（子 shell 变量、错误的夹具、被消耗的变更集），共同的教训是同一句话：
**在看到 gate 内部变量之前，不要相信 gate 的外部症状。**


### 3.8 门禁 11：SKIP 的原因打印了，写进记录时丢掉

三个「拒绝评估」的分支各自都算出了原因并打印，但整个门禁只有**一处**汇总的
`record_gate_audit`，调用时没传第六个参数：

```bash
record_gate_audit "gate-11" "sprint-flow" "$GATE_11_STATUS" "0" "$GATE_11_START"
```

于是每一条 SKIP 都以**空原因**落进审计记录。这是 `githooks/AGENTS.md` 列为
全项目最常复发的缺陷，并且明说**一行带绿、却没有原因的 SKIP 是缺陷不是通过**。

对只读 `xp-gate audit` 的消费者，「故意跳过」和「这条链里根本没有这个门禁」完全一样。

修复后四个分支各自设 `GATE_11_DETAIL`。其中 `allow` 分支记的是**哪一种 allow**——
`phase-not-reached` 与 `checks-passed` 是关于冲刺的相反陈述，只记「allow」等于没记。

**与 3.5、3.7 是同一族的第三次**：

| 门禁 | 形态 |
|---|---|
| 5 | 五种 SKIP 措辞，门禁只认 TypeScript 的那一种 |
| 9 | 机制存在、文档成立，只接了一个语言入口 |
| 11 | 原因算出来了、打印了，汇总时没传下去 |

三处都不是"忘了写"，而是**链路的一环没接上**，且都在"看起来正常"的地方。

### 我的测试也错了两次，第二次离报假缺陷只差一步

1. 测试桩的 `record_gate_audit` 只打印 `$3|issues=$4`，把 detail 丢掉——
   **不改桩，这条缺陷在测试里根本观测不到**。
2. 反证测试先写成 `{"decision":"allow","reason":"checks-passed"}`，而分类器读的是
   `allow_reason` 字段，于是期望 PASS 却得到 SKIP。我花了一步去找一个
   **由我自己夹具字段名错误制造的**产品缺陷。

### 本轮另外两处核查，结论是「实现是对的」

这两项值得记，因为它们证明了这套代码并非处处有问题——避免把"找缺陷"变成"必须找到缺陷"：

| 检查项 | 结论 |
|---|---|
| 门禁 1 是否把「无适配器语言」记成 PASS（历史上 C# 整年如此） | **否**。`.rb` 夹具输出 `No specific adapter for ruby` + `SKIPPED - Code quality (no specific checks for ruby)`，SKIP 带原因 |
| 门禁 1 的扩展名列表是否漏语言 | 逐个核对 22 个扩展名，15 个适配器全覆盖（`.pl` 在列表内，`.tf` 是独立 pattern） |


### 3.9 耗时基线（2026-11-19 实测）

数据源：`.xp-gate/audit.jsonl`，排除负值与 `duration_anomaly` 标记后 **15691 条**可信样本。

| 门禁 | 样本 | 平均 ms | **p90 ms** | p90 占比 |
|---|---|---|---|---|
| SAST Security | 445 | 44 204 | **180 118** | **35.6%** |
| 5-focus | 16 | 43 829 | 76 638 | 15.1% |
| Tests + Coverage | 1 255 | 35 741 | 64 296 | 12.7% |
| File Hygiene | 1 207 | 14 973 | 41 706 | 8.2% → 见 §3.11（已修，21 倍） |
| Code Quality | 1 248 | 16 403 | 34 381 | 6.8% |
| Architecture + Boy Scout | 1 102 | 12 466 | 23 137 | 4.6% |
| IaC Security | 343 | 5 977 | 19 888 | 3.9% |
| Build Integrity | 1 179 | 6 658 | 12 989 | 2.6% |
| 其余 9 个 | — | — | — | <3% 各 |

**SAST 是唯一超过「价值对应比例」的门禁：单条 p90 占全部门禁 p90 之和的 35.6%。**

### 但 SAST 的分布不是性能问题，是两条路径

| 分支 | 样本 | 中位数 |
|---|---|---|
| 全部 | 445 | **10 252 ms** |
| <2s | 184（41.3%） | — |
| 2–10s | 36（8.1%） | — |
| >10s | 225（50.6%） | — |

最快 191 ms，最慢 247 358 ms——**相差 1290 倍**。这不是波动，是「短路」与「真扫」两种行为混在同一个门禁名下。

`gate-10.sh` 的注释已经写明根因：direct `semgrep scan` 在 Windows 上约 9 秒，
账单几乎全是 Python 导入税，`--version` 单独就要 4-5 秒。所以真正的优化方向是
**避免每次提交都付这笔启动税**（常驻 daemon 或增量扫描），而不是调超时。

### 顺带发现：SAST 的历史记录 93% 缺状态字段

445 条 SAST 记录里 415 条 `gate_status` 缺失（读出来是 `?`），只有 11 条 PASS、19 条 SKIP。
门禁 10 entry 的注释提到 #806 G10x 修过「早退分支不写记录」，所以这是**修复之前的历史数据**，
不是当前缺陷。但它说明：任何基于历史 journal 的统计都必须先过滤，否则 93% 的样本
归入「未知」，得出「SAST 从不通过」的错误结论。


### 3.10 门禁 × 语言可用性矩阵（截至 2026-11-19）

只记录**本轮及前几轮实测过**的组合。空格不是「可用」，是「尚未验证」——
这张表的价值在于它诚实地留下空白，而不是填满它。

| 门禁 | 验证方式 | 已实测语言 | 判定形态 | 未验证 |
|---|---|---|---|---|
| 1 Code Quality | `probe-gate1-languages.sh` | ts python go java | 真实 lint 或 `No specific adapter for <lang>` + SKIP | rust lua perl 等无适配器语言 |
| 2 Duplicate Code | `gate-2-no-files.test.bats` + dart 夹具 | dart（空扫描）+ ts | `clean` / `duplicates` / `no_files→SKIP` / `error` | 其余 14 语言 |
| 4 Principles | 前轮 10/10 | 全部 10 个有规则的 | 2 个报真实违规，6 个显式「未分析」，java/kotlin 报 INFO | — |
| 5 Tests+Coverage | `probe-gate5-languages.sh` | ts python go shell powershell java cpp dart php | 8 个 BLOCK / 1 个委托 CI（已诚实标注） | csharp kotlin swift objectivec flutter iac |
| 9 Build Integrity | `gate-9-verdict-honesty.test.bats` | ts java go | PASS / SKIP(带语言名) / BLOCK | 其余 12 语言（现已全部记入 `GATE_9_UNVERIFIED`） |
| 11 Sprint Flow | `gate-11-verdict-integrity.test.bats` | 与语言无关 | PASS / SKIP(带原因) / BLOCK | — |
| 13 Compiler Strictness | 手工夹具 | go（正确 SKIP：只支持 C/C++/Java/C#） | SKIP 带原因 | cpp java csharp ts |

**架构层面的结论**（比逐格填表更重要）：

1. **门禁 1 的判定是正确的**：无适配器语言得到 `No specific adapter for <lang>` + SKIP 带原因，
   不是 PASS。历史上 C# 曾整年被判 PASS，那个分支已修。
2. **门禁 9 只支持 TS/Java 两半**，其余语言现在会进入 `GATE_9_UNVERIFIED` 并在
   SKIP 行点名——这是本轮 §3.7 的修复。
3. **门禁 13 只支持 C/C++/Java/C#**，其余语言 SKIP 带原因（`No staged C/C++ source files`）。
   一个 Go 文件即使有类型错误也不会被它发现——但门禁 9 现在会说明「go 没被构建」。
4. **真正需要补的是「谁负责构建每种语言」这个归属问题，不是补 15 个适配器**。
   门禁 9 与门禁 13 的职责边界目前没有文档规定，这属于待决设计问题。


### 3.11 门禁 12：循环里 spawn 任何东西都是错的（21 倍提速）

门禁 12 是整条链第二慢的门禁，而它要做的只是读暂存文本：行尾空白、缺 EOF 换行、冲突标记。

| 规模 | 修复前 | 修复后 | 倍率 |
|---|---|---|---|
| 200 个文件 | **2 分 47 秒** | **7.9 秒** | **21 倍** |
| 301 个文件 | 4 分 22 秒 | 11.5 秒 | 22 倍 |

### 我连续两次把根因判断错

第一反应是「Windows 上 `git show` 约 200ms，所以把 git 调用批量化的就解决了」。
实施后 4 分 22 秒只降到 3 分 14 秒。接着我把 blob 获取也批量化、但**把
`tail | head` 留在循环里**——结果**涨到 6 分 25 秒**。

拆成单项才看清：

| 单项（300 文件） | 耗时 |
|---|---|
| `git show ":$f"` × 300 | 26.2 秒 |
| `git diff --numstat -- $f` × 300 | 27.0 秒 |
| **只有 `tail \| head`** | **21.8 秒** |
| 单个 awk 处理全部字节流 | **0.074 秒** |

git 部分只占 262 秒里的约 53 秒。**其余约 200 秒是管道里那些
`tail`/`head`/`grep`/`od`——每一个都是进程。**

规则因此变成一句可执行的话：**逐文件循环里不许 spawn 任何东西。**

这与本文件 §一 的「高效性」标准直接对应：门禁的耗时主体应当是它检查的内容，
而不是进程创建。修复后 200 文件的门禁耗时从「用户等待三分钟」变成「感觉不到」。

### 我的性能测试错了三次，每次都是「绿了但证明的不是我想的东西」

1. **规模太小**——20 vs 80 文件时，旧实现也能通过，固定开销淹没了差异。
2. **作用域错了**——`git add -A` 在 `small/` 子目录里跑，而门禁从仓库根读索引，
   于是两次运行都是**空变更集**，测的是同一个固定开销。
3. **阈值太松**——4 倍文件允许 4 倍时间，旧实现的斜率恰好落进去。

三次都是做**证伪**才暴露：把旧实现放回去跑新测试。修正后旧实现 50 文件 46 秒、
200 文件 183 秒（斜率 137 秒 > 阈值 115 秒）→ 红；新实现 → 绿。

**若不做证伪，我会交付一个「看起来在防性能回退」的空测试**，并把它写进文档当作证据。

### 两次镜像故障，都是既有的

推送被 Gate MP 拒绝三次，两次都不是我的改动：

| 故障 | 根因 | 说明 |
|---|---|---|
| gate-driver 镜像落后 20 行 | 提交 `72fff129` 只改了 canonical，没改镜像 | 这条提交是另一个 agent 的；HEAD 里就是不一致的 |
| 新的 `.awk` 未被检查 | `check-hook-mirror.sh` 用**显式清单**而非遍历目录 | 我把文件复制过去了、md5 一致，检查仍失败 |

第二条的教训值得单独记：**白名单的失败信息永远在说清单，而不是说缺了哪一项。**
Gate MP 失败时，第一件事应该是 `ls githooks/lib/` 与清单那一行做 diff，
而不是去改提示里点名的那个文件。


### 3.12 门禁 10：双峰分布不是性能曲线，是网络

审计日志里 445 条可信 sast-security 记录一直是双峰的：**41.3% 在 2 秒内，50.6% 超过 10 秒**，
最快 191ms、最慢 247 秒——相差 1290 倍。

这不是波动。这是**同一门禁的两条路径**：遥测上报成功就快，卡住就慢。

`gate-10.sh` 的文件头**自己就点名了** telemetry：

> "the bill is almost entirely Python import tax: `--version` alone takes 4-5s because
> semgrep's CLI eagerly imports `commands.ci` -> `app.auth` -> **`telemetry`** ->
> `opentelemetry` -> `requests` -> `urllib3`"

然后从未关掉它。

实测（同一文件、同一规则集 `p/security-audit`、ABBA 交替）：

| 模式 | 耗时 |
|---|---|
| 默认（上报） | **6092 ms** |
| `SEMGREP_SEND_METRICS=off` | **4128 ms** |

门禁 10 是整条链 p90 占比最大的单项（35.6%），而 `AGENTS.md` 明写**门禁不得以网络等待
充当耗时主体**——它违反的正是这一条。

### 但我没有测出门禁层面的提速

| | 耗时 |
|---|---|
| 修复后 | 15.0 / 15.8 / 15.4 秒 |
| 修复前 | 14.9 / 15.2 / 14.9 秒 |

空跑一次 commit 要 6.8 秒，门禁净耗时约 9 秒、其中 semgrep 5 秒，省下的 2 秒穿不过噪声。

所以这里的结论必须写得比直觉窄：**网络不再是这个门禁的变量**。真实消除的不是
「每次省 2 秒」，而是「网络卡住时提交从 15 秒变成 100 秒」这一整类从未被记录的失败。

### 三次测量错误，全是我自己的

1. 第一次用 `--config=auto`，测出「8.1 秒 vs 402 毫秒，20 倍」——而门禁用
   `p/security-audit`。**调用契约不同，数字与这个门禁无关。**
2. 探针仓库建在 `master` 上，`XP_GATE_ONLY_GATE` 在受保护分支被拒绝，门禁 0 直接 BLOCK，
   门禁 10 从未运行——而报告上写着「Gate 10: SKIP」，我差点把它当成另一个原因。
3. 全局安装的 `gate-10.sh` 还是我为做 A/B 用 `git show HEAD:` 落地的旧版，
   于是第一批「修复后」测量测的是「修复前」。

第 1 条是测量纪律第一条（先读调用契约）的原样重演。**若不核对规则集，
我会带着一个不存在的 20 倍数字写进这份文档。**


### 3.13 门禁 13：两个「报告了没算出来的判定」

同一个形状的两个实例，都是**门禁说了一个它没有计算的结论**。

#### 缺陷一：编译不过的新文件算作「零警告」

```bash
out=$("$cc" -fsyntax-only $flags "$file" 2>&1)
printf '%s\n' "$out" | grep -E 'warning:' | grep -vcE '^\s*

每一个都「看起来像成功」。记录在此，因为它们比结论更能说明问题。

### 第一轮：6 个

| # | 错误 | 后果 |
|---|---|---|
| 1 | 探针测的是**全局 CLI v0.38.9**，而非仓库 v0.38.21 | 门禁 6 报 PASS，而仓库副本已经阻断 |
| 2 | 把**崩溃读成「没找到」** | 6 个探针全报 NONE，实为 `ERR_MODULE_NOT_FOUND` |
| 3 | `for g in "${@:-0 2 3}"` 把默认值引成**一个词** | 探针探了 0 个用例，报告全绿 |
| 4 | 改错了文件（钩子侧，而 `check` 走 JS 侧） | 耗时纹丝不动（55s），才发现是两套实现 |
| 5 | `shell: true` 让忽略模式的 `\|` 变成管道 | 52s → 389ms **看着像 142 倍提速**，实为崩溃且 exit 0 |
| 6 | 断言用 `grep \| head -1` 抓到**注释里的同一句话** | 检查窗口里根本没有代码 |

### 第二轮：6 个，其中 5 个错在断言自身

第一轮的错误多在**被测物**，第二轮几乎全在**测试本身**——「断言与被断言的东西
不是一回事」这一族，在写来抓它的测试里又犯了一遍。

| # | 错误 | 后果 |
|---|---|---|
| 7 | 块注释里写 `"**/node_modules/**"`，其中的 `*/` **提前闭合注释** | 模块加载期报 `node_modules is not defined` |
| 8 | jscpd 的 `--ignore` 要 **glob**，我传了正则 | 忽略参数形同虚设，实际 0 个文件被排除 |
| 9 | jscpd 对**绝对扫描根**不应用 glob 忽略 | `check 2 <绝对路径>` 报 0 个克隆（真实缺陷） |
| 10 | 探针按 PASS/FAIL **关键词**分类，门禁 2 从不打印这些词 | 门禁工作正常却记为 NONE |
| 11 | 测试里 `grep -qE "cached"` 匹配到**第 862 行的注释** | 门禁没改却判为已修 |
| 12 | 写了一个「复制解析逻辑再断言」的测试 | 自查发现后**删除**——那正是我一直批评的做法 |

第 12 条值得单列：我为门禁 7 写的新测试没有驱动真实代码，而是把解析循环抄进测试里
再断言。它当然会通过，也当然能被我「证伪」——因为两边都是我的副本。**发现后删除**，
改为改写那条本来就驱动真实代码的既有测试。

### 一个元观察

13 次错误里，**没有一次是产品逻辑写错**。全部是「检查的东西 ≠ 声称检查的东西」。
这本身就是本任务的结论之一：门禁的价值不在于规则写得多好，而在于**它到底看了什么**。

---

## 五、待办

已完成（第二轮）：

- ~~门禁 MP 只查工作区~~ → 已加暂存区比较，4 条测试（正反成对）
- ~~门禁链 fail-fast 未点名~~ → 已点名未到达的门禁
- ~~门禁 2 绝对路径静默失效~~ → 已修为相对扫描根
- ~~门禁 7 全局优先~~ → 已改为项目优先、全局兜底
- ~~门禁 6 两套实现的一致性~~ → 已加跨实现文件名比对测试
- ~~漏提交的两个镜像~~ → 已补提交，远程三处一致
- ~~`audit --stats/--tail/record` 全部无法运行~~ → 四个入口统一走 tsx 加载器
- ~~`audit --stats` 求和历史坏值~~ → 已套用 6 小时合理性上限

仍待办：

1. ~~门禁 4 的专项深挖~~ → **已完成**（见 3.1 后续与 CHANGELOG 0.38.35.0）：
   10/10 语言现在给出真实判定——2 个报真实违规，6 个显式声明「未分析」，
   java/kotlin 早已诚实报 INFO。
2. ~~门禁 5 的全语言深挖~~ → **已完成**（见 3.5）。9 语言实测，修了 4 类缺陷。
   剩下的 `dart`/`php`/`java` 等语言在夹具里仍需补依赖才能全跑，属环境而非产品问题。
2. ~~pre-push 专项门禁~~ → **已验证**：本轮两次真实 push 中 M / M2 / ML / UI / MW / S
   全部给出明确原因（无对应语言源文件 → SKIP；推 main → MW 预审跳过），无一静默通过。
3. ~~剩余 13 个语言~~ → **已完成**：15/15 全部产生真实判定（见上表）
4. **测试套件权重表更新**（238/284 个套件无实测权重，13 个钉在 50000ms）
5. **审计键名不统一**：6 条旧记录用裸数字键（`7`/`10`/`11`/`99`），导致统计表出现
   `10` 与 `gate-10` 两行并存、旧行显示 `Pass% 0.0%`。数量少但会误导读表的人。
   归一化时应保留原始行，只在读取侧合并。
6. **门禁 MP 仍然在 push 时检查工作区镜像**——本轮已补上「暂存区」这一半，但他人未提交
   的 canonical 改动仍会让别人的推送失败（本轮实测被阻塞 6 次）。是否应让 MP 只看
   暂存区而不看工作区，是一个需要单独决定的设计问题。
7. **shellcheck 基线漂移**：`.xp-gate/lint-baseline.json` 记录 `iac.sh` 有 13 个问题，
   实际 15 个（**本轮改动之前就如此**）。门禁据此报「4 NEW」，其中 2 个是漂移、2 个是
   新增脚本未入基线。已确认本人改动零新增（改前 13、改后 13），**未刷新基线掩盖**。

8. **`principles-csharp-coverage.test.js` 有 1 条失败**——与本轮改动无关（C# 适配器工作），
   未触碰，留给该工作的 owner。

9. **`extractClasses` 基线是 lizard 的漏洞值**（见 3.4 第 4 点）。同类「lizard 漏算箭头
   函数体 `&&`」的函数可能还有别的未暴露——只在被改动时才浮现。若要系统性排查，需要
   一次全库 lizard-vs-复算 对比，本轮未做。

10. ~~门禁 5 汇总表仍显示 `PASS`~~ → **已修复**：状态默认现在先看
    `DELEGATED_LANGS`，记 SKIP 并在 `GATE_5_DETAIL` 点名语言。端到端验证过，
    同一夹具的汇总行已是 `SKIP (coverage: N/A%)`。

11. **门禁 5 的「死变量」——我最初判断错了两个**：只有 `TESTS_DEFERRED` 真无人读取。
    `PY_TEST_SKIPPED` 被 `lib/coverage-total.sh:54` 读（`enforce_python_coverage`
    拒绝消费子集运行留下的陈旧 `.coverage`，**该防护有效**）；
    `GATE_5_COVERAGE_APPLIES_TO` 被 `gate-13-entry.sh` 两处读
    （持久化 `applies_to` 字段与子集豁免）。
    我基于只 grep 了三个目录的结论去「修复」后者、还写了个绿测试，
    扩大范围后才发现读取方——改动已回退。教训：
    **「我 grep 了没找到读取方」是关于所 grep 目录的证据，不是关于代码库的**。

12. **PHP 的 skip 返回 2 而非 0**，会走 `handle_test_failure` 的真实失败路径，
    属于**过度阻断**（与 Go/shell 的漏检相反）。优先级低：过度阻断会立刻被人发现，
    漏检不会。修法同 Bug 2——补 `XP_GATE_TESTS_SKIPPED` 标记。

```

语法错误的文件只输出 `error:` 行、没有 `warning:` 行 → 计数 **0** → 与干净文件无法区分
→ 而新增文件分支正是靠 `cnt > 0` 决定是否拦截。

实测（新增文件内容 `int broken( { return 0; }`）：

```
g++ 说：      bad.cpp:1:11: error: Unmatched '('
门禁说：      （沉默），然后 PASS
```

而同一个函数上方两行的横幅还写着「new files are still -Werror」。

#### 缺陷二：「这里没有 C/C++」被记成 PASS

Java 和 C# 分支在同样条件下都返回 WARN，只有 C/C++ 分支回答 PASS。
只有 Go 的项目里提交一个刻意的类型错误：

| 门禁 | 判定 |
|---|---|
| 门禁 9 | SKIP（not a TypeScript project — **正确，且带原因**）|
| 门禁 13 | **PASS**（"No staged C/C++ source files"）|

#### 第一次修复失败了，是端到端运行抓到的

只改了 C/C++ 分支后，判定**仍是 PASS**——因为 analyzer 分支在同一个空变更集上返回 0，
而 `_g13_note` 把「PASS + SKIP」归并成了 PASS。**单测当时是绿的。**

这是本文件反复记录的那件事的又一次实例：**单测绿 ≠ 行为对**。
只有真正跑一次 commit 才看见。

#### 语言盲区没有关闭

门禁 13 只编译 C/C++、Java、C#。Go / Rust / Dart / Kotlin / Swift / PHP 的类型错误
对它仍然不可见。本次改变的只是：发生这种情况时它说 **SKIP 而不是 PASS**。

关掉盲区需要 adapter 能力声明（本项目的规则：能力由 adapter 声明，门禁里绝不枚举语言），
那是另一个更大的改动，本轮没有做。


### 3.14 门禁 13 的语言盲区：改成 adapter 声明

上一节写的是「盲区没有关闭」。这一节把它关掉了。

#### 一个 Go 类型错误穿过了全部 13 个门禁

```go
var x int = "not an int"
```

| 门禁 | 判定 |
|---|---|
| 门禁 9 | SKIP（not a TypeScript project — 正确，带原因）|
| 门禁 13 | SKIP（上一轮的诚实性修复）|
| 其余 11 个 | 没有一个在看编译器错误 |

而 `go vet` 检测它只要 **1.4 秒**，编译器就在机器上。

门禁 13 原本覆盖的 C/C++、Java、C#，**恰好是有人接过线的那三种语言**。

#### 修复方式是声明，不是清单

`githooks/AGENTS.md` 明确禁止显然的做法：

> "Declare capabilities on the adapter, never enumerate language names. A hand
> written list of languages can only ever contain what someone remembered; this
> was patched twice before becoming a rule."

契约因此是 adapter 里的一个函数：

```bash
compiler_check_command() { printf "%s" "go vet ./..."; }
```

**门禁里不出现任何语言名。** 加 Rust/Dart 只是改各自的 adapter。

#### 端到端

| 场景 | 判定 | 耗时 |
|---|---|---|
| Go 类型错误 | **BLOCK** | 1.4s |
| Go 代码正确 | **PASS** | 1.4s |
| Ruby（未声明）| **SKIP + 原因** | 0.0s |

#### 接线之后，又暴露出三处同一形状的缺陷

功能跑起来之后，一个 Ruby 项目报了 **PASS**。原因：Java、C#、-fanalyzer 三个 arm
在**自己没有源码时都返回 PASS**。三处，一个形状——**没评估却claim干净**。

全部改为 SKIP。

**这是跑真实 commit 抓到的，当时 7 个单测全绿**，因为它们没有一个覆盖那些 arm 的空路径。

#### 第二个语义 bug 也来自同一次运行

一旦某个 arm 真的评估过，SKIP 就不该再传染——否则一个**干净的 Go 项目会报 SKIP**，
读起来就像「不支持你的语言」。entry 现在分开跟踪 `_g13_any_pass` 与 `_g13_any_skip`。

#### Kotlin 故意没接

`kotlinc` 需要文件列表参数，不是项目级命令，不符合契约。它有自己已验证的
`run_static_analysis` 路径。**宁可不接，也不接一个半对的。**


### 3.15 门禁 9：拦住了提交，却把结果记成了"跳过"

这一条不是靠读代码发现的，是靠**语言矩阵探针**发现的。

#### 实测

TypeScript 项目，`const x: number = "not a number"`：

```
终端:  tsc: FAIL  TypeScript compilation failed with 1 error(s):
       ❌ BLOCKED - Gate 9: Build integrity check failed
报告:  gate9_build_integrity.status = "SKIP"
       overall.gatesFailed = 0, failedGates = []
审计:  gate-9 build-integrity SKIP
```

**提交被正确拦截，记录却是相反的。**

#### 根因

两个分支（TypeScript 与 Java）都在设好 `BLOCK`、打完提示后立刻 `return 1`。
那个 return 跳过了文件底部的**状态聚合**与 **`record_gate_audit`**，
于是 `GATE_9_STATUS` 保持初始化值 `"SKIP"`。

#### 修复必须两半一起动

只删 `return 1` 会更糟——函数末尾是无条件 `return 0`，门禁会**打印 BLOCKED 然后放行**。

1. 两个分支改为设置状态后继续；
2. 末尾改成 `[ "$GATE_9_STATUS" = "BLOCK" ] && return 1`。

测试因此**同时**钉住记录状态与返回码。证伪：把 `return 1` 注入回去，
**只有**记录状态那条变红，返回码那条保持绿——正是缺陷的特征。

#### 这条缺陷在本文档的缺陷谱系里的位置

之前每一例都是「**没检查**却记成 PASS」。这一例是「**检查了并正确拒绝**却记成 SKIP」——
方向相反，破的是同一条规则：**记录必须说出实际发生了什么，两个方向都算。**

## 四、我自己的验证抓住的错误

每一个都「看起来像成功」。记录在此，因为它们比结论更能说明问题。

### 第一轮：6 个

| # | 错误 | 后果 |
|---|---|---|
| 1 | 探针测的是**全局 CLI v0.38.9**，而非仓库 v0.38.21 | 门禁 6 报 PASS，而仓库副本已经阻断 |
| 2 | 把**崩溃读成「没找到」** | 6 个探针全报 NONE，实为 `ERR_MODULE_NOT_FOUND` |
| 3 | `for g in "${@:-0 2 3}"` 把默认值引成**一个词** | 探针探了 0 个用例，报告全绿 |
| 4 | 改错了文件（钩子侧，而 `check` 走 JS 侧） | 耗时纹丝不动（55s），才发现是两套实现 |
| 5 | `shell: true` 让忽略模式的 `\|` 变成管道 | 52s → 389ms **看着像 142 倍提速**，实为崩溃且 exit 0 |
| 6 | 断言用 `grep \| head -1` 抓到**注释里的同一句话** | 检查窗口里根本没有代码 |

### 第二轮：6 个，其中 5 个错在断言自身

第一轮的错误多在**被测物**，第二轮几乎全在**测试本身**——「断言与被断言的东西
不是一回事」这一族，在写来抓它的测试里又犯了一遍。

| # | 错误 | 后果 |
|---|---|---|
| 7 | 块注释里写 `"**/node_modules/**"`，其中的 `*/` **提前闭合注释** | 模块加载期报 `node_modules is not defined` |
| 8 | jscpd 的 `--ignore` 要 **glob**，我传了正则 | 忽略参数形同虚设，实际 0 个文件被排除 |
| 9 | jscpd 对**绝对扫描根**不应用 glob 忽略 | `check 2 <绝对路径>` 报 0 个克隆（真实缺陷） |
| 10 | 探针按 PASS/FAIL **关键词**分类，门禁 2 从不打印这些词 | 门禁工作正常却记为 NONE |
| 11 | 测试里 `grep -qE "cached"` 匹配到**第 862 行的注释** | 门禁没改却判为已修 |
| 12 | 写了一个「复制解析逻辑再断言」的测试 | 自查发现后**删除**——那正是我一直批评的做法 |

第 12 条值得单列：我为门禁 7 写的新测试没有驱动真实代码，而是把解析循环抄进测试里
再断言。它当然会通过，也当然能被我「证伪」——因为两边都是我的副本。**发现后删除**，
改为改写那条本来就驱动真实代码的既有测试。

### 一个元观察

13 次错误里，**没有一次是产品逻辑写错**。全部是「检查的东西 ≠ 声称检查的东西」。
这本身就是本任务的结论之一：门禁的价值不在于规则写得多好，而在于**它到底看了什么**。

---

## 五、待办

已完成（第二轮）：

- ~~门禁 MP 只查工作区~~ → 已加暂存区比较，4 条测试（正反成对）
- ~~门禁链 fail-fast 未点名~~ → 已点名未到达的门禁
- ~~门禁 2 绝对路径静默失效~~ → 已修为相对扫描根
- ~~门禁 7 全局优先~~ → 已改为项目优先、全局兜底
- ~~门禁 6 两套实现的一致性~~ → 已加跨实现文件名比对测试
- ~~漏提交的两个镜像~~ → 已补提交，远程三处一致
- ~~`audit --stats/--tail/record` 全部无法运行~~ → 四个入口统一走 tsx 加载器
- ~~`audit --stats` 求和历史坏值~~ → 已套用 6 小时合理性上限

仍待办：

1. ~~门禁 4 的专项深挖~~ → **已完成**（见 3.1 后续与 CHANGELOG 0.38.35.0）：
   10/10 语言现在给出真实判定——2 个报真实违规，6 个显式声明「未分析」，
   java/kotlin 早已诚实报 INFO。
2. ~~门禁 5 的全语言深挖~~ → **已完成**（见 3.5）。9 语言实测，修了 4 类缺陷。
   剩下的 `dart`/`php`/`java` 等语言在夹具里仍需补依赖才能全跑，属环境而非产品问题。
2. ~~pre-push 专项门禁~~ → **已验证**：本轮两次真实 push 中 M / M2 / ML / UI / MW / S
   全部给出明确原因（无对应语言源文件 → SKIP；推 main → MW 预审跳过），无一静默通过。
3. ~~剩余 13 个语言~~ → **已完成**：15/15 全部产生真实判定（见上表）
4. **测试套件权重表更新**（238/284 个套件无实测权重，13 个钉在 50000ms）
5. **审计键名不统一**：6 条旧记录用裸数字键（`7`/`10`/`11`/`99`），导致统计表出现
   `10` 与 `gate-10` 两行并存、旧行显示 `Pass% 0.0%`。数量少但会误导读表的人。
   归一化时应保留原始行，只在读取侧合并。
6. **门禁 MP 仍然在 push 时检查工作区镜像**——本轮已补上「暂存区」这一半，但他人未提交
   的 canonical 改动仍会让别人的推送失败（本轮实测被阻塞 6 次）。是否应让 MP 只看
   暂存区而不看工作区，是一个需要单独决定的设计问题。
7. **shellcheck 基线漂移**：`.xp-gate/lint-baseline.json` 记录 `iac.sh` 有 13 个问题，
   实际 15 个（**本轮改动之前就如此**）。门禁据此报「4 NEW」，其中 2 个是漂移、2 个是
   新增脚本未入基线。已确认本人改动零新增（改前 13、改后 13），**未刷新基线掩盖**。

8. **`principles-csharp-coverage.test.js` 有 1 条失败**——与本轮改动无关（C# 适配器工作），
   未触碰，留给该工作的 owner。

9. **`extractClasses` 基线是 lizard 的漏洞值**（见 3.4 第 4 点）。同类「lizard 漏算箭头
   函数体 `&&`」的函数可能还有别的未暴露——只在被改动时才浮现。若要系统性排查，需要
   一次全库 lizard-vs-复算 对比，本轮未做。

10. ~~门禁 5 汇总表仍显示 `PASS`~~ → **已修复**：状态默认现在先看
    `DELEGATED_LANGS`，记 SKIP 并在 `GATE_5_DETAIL` 点名语言。端到端验证过，
    同一夹具的汇总行已是 `SKIP (coverage: N/A%)`。

11. **门禁 5 的「死变量」——我最初判断错了两个**：只有 `TESTS_DEFERRED` 真无人读取。
    `PY_TEST_SKIPPED` 被 `lib/coverage-total.sh:54` 读（`enforce_python_coverage`
    拒绝消费子集运行留下的陈旧 `.coverage`，**该防护有效**）；
    `GATE_5_COVERAGE_APPLIES_TO` 被 `gate-13-entry.sh` 两处读
    （持久化 `applies_to` 字段与子集豁免）。
    我基于只 grep 了三个目录的结论去「修复」后者、还写了个绿测试，
    扩大范围后才发现读取方——改动已回退。教训：
    **「我 grep 了没找到读取方」是关于所 grep 目录的证据，不是关于代码库的**。

12. **PHP 的 skip 返回 2 而非 0**，会走 `handle_test_failure` 的真实失败路径，
    属于**过度阻断**（与 Go/shell 的漏检相反）。优先级低：过度阻断会立刻被人发现，
    漏检不会。修法同 Bug 2——补 `XP_GATE_TESTS_SKIPPED` 标记。

---

## 六、第十四轮：矩阵第一次跑出真数据，抓到四个缺陷

### 6.1 先修好测量工具本身

在此之前矩阵连续输出全是 `NO_REPORT`。三个叠加原因，全部是**测量缺陷伪装成产品缺陷**：

| # | 原因 | 表现 | 修法 |
|---|---|---|---|
| 1 | `/tmp` 路径分歧 | bash 解析成 `C:\Users\...\Temp`，python 解析成 `D:\tmp` | 用 `cygpath -m` 传原生路径给 python |
| 2 | 清理失败被吞 | `rm -rf` 遇 "Device or resource busy"，`mkdir -p` 复用残留，`git init` 静默失败 | 检查两者结果并报错 |
| 3 | 报告写错地方 | `REPORTS_DIR` 是相对路径，trap 里的 CWD 已是**另一个 fixture** | 相对 `PROJECT_ROOT` 解析 |

第三个是「记录写到了没人会看的地方」——与被检查的门禁属于同一族缺陷，只是发生在测量工具里。

### 6.2 门禁 8：被拦下的提交没有报告（`654471d3`）

Go fixture，门禁 5 因覆盖率 0% 拦截：

```
commit rc = 1                    （提交确实被拒绝）
ls .xp-gate/reports/pre-commit → 0 份
```

同 fixture `XP_GATE_ONLY_GATE=8`（链能跑完）→ **1 份**。

**通过的提交有报告，被拦下的没有。**

`pre-commit` 开头装了 `_quality_report_on_exit`，第 1183 行还专门串联了它。
但 `gate-8.sh` 是 `trap gate8_cleanup EXIT`——**替换而非串联**，而门禁 8 在门禁 5 之前跑。

把它注释掉，报告立刻出现；恢复，报告消失。两个方向都测了。

#### 第一次修错了，而且更严重

加上链式调用后报告出现了，但 `commit rc = 0`——**被拦的提交被放行了**。
因为 `rm` 把 `$?` 改成 0，而报告 trap 读的第一件事就是 `$?`。

「让报告出现」的代价是「让拦截失效」，比原缺陷更糟。

#### 第二个坑

`trap -p EXIT` 输出 `trap -- 'cmd' EXIT`。整个 eval 回去会**重新安装**旧 trap 而非执行它，
链式静默失效。必须剥掉前后缀只留命令体。

**这一点是测试抓到的，不是读代码读出来的。**

修复后：`commit rc=1` **且** 报告 1 份。

### 6.3 门禁 13：编译不过的文件被放行（`27198961`）

```
a.cpp : int main() { return not_a_symbol; }
g++   : error: 'not_a_symbol' was not declared in this scope
门禁  : "0 warning(s) (no baseline entry, report-only)"
提交  : 通过
```

两个豁免被合并了：

| 问题 | 豁免是否合理 |
|---|---|
| 基线棘轮「不能比之前更差」 | 合理——采用门禁不该要求先清光历史警告 |
| 可编译性「能不能编译」 | **不合理**——error 不是继承来的债 |

代码里早就写着 `gate13_count_warnings` "ERRORS COUNT TOO, AND THEY ARE THE POINT"，
计数是对的，只是那个分支拿到计数后**打印一行就 `continue` 了**。

**这不是边角情况**：任何已有的 C/C++ 项目在跑 `compiler-baseline create` 之前都是这状态。

修复：拆成两个函数，各自回答一个问题。`AC-GATE13-NB-02` 钉住"仅有警告仍走 report-only"。

### 6.4 门禁 1：mypy 一次都没跑，却说 PASSED（`af701f63`）

```
a.py  : def f() -> int: return "not an int"
mypy  : error: Incompatible return value type (got "str", expected "int")
门禁  : ✅ PASSED - mypy type checking.
提交  : 通过
```

无 `src/`、无 `scripts/`、无 `.xp-gate-mypy-scope` 时 `SCOPE_DIRS` 为空，
过滤循环不执行，`TYPECHECK_FILES` 空，`return 0`——**mypy 从未被调用**。

输出里没有任何一行说"我没看"。

作用域收窄本来的意思：让**大仓库**的 pre-commit 保持快、不受无关代码干扰。
它从不意味着"小项目干脆不做类型检查"。

修复：无声明作用域时直接检查暂存文件。`AC-PY-MYPY-02` 钉住"声明的 scope 仍然生效"。

### 6.5 门禁 13：Kotlin 类型错误无人检查（`4e4f9632`）

```
门禁 1 : ✅ PASSED      ← ktlint/detekt 只 lint，不查类型
门禁 13: ⏭️ SKIPPED     ← adapter 没声明 compiler_check_command
```

两个答案**单独看都对**，所以洞不可见。lint 和类型检查回答不同问题，Kotlin 只被问了第一个。

修复：走既有的能力声明契约，给 Kotlin adapter 加 `compiler_check_command`。

三个细节都是被实测逼出来的：

1. `kotlinc .` 报 `error: no source files` —— **不接受目录**，必须显式展开文件列表
2. 输出目录必须是临时目录 —— 否则 `.class` 落进工作区，下次提交的变更集取决于门禁有没有跑
3. `nullglob` —— 空树不能让字面量 `**/*.kt` 传给编译器

耗时 4.4s（两文件项目）。

### 6.6 第六次同类，五个提交

| 门禁 | 行为 | 记录 |
|---|---|---|
| 9 | 拦截构建失败 | SKIP |
| 13 | 什么也没编译 | PASS |
| 6 | 十种拒绝 | SKIP |
| 8 | 拦截时 | **连记录都没有** |
| 13 | 编译不过 | 只报告不拦 |
| 1 | 从未调用 mypy | **"PASSED - mypy type checking."** |

最后一个是这一族最纯粹的形态：**"检查成功"这句话，由一段从未运行该检查的代码打印。**

---

## 七、第十五轮：矩阵全部跑通后的六个修复

### 7.1 总览

| # | 门禁 | 缺陷 | 提交 |
|---|---|---|---|
| 1 | 8 | 被拦下的提交没有报告（EXIT trap 被替换） | `654471d3` |
| 2 | 13 | 编译不过的文件被 report-only 放行 | `27198961` |
| 3 | 1 | mypy 从未运行，却打印 PASSED | `af701f63` |
| 4 | 13 | Kotlin 类型错误无人检查 | `4e4f9632` |
| 5 | 12/12b/12c | SKIP 记录了但没写原因 | `47934024` |
| 6 | 13 | Flutter 检测下失去 Dart 类型检查 | `d778bcee` |
| 7 | 13 | Java 编译失败被降级成 WARN | `ccedab10` |

### 7.2 修复前后的矩阵对比

```
go       dirty  G13: - → B     编译错误被拦
python   dirty  G1:  P → F     mypy 真正运行
kotlin   dirty  G13: S → B     类型检查覆盖
cpp      dirty  G13: P → F     无 baseline 也拦编译错误
java     dirty  G13: W → F     降级模式不再放过编译失败
dart     dirty  G13: S → B     全局 adapter 同步后生效
```

### 7.3 三个"诊断层"的教训

dart 那个缺陷我排查了三轮：

1. 猜「adapter 没声明」→ **错**，它声明了
2. 发现「项目被检测成 flutter」→ **真缺口**，但修完没生效
3. **全局 adapter 副本过期** → 真正原因

第 3 层写着 `githooks/AGENTS.md` 里，**我本轮读过了它，然后在排查时没有执行它**。

> An adapter is stale until proven otherwise — `md5sum` both copies before
> believing a hook-vs-direct-call difference.

### 7.4 第二次栽在「grep 到注释」

Java 修复的两个测试，各自抓到我自己的一次同类错误：

- AC-01 匹配到注释里的 `not attributed to Gate 13`，把**正确的修复**报成死代码
- AC-02 匹配到注释里的 `Could not resolve`，报出**假警报**

两个方向相反，同一个原因。修法都是 `grep -vE '^[[:space:]]*#'`。

**写测试消除一种误报，可能就是为下一种误报铺路。**

### 7.5 测量工具自身的卫生

`dotnet build` 在 fixture 里生成 `obj/`、`bin/`，被 `git add -A` 收进基线，
导致 csharp 的后续用例变慢并卡住。给 probe 加 `.gitignore` 解决。

这是**测量工具的缺陷被误读成产品缺陷**的第 N 次——矩阵本身也是一个需要被检查的对象。

---

## 八、第十六轮：报告三处说谎，一处比一处彻底

这一轮不再找"门禁算错了"，而是查**门禁算对之后，这个结论有没有活到该到的地方**。

三处全部失守，而且是递进的：报告的**判定**丢了、**测量**丢了、**门禁的存在**丢了。

### 8.1 Gate 12b / 12c：记了 PASS，什么都没检查

两个前置门禁都把工作藏在文件存在性判断后：

```bash
if [ -n "$ROOT" ] && [ -f "$ROOT/scripts/check-xxx.sh" ]; then
   ... 真正检查 ...
fi
# 落到这里，记 PASS
```

**没有 `else`。** 条件不成立时，代码直接穿到底部的 PASS 记录。

实测（装了钩子但没有 `scripts/` 的 fixture，暂存一个含裸 `npx --yes eslint` 的文件）：

```
提交      : 通过
报告 JSON : 没有 gate12b / gate12c 条目
审计日志  : 没有 gate-12b / gate-12c 记录
控制台    : 该门禁一行都没打印
```

本仓库自己的审计里有 112 条 12c 记录、每条 143ms——**它在这里确实运行**。
在那个仓库里，它连"存在过"的证据都没留。

这是本系列缺陷里**最完整的一例**：不只是报了没挣到的通过，
而是**报了通过，同时抹掉了自己存在过的全部痕迹**。

### 8.2 持久化：报告算好的字段，写盘前全扔掉

`generate_quality_report()` 写完整报告，随后"持久化"那一步用**写死的键列表**重建：

```js
const r = {timestamp, trigger, branch, commit, changed_files,
           overall, gates, warnings, errors};
```

本仓库连续 8 份真实报告的顶层键里，`gateTimings`、`coverageMatrix`、
`coverageWarnings`、`languagesSource` **全部不存在**。

而模版里关于 `gateTimings` 的注释写着：

> published so "which gate is slow" is a measurement instead of an estimate

**它一直在发布，发布进了一个随后被丢弃、替换成更短文档的文件里。**

### 8.3 报告：链没到的门禁记成 SKIP

驱动是 fail-fast 的，但报告为每个门禁打印一行，状态写成 `${GATE_N_STATUS:-SKIP}`。
没运行的门禁体永远不会设置这个变量——于是「链在这里就断了」和「这个门禁决定跳过」
产生**完全相同的一行**。

iac fixture 实测：

```
控制台: Chain stopped at Gate 1 — these gates were NOT reached: 2 3 8 10 7 5 6 4
报告:   gate7_iac_security {"status":"SKIP","scanned_files":0}
```

矩阵分析器读到那个 `SKIP`，理解为「门禁 7 运行了、没问题」，
报出 **「iac 的植入缺陷没有被 G7 抓到」**——一个**由报告制造的假结论**。

### 8.4 三处是同一个错误的不同深度

| 层次 | 丢的是什么 | 表现 |
|---|---|---|
| 8.3 | 判定 | 记成 SKIP，读起来像"检查了但放过" |
| 8.2 | 测量 | 字段消失，下游看到的报告更短 |
| 8.1 | 门禁的存在 | 什么都没留，连"有这道门禁"都看不出来 |

前面十五轮修的都是"门禁算错了"。这一轮的三处，**门禁都算对了**——
错在结论离开门禁之后。

### 8.5 分析器也要跟着改，而且不只是改符号

矩阵分析器把 `NOT_REACHED` 当成漏检上报。修法不只是加个标志，还要**调整判断顺序**：

从未运行的门禁既无 FAIL 也无 BLOCK，所以同时满足 `!seen.length`。
旧顺序先判 `!seen.length`，「门禁不可达」的分支永远轮不到。

**一个分支写了但永远走不到，和没写是一样的。** 这和 8.1 的 `else` 缺失是同一个病。

### 8.6 我自己在这一轮犯的错

**1. 把注释插进了 heredoc。** 辅助函数的说明被插进
`cat > "$REPORT_FILE" << ENDJSON` 内部，原样输出到 JSON：

```
SyntaxError: Expected double-quoted property name in JSON at position 894
```

**提交钩子没有报错，因为它不解析这个文件。** 端到端运行时才发现。

**2. 一个在 bug 存在时依然通过的护栏。** AC-PF-01 第一版 grep 整个文件找
`Object.assign`，而这个文件别处本来就有 `Object.assign`——
把缺陷还原回去，测试仍然绿。改成只检查持久化那一行才有效。

**3. 同一个锚点错误犯了两次。** AC-PH-03 要检查 `if` 有没有 `else`：

- 第一次从"提到 checker 文件名的行"开始扫——注释里也有这个文件名；
- 第二次从 guard 往后找第一个列 2 的 `fi`——12b 的块内部第 136 行就有一个。

两次都是**断言是对的，锚点找错了**。锚定"文件里最后一个列 2 的 `fi`"才对。

**4. CHANGELOG 有 10 条从未提交。** 每次插入后 `git add` 都撞上另一个
agent 持有的 `.git/index.lock`，而我把 `git add` 的输出经
`grep -v ignored | head -2` 过滤，**错误被吞掉了**，脚本仍报"已插入"。

**流程成功信号比结论错误信号更容易骗人**——这是本轮 8.1 的产品缺陷，
在我自己的工作流里一模一样地重演了一遍。

### 8.7 本轮落地的修复

| 提交 | 缺陷 |
|---|---|
| `ccedab10` | Java 编译失败被降级模式 WARN 放行 |
| `cd3a4664` | 探针 fixture 加 `.gitignore` / `.architecture-skip` |
| `e3202fed` | 工具缺失被当成"发现违规"（swift/dart/flutter）；`PIPESTATUS` |
| `99babd26` | 链未到达的门禁被记为 SKIP |
| `444b02cd` | 持久化丢掉报告字段 |
| `722f465c` | 耗时基线 |
| `fe19af25` | 门禁 × 语言矩阵 |
| `4630fce4` | 12b/12c 记 PASS 却什么都没检查 |

### 8.8 测试计数

| 套件 | 结果 |
|---|---|
| `gate-report-not-reached.test.bats` | 4/4 |
| `report-persisted-fields.test.bats` | 3/3 |
| `prelude-gate-honest-skip.test.bats` | 4/4 |
| `gate-13-java-compile-fail.test.bats` | 3/3 |
| `adapter-tool-missing.test.bats` | 5/5 |

全部做过证伪：删掉修复后对应用例变红。

### 8.9 下一轮该查什么

按"门禁算对之后结论去哪了"这条线，还有两处没查：

1. **Gate 5（覆盖率）的 commit-only 记录**：它写不写审计？理由带不带？
2. **pre-push 的门禁**：那一侧的报告与审计是否也有同样的三处丢失？

---

## 九、第十七轮：审计日志本身是最脏的数据

这一轮修的是**记录层**，而不是判定层。修完之后回头看审计日志，发现它自己也是坏的。

### 9.1 两套 schema 写同一个文件

`src/gates/common.ts` 的 `recordAudit()` 与 bash 的 `record_gate_audit()`
写的是同一个 `.xp-gate/audit.jsonl`，但字段名不同：

| 写入端 | 字段 |
|---|---|
| TS | `gate` / `name` / `status` / `details` |
| bash | `gate_id` / `gate_name` / `passed` / `issues_found` / `duration_ms` |

TS 那边的注释写着「**Schema must match bash version**」。**它没有 match。**

实测：16763 行里有 **315 行没有 `gate_id`**，任何按 `gate_id` 索引的读取方
（`xp-gate audit`、决定 `attempt` 的失败连续计数、耗时基线）都看不见它们。

**而且只改键名不够。** `passed` 必须是真布尔值：bash 侧用
`index($0, "\"passed\":false")` 判失败，字符串 `"false"` 的引号位置不同，
永远匹配不上。

### 9.2 测试往开发者的真实日志里写

`common.test.ts` 直接对 `process.cwd()` 调 `recordAudit()`，
而它的 `afterEach` **是空的**——函数体只有一句注释「Just verify it doesn't throw」。

每跑一次测试就往仓库自己的审计里追加一行真正的 `gate-test`：**215 行**。

> 一个往生产状态写入、却只断言「没抛异常」的测试，
> 把破坏留在原地，然后报告这一轮是干净的。

修复：`afterEach` 逐字节快照并还原。验证：套件前后审计都是 16662 行，零新增。

### 9.3 清理结果

| 项目 | 处理 |
|---|---|
| `gate-test` 测试污染 215 条 | 删除 |
| 旧 schema 真实门禁记录 100 条 | 迁移到新 schema，信息不丢 |
| 无门禁名的孤儿记录 2 条 | 删除 |
| 裸数字 id（`10`/`7`/`11`/`99`）6 条 | 规范化为 `gate-N` |
| `unknown` 69 条 | **保留**：有真实 `commit_hash` 和 `failure_reason`，是真实提交被阻止的记录，只是没记下门禁名 |

最终：**16546 行，全部符合新 schema，0 异常**。
其中 71 条 `duration_ms: null`——按项目规则，「未测量」就是 null，不能写成 0
（否则「瞬时」和「没测」就分不开了）。

`unknown` 那 69 条是刻意保留的：把它们删掉等于抹掉「有 69 次提交被拦下、
但我们不知道是谁拦的」这个事实。**不可归因不等于不存在。**

### 9.4 匿名函数的身份是行号

修 `recordAudit` 时给它加了一段 15 行注释，把 `common.ts` 后面每行下推了 18 行。
Gate 3 立刻阻断：

```
BLOCK (anonymous) CCN=7 baseline=2 (ratchet: worse than recorded)
```

而那个 `catch { }` 块真实 CCN 是 2，**什么都没变**。

基线用位置当身份：`src/gates/common.ts::(anonymous)@125`。
78 行之上的一段无关注释，把另一个回调挪到了第 125 行。

**Gate 3 阻断是对的，但它指的是哪个函数是错的。**

修法是把文件挪回去（docblock 压回三行、函数内净零行改动、三个锚点回到 47/77/122）。

但这个脆弱性**只是被记录下来，没有被修掉**：62 个文件里有 **353 个
`(anonymous)@<行号>` 条目**。任何在匿名回调之上增删一行的编辑都会静默重定向基线。

**同一个机制也能放过一个回退**——只要被挪过去的条目恰好带着更大的数字。

### 9.5 这一轮暴露的模式

前面十六轮：**门禁算错了**。
第十七轮：**门禁算对了，但它依据的数据是脏的。**

判定正确、记录正确，都还不够——**判定所依赖的基线本身可能正在指向错误的对象**。
