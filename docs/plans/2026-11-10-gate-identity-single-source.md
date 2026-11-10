# P1-B 门禁身份单一事实源 —— 设计文档

**状态**: DRAFT (待 R1/R2 评审)
**Sprint**: sprint / P1-B
**上游**: `2026-11-09-architecture-orthogonal-decomposition.md` §3 P1-B
**吸收 issue**: #738 (CLI 编号 9/10 双轨)、#715 (Gate 6 双执行面分叉)、#769 (registry 不部署/编号面)、#783 编号部分
**前置**: P1-A（registry 已可部署）、P1-C（pre-push 已 source 生成表）—— 均已完成并合入 main `93f61e68`

---

## 0. 为什么现在做，以及根因是什么

### 0.1 根因：编号是**位置标签**，却被当作**身份**使用

一个门禁有两个属性：

- **名字**（`sast`、`build-integrity`）—— 语义标识，稳定
- **编号**（9、10）—— 显示位置，可移动

仓库里有 4 处各自声明「编号 → 名字」。它们不是「有的对有的错」这种简单情形，
而是**同一个物理事实被抄写了 4 遍，其中一份抄反了**，而没有任何机制比对它们。

### 0.2 实测：三处一致，一处孤立对调

事实来源：`githooks/pre-commit:6107-6171` 真实生成的报告键（自动运行产物，
已用 `2026-11-10-143040.json` 与 `quality-status/main.json` 两次独立验证）。

| 编号 | `gate-registry.sh` | `gate-runner.js` | **真实报告键** | `gate-coverage.js` |
|---|---|---|---|---|
| 8 | `secret-scanning` | Secret Scanning | `gate8_secret_scanning` | Secret Scanning |
| **9** | **`build-integrity`** | **Build Integrity** | **`gate9_build_integrity`** | **SAST Security** ← 孤立 |
| **10** | **`sast`** | **SAST Security** | **`gate10_sast`** | **Build Integrity** ← 孤立 |
| 11 | `sprint-flow` | Sprint Flow Enforcement | `gate11_sprint_flow` | Sprint Flow |

**三方一致，第四方对调。** 对调的那一方是 `gate-coverage.js`，
而且它为此写了一张**解释性的交换表**：

```js
// src/npm-package/lib/gate-coverage.js:63-66
// NOTE the swap: the producer calls Build Integrity gate9 and SAST gate10,
// while this project numbers them the other way round.
['gate10_sast', 9],
['gate9_build_integrity', 10],
```

这段注释**是不成立的**。`pre-commit` 的产物键 `gate9_build_integrity` /
`gate10_sast` 与 registry 完全一致，没有任何「the other way round」。
这张表是为一个**不存在的颠倒**而写的，它的存在本身让缺陷看起来像**有意设计**。

### 0.3 这个缺陷的实际后果（已实测复现）

`gate-coverage` 会**用另一份产物的数值回答本产物的问题**：

```
真实产物 quality-status/land-pr438.json:
    gate9_build_integrity = PASS
    gate10_sast           = PASS

gate-coverage 输出:
    9  SAST Security   PASS   ← 这个 PASS 来自 gate10_sast
```

当两份产物的 SAST 结论不同时（例如 `main.json` 中 `gate10_sast = SKIP`），
`gate-coverage` 报出的是**另一份提交的结论**。它同时打印 `stale: true`，
但 stale 只是提示，不阻断 —— 「读错了对象」比「读的对象旧了」更严重，
而后者恰好掩盖了前者。

### 0.4 第二个缺陷：无 `--branch` 时选错产物

`readQualityStatus()` 在拿不到 `--branch` 时会兜底遍历目录内所有 `.json`：

```js
// gate-coverage.js:117-119
for (const name of fs.readdirSync(dir)) {
  if (name.endsWith('.json')) candidates.push(path.join(dir, name));
}
```

`readdirSync` 的顺序即文件系统顺序。实测本仓库有 `land-pr438.json` 与
`main.json` 两个文件，前者排在前，于是 `xp-gate gate-coverage`（不带 `--branch`）
读的是 **`land-pr438.json`（commit `33672f6d`）**，而非当前分支的产物。

这两个缺陷叠加，才能解释「显示 9 = SAST **PASS**」而真实 `main.json` 里
`gate10_sast = SKIP`。

### 0.5 为什么单独立项而不是顺手修

因为**修一行映射不能防止下一次抄写**。真正的防线是：
让「编号→名字」只有一个声明处，其余全部派生，并用一个**跨侧一致性测试**
把派生关系和真实产物的键名钉在一起。这正是本 sprint 的验收标准。

---

## 1. 已勘察的其余漂移事实

| # | 声明位置 | 现状 | 证据 |
|---|---|---|---|
| D1 | `gate-registry.sh` | **无 pre-push 行**（0 处匹配 `pre-push`/`Gate M`/`walkthrough`） | `grep -c` = 0 |
| D2 | `gate-registry.sh:58` | gate 6 声明 `inline`，但层边界判定实际由 `gate-6-layers.sh` 执行 | `pre-commit:4570` 注释自述 |
| D3 | `bin/xp-gate.js:515` | 硬编码 `for (let i = 0; i <= 11; i++)`，gate-12/13 无 CLI 子命令 | 有 `GATE_REGISTRY` 可遍历却未用 |
| D4 | `githooks/gate-9.sh` | 13981 字节死文件，**无任何 hook source** | `grep` 于 pre-commit/pre-push 均无命中 |
| D5 | `gate-coverage.test.js:84-95` | 把**反向映射钉为规格** —— 测试在背书漂移 | 需同步修正，否则修了代码测试会红 |

> D5 特别注明：这不是「测试挡住重构」的普通情形。那条测试断言的是
> **一张错误的表**，它让错误获得了「已测试」的外观。修代码时必须同时
> 修测试，并且要在新测试里**明确说明旧断言为何是错的**，否则下一个人
> 会以为是测试回归而把修复回滚。

---

## 2. 需求

### REQ-GATEID-001 — 编号到名字只有一个声明处

**陈述**：`githooks/gate-registry.sh` 的 `GATE_REGISTRY_ROWS` 是
「编号 → 名字 → 实现 → 能否阻断」的**唯一**声明处。其他任何文件需要这些
信息时，必须从它派生；不得出现第二份手写副本。

**理由**：当前 4 份副本中只有 1 份错，而没有任何机制发现它。收敛到一处后，
「错」与「不一致」成为同一个概念，可以被一个测试检测。

**验收标准**

- **AC-GATEID-001-01**：`src/npm-package/lib/gate-coverage.js` 不再包含任何
  手写的 `{ gate: N, name: '...' }` 字面量表，其 `GATE_TABLE` 由 registry 派生。
- **AC-GATEID-001-02**：`gate-coverage.js` 不再包含 `PRODUCER_KEYS` 这张交换表；
  报告中 `gate{N}_{slug}` 的键名由 registry 的行**机械生成**，不存在人工维护的
  新旧编号对照。
- **AC-GATEID-001-03**：删除后 `gate-coverage` 对 9/10 的显示与 `gate-registry.sh`
  **逐字段相等**：`gate 9 -> name=build-integrity`、`gate 10 -> name=sast`。
  断言用 registry 的 **slug** 作比对键，不用散文名（散文名正是本缺陷写错的对象）。
- **AC-GATEID-001-04**（取代原「保留证伪注释」）：`gate-coverage.test.js:84-95`
  的 `AC-636-02` 用例**重写**为断言修正后的映射 —— `gate 9` 的行名取自 registry
  的 `build-integrity`，`gate 10` 取自 `sast` —— 并在用例注释中逐字引用
  `pre-commit:6158/6163` 的真实产物键名作为证据。旧断言**删除**（不是原地取反），
  因为取反后仍是一条手写映射，等于保留第二份事实。
- **AC-GATEID-001-05**（明确扫描根与豁免）：**生产代码**中不得存在手写
  `{gate: N, name: '<gate name>'}` 映射字面量。扫描根固定为
  `src/npm-package/lib/**` 与 `src/npm-package/bin/**`；
  豁免 = 路径中**任一路径段**为 `__tests__` 或以 `fixture` 开头的文件
  （按 `path.sep` 分段后逐段比对，不用子串匹配，使 `a/__tests__/b` 与
  `__tests__/a/b` 判定一致且不受目录名巧合影响）（它们可以携带人为的门禁编号，
  那正是构造坏输入所必需的）。
  > 豁免**不会**重开回滚口子：回滚需要把旧映射写回**生产**文件（`lib/`/`bin/`），
  > 仍在扫描范围内；放行 fixture 只避免对合成编号的误报。
- **AC-GATEID-001-06**（封堵「用 fixture 替代真表」）：没有任何生产模块
  从 `__tests__`/`fixture` 文件 import 门禁映射数据；由 `require`/`import`
  图断言 —— 否则把旧映射藏进 fixture 再被生产代码引用即可绕过 AC-001-05。

### REQ-GATEID-002 — 跨侧一致性测试：一处声明，多处验证

**陈述**：存在一个测试，同时读取 registry、真实报告产物键名、`gate-runner.js`
的 `GATE_REGISTRY`、`gate-coverage.js` 的派生结果、以及 `bin/xp-gate.js` 的
CLI 子命令集合，断言它们在**编号与名字的对应关系**上一致。

**理由**：AC-001-01 若只靠「删掉手写表」，下次有人加个新表仍无人发现。
一致性测试把「唯一声明处」变成**可执行的约束**，而非文档约定。

**验收标准**

- **AC-GATEID-002-01**：测试遍历 registry 的每一行，断言
  `gate-runner.js` 中同编号条目的 `name` 与之语义对应（归一化后相等）。
- **AC-GATEID-002-02**：测试断言 `gate-coverage` 派生表与 registry 逐行相等，
  且派生表中不存在 registry 未声明的编号。
- **AC-GATEID-002-03**：测试读取一份**真实** pre-commit 报告产物（fixture），
  断言 registry 声明的每一行的 slug 都能在产物中找到对应键；若产物缺键，
  报告为「产物过期」而非静默 SKIP。
- **AC-GATEID-002-04**（改为可执行形式）：一致性校验器**导出纯函数**
  `checkCrossSurface(registryRows, surfaces)` 返回违规列表；测试**直接调用**它并
  传入一份「人为把 gate 9 的 name 改成 `sast`」的行数组，断言返回非空且明确指出
  第 9 行。这不依赖修改真实文件，因此可在 CI 中稳定复现 —— 原写法「临时改真实
  文件再看测试红」既污染工作区又无法在并行 CI 中执行。
- **AC-GATEID-002-05**：同一纯函数在**真实** registry 上返回空列表；两条断言
  在同一用例内相邻，使「函数总是返回空」这种假绿立刻暴露。
- **AC-GATEID-002-06**（改写：注释不是需求）：`checkCrossSurface` 的契约由
  **断言**锁定，而非由注释声明：函数在真实 registry 上返回空、在注入坏行时返回
  非空，两条必须**同时**存在于同一测试文件内。原「测试注释需解释为何删表不够」
  一句**删除** —— 注释无法失败，写进需求只会诱使后续继续往需求里塞不可执行条款。
  （该理由改记在测试文件的普通注释中，不列为 AC。）

### REQ-GATEID-003 — registry 覆盖 pre-push 门禁

**陈述**：`gate-registry.sh` 增加 pre-push 门禁行，且能被 `pre-push` source。
「一个门禁在哪执行」不再需要读 1210 行 pre-push 才能知道。

**理由**：D1 —— 当前 registry 只有 pre-commit 的 14 行，pre-push 的 M/M2/ML/UI/MW/S
完全不可查。 #717 的同类问题（改错文件）在 pre-push 侧仍可能复发。

**验收标准**

- **AC-GATEID-003-01**：registry 新增 `hook` 字段（`pre-commit` / `pre-push`），
  既有 14 行标 `pre-commit`，新增 pre-push 行标 `pre-push`。
- **AC-GATEID-003-02**：registry 包含 pre-push 的至少 6 条门禁：
  mutation (M)、mock-density (M2)、mock-layering (ML)、ui-sprint (UI)、
  code-walkthrough (MW)、prepush-sprint (S)。
- **AC-GATEID-003-03**：`pre-push` 实际 source `gate-registry.sh`，且在
  registry 缺失时按既有 SKIP 契约写 `skip_kind=missing`，不静默。
- **AC-GATEID-003-04**：一致性测试断言 registry 中 `hook=pre-push` 的每个名字，
  都能在 `pre-push` 源码中找到对应的门禁标识（可 grep 锚点）。
- **AC-GATEID-003-05**（点明 oracle）：不改变任何门禁的实际执行行为。
  **测法**（修正「有序集合」的自相矛盾表述）：在同一 fixture 仓库上运行 pre-push
  两次（改动前后各一次），从 JSON 日志提取 `(gate_id, status, skip_kind)` 三元组的
  **多重集（multiset）**，断言两者**多重集相等**（同一三元组出现两次要算两次 ——
  用排序后数组比对，不用 Set）。**空字符串 `skip_kind` 同样参与比较**：
  「未 SKIP」是 7 种取值里的一种，不是缺失值，否则 PASS 门禁在两侧都会消失，
  比较就退化成「只比 SKIP 的门禁」。
  字段定义：`gate_id` 为 registry 的 slug；`status ∈ {PASS, FAIL, SKIP, WARN, DEBT}`；
  `skip_kind ∈ {"", missing, corrupt, stale, contract_mismatch, source_failed, not_applicable}`
  （前 6 个取自本轮 P1-C 已落地的 `GATE_M_SKIP_KIND`，为空表示未 SKIP）。
  fixture 必须**至少命中一种非空 `skip_kind`**（例如移除 `adapter-common.sh`），
  否则「SKIP 契约未变」根本没被测到。
  仅比较 `gate_id` 集合不够 —— 那会把「某门禁从 PASS 变 SKIP」读成「集合不变」。

### REQ-GATEID-004 — 修正 registry 对 gate 6 的实现声明

**陈述**：`architecture` 行的 `impl` 由 `inline` 改为 `gate-6-layers.sh`，
或明确表述为「inline 主控 + gate-6-layers.sh 判定」。

**理由**：D2 —— 声明与执行不符。`gate_name_for_file("gate-6-layers.sh")`
当前返回失败，而这正是 #717 类问题的检测入口。

**验收标准**

- **AC-GATEID-004-01**：`gate_name_for_file("gate-6-layers.sh")` 返回
  `architecture`。
- **AC-GATEID-004-02**：若采用「主控 + 判定」表述，则 registry 需支持多 impl
  或有清晰注释说明为何只列其一；不得让 `gate_name_for_file` 对真实执行文件返回失败。
- **AC-GATEID-004-03**（点明锚点格式）：一致性测试断言 registry 中每个非 `inline`
  的 impl 满足两个条件：(a) 文件在 `githooks/` 下真实存在；(b) 在 `pre-commit`
  或 `pre-push` 文本中命中正则 `(source|\.|bash)[^
]*<impl>` 或其文件名出现在
  某条 `gate_not_run`/`_details` 记录里。扫描文件集固定为 `['pre-commit','pre-push']`
  （不递归 —— hook 只 source 顶层的解析脚本，递归会把 `__tests__` 里的 fixture
  误判为执行证据，这正是 D4 死文件当初能被当成「有人用」的原因）。

### REQ-GATEID-005 — CLI 子命令集合从 registry 派生

**陈述**：`bin/xp-gate.js` 的编号门禁子命令不再硬编码 `i <= 11`，而是遍历
registry（或 `gate-runner.js` 的 `GATE_REGISTRY`），使 gate-12/13 自动获得子命令，
或显式声明何者 hook-only。

**理由**：D3 —— 硬编码 11 让 12/13 静默缺席；`gate-12-file-hygiene` 与
`gate-13-compiler-strictness` 都有独立脚本却无法从 CLI 调用。

**前提事实**（评审要求明确）：gate 12 `file-hygiene` 与 gate 13 `compiler-strictness`
**已经是** registry 中的 `hook=pre-commit` 行（`gate-registry.sh:64-65`）。
因此 AC-01 与 AC-02 不冲突：它们本就属于「pre-commit 行集合」，缺的只是 CLI 侧的
硬编码上限。

**验收标准**

- **AC-GATEID-005-01**：`xp-gate gate-12` 与 `xp-gate gate-13` 存在且可运行
  （前置：registry 中这两行已存在，见上）。
- **AC-GATEID-005-02**：子命令集合与 registry 的 pre-commit 行集合一致；
  新增 registry 行时无需改 `bin/xp-gate.js` 即可获得子命令。
- **AC-GATEID-005-03**：`xp-gate gate-list` 输出与 registry 一致（编号、名字）。
- **AC-GATEID-005-04**：`#618` 的 `GATE_NOT_RUN → exit 2` 语义保持不变
  （「没跑」不得与「跑通」同码退出）。

### REQ-GATEID-006 — 删除 gate-9.sh 死文件

**陈述**：删除 `githooks/gate-9.sh`，并把任何指向它的 fallback 修正到真实实现。

**理由**：D4 —— 13981 字节、无 hook source。这是 #717 的作案现场：
一份「看起来是 Gate 9 实现」的文件，让修改落在不执行的代码上而看似成功。

**验收标准**

- **AC-GATEID-006-01**：`githooks/gate-9.sh` 从仓库删除。
- **AC-GATEID-006-02**：全仓搜索 `gate-9.sh` 无任何执行/引用残留
  （文档中的历史叙述除外，须标注为已删除）。
- **AC-GATEID-006-03**：若 `resolveGateScript(9)` 或类似 CLI fallback 曾指向它，
  已改指真实实现，并有测试断言其结果文件确实被执行。
- **AC-GATEID-006-04**：删除后既有 gate 9（Build Integrity）行为不变 —— 
  测试断言 Build Integrity 仍由 `inline` 路径执行且结论不变。

### REQ-GATEID-007 — 产物选择必须确定，禁止目录顺序兜底

**陈述**：`gate-coverage` 在未显式指定产物时必须**确定性地**选到与当前 HEAD
对应的那一份；无法确定时报错并提示，**不得**按 `readdirSync` 顺序取第一个。

**理由**（R1 评审三方一致要求纳入）：这是 §0.4 记录的缺陷，且它与编号错配
叠加才产生了实测的「9 SAST PASS」错误输出。把它排除出范围，等于只修了两个
成因中的一个，另一个继续存活。评审同时指出：这**不是** UX 取舍，读取结果的
不确定性本身就是缺陷 —— 同一命令在不同文件系统顺序下给出不同答案。

**范围限定**：只做「确定性 + 显式失败」，不做产物发现策略的重设计
（例如不引入时间戳排序、不引入 `--latest` 语义）。

**验收标准**

- **AC-GATEID-007-01**：未指定产物且目录中存在**多于一份**候选产物时，
  `gate-coverage` 以非 0 退出，并在 stderr 说明「存在多份产物、请用
  `--branch <name>` 指定」，同时列出候选文件名。**不得**静默选其一。
- **AC-GATEID-007-02**：仅存在一份候选产物时，仍可正常输出（保持既有可用性，
  不把单产物的常见情形也变成错误）。
- **AC-GATEID-007-03**：`--branch <name>` 指定的产物优先于任何兜底；
  指定分支不存在时报错而非回落到其他产物（当前实现会回落，属静默错误）。
- **AC-GATEID-007-04**：测试用**两份**产物构造目录（`cam-a.json` 内容 commit=X，
  `cam-b.json` 内容 commit=Y），断言未指定时退出码非 0 且两份文件名都出现在
  错误信息里；再断言 `--branch` 指定后读到的是对应那一份。
- **AC-GATEID-007-05**（加入可发现的迁移路径）：多产物报错时，**错误信息本身
  必须点名 `--branch <name>` 作为解决办法**，并在同一行给出候选文件列表；
  测试断言 stderr 中同时出现字符串 `--branch` 与每个候选文件名。
  理由：静默返回 → 报错若没有迁移提示，是比原缺陷更差的失败模式
  （用户从「拿到错答案」变成「不知道怎么办」）。
- **AC-GATEID-007-06**：破坏性变更在 `CHANGELOG.md` 的 Unreleased 段落记录，
  条目须包含 `--branch` 迁移说明。测试断言 CHANGELOG 含该字符串
  （仓库已有 CHANGELOG 的既有格式，按其格式追加）。

---

## 2A. 评审要求的验证结果（R2 阻塞项已全部落实）

R2 设计评审（0%，5 轮）的三条阻塞项都是「设计把最risky的验证推给实现阶段」。
全部已完成，结论**改变了设计**：

### V1 — registry 的消费者：只有一个，而且是它自己的测试

```
grep -rn "gate_name_for_number|gate_name_for_file|gate_impl|gate_can_block|
          gate_number|gate_registry_dump|gate_all_impls" githooks/*
→ 除 gate-registry.sh 自身外：0 处命中
```

- `pre-commit:318-323` **source** 了 registry（可选，缺文件也继续）
- 但 pre-commit 中**没有任何一处调用它的函数**
- `pre-push` **完全没有 source** 它
- 唯一的调用方是 `githooks/__tests__/gate-registry.test.bats`

**结论**：registry 目前是一个**只有测试在用的装饰品**。这解释了为什么它能
公开把 gate 6 写成 `inline` 而无人发现 —— **没有任何生产代码依赖它**。
「单一事实源」当前只对一个测试成立。

**这改变了两件事**：(a) REQ-003「pre-push 也 source 它」不是锦上添花，
而是让 registry 第一次拥有真实消费者；(b) 设计必须回答「谁真的读它」，
否则做完还是装饰品。

### V2 — 算术假设：不存在，非数字编号安全

```
grep 上述函数在 githooks/ 下的调用 → 0
```

registry 内部函数只用 `cut -d'|' -fN` 取字段，**不做数值运算**。
`gate_name_for_number` 用 `case "$row" in *\|"$want"\|*)` 做字符串匹配。
因此 `M`/`M2`/`ML`/`UI`/`MW`/`S` 作为编号**不会触发任何算术错误** ——
前提是不新增数值比较。设计约束：**registry 不得引入任何数值排序/比较**。

### V3 — gate-9.sh：不是"删一个文件"，是"分开两份字节相同的文件"

```
cmp githooks/gate-9.sh githooks/adapters/gate-9.sh → 字节完全相同（md5 一致）
gate_name_for_file gate-9.sh → 空（查不到任何归属）
```

- `githooks/gate-9.sh`：自带 `⚠️ DEAD CODE — NOT EXECUTED` 警告头，install.sh 会装但它从不运行
- `githooks/adapters/gate-9.sh`：**字节与死文件相同**，但通过适配器路由**真实执行**，
  内容是 **SAST** 实现

**结论**：这不是「删死文件」这么简单。一个叫 `gate-9` 的文件里装的是 **gate 10 (SAST)**
的实现，而这个矛盾的名字正是 #717 的作案条件 —— 有人按名字找文件，
改到了不执行的那份上。删除顶层死文件是**必须的**，同时必须加一条断言：
`adapters/gate-9.sh` 的 **gate-identity 归属必须是 `sast`（编号 10）**，
且该断言要能解释「文件名里的 9 与它实现的 gate 10 无关」。

### V4 — 历史报告键的偏差是真实且有限的

`code-quality`（编号 1）的历史键是 `gate1_static_analysis`，不是
`gate1_code_quality`。逐一枚举后的偏差集合（来自真实产物
`2026-11-10-143040.json`）：仅此 1 处需要 override，其余 13 行均可由
`gate{number}_{name}` 规则推导。**偏差是 1 条，不是一张 14 行的表。**

### V5 — registry 解析器的作用域必须锚定到数组块

原设计 `line.startsWith('"')` 会匹配文件中任何以引号开头的行，包括注释里的
示例。改为：只在 `GATE_REGISTRY_ROWS=(` 与配对的 `)` 之间解析，
并对块外的行执行「只允许空行/注释」校验。

### V6 — 打包路径：`gate-registry.sh` 确实随包发布，但有三份副本

评审三方一致把「未验证 npm tarball 是否包含 registry」列为**阻塞**，
理由准确：设计让它成为 load-bearing，若不在包内，
`require` 时即抛错 = 「单一事实源」变成「单一故障点」。

**实测**（按 `files[]` 语义模拟打包，`npm pack` 本身因 dsh 插件未构建而
失败 —— 那是环境问题，与本 sprint 无关）：

```
files[] 声明下会打包的文件数: 1112
gate-registry.sh 在包内: YES
  src/npm-package/hooks/gate-registry.sh
  src/npm-package/gate-registry.sh
```

**结论**：文件在包内，设计可行。但同时暴露一个真问题：
**同一文件有三份副本**（`githooks/` 源、`src/npm-package/hooks/` 镜像、
`src/npm-package/` 根）。根副本正是 P1-C 清理过的那类孤儿路径。
因此设计约束升级为：`gate-identity.js` 必须按**明确的候选顺序**解析
（`hooks/` 优先，与其他 hook 脚本的解析一致），并在三者不一致时抛错而非取第一个。

### V7 — 重命名 `adapters/gate-9.sh` 的爆炸半径（已完整枚举）

```
grep gate-9.sh（排除 node_modules/.stryker-tmp/.sprint-*）
→ 真实引用点 3 处:
   githooks/deploy-manifest.sh:36     部署清单 GATE_FILES 条目
   githooks/__tests__/gate-9.test.bats  测试文件（source ../gate-9.sh）
   scripts/check-hook-mirror.sh       镜像 parity 清单
   其余均为注释/文档叙述
```

**关键发现**：`githooks/__tests__/gate-9.test.bats` **正在测试那个死文件**
（`source ../gate-9.sh`）。这让死文件看起来「有测试覆盖」——
又一次说明「测试存在」不等于「被测对象被执行」。

**决策**：本 sprint **不重命名**，只删除顶层死文件并把
`githooks/__tests__/gate-9.test.bats` 改指向**真实执行的那份**
（`adapters/gate-9.sh`）。理由：
- 重命名会同时改动部署清单、镜像清单、镜像 parity 报告、以及
  已安装消费者的文件布局 —— 与「身份登记」这个目标无关，属行为变更，
  应留给 P1-E（镜像重复治理）。
- 但**不能什么都不做**：断言 `adapters/gate-9.sh` 的 gate-identity 归属是
  `sast`（编号 10），且测试注释解释「文件名里的 9 与它实现的 gate 无关」。
  这样文件名即使还叫 9，它的**语义归属**也被钉住，不再能被误改。
- 重命名作为**显式跟进项**记入 §7（发现但不处理），而非静默留下。

### V8 — 副本一致性策略：以**集合**定义，禁止多数表决

三方在两轮内对同一条文本缺陷达成一致：原表述「两份都存在且不同则硬失败」
是**成对（pairwise）**语义，而账本已记录同一文件有 **3** 条打包路径 ——
「两份一致、第三份不同」在原文本里没有定义，而按成对读法实现者可以
「找到两份先一致的就放行」，这正是本 sprint 要消灭的漂移容忍。

**定案（集合语义，替换而非补充成对表述）**：

```
S = 实际发现的全部 gate-registry.sh 副本

| S | == 0                  -> 硬失败（无法确定门禁身份，不猜）
∀ a,b ∈ S: bytes(a) == bytes(b)  -> 使用之（内容唯一，路径无关）
∃ a,b ∈ S: bytes(a) != bytes(b)  -> 硬失败，错误信息列出 S 中每条路径
                                    以及首个差异行
```

**明确禁止多数表决**：不存在「3 份中 2 份一致就采用」的分支。
多数表决会把「分歧」重新定义为「可接受」，而那正是缺陷本身。

**为什么硬失败不会让消费者全线停摆**（B 的反驳成立并采纳）：
`gate-identity.js` 的消费面只有 hook 脚本与 CLI 的门禁相关子命令，
爆炸半径限于门禁执行 —— 而身份已损坏时门禁**本来就该停**。
在装错的仓库里静默跑门禁，比报错危险得多。

**必须有的测试**（B 点名要求）：注入**第三份**分歧副本，
证明检查是集合语义而非成对语义 —— 只测两副本的实现会漏掉这个分支。

### V9 — §3.6 跟进项必须有 owner 与目标 sprint（评审要求）

A 与 C 都指出：无 owner 的跟进项等于「带更好文档的 #717 陷阱」。
因此 §3.6 全部升级为**带 owner 与归属**的条目，并给出追踪方式；
本 sprint 结束时它们会被实际创建为 issue，而非仅停留在文档里。

### V10 — 副本发现必须动态（B 的阻塞项成立）

「S = 实际发现的全部副本」中 **「实际发现」本身未定义** —— 只查硬编码三路径
的实现能通过「注入第三份」测试（若注入在已知路径），却漏掉第四份。这与被禁止的
多数表决是**同一缺陷类**：任何**真子集**一致都不能当 2 作全集。

**定案**：发现有唯一算法，写进设计而非留给实现：

```
从 repo root 递归扫描文件名 == "gate-registry.sh"
排除 .git（仅此一项 —— node_modules 也扫，镜像就在 node_modules 之外但同属风险面）
symlink 解析到真实路径后再比对（避免同一文件被算两次）
结果按路径排序（保证失败输出可复现）
```

**测试要求**：第三份分歧副本必须注入到**任何硬编码清单之外**的路径
（例如 `tmp-copy/fixture/gate-registry.sh`），以证明发现是动态的。

### V11 — 比较键必须是 registry slug，override 不得进入等式（C 的阻塞项成立）

C 指出的是一条**我自己引入的后门**：若 `checkCrossSurface` 用报告键比较，
而 `code-quality -> gate1_static_analysis` 的 override 正当存在，
那么 override 会**掩盖真实的 registry/report 不匹配** —— 把原始缺陷
从「对调表」换成「override 表」重新引入。

**定案**：
- `checkCrossSurface` **只比较 registry 的 slug 与编号**；
- 历史键 override **只在报告输出时套用**，绝不进入相等性判断；
- 增加测试：构造一个「override 是唯一差异」的用例，断言返回**非空**
  （即 override 不能成为豁免票）。

### V12 — 打包路径的存在性不是运行时强制项（C 的阻塞项成立）

C 指出：既然副本策略是「不一致则硬失败」，那么「3 条打包路径缺 1 条」是否会
在运行时变成必然硬失败？若会，SHIP 就带着一个保证失败的状态。

**定案（取 (b) 范围限定）**：策略作用域明确为 **「本次构建/安装中实际存在的副本」**。
缺失的路径**不构成失败** —— 只有 `|S| == 0`（一份都没有）才硬失败。
理由：消费者仓库的布局合法地不同于本仓库（`init` 只装 `hooks/`，
不会产生根副本），把「本仓库恰好有 3 份」当成所有环境的契约就是过度约束。

### V13 — 三处实现细节钉死（A/B 的非阻塞项，一并落实）

1. **集合相等写法**：`new Set(a) === new Set(b)` 在 JS 中恒为 false ——
   设计要求写为**内容相等**：比较排序后的 `[...set].sort().join(' ')`。
2. **`hook` 列取值域**：仅 `pre-commit` | `pre-push`，解析器对其它值抛错。
3. **「禁止数值比较」的强制手段**：一条测试 grep `gate-registry.sh` 中对
   `gate_number`/`_gate_field` 结果做 `-gt|-lt|-ge|-le|-eq|$((` 的用法，
   有则失败 —— 让不变式可执行，而非仅写在注释里。
4. **失败输出可复现**：差异路径按排序后输出（见 V10），首个差异行取排序后
   第一对不一致副本的首个不同行号。

### V14 — R2 通过后的三条落实（评审非阻塞建议，全部采纳）

1. **`|S| == 0` 必须有空仓库 fixture 测试**（C 建议）：它现在是**唯一**的硬失败
   触发条件，反而最缺测试。测试须覆盖「`init` 只装 `hooks/` 的消费者布局」
   这一合法情形 —— 该情形下 |S| 为 1，必须**正常通过**
   （即：缺失不是失败，只有全缺才是）。
2. **历史键 override 表放在 registry 文件里**（B 建议）：保持单一声明处，
   防止后人把第二份映射加在比较逻辑旁边。形式上作为 registry 的附加数组
   `GATE_REPORT_KEY_OVERRIDES`，与 `GATE_REGISTRY_ROWS` 同文件。
3. **算术不变式的 grep 测试标注为启发式**（C 建议）：它补充内容相等测试而非替代；
   注释中明写「grep 可能被混淆写法绕过，真正的保证是 registry 不引入数值语义」。

---

## 3. 设计

### 3.0 设计修订（依据 §2A 验证结果）

**R2 评审第 1 条否决「两个注册表」是正确的。** 原 D5 让 CLI 从
`gate-runner.js` 的 `GATE_REGISTRY` 派生，而那是**第三份手写声明**；
一边宣称单一事实源、一边保留两份，是自相矛盾。

**修订后的结构**：`gate-runner.js` 不再声明 name/number 等**元数据**，
只保留 `run` 函数（按 slug 索引）。它的 `GATE_REGISTRY` 在加载时由
`gate-identity.js` 从 shell registry **构造**：

```js
// gate-runner.js AFTER -- metadata comes from the registry, code stays here.
const { loadRegistry } = require('./gate-identity.js');
const RUNNERS = {                    // slug -> how to execute. The ONLY thing this file owns.
  'duplicate-code': (p) => { ... },
  'complexity':     (p, o) => runTsGate('gate-3', p, o),
  ...
};
const GATE_REGISTRY = Object.fromEntries(
  loadRegistry().map((row) => [row.number, {
    name: row.name, impl: row.impl, blocks: row.blocks,
    aliases: row.aliases, preCommitOnly: row.hook === 'pre-commit',
    run: RUNNERS[row.name],
  }])
);
```

这样「一个声明处」在**结构上**成立，一致性测试不再是「比对两份真值」，
而是「断言构造成功 + 每个 slug 都有 runner」。

**但单向断言不够**（评审指出）：`registry ⊆ RUNNERS` 只能发现
「registry 有行但没 runner」，发现不了**孤儿 runner**（registry 删了行、
`RUNNERS` 里还留着键）—— 那是与 `gate-9.sh` 同种的死代码。
因此断言必须是**双向集合相等**：

```js
expect(new Set(Object.keys(RUNNERS))).toEqual(new Set(registry.map(r => r.name)));
```

一条断言两个方向，且用集合相等而非长度相等（长度相同但键不同仍是漂移）。

### 3.1 派生方向：registry → 消费端（单向）

```
                githooks/gate-registry.sh
                GATE_REGISTRY_ROWS=( name|number|impl|blocks|hook )
                              │
              ┌───────────────┼────────────────┐
              │               │                │
     gate-coverage.js    gate-runner.js    bin/xp-gate.js
     (派生表+键名)        (已有，校验)      (子命令集合)
```

**为什么是 shell 文件作源**：registry 必须能被 hook 直接 `source`
（pre-commit 与 pre-push 都是 shell），而 npm 包要在**无 Node 依赖**下可读。
shell 是唯一同时满足两者的载体。JS 侧通过一个薄解析器读取，不引入构建步骤。

### 3.2 键名生成规则必须机械化

当前 `gate9_build_integrity` 这种键名是**另一份手写事实**。设计要求：

```
key = "gate" + number + "_" + slug(name)
  slug:  kebab-case → snake_case，并与历史键名逐一比对
```

历史键名与 slug 规则的偏差必须**显式列出**（如 `gate1_static_analysis`
对应 name `code-quality`，slug 会是 `code_quality`）。处理方式：
在 registry 行内增加可选的 `key` 字段，**只有偏差行才写**，
规则可推导的行不写。这样「偏差」是显式的、可枚举的，而不是一张完整的对照表。

> 这是本设计的关键取舍：上一版用一张 14 行的交换表**替换**了一张 14 行的名字表，
> 结果错误只是搬家了。本次要求「默认由规则推导，例外逐条标注理由」。

### 3.3 一致性测试的放置

放 `scripts/__tests__/gate-identity-cross-surface.test.cjs`（不依赖 tsx，纯 node），
理由：它要读 shell 文件与 JSON 产物，不需要 TypeScript 运行时；
且 `scripts/__tests__/` 已被 CI quality-gates 收录。

### 3.4 失败语义

| 情形 | 行为 |
|---|---|
| registry 缺失 | hook 侧：SKIP + `skip_kind=missing`；CLI 侧：报错并非 0 退出 |
| registry 行缺字段 | 抛错，列出该行与缺失字段 —— 不猜默认值 |
| 产物缺某门禁键 | 该行报「产物过期」，**不得**静默 SKIP |
| 产物 commit ≠ HEAD | 已实现 `stale` 标记；本轮不改语义，但测试断言它仍被打印 |

### 3.5 不做的事（本轮明确排除）

- **不**把 pre-push 门禁的执行逻辑改造为 registry 驱动（那是 P1-D）。
  本轮只登记身份（REQ-003 的验收明确要求行为不变）。
- **不**统一 `gate-3.sh` 等既有脚本与 `src/gates/*.ts` 的双实现（P1-D）。
- **不**重设计产物发现策略（时间戳排序、`--latest` 等）。
  ~~不解决 `readQualityStatus` 兜底~~ —— **修订**：R1 评审三方一致指出这是
  实测错误输出的两个成因之一，排除它等于只修一半。现纳入 REQ-GATEID-007，
  范围严格限定为「确定性 + 显式失败」，不做策略重设计。

---

## 3.6 本 sprint 发现但不处理（显式跟进）

每条都带 **owner 角色** 与 **目标 sprint**；本 sprint SHIP 前会实际提为 issue
（`xp-gate` 仓库），文档表格只是索引，不是追踪载体。

| # | 发现 | 为何不在本轮 | owner | 目标 |
|---|---|---|---|---|
| 7.1 | `src/npm-package/gate-registry.sh` 与 `hooks/gate-registry.sh` 是同一文件的两份副本（另有 `githooks/` 源） | 属镜像重复治理（与 293 个 adapters 文件同类），单独处理才有意义 | P1-E 负责人 | **P1-E**（镜像去重） |
| 7.2 | `githooks/adapters/gate-9.sh` 文件名里的 9 与它实现的 gate 10 不符 —— **#717 陷阱仍有残留** | 重命名触及部署清单/镜像清单/report/消费者布局，属行为变更；本轮用「删除死文件 + 断言语义归属 + 重新指向测试」三重缓解 | P1-E 负责人 | **独立 issue（P1-B SHIP 后 1 周内）** |
| 7.3 | `githooks/__tests__/gate-9.test.bats` 测的是**死文件** | 本轮改为指向真实执行的那份即可；系统性审计「测试是否测到真对象」超出范围 | 质量负责人 | 独立 issue |
| 7.4 | `npm pack` 因 `plugins/dsh/lib/index.js` 缺失而失败 | 环境/构建前置，与 P1-B 无关；已改用 `files[]` 语义模拟验证 | 发布负责人 | 不处理（需先 build dsh 插件） |

**缓解措施的有效性取决于可验证性**（C 的要求）：7.2 的缓解不是「加个注释」，
而是三条可执行断言 —— (a) 顶层死文件不存在；(b) `adapters/gate-9.sh` 的
gate-identity 解析结果是 `sast` / 编号 `10`；(c) `gate-9.test.bats` 的 source
路径指向 `adapters/gate-9.sh` **且该测试因 SAST 相关断言而失败或通过，
而不是仅仅「source 成功」** —— 后者只会重复「有测试所以有覆盖」的错觉。

---

## 4. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 派生逻辑读 shell 文件易碎 | registry 一改格式，JS 侧静默失配 | 解析器对无法识别的行**抛错**，不跳过；一致性测试覆盖 |
| `gate-coverage.test.js:84-95` 钉住了错误规格 | 修代码时测试红，可能被误判为回归 | 同时改测试，并在测试内注释说明旧断言为何是错的（D5） |
| pre-push source registry 改变启动时序 | 可能影响 M 门禁的 skip 契约 | AC-003-05 强制对比 source 前后门禁集合不变 |
| 删 gate-9.sh 有外部引用 | 消费者仓库可能残留副本 | 该文件从不被 source，删除只影响版本库；`doctor` 已有漂移检测 |
| 编号 9/10 修正影响历史报告解读 | 旧报告键名仍是 `gate9_build_integrity` | 键名本身不变（本来就是对的），只改显示映射；历史产物无需迁移 |

---

## 5. 交付物

1. `githooks/gate-registry.sh` — 增 `hook` 字段、pre-push 行、修正 gate 6 impl
2. `src/npm-package/lib/gate-identity.js` — registry 解析器（新增）
3. `src/npm-package/lib/gate-coverage.js` — 删除手写表与交换表，改为派生
4. `src/npm-package/bin/xp-gate.js` — 子命令集合遍历 registry
5. `githooks/pre-push` — source registry（仅登记）
6. `githooks/gate-9.sh` — 删除
7. `scripts/__tests__/gate-identity-cross-surface.test.cjs` — 跨侧一致性测试
8. `src/npm-package/lib/__tests__/gate-coverage.test.js` — 修正被钉住的错误规格

---

## 6. 验收总表

| REQ | AC 数 | 关键断言 |
|---|---|---|
| GATEID-001 唯一声明处 | 6 | 无手写表、无交换表、9/10 按 slug 相等、D5 测试重写、无硬编码扫描 |
| GATEID-002 跨侧一致性 | 6 | 五侧比对、纯函数可注入坏行、真 registry 返回空、防的是抄写动作 |
| GATEID-003 pre-push 登记 | 5 | 6 条 pre-push 行、source 可用、(gate,status,skip_kind) 集合不变 |
| GATEID-004 gate 6 impl | 3 | `gate_name_for_file` 可查、impl 真实存在且命中锚点 |
| GATEID-005 CLI 派生 | 4 | gate-12/13 可用、gate-list 一致、exit 2 语义保留 |
| GATEID-006 删死文件 | 4 | 文件删除、无引用、fallback 修正、行为不变 |
| GATEID-007 产物确定性 | 6 | 多产物报错、单产物可用、--branch 优先、破坏性变更记录 |
| **合计** | **34** | |
