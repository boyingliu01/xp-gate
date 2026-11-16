# Open Issues 审查与开发计划（2026-11-15）

基线：`main @ f267d8b7`，VERSION `0.38.4.0`，npm `latest = 0.38.4`。

起始 87 个 open issue → 关闭 20 个 → 剩余 67 个。

---

## 一、本轮关闭的 issue（20 个）

全部经代码/测试级核验，关闭时附了证据评论。

| # | 判定依据 |
|---|---|
| #808 | 0.38.4 修复；`bats gate-12-conflict-marker-precision` 5/5，边界钉死（恰好 7 字符是标记，6/8/23/64 不是） |
| #809 | 0.38.4 修复；`bats gate-0-staged-env-oversize` 3/3，精确边界 32767/32768 |
| #815 | `403facab` 已合入；checkov 合批 104.6 s → 50.4 s |
| #803 | `iac.sh:118` 探测超时 20 s → 60 s |
| #701 | `gate-13:542` LC_ALL=C；`bats issue-701` 4/4 |
| #705 | `classifyServerErrorResponse()` 保留 5xx 错误体 + 重试性判定 |
| #707 | `base_url` 支持 `${VAR}`，未设置即 exit(1) 不回退字面量 |
| #708 | `java_bi_report_jdk_context()` 提示 JDK 下限 |
| #728 | 自研 `gate-6-layers.sh` 绕开恒返回 0 的 archlint 检测器；18/18 |
| #738 | `gate-coverage.js` 改为从 registry 派生，删除手写反向映射 |
| #751 | `sync-version.sh` 缩为 35 行薄壳，sed 兜底分支整体删除 |
| #752 | 四项齐备（**Version:** 精确匹配、委托 cjs、沙箱三形态、干净树守卫） |
| #764 | `pass = errors + warnings === 0`，info 不参与判定 |
| #769 | `deploy-manifest.js` 收录 gate-registry + blocks 列纠正；21/21 |
| #783 | `GATE_FILES` 含 gate-6-layers；deploy-manifest 40 passed |
| #788 | `.cs` 进入 Gate 1/Gate 10 扩展名；7/7 |
| #794 | adapter 声明 `coverage_runs_tests`；未声明者保持安全默认（双跑） |
| #798 | `XP_GATE_ORDER` 成为数据、单一时钟、`gateTimings`；4 个测试套件全绿 |
| #797 | **重复于 #798**，关闭以收敛讨论 |
| #801 | `sync-package-content.test.js` 播种 `lib/deploy-manifest.js`；25/25 |

### 自查纠错（1 条）

**#729 关闭后又重新打开。** 我先把 `.lizard-version` 存在误判为"已解决"，但 `node -e` 实测 `.ccn-baseline.json` 顶层键只有 `population` / `entries`——没有版本字段。版本校验是"外部旁证"而非"基线自证"，issue 的核心诉求只完成一半。改判 PARTIAL 并 reopen。

---

## 二、剩余 67 个按优先级

### P0 — 会直接阻断用户或让门禁说谎（11 个）

**边界：要么让人无法提交，要么报 PASS/BLOCKED 与事实不符。**

| # | 问题 | 伤害方式 |
|---|---|---|
| **#784** | Gate 6 检测器 exit 1 只写变量不退出 | **真违规打印 ❌ BLOCKED 却 RC=0 落库**——最严重的一类，门禁看着拦、实际放行 |
| **#807** | sprint-gate `checks-passed` 只看 `.verdict` | 上一个 sprint 的 APPROVED 给本次背书；状态文件读不懂就放行 |
| **#811** | `gate-6-layers.sh` 只认 map 形态 | 标准 YAML 序列写法 → `layer_config_unparsable` → **合规仓库 Gate 6 恒 FAIL** |
| **#785** | `allowedImports` 不解析块式列表 | 被允许的依赖报 ❌ BLOCKED（**诬告合规代码**） |
| **#793** | Gate 8 把"缺 baseline"报成"工具未安装" | 每笔提交给出**错误的 pip install 指令** |
| **#792** | `hasPythonSignal` 深度上限当成"没有 Python" | 第 6 层的 `.py` 让 required mypy/pytest 变 SKIPPED，仍报 ✅ healthy（**required 变 skipped = 假绿**） |
| **#786** | Gate 9 pack 对 noEmit + `files:[dist]` 永久 BLOCK | `tsc` 保证不产出、`pack` 却要求产物已在磁盘 → **死循环 BLOCK** |
| **#787** | Gate 5a 漏掉单数 `test/` 目录 | `test/x.test.ts` 已存在仍硬 BLOCK |
| **#810** | post-commit `_flush` 未定义 | PATH 无 node/npx 时每次提交刷错误 + **静默丢审计** |
| **#814** | 技能副本相对深度定位仓库根 | 装本仓库钩子后 **6 个套件恒失败 → 无法提交**（自伤） |
| **#772** | Gate 12 空格分隔累加错误名 | 一条语法错误被拆成一串**假文件名** |

### P1 — 门禁能力缺口 / 安装一致性（18 个）

| # | 问题 |
|---|---|
| #715 | Gate 6 双执行面结论分叉：pre-commit 缺配置 BLOCK，CLI 面报 PASS |
| #778 | 三条执行路径对同一门禁给出不同结论，无人断言它们一致 |
| #800 | 语言不支持时全 SKIP 仍报 PASS，缺统一 NOT_CHECKED 第三态 |
| #732 | Gate 3/4/9/10 完全跳过 `.mjs/.cjs/.mts/.cts` |
| #734 | Gate 3 只扫 diff，存量债单提交完全不可见 |
| #727 | 只测圈复杂度，认知复杂度无人消费；基线只覆盖 `src/` |
| #742 | `packages[""]` 缺失静默跳过；无 npm 规范化回归哨兵 |
| #770 | uninstall 把"任何 `.sh`"当自己的文件删（**删他人文件**） |
| #771 | uninstall 报"未能删除"却不点名，退出码仍 0 |
| #773 | `update-skill --all` 全部被拒仍退出 0 |
| #741 | `uninstall --global` 不删 skill；`globalSkillRoots()` 是死代码，36 个残留 |
| #777 | doctor pending 名单硬编码，与实际 check 名全部不匹配 |
| #755 | doctor 只查一个平台，多平台漂移不可见 |
| #756 | `~/.config/xp-gate/backup/` 只增不减 |
| #782 | npx tsx 在不可写缓存下 EPERM → 假红，工具故障与代码违规同码 |
| #711 | `channels:["external"]` 不是完整关闭开关 |
| #712 | Delphi 守卫在安装链路无执行点；无 `pinned_models` |
| #812 | doctor 的 DSH 检查只看 `~/.dsh/settings.json`，健康环境恒报 FAIL |

### P2 — 性能与体验（9 个）

| # | 问题 | 已有进展 |
|---|---|---|
| #640 | pre-commit 6 分钟耗在冷启动 | Java 增量选测已落地（32/32），**Gate 10 规则缓存未做** |
| #805 | `install.sh` 17–20 s（82 次逐文件 cp/chmod） | 未动 |
| #804 | `crap` 缺 coverage 时先扫全树再报错（10–36 s） | 未动 |
| #791 | Gate 10 性能：225 条规则解析 5.9 s；82 次 >60 s 全部假通过 | daemon 已证伪 |
| #706 | kotlin 夹具缺文件 | 第 1、2 层已修，第 3 层未动 |
| #703 | JaCoCo 非 ASCII 路径静默不写执行数据 | 未动 |
| #754 | 带对象字面量返回类型注解的函数被提取成注解本身（全仓 54 个） | 实测复现 |
| #748 | 建议新增 `xp-gate cognition` 报表 | 无子命令 |
| #562 | 覆盖率门槛 78 → 80（Ratchet） | 停在 78，差 1.2pp |

### P3 — 设计提案 / 索引单 / 实验（29 个）

这些**不该当成 bug 排期**，而是待决策或追踪载体：

**索引单（4）**：`#610`（AI 测试指南 10 子项）、`#638`（技术债清单）、`#685`（ArchUnit 33 规则）、`#789`（架构正交分解）

**ARCH 系列待设计（9）**：`#690` `#691` `#692` `#693` `#695` `#696` `#697` `#698` `#700`
——共同前提是 `#690`（`.layer-contract.yaml` 不存在）。**#690 不做，其余 8 个都无从落地。**

**认知复杂度系列（4）**：`#746` `#747` `#750` `#727`（部分）
——`#747` 是 lizard 上游缺陷，本仓无落点；`#746` 依赖可信 CogC，而 `#747` 说 CogC 本身不可信。**建议先决策"是否引入 CogC"，否则这一串都是空转。**

**指南对齐（4）**：`#606`（风险分级）`#608`（例外注册表）`#609`（审计字段+SLO+dashboard）
**纯提案（4）**：`#539`（JEV PoC）`#790`（镜像治理 A/B/C）`#796`（delphi review CLI）`#802`（C# 强转审计）
**其他（3）**：`#730`（自动语言注册，半完成）`#731`（CI setup-dotnet）`#742`（PARTIAL）

---

## 三、建议的推进顺序

### 第 1 批：P0 止血（建议一个 sprint，目标 0.38.5）

先修**让门禁说谎**和**让人无法提交**的。这两类不修，后面所有门禁相关的度量都不可信。

**1a. fail-open / 假绿（最优先，因为这会让"绿"失去意义）**
- `#784` Gate 6 真违规不退出 ← 与 `#811` `#785` 同一文件，**一次性重写配置解析 + 退出码**
- `#807` sprint-gate 未验证却背书
- `#792` required 变 SKIPPED 仍报 healthy

**1b. 阻断正常提交（用户会直接撞见）**
- `#814` 装仓库钩子后无法提交（自伤，开发体验最痛）
- `#786` Gate 9 noEmit 项目死循环 BLOCK
- `#787` Gate 5a 漏单数 `test/`
- `#811` `#785` Gate 6 配置形态兼容

**1c. 误导性提示**
- `#793` Gate 8 把缺 baseline 报成未安装
- `#772` Gate 12 假文件名
- `#810` post-commit `_flush`

> **建议合并做**：`#784` `#811` `#785` 都指向 `gate-6-layers.sh` + `gate-6-entry.sh`，分三次改同一处代码是浪费，且容易互相踩。一次重写解析器（支持 map/序列、块式/flow 列表）+ 统一退出码语义。

### 第 2 批：P1 一致性（0.38.6）

- **编号即身份**：`#715` `#778` `#738`（已关）之后的收尾——把 CLI/hook/skill 三个执行面收敛到唯一 verdict
- **SKIP 不等于 PASS**：`#800` 统一 NOT_CHECKED 第三态（`#792` 的同类问题在此一并解决）
- **uninstall 安全**：`#770` `#771` `#773` `#741` `#756`——**这一组是"卸载会删错东西"和"卸载不干净"，建议一次性重做 uninstall 的归属判定**
- **扩展名覆盖**：`#732`（`.mjs/.cjs` 全 gate）

### 第 3 批：P2 性能（0.39.0）

- `#640` 的剩余项（Gate 10 规则集本地缓存）——**这是 pre-commit 6 分钟里最大的一块**
- `#805` `install.sh` 合批（82 次 cp/chmod → 批量）
- `#804` `crap` 先判 coverage 再扫树

> 性能项建议**先测量再动手**。本机长期 CPU 90–100%，`~/.dsh/AGENTS.md` 的六条硬规则要求 ABBA 交替 + 记录负载，否则会得出方向错误的结论（历史上已发生过"测出 AOT 慢 20ms，实际快 68%"）。

### 第 4 批：P3 需要先决策，不是先开发

**建议先做决策，再决定是否排期：**

1. **CogC 是否引入**（`#746` `#747` `#750`）——`#747` 说 lizard 1.25 的 CogC 有三处实测计数缺陷。在缺陷未澄清前做 `#746`/`#750` 等于把不可信的数做成基线。**决策点：等 lizard 修复 / 自己重算 / 放弃 CogC 走 CCN×nesting（`#748` 路线）。**
2. **ARCH 系列是否立项**（`#690`–`#700`，9 个）——**都依赖 `#690` 的 `.layer-contract.yaml`**。`#690` 是"编排而非重写检测"，工作量最大、收益最不确定。**决策点：立项则先做 `#690` 并砍掉其余 8 个的依赖；不立项则把这 9 个标 `needs-decision` 冻结。**
3. **镜像治理**（`#790`，429 个文件 / 30,404 行重复）——A/B/C 三方案待拍板。这关系到每次改门禁要改几处，是**结构性技术债**。
4. **指南对齐三项**（`#606` `#608` `#609`）——来自公司指南，需要确认是否作为产品承诺。

**索引单处理建议**：`#610` `#638` `#685` `#789` 本身不是待办，建议改成 **GitHub Milestone 或 Project 视图**，而不是留在 issue 列表里稀释信号。它们各自的子 issue 才是工作项。

---

## 四、两个观察

**1. `migrating-to-wsl` 标签（42 个 issue）已经失去信息量。** 它覆盖了从 P0 fail-open 到纯提案的整个光谱，无法用来筛选。建议去掉，改用优先级标签 + milestone。

**2. 同一处代码被开了多个 issue。** `gate-6-layers.sh` / `gate-6-entry.sh` 上有 `#784` `#785` `#811` `#813`；`uninstall.js` 上有 `#741` `#770` `#771` `#773` `#756`。按 issue 逐条修会导致同一文件被反复改动、各自打补丁。**建议按"文件/子系统"重组为工作项，而不是按 issue 排期。**
