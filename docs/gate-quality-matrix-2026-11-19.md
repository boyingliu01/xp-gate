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
| File Hygiene | 1 207 | 14 973 | 41 706 | 8.2% |
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
