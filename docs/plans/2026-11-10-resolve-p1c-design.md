# P1-C 解析层收敛 + P1-A 清单完整性收口 设计

- 日期：2026-11-10
- Sprint：sprint-20261110-33
- 状态：待评审（DESIGN v1）
- 关联 issue：#789（索引）、#783（部署清单第 N 次重演）、#769、#771、#770、#741、#756、#505
- 前置文档：`2026-11-09-architecture-sprint-breakdown.md`（P1-C §、P1-A §）、
  `2026-11-09-architecture-orthogonal-decomposition.md`（根因实测）
- 前序 sprint：sprint-20261109-15（P1-A 主体，已合入 main 7ac47a29）

---

## 0. 结论先行

本次 sprint 做两件事，**两件都是发版硬门槛**：

1. **P1-C 解析层收敛**：pre-push 改消费生成的解析表，删除顶层过期副本，加防再生断言。
2. **P1-A 清单完整性收口**：三份部署清单合为可枚举的完整集合，并加「一个都不能漏」的断言。

第 3 条硬门槛（项目级 init 生成 `.archlint.yaml`）按用户决策**只做项目级**，不做全局。

**本次 sprint 不发版。** 三条硬门槛全部满足后由下一个 sprint 执行发版。

---

## 1. 实测现状（不是推测）

### 1.1 P1-C 的核心事实

生成表 `githooks/hook-module-resolution.sh` 已经是 **project 优先**：

```
HOOK_ADAPTER_DIR_TIERS=(
  'project|PROJECT_GITHOOKS|adapter-common.sh'    ← 第一顺位
  'global|GLOBAL_ADAPTER_DIR|adapter-common.sh'   ← 第二顺位
  'script|SCRIPT_DIR|adapter-common.sh'
)
```

而 `githooks/pre-push:534-545` 仍是**手写 global 优先**：

```bash
if [[ -f "$GLOBAL_ADAPTER_DIR/adapter-common.sh" ]]; then      # ← global 第一
  ADAPTER_COMMON="$GLOBAL_ADAPTER_DIR/adapter-common.sh"
elif [[ -f "$PROJECT_GITHOOKS/adapter-common.sh" ]]; then       # ← project 第二
  ...
```

**实测计数**：`grep -c "HOOK_ADAPTER_DIR_TIERS\|hook-module-resolution" githooks/pre-push` = **0**。
`grep -c "_hook_resolve" githooks/pre-push` = **0**。pre-push 完全没有这套基础设施。

**后果（可复现）**：用户机器上同时存在全局旧版与项目新版 adapter 时，
pre-commit 选**项目版**（正确），pre-push 选**全局版**（错误）——
同一个仓库的两道门用不同版本的 adapter 判同一份代码。

### 1.2 顶层死副本已实证为过期

```
diff src/npm-package/hook-module-resolution.sh githooks/hook-module-resolution.sh
27d26
<   'global|GLOBAL_ADAPTER_DIR|adapter-common.sh'
28a28
>   'global|GLOBAL_ADAPTER_DIR|adapter-common.sh'
```

两份**内容不同**（global 与 project 的顺序位置相反）。`src/npm-package/hook-module-resolution.sh`
是旧序副本，且**无任何消费方**：

- `hooks/install.sh` 读的是 `$HOOKS_DIR/hook-module-resolution.sh`（即 `hooks/` 下那份，非顶层）
- `deploy-manifest.sh` 的 `HOOK_FILES` 列的是 `hook-module-resolution.sh`（相对 `hooks/`）
- 无任何 import/require/source 指向顶层那份

三重盲区：过期内容 + 无人消费 + 无一致性检查。

### 1.3 P1-A 清单缺口的实证

实测 `HOOK_FILES ∪ GATE_FILES` 对 `src/npm-package/hooks/` 的覆盖：

```
缺声明: adapter-common.sh, deploy-manifest.sh, install.sh, lib
```

（`lib` 是目录。）此前已实测：`xp-gate init --global` 后这三个**文件**不会被安装。

后果链：`install.sh` 不落地 → 消费者拿不到部署清单的安装入口；
`deploy-manifest.sh` 不落地 → 装好的 `install.sh` 读不到投影。

**精确化（实测修正）**：`lib/` 目录**确实会被安装**，但它是靠
`shared-utils.js:84` 的**硬编码路径** `path.join(srcDir, 'hooks', 'lib')` 复制的，
不经过任何清单。这与三个未声明文件是**同一类缺陷的两种形态**：

| 形态 | 例子 | 为什么危险 |
|------|------|-----------|
| 清单不认识 | `adapter-common.sh` / `deploy-manifest.sh` / `install.sh` | 不在清单 → 不被安装 |
| 绕过清单硬编码 | `lib/` 目录 | 能装上 → **看起来清单是完整的**，于是没人去查 |

第二种更隐蔽：它让「清单完整性」这个属性**无法通过读清单来验证**。
AC-DEPLOY-002-02 的目录枚举断言同时覆盖这两种形态。

> 另注：`copyGateScripts` 用通配符 `gate-*.sh`，`copyAdapters` 用 `*.sh` 通配符，
> 所以 gate 脚本与 adapters 实际不会漏——但那也是「绕过清单」，只是绕得恰好正确。
> **清单不完整 ≠ 当前有 bug；清单不完整 = 下一次新增文件时必然漏。**

---

## 2. REQ / AC

### REQ-RESOLVE-001（pre-push 消费生成解析表）

pre-push 的 adapter-common 解析改为 `_hook_resolve` + `HOOK_ADAPTER_DIR_TIERS`（后者实测来自 `scripts/generate-hook-resolution.cjs`），
删除手写 global-first 级联。与 pre-commit 使用**同一份生成数据与同一份函数实现**。

> **v2 修正**：v1 的 AC-01 是「手写级联不存在」（grep 负向断言）。三位专家一致指出
> 负向存在性断言是最弱的验证形式——它只证明「我没找到」，不证明「行为正确」。
> 改为行为断言为主，grep 仅作辅助。

**AC-RESOLVE-001-01（行为）**：fixture 同时放置全局版与项目版 `adapter-common.sh`
（内容可区分，如各写一个标记变量），运行 pre-push，断言它 source 的是**项目版**。
这条断言在 v1 实现下必然失败——那就是它有效的证明。

**AC-RESOLVE-001-02（行为，结构化字段为主，文本为辅）**：

> 第 5 轮专家 A：*"stderr contains / stdout does NOT contain are substring checks on free
> text — brittle, not a structured predicate. Should assert journal fields only; text is
> auxiliary."* 接受。第 5 轮专家 C 补充：消费者集合未枚举，测试数量不可验证。

消费 hook 集合显式枚举为 **2 个**：`githooks/pre-commit`、`githooks/pre-push`。
**每个各跑一次**，共 2 次断言。

**主断言（结构化字段，不依赖文案）**：

```bash
assert journal.gates.M.details.skip_kind   == "missing"
assert journal.gates.M.details.skip_reason == "hook-module-resolution.sh could not be sourced"
assert exit_code == 0
```

**辅助断言（文本，仅用于人类可读性，不作为唯一证据）**：

```bash
assert stderr contains "hook-module-resolution.sh not found"
assert stdout does NOT contain "PASSED - Gate M"   # 「静默算作通过」的可观察形态
```

主断言只看 journal 结构化字段——文案改动不会让它失效。
辅助断言如果因文案调整而失败，那是**提醒有人改了对外输出**，需要一并更新测试，
而不是被当成脆弱噪音删掉。

**AC-RESOLVE-001-03（行为）**：项目级与全局级同时存在时，pre-push 与 pre-commit
解析到**同一个绝对路径**（bats 分别打印各自解析结果并比对）。

**AC-RESOLVE-001-04（行为，精确到可观测值，非「能继续」）**：

> 第 5 轮专家 B：*"'仍能解析并继续' 应精确固定为可观测值。"*

只存在全局版本（无项目级）时：

```bash
assert exit_code == 0
assert journal.gates.M.details has no "skip_kind" key   // 字段不存在 = 没有发生任何 SKIP
assert stdout contains "Gate M" && stdout does NOT contain "SKIP"
```

**AC-RESOLVE-001-05（结构，辅助）**：`githooks/pre-push` 中出现 `HOOK_ADAPTER_DIR_TIERS`（常量名实测来自 `src/npm-package/lib/hook-module-resolution.js`）
且出现 `_hook_resolve`。此为辅助断言，不作为主要证据。

**AC-RESOLVE-001-06（解析表损坏时 pre-push 必须响——v11 新增）**：

> R2 第 6 轮专家 C：实验 F 只证明 Gate 6 不解析 archlint 配置，
> **未证明它对 pre-push 注入的解析表有任何校验**。若表生成失败（REQ-002 删除死副本后
> 路径变更），Gate 6 仍 PASS，错误会在下游某处爆开。

```js
// fixture: 把生成的 hook-module-resolution.sh 替换成畸形内容
//   case A：空文件
//   case B：只含注释、无任何函数定义
//   case C：函数定义被截断（语法错误）
//
// case D（v13 新增，R2 第 7 轮专家 C）：文件语法正确、函数也存在，
// 但签名/返回契约与调用方不符（例如旧生成器发出的是 2 参数版 _hook_resolve）
//   —— source 成功，调用时在 push 中途炸开，这是最难定位的一种

// 四种情况的共同断言：pre-push「不确定地通过」是不可接受的
assert(prePush.exitCode !== 0 || prePush.journal.gates.M.details.skip_kind);
assert(prePush.stderr contains the resolution file path);
// 即：要么明确失败，要么明确 SKIP 并带原因和路径。不允许静默继续。
```

**case D 的实现要求**：`_hook_resolve` 必须自带**契约自检**，
在 source 后、任何调用前验证自身行为符合预期：

```bash
# 生成器产出的自检（放在函数定义之后）
_hook_resolve_selfcheck() {
  local _probe
  _probe="$(_hook_resolve "project" "PROJECT_GITHOOKS" || true)"
  [[ -n "$_probe" ]]   # 空返回值 = 契约不符
}
_hook_resolve_selfcheck || {
  GATE_M_SKIP_REASON="hook-module-resolution.sh contract mismatch (selfcheck failed)"
  export _HOOK_RESOLVE_BROKEN=1
}
```

> 这一条把「签名不匹配」从**运行时随机炸开**变成**加载时确定性发现**。
> 一个只在特定调用路径才炸的实现，与「永远不炸」在测试里看起来一样——
> 除非让它在加载时就自检。

**这一条与 AC-RESOLVE-003-06 的区别**：003-06 测「文件缺失/陈旧」两种已知状态，
本条测「文件存在但内容坏了」——这是另一类失败，且正是 `source` 会静默半途而废的形态
（`source` 一个语法错误的文件时，已执行的部分生效、后面的不生效，
**不检查返回值就完全看不出来**）。

### REQ-RESOLVE-002（删除顶层死副本 + 防再生）

删除 `src/npm-package/hook-module-resolution.sh`，并加断言阻止其被重新生成进该位置。

**AC-RESOLVE-002-01**：该文件从 git 移除。

**AC-RESOLVE-002-02（具体位置）**：守卫放在 `scripts/sync-package-content.js` 的
`syncHooks()` 内、与写 `hooks/` 的同一个函数里（不是另一个可能不被调用的地方），
断言 `src/npm-package/hook-module-resolution.sh` 不存在；存在则抛错并终止 prepack。
**必须有一个测试**：在 fixture 里人为创建该文件，调用 `syncHooks()`，断言它抛错。
证明守卫真的执行，而不只是存在。

**AC-RESOLVE-002-03（行为）**：删除后 `hooks/install.sh` 的生成兜底仍工作
（它读 `$HOOKS_DIR/hook-module-resolution.sh`，与顶层副本无关）——
在无该文件的 fixture 中运行 install.sh，断言它能自行生成并继续。

### REQ-RESOLVE-003（解析函数单一实现，消除 v1 的漂移风险）

> **新增 REQ**，来自评审：取舍 A 的内联复制会重造本 sprint 要消灭的缺陷。

三个函数（`_hook_tier_base` / `_hook_resolve` / `_hook_resolve_dir`）由
`scripts/generate-hook-resolution.cjs` 生成到 `githooks/hook-module-resolution.sh`，
pre-commit 与 pre-push 都 source 同一份。

**AC-RESOLVE-003-01（枚举三个函数名）**：source 生成文件后，以下**三个**函数可被
`declare -F` 查到（逐个断言，不是「都能查到」这种整体判断）：

```bash
declare -F _hook_tier_base    > /dev/null
declare -F _hook_resolve      > /dev/null
declare -F _hook_resolve_dir  > /dev/null
```

> 第 4 轮专家 C 第 2 条：原稿只写「三函数可 declare -F 查到」，未点名。
> 现在逐个列出，任何一个缺失都会独立失败，且失败信息直接指出是哪一个。

**AC-RESOLVE-003-02（唯一实现，正则覆盖多种写法）**：

`githooks/pre-commit` 与 `githooks/pre-push` 中**都没有**这三个函数的定义（只有 source）。

> 第 5 轮专家 A：原正则漏 `_hook_resolve ()`（括号前有空格）与跨行定义，
> 且「必须为 0」本身是负向断言——文档自己否定过的最弱形式。
> 第 5 轮专家 C 对 AC-RESOLVE-004-03 的同类意见：负向断言需配正向证据。

**断言分两层，正向为主**：

正向（主证据，证明「函数来自生成文件」）：

```bash
# 生成文件确实定义了这三个函数
grep -cE '_hook_(tier_base|resolve|resolve_dir)[[:space:]]*\(\)' \
  githooks/hook-module-resolution.sh          # 必须 >= 3

# 两个 hook 都能通过 source 拿到它们
bash -c 'source githooks/hook-module-resolution.sh && declare -F _hook_resolve' # 成功
```

负向（辅助，防重复定义回归）——正则覆盖空格与多种写法：

```bash
grep -cE '^[[:space:]]*(function[[:space:]]+)?_hook_(tier_base|resolve|resolve_dir)[[:space:]]*\(\)' \
  githooks/pre-commit githooks/pre-push       # 必须为 0
```

负向断言保留，但它不再单独承载「唯一实现」的证明——正向断言已经证明
「函数确实来自生成文件」，两者合起来才是完整证据。

**AC-RESOLVE-003-03（手改检测，含失败模式）**：`node scripts/generate-hook-resolution.cjs --check`
在文件被手改时：**退出码 1**，stderr 含 `hook-module-resolution.sh is STALE`。
测试：fixture 中向生成文件追加一行伪造内容，跑 `--check`，断言上述两项。
（此机制已在 `generate-deploy-manifest.cjs --check` 上验证过同样形态，
且已由 Gate 12b 接线，可复用其既有实现模式。）

**AC-RESOLVE-003-05（生成物与生成器一致性——R2 评审的核心批评，v7 新增）**：

> 第 R2 轮三位专家一致指出：*"Generator↔committed-file drift: REQ-RESOLVE-004 covers
> install-time staleness only; nothing regenerates-and-diffs the committed
> `hook-module-resolution.sh` in CI/test. Without this, 方案1 relocates drift rather
> than eliminating it."*
>
> 这条批评是**对的**：`githooks/hook-module-resolution.sh` 是提交进 git 的生成物，
> 它和生成器构成一对副本。没有守卫，方案 1 只是把漂移从「两个 hook 内联」
> 搬到了「生成器 vs 提交物」。

```bash
# 重生成 → 与已提交版本比对，不一致即失败（不改工作区）
node scripts/generate-hook-resolution.cjs --check
# 等价于：生成期望内容到内存 → 与磁盘上的 githooks/hook-module-resolution.sh 逐字节比对
# 退出码 0 = 一致；1 = 不一致（stderr 含 "is STALE"）
```

**必须放在 CI 与本地测试里各跑一次**（只放其一等于没放）：
- 本地：纳入 `npm test`（新增一个测试文件断言 `--check` 退出码 0）
- CI：`.github/workflows/quality-gates.yml` 增加一步直接执行 `--check`

> 注：`generate-deploy-manifest.cjs --check` 已有同样形态并被 Gate 12b 接线，
> 复用它验证过的实现模式，不新造机制。

**AC-RESOLVE-003-08（archlint 版本与 schema 一致性——v11 新增，v12 用实测值替换臆造清单）**：

> 专家 B：*"Unverified premise: archlint JSON schema (`files_analyzed`,
> `cyclic_dependencies`, `total_smells`) is identical between the local dev env and
> CI/pre-push env. A version skew could make `--check` green locally, red in CI —
> or silently compare incomparable shapes."*
>
> 更关键的是专家 B 第 6 轮的第二条批评——v11 我写的版本正则与字段清单
> **同样是臆造**：*"均来自文档/推测，非 0.16.0 实际 stdout 观测值。
> 这是本轮批评 1 的完全同构错误（臆造 `archlintStatus`）"*。**完全正确。**

**实验 H（原始输出，可复现，未经编辑）**：

```
$ ./node_modules/.bin/archlint --version
archlint 0.16.0
[exit=0]

$ cd <fixture> && archlint -q -f json . > o.json          # [exit=0，3550 字节]
$ node -e "const j=require('./o.json'); console.log(JSON.stringify(Object.keys(j).sort()))"
["smells","summary"]
$ node -e "const j=require('./o.json'); console.log(JSON.stringify(Object.keys(j.summary).sort()))"
["architecture_grade","cycle_clusters","cyclic_dependencies","dead_code","dead_symbols","feature_envy","files_analyzed","files_in_cycles","god_modules","high_cognitive_complexity_functions","high_cyclomatic_complexity_functions","hub_dependencies","large_files","shotgun_surgery","total_smells","unstable_interfaces"]
```

**顶层只有 `smells` 和 `summary` 两个键；`architecture_grade` 在 `summary` 里，
`j.architecture_grade` 是 `undefined`。**（实测：node -e 读 o.json 验证，见下方「关于一次自相矛盾」。）

> **关于一次自相矛盾（R2 第 7 轮专家 B 抓到）**：
> 我上一版写「v11 我猜的清单里多了一个 `architecture_grade` 位置错误」——
> **这句话本身是错的**，因为实测 `architecture_grade` 确实在 summary 里。
> 专家 B 因此合理质疑「16 字段清单到底哪来的」。
> 真实情况是：字段清单是对的（我跑了），但**我对它的描述是错的**（我没跑就说它错）。
> 这是同一毛病的新变体——**凭记忆描述自己的实测结果**。
> 现在把原始输出逐字贴在这里，任何人可复现。

```js
const ARCHLINT_EXPECTED_VERSION = '0.16.0';

// v13 修正（R2 第 7 轮专家 C）：不再断言完整 16 字段清单。
// 理由：那份清单虽已实测，但把它固化成静态期望，会让 archlint 每加一个 detector
// 都因与本设计无关的原因让测试红——这正是「把 API 细节写进断言」的老问题，
// 只是冻结得晚了一个版本。
//
// 改为：只断言本设计真正消费的字段，其余用非阻断的漂移检查。
const FIELDS_THIS_DESIGN_CONSUMES = Object.freeze([
  'total_smells',
  'files_analyzed',
  'cyclic_dependencies',
]);

const v = execSync('archlint --version').toString().match(/\d+\.\d+\.\d+/)[0];
assert(v === ARCHLINT_EXPECTED_VERSION, `archlint version drift: ...`);

// 硬断言：消费的字段必须存在（缺了就是设计假设失效，必须失败）
for (const f of FIELDS_THIS_DESIGN_CONSUMES) {
  assert(f in summary, `archlint summary no longer has '${f}' — design assumption broken`);
}

// 非阻断漂移检查：出现了预期外的新字段只提示，不让测试红
const EXPECTED = new Set([...16 个实测字段]);
const unexpected = Object.keys(summary).filter(k => !EXPECTED.has(k));
if (unexpected.length) {
  console.warn(`[archlint] new summary fields: ${unexpected.join(', ')}. ` +
               `Not a failure — update EXPECTED and this design doc's Experiment H.`);
}
```

> **这个改动的要点**：区分「设计依赖的不变量」（硬断言）与「环境的当前形状」（软提示）。
> 前者失效=设计错了；后者变化=世界变了，只需要知道。**把两者都用同一种断言表达，
> 就会让世界一变化测试就红，然后被人改宽——最后连前者也不再被守护。**

**这条批评本身值得记下来**：我在同一个话题上犯了**完全相同**的错误两次——
先是臆造 `archlintStatus` 字段名，然后是臆造 summary 字段清单与版本格式。
第一次被抓到后我改正了那一处，却没意识到「凭记忆写 API 细节」是**习惯**而非单次失误。
**修一类错误要改习惯，不是改那一行。**

**AC-RESOLVE-003-06（pre-commit 的对应降级路径——R2 专家 B 第 3 条）**：

> 专家 B：*"pre-commit behavior when the generated resolution file is missing/stale is
> undefined — a single shared artifact means both gates fail identically or diverge
> silently."*

两个消费方的降级必须**对称且各自可测**（详见 AC-RESOLVE-004-02 的统一表）：

| hook | 生成物缺失 | 生成物陈旧 |
|------|-----------|-----------|
| `githooks/pre-push` | Gate M 记 SKIP（`details.skip_kind=missing`，**本设计新增字段**），其他 7 道门照跑 | 同左，`skip_kind=stale` |
| `githooks/pre-commit` | 既有行为是 FATAL（pre-commit 依赖范围更广，缺了无法安全运行） | 同缺失处理 |

**pre-commit 与 pre-push 的处置可以不同，但必须都是显式的、有测试的、写清理由的**。
「未定义」是最差选项——它意味着实际行为取决于运行时碰巧哪一行先炸。

**AC-RESOLVE-003-07（绑定上述分歧的测试——R2 第 2 轮专家 A 第 3 条）**：

> 专家 A：*"003-06 table is explicit but lacks the test that proves
> pre-commit FATAL vs pre-push SKIP divergence — the AC text says '有测试的'
> but no AC ID binds it."*

一个测试文件，两个 case，各自断言：

```js
// case 1: 生成物缺失（或陈旧）时跑 pre-push
assert(prePush.exitCode === 0);
assert(prePush.journal.gates.M.details.skip_kind === 'missing' /* 或 'stale' */);
assert(prePush.stdout contains 'other gates ran');        // 其他 7 道门确实跑了

// case 2: 同一 fixture 跑 pre-commit
assert(preCommit.exitCode !== 0);                          // FATAL
assert(preCommit.stderr contains 'hook-module-resolution.sh');
```

**这两个 case 必须在同一个测试文件里**——它们证明的是同一件事：
「一份共享生成物，两个消费方按各自约定的方式失败」。
拆到两个文件里，将来只改一个时不会发现另一个已经不一致。

### REQ-RESOLVE-004（存量安装的升级路径：陈旧生成物必须被识别）

> **新增 REQ**，来自第 2 轮评审：三位专家一致指出，v2 只为**新装用户**设计，
> 完全遗漏**存量用户**。核实属实——这是本设计最大的盲点。

**实测事实**（不是推测）：

```
grep -c "^_hook_resolve()" githooks/hook-module-resolution.sh  =  0
```

现有生成文件**只有 4 个 `HOOK_*` 常量，一个函数都没有**。而
`update-hooks.js` 的 `copyHooks` **不会重新生成**该文件（只在 install.sh 缺失时兜底生成）。

**后果链**（若不处理）：
1. 发布 v2 → 存量用户 `xp-gate update-hooks` → 拿到新 `pre-push`，source 旧生成文件
2. source **成功**（文件存在、语法合法），所以 AC-RESOLVE-001-02 的「文件缺失」路径**不会触发**
3. pre-push 调用 `_hook_resolve` → 命令不存在 → Gate M 崩坏或静默跳过
4. 这是最坏的失败形态：**source 成功但内容陈旧**，比文件缺失更难发现

**AC-RESOLVE-004-01（版本标记）**：生成文件带一个可机器读取的版本标记，
例如 `HOOK_RESOLUTION_SCHEMA=2`（本设计新增，由生成器写入，不在生成器输出之外手工维护）。

**AC-RESOLVE-004-02（运行时自检，对每个消费 hook 各一次）**：

> 第 3 轮专家 A/B/C 一致指出：v3 只写了 pre-push，但 **pre-commit 也 source 同一文件**。
> 同一根因、两个消费方，必须都有自检。

`githooks/pre-commit` 与 `githooks/pre-push` **各自**在 source 之后、使用之前，
检查三个函数是否可用（`declare -F _hook_resolve` 等）。不可用时**不静默**：

| 输出面 | 缺失（missing） | 陈旧（stale） |
|--------|----------------|---------------|
| stderr | `hook-module-resolution.sh not found` | `hook-module-resolution.sh is stale (missing _hook_resolve)` |
| `details.skip_reason`（既有） | `hook-module-resolution.sh could not be sourced` | `hook-module-resolution.sh is stale` |
| `details.skip_kind`（**新增**） | `missing` | `stale` |
| 退出码 | 0（其他 gate 照常运行） | 0（同上） |

> **第 3 轮专家 A 第 2 条**：「同一出口」让运维只能靠 reason 字符串区分。
> **`details.skip_kind` 本设计要新增，当前不存在。**（R2 第 8 轮三位专家一致指出，
> 这是「臆造字段」的第四实例：我在同一轮里刚坦诚这个毛病，紧接着又犯了。）

**实测现状（`githooks/pre-push:155`，逐字）**：

```bash
printf '%s
' "_m_details = {'skip_reason': '${GATE_M_SKIP_REASON:-}', 'duration_ms': '${M_DURATION_MS:-0}', 'mutation_score': '${M_SCORE:-}'}"
```

**只有 `skip_reason` / `duration_ms` / `mutation_score`，没有 `skip_kind`。**

**因此这是一条实现任务，不是对现状的描述**。BUILD 阶段必须做的改动（逐行写清）：

```bash
# pre-push:155 改为（新增 GATE_M_SKIP_KIND 变量并写入同一层）
printf '%s
' "_m_details = {'skip_reason': '${GATE_M_SKIP_REASON:-}', 'skip_kind': '${GATE_M_SKIP_KIND:-}', 'duration_ms': '${M_DURATION_MS:-0}', 'mutation_score': '${M_SCORE:-}'}"
```

并且**每一条设置 `GATE_M_SKIP_REASON` 的路径都必须同时设置 `GATE_M_SKIP_KIND`**（本设计新增变量），
否则 `skip_kind` 会在部分 SKIP 路径上为空字符串，而「空」既可能是
「没有 kind」也可能是「没设置」——又是同一个歧义问题。

实测的 `GATE_M_SKIP_REASON` 设置点共 7 处（`pre-push:549, 558, 564, 574, 591, 643, 650`），
逐字内容：

```
:549  GATE_M_SKIP_REASON="adapter-common.sh could not be sourced"
:558  GATE_M_SKIP_REASON="not a TypeScript project (package.json+tsconfig.json required)"
:564  GATE_M_SKIP_REASON="stryker config missing or @stryker-mutator not installed"
:574  GATE_M_SKIP_REASON="no changed TypeScript source files in this push"
:591  GATE_M_SKIP_REASON="gate-m.ts not found in .xp-gate/modules, src/mutation, or global modules"
:643  GATE_M_SKIP_REASON="mutation run exceeded the 600s timeout; score is unknown"
:650  GATE_M_SKIP_REASON="gate-m.ts exited $MUTATION_EXIT (unexpected); score is unknown"
```

**关键实测结论（回答了「单点改动能否覆盖全部 7 处」）**：

```
$ grep -n "_m_details = {" githooks/pre-push
155:    printf '%s
' "_m_details = {'skip_reason': '${GATE_M_SKIP_REASON:-}', ...}"
$ grep -c "report = {" githooks/pre-push
1
```

**_m_details 只有一处写入点（:155），且位于全部 7 处 reason 之前。**
所以「补 kind」只需改 :155 这一行的 printf 模板，
**7 处 reason 设置点则各自补一行 `GATE_M_SKIP_KIND=...`**（本设计新增，因为 kind 的取值不同：
前 5 类是 `missing`/`unsupported`/`no-input`，后 2 类是 `error`）。

**测试必须逐个覆盖这 7 条路径，而不是只测新增的 2 条**（missing / stale）——
只测新增的，等于证明新增的是对的、其余 5 条是空的。7 条路径与测试的对应：

| # | 行号 | kind 取值 | 触发方式（fixture） |
|---|------|-----------|--------------------|
| 1 | :549 | `missing` | 移除 adapter-common.sh |
| 2 | :558 | `unsupported` | 无 package.json/tsconfig.json |
| 3 | :564 | `unsupported` | 无 stryker 配置 |
| 4 | :574 | `no-input` | 推送中没有 TS 变更 |
| 5 | :591 | `missing` | 移除 gate-m.ts |
| 6 | :643 | `error` | 模拟 600s 超时 |
| 7 | :650 | `error` | 让 gate-m.ts 非期望退出 |
> 「同一出口」的意图保留（同一根因不该表现为截然不同的行为），
> 但用结构化字段而非字符串匹配区分——字符串匹配会在文案改动时静默失效。

**AC-RESOLVE-004-03（陈旧 fixture 行为测试，两个 hook 各跑一次）**：

> 第 5 轮专家 C：*"不出现 `_hook_resolve: command not found` 是负向 grep——
> 本评审流程自己在 v1 就否定过的最弱形式。需加正向断言：自检分支确实执行。"*
> 接受。

构造一个**不含函数段的旧版生成文件**（即当前真实内容的快照），
分别放入 fixture 的 `pre-push` 与 `pre-commit` 运行环境。

**正向断言（主证据：自检分支真的执行了）**：

```bash
// 自检在任何 gate 运行之前就把结论写进 journal
assert journal.gates.M.details.skip_kind == "stale"   // 字段存在且值正确
assert journal.gates.M.details.skip_reason == "hook-module-resolution.sh is stale"
assert exit_code == 0
```

**辅助断言（排除「靠 bash 报错兜底」这一错误实现）**：

```bash
assert stderr does NOT contain "_hook_resolve: command not found"
```

这条辅助断言的**作用方向要写清楚**：它不能证明自检有效，
只能排除「没自检、直接调用、被 bash 报错」这个错误实现。
正向证据是 journal 字段。

### AC-RESOLVE-004-08（生成器同时产出 schema 与函数：REQ-003/004 的交互）

> **第 5 轮专家 A 补充**：无 AC 断言**生成器**同时产出 `HOOK_RESOLUTION_SCHEMA=2`（本设计新增常量）
> 与三个函数；schema 与函数存在性可能各自漂移。

断言：对生成器的输出做一次**联合**检查——同一个文件里
既有 `HOOK_RESOLUTION_SCHEMA=2`（本设计新增），又有三个函数定义：

```js
const out = fs.readFileSync('githooks/hook-module-resolution.sh', 'utf8');
expect(out).toMatch(/^HOOK_RESOLUTION_SCHEMA=2$/m);
for (const fn of ['_hook_tier_base', '_hook_resolve', '_hook_resolve_dir']) {
  expect(out).toContain(`${fn}()`);
}
```

这条把 REQ-RESOLVE-003（单一实现）与 REQ-RESOLVE-004（版本标记）绑在同一个谓词上，
两者不能各自演化。

**AC-RESOLVE-004-04a（发布链路完整性——v3 未发现的更严重缺口）**：

> 第 3 轮专家 B 的关键批评：*"if update-hooks is the documented upgrade command,
> the AC as written can pass via install.sh while the real user path stays broken."*

**实测事实**：
- `README.md:179` 明确 `xp-gate update-hooks` 是文档里的升级命令
- `copyHooks` 从 `HOOK_FILES` 复制 `hook-module-resolution.sh`——复制的是**包里那份生成物**
- 而 `src/npm-package/package.json` 的 `prepack` 是
  `check-mattpocock-license.cjs && sync-package-content.js`，
  **`sync-package-content.js` 不重新生成 `hook-module-resolution.sh`**

于是：开发者改了生成器却忘了手动重生成 → **发布出去的包里是旧文件**，
而 `--check` 只在仓库内执行过 → 「AC 全绿但真实用户路径坏掉」。

**AC-RESOLVE-004-04a**：`prepack` 必须先执行 `node scripts/generate-hook-resolution.cjs`
再打包。断言：从干净 checkout 删除该生成文件 → `npm pack --dry-run`
→ 断言 tarball 内 `hooks/hook-module-resolution.sh` 含函数段
（`grep -c '^_hook_resolve()' >= 1`）。

**AC-RESOLVE-004-04b（真实升级命令确实修复）**：从陈旧 fixture 执行
**`xp-gate update-hooks`**（文档命令，不是 install.sh），
断言部署文件被替换为含函数段的新版且后续解析正常。
install.sh 的兜底生成路径单独由 AC-RESOLVE-002-03 覆盖。

**AC-RESOLVE-004-05（单一谓词，含换行规范化说明）**：

> 第 3 轮专家 B：*"逐字节相同 **或** --check — dual-mode acceptance is not a single
> mechanical predicate."* 正确，「或」不是谓词。
> 第 4 轮专家 C 第 3 条补充：裸 `readFileSync` 相等会因为部署步骤带来的
> 尾随换行或 CRLF 差异**虚假失败**。

```js
// 逐字节相等是目标。规范化规则必须精确，不能让「零尾换行」与「一个尾换行」
// 被判为相等——那是真实的字节差异（第 5 轮专家 A 指出原 norm 有此漏洞）。
//
// 正确做法：先断言尾部至多一个换行，再做严格字节比较。
// 不规范化 CRLF：部署改了行尾是 #546 类真缺陷，必须失败。
const deployed = readFileSync(deployedPath, 'utf8');
const generated = readFileSync(generatedPath, 'utf8');
assert(!/\n\n$/.test(deployed));            // 尾部至多一个换行（多于一个是缺陷）
assert(deployed.endsWith('\n'));            // 生成器总是以单个换行结尾
assert(deployed === generated);             // 严格字节相等，无任何折叠
```

不提供 `--check` 作为替代路径。若部署步骤改动了行尾或尾换行数量，此断言失败——
那是**应该**失败的情况（#546 已证明 CRLF 会让 bash 无法解析 hook）。

**AC-DEPLOY-002-02 的补充断言（显式注入缝隙，明确可实现）**：

> 第 4 轮专家 C 第 4 条指出「未断言枚举器真的读冻结清单」；
> 第 5 轮专家 A 与 C 进一步指出：**替换一个 `Object.freeze` 的导出常量可能不可实现**（本设计新增常量），
> 机制未指定。这个质疑是对的——依赖「`module.exports.X = ...` 能改」是隐式约定（本设计新增机制），
> 会随打包方式变化而失效。

**改为显式函数参数注入**：枚举器接受可选参数，默认值即导出的常量。

```js
// 实现（deploy-manifest.js）
function enumerateUndeclared(ignoredNames = NON_DEPLOYABLE) { /* ... */ }

// 测试：正反两向断言
const withExtra = enumerateUndeclared([...NON_DEPLOYABLE, 'fixture-only-ignored.txt']);
assert(withExtra does NOT report 'fixture-only-ignored.txt');   // 传了就忽略
assert(enumerateUndeclared() DOES report 'fixture-only-ignored.txt'); // 没传就报告
```

**正反两向缺一不可**：只测「传了就忽略」，一个恒定忽略所有文件的实现也能通过；
加上「不传就报告」才证明该参数真的在起作用。

`Object.isFrozen(NON_DEPLOYABLE)`（本设计新增常量）与字面量相等断言保留，防常量本身漂移，
但**不再依赖「能否替换导出」这种未定义行为**。

测试自身必须在临时 fixture 中运行，不得依赖当前目录恰好有什么文件。

**AC-RESOLVE-004-06（生成先于执行，行号断言）**：

> 第 3 轮专家 A 第 3 条：AC-06 未给可机械验证的断言形式。

读 `src/npm-package/hooks/install.sh`，定位生成调用行号与
`for gate in "${DEPLOY_GATE_FILES[@]}"` 行号，断言 `generate_line < copy_loop_line`。

**AC-RESOLVE-004-07（永久陈旧的暴露，来自专家 C）**：

> 专家 C：*"用户完全不跑 update 无覆盖：陈旧文件 + 运行时自检 = 永久 SKIP Gate M，
> 无告警升级路径。"*

`update-hooks` / `install.sh` 在任何调用中发现现存生成文件
`HOOK_RESOLUTION_SCHEMA < 2` 时，必须向 stderr 输出升级提示并含具体命令。
fixture：预置 schema=1 的文件，跑 update-hooks，断言 stderr 含该提示串。

**AC-RESOLVE-004-10（升级后与全新安装行为等价——v13 新增）**：

> R2 第 7 轮三位专家一致指出：现有 9 条 AC 只证明了「旧文件无函数」「可以被更新」，
> **从未证明升级后的解析结果与全新安装一致**。
> 专家 B：*"现有条目只证旧文件无函数/可升级，未证行为等价。"*
> 专家 C：*"none assert that the upgraded resolution result on a legacy fixture equals
> the result of a fresh project-first install on the same tree."*

**等价性是升级路径的全部意义**：如果升级后的行为与新装不同，那升级只是把
「缺文件」换成了「有文件但行为不同」——更难发现。

```js
// fixture：一棵同时含全局版与项目版 adapter-common.sh 的目录树
//            + 现有的旧生成物（实测：4 个 HOOK_* 常量、零个函数）
//
// 路径 A（升级）：放旧生成物 → 跑 update-hooks → 调用 _hook_resolve('project', ...)
// 路径 B（新装）：清空 → 跑全新 install → 调用同一个 _hook_resolve('project', ...)
//
// 断言：两条路径的解析结果逐字段相等
assert.deepEqual(upgraded.resolve('project'), freshInstall.resolve('project'));
assert.deepEqual(upgraded.resolve('global'),  freshInstall.resolve('global'));
assert.deepEqual(upgraded.resolve('script'),  freshInstall.resolve('script'));

```

**关于「项目版优先」这条语义怎么断言（R2 第 8 轮专家 C）**：

> 专家 C：*"AC asserts `upgraded.resolve('project') === path.join(PROJECT_GITHOOKS,
> 'adapter-common.sh')` — a concrete path constant that appears nowhere in any quoted
> measurement... this is precisely 'asserting a value I did not measure'."*

**接受。** 我不该硬编码一个没实测过的绝对路径拼接。改为断言**不变量**而非**具体值**：

```js
// 用「哪个文件被选中」而不是「拼出来的绝对路径是什么」来表达 project-first
// fixture 里三个 tier 各放一份内容不同的 adapter-common.sh，用内容区分
const resolvedPath = upgraded.resolve('project');
const contentMarker = readFileSync(resolvedPath, 'utf8').match(/TIER_MARKER=(\w+)/)[1];

assert(contentMarker === 'PROJECT');        // 选中了项目版 —— 这才是要断言的语义
assert(upgraded.resolve('project') === fresh.resolve('project'));  // 且与新装一致
```

**为什么这样更好**：`path.join(PROJECT_GITHOOKS, 'adapter-common.sh')` 断言的是
「路径字符串怎么拼」，那是实现细节；`contentMarker === 'PROJECT'` 断言的是
「选中的是不是项目版」，那是需求本身。**前者改动就会红，后者只有语义错了才红。**

**为什么三个 tier 都要断言**：只比 `project` 一项，无法区分
「三个 tier 都对」与「恰好 project 对、其余都是默认值」。
旧的 global-first 实现正是在 `project` 上碰巧给出正确答案（当全局未安装时），
而在 `global` 上给出错误答案——**只测 project 会漏掉 PC-1 这个原始缺陷本身**。

### REQ-DEPLOY-002（清单完整性：一个都不能漏）

三份部署清单（`HOOK_FILES` / `GATE_FILES` 均实测来自 `src/npm-package/lib/deploy-manifest.js`；`MODULE_FILES` 本设计新增）合为一个可枚举的完整集合，
并加「包内 hooks/ 下每个文件都必须被某份清单声明」的断言。

**AC-DEPLOY-002-01**：`deploy-manifest.js` 导出 `ALL_DEPLOYED_FILES`（三份清单并集，无重复）。

**AC-DEPLOY-002-02（核心，含排除策略与跨平台防护）**：遍历 `src/npm-package/hooks/`
（递归），断言每个文件出现在并集中。**排除策略必须是显式、最小、且自身被测试钉住的**：

> R2 三位专家一致指出：递归枚举需处理符号链接循环、大小写、Windows 路径分隔符。
> 这些在 Windows CI 上是真实故障源，不是理论风险。

**遍历规则（必须写进实现）**：

```js
// 1. 不跟随符号链接（防循环导致无限递归）
//    用 fs.readdirSync(dir, { withFileTypes: true }) + isSymbolicLink() 跳过
//    不用会跟随链接的递归库
// 2. 路径统一转成 POSIX 分隔符再比对（Windows 上 path.join 产出 '\\'）
const normalize = p => p.split(path.sep).join('/');
// 3. 大小写：不做归一化。hooks/ 下全是小写文件名；
//    若出现大写变体，那是真实异常，应当报告而不是被归一化抹掉
//    （与 AC-DEPLOY-003-04 拒绝规范化 CRLF 同理）
// 4. 深度上限 8 层，超出即报错（防御性，不是正常路径）
```

另加断言：`hooks/` 下**不存在符号链接**（若存在，测试直接失败并指出路径）——
部署清单语义对 symlink 没有定义，静默跳过比失败更危险。

```js
// 允许的非部署文件（完整清单，不允许多）
const NON_DEPLOYABLE = Object.freeze([
  '.gitkeep',      // 占位
  '.DS_Store',     // macOS 元数据
]);
```

匹配规则：基名精确匹配上表，**或**匹配 `*.swp` / `*.tmp` / `*.bak`（编辑器临时文件）。
除此外**任何**文件未声明即失败。

**排除清单自身的钉住方式（第 2 轮专家 A 指出此处不可验证，已具体化）**：

```js
// 测试断言：这份清单必须与一个期望字面量完全相等。
// 想加一条排除，必须先改这个测试里的字面量——
// 那是一次显式的、会被 review 看到的动作，而不是运行时的 ad-hoc ignore。
expect([...NON_DEPLOYABLE]).toEqual(['.gitkeep', '.DS_Store']);
expect(Object.isFrozen(NON_DEPLOYABLE)).toBe(true);
```

即：排除清单的变更**必然**表现为一个测试文件的 diff，评审可见。
这是「防止 ad-hoc ignore 回归」的机械形式——不是靠纪律，是靠改动必须落到一个被断言的字面量上。

> **第 3 轮专家 A 第 4 条**：原稿「断言每项在真实 hooks/ 中出现」对 `.gitkeep` / `.DS_Store`
> 不成立——`.DS_Store` 不会出现在提交的仓库里，`.gitkeep` 当前也不存在。
> 已改为：**每项在 fixture 中可构造出现**。测试在临时 fixture 里逐一创建这些文件，
> 断言枚举器正确跳过它们（即豁免真的生效），而不是断言它们在真实目录里存在。

测试自身必须在临时 fixture 中运行，不得依赖当前目录恰好有什么文件。

> 这条原则直接来自本次复盘：**上一 sprint 的 bug 正是一份「看起来对但漏了三个文件」的清单。**
> 评审补充的关键点：排除清单若不显式，执行者会临时 ad-hoc 加 ignore，
> 那就又变回了手写清单。

**AC-DEPLOY-002-03**：`adapter-common.sh`、`deploy-manifest.sh`、`install.sh` 三个文件
被显式声明并实际安装（`init --global` 后存在性验证）。

**AC-DEPLOY-002-04**：`lib/` 目录纳入枚举。注意 `lib/` **当前已能安装**，但靠的是
`shared-utils.js:84` 的硬编码路径而非清单。本条要求其内容出现在并集中。

**AC-DEPLOY-002-05（新增，来自评审）**：**声明 ≠ 安装。**
安装到临时目录后，断言 `ALL_DEPLOYED_FILES`（本设计新增的并集常量）中**每一项**都在目标目录存在。
只测「清单内容完整」而不测「清单的每一项真的被装上」，会留下
「清单对了但安装器没读它」的缺口。

### REQ-DEPLOY-003（项目级 init 生成默认架构配置）

**按用户决策：只做项目级，不做全局。**

`xp-gate init --core-only` / `--full`（走 `installLocal`）时，若项目根无
`.archlint.yaml` 且无 `architecture.yaml` 且无 `.architecture-skip`，
生成一份**最小可用**的 `.archlint.yaml`。

**AC-DEPLOY-003-01（行为）**：项目级 init 后，项目根出现 `.archlint.yaml`；
在该项目执行一次 gate 6（或完整 pre-commit），Gate 6 **不再输出**
`ARCHITECTURE CONFIG MISSING`。

**AC-DEPLOY-003-02（沙箱化 HOME，具体路径枚举）**：

> 第 5 轮专家 C：*"Recursive `$HOME` diff is environment-fragile (shell rc, concurrent
> processes); 'no new file matching archlint' is a negative assertion. Scope diff to a
> sandboxed `$HOME` fixture directory."* 完全正确——对真实 `$HOME` 做前后 diff
> 会被 shell rc、后台进程、浏览器缓存干扰，测试必然不稳定。

**做法**：在临时目录建一个**空 HOME fixture**，仅通过 `HOME=<fixture>` 环境变量
运行 `setupGlobal`，**不触碰真实 `$HOME`**。然后在该 fixture 内做断言。

**正向断言（主证据：安装确实发生了）**：

```js
// 全局安装确实写入了它该写的文件（证明 HOME 确实被使用了，
// 而不是因为路径解析失败才「没有新增」——后者是假绿）
assert(exists(`${homeFixture}/.config/xp-gate/hooks/pre-commit`));
assert(exists(`${homeFixture}/.config/xp-gate/hooks/hook-module-resolution.sh`));
```

**负向断言（辅助）**：以下路径在 fixture 内均不存在：

```
<homeFixture>/.archlint.yaml
<homeFixture>/.archlint.yml
<homeFixture>/.architecture.yaml
<homeFixture>/.config/archlint/
<homeFixture>/.config/archlint.yaml
```

外加对**该 fixture** 做安装前后递归文件清单 diff，断言无新增文件匹配
`archlint` 或 `architecture`。

**为什么正向断言不可省**：只写负向断言时，一个「`setupGlobal` 因路径 bug 什么都没写」
的实现会让所有负向断言全绿。正向断言把「没写配置」与「什么都没写」区分开。

**AC-DEPLOY-003-03**：已存在任一架构配置（`.archlint.yaml` / `architecture.yaml` /
`.architecture-skip`）时**不覆盖**，只打印提示。测试：预置一份内容不同的配置，
init 后断言内容未被修改。

> **这条 AC 原先建立在未实测的假设上**（R2 第 6 轮专家 A 第 3 条：
> *"REQ-DEPLOY-003 假设项目级 init 在「已有 .archlint.yaml」时不覆盖——
> 未实测 init 的写入语义（覆盖/跳过/报错）"*）。
> 说明：**「不覆盖」是本设计要新增的行为**（REQ-DEPLOY-003 的实现内容），
> 不是对现状的描述，所以没有"实测 init 当前语义"这一项——
> 当前 `installLocal` 根本不写 `.archlint.yaml`（`:504-510` 只做 hooks 安装）。
> 但「init 会不会碰别的文件」确实是个前提，已改为显式断言：
>
> ```js
> // 反证：init 不得修改任何已存在的架构相关文件
> const before = hashAll(['.archlint.yaml', 'architecture.yaml', '.architecture-skip']);
> await initLocal();
> const after = hashAll([...]);
> assert(deepEqual(before, after));
> ```

**AC-DEPLOY-003-08（生成的文件必须真的起到「存在性」作用——v12 新增）**：

> R2 第 6 轮专家 C 第 2 条：*"REQ-DEPLOY-003 假设 init 生成的默认架构配置能通过
> Gate 6 的存在性检查即「足够」。但 F 的推论已承认：空文件也过 Gate 6。
> init 生成的配置若不含任何规则，Gate 6 PASS 但架构检查为零。"*

这条批评表面上和 §3.4 的结论冲突（我们**故意**生成不含规则的文件），
**但实际上指向了一个我确实没写清的验收标准**：既然文件是空的，
那它的价值就**完全**来自 §3.4 列的三条（存在性前置条件、说明载体、将来可改）。
必须把「它的作用是什么」「它不做什么」都写成可断言的：

```js
// 1. 存在性作用成立：生成后 Gate 6 不再报缺失
//    字符串取自实测（githooks/pre-commit:4838，逐字）：
//      echo "❌ ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED"
assert(afterInitGate6 does NOT contain 'ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED');

// 2. 不冒充配置：除注释与空行外无任何内容
assert(nonCommentNonBlankLines.length === 0);

// 3. 说明载体作用成立
assert(content contains 'archlint detectors list');
assert(content matches /deliberately contains no configuration keys/i);
```

> **关于第 3 组断言（R2 第 7 轮专家 A 第 2 条）**：
> *"断言 init 输出含 'archlint detectors list' 与 /deliberately contains no
> configuration keys/i —— 这是你新设计的文案，非现有输出；断言的是自己刚写的字符串，
> 等于自证。"*
>
> **这条批评对「文案从哪来」是对的，但结论不成立**，理由要说清楚：
> 这两条断言的对象**本来就是本设计要新增的生成内容**，不是对既有输出的观测。
> 它属于**新增文案契约**（new contract），与「臆造既有 API」是两回事：
>
> | 类别 | 例子 | 断言的意义 |
> |------|------|-----------|
> | 臆造既有 API | `archlintStatus === 'PASS'`（v10） | **错误**——描述了不存在的现实 |
> | 新增文案契约 | `content contains 'archlint detectors list'` | **正确**——约束我们自己的产出 |
>
> 为避免混淆，**在实现时把这份文案定义为唯一来源常量**，
> 生成器与测试都从它读取（不是两处各写一份字符串）：
>
> ```js
> // src/npm-package/lib/arch-config-template.js —— 唯一来源
> const ARCH_CONFIG_TEMPLATE = '...';   // 生成器用
> module.exports = { ARCH_CONFIG_TEMPLATE };  // 测试从这里 import，不重写字面量
> ```

> **并把这一点写进 `init` 的输出**：安装时打印
> `archlint config: created .archlint.yaml (no rule overrides — archlint defaults apply)`。
> 用户不会因为看到一个文件就以为配置好了——**这正是「虚假安全感」的最后一环**：
> 文件在、Gate 绿、但没人说过它意味着什么。输出里说清楚，这一环就闭合了。

**AC-DEPLOY-003-04（行为验证，不维护规则清单）**：生成内容必须能被 archlint 实际执行。
验证方式：

- 用 fixture 项目（含一份真实源码）跑 `archlint` 对生成的配置，断言 **exit 0 且
  stderr/stdout 不含**封闭枚举中的任一字符串：

```js
const ARCHLINT_BAD_DIAGNOSTICS = Object.freeze([
  'unknown rule',
  'unrecognized',
  'did not validate',
]);
```

- **不维护「生效规则清单」**——那份清单本身会漂移，正是我们要消灭的形态
- 另加**金样快照**：生成的文件与一份 `__snapshots__` 比对，
  内容变更必须显式更新快照，强制人工确认

**AC-DEPLOY-003-05（v9 重写：生成的文件不得改变扫描结果，且断言本身必须非平凡）**：

> 演进过程：v7 用 `detectors list` 前后计数（恒真、零检验力）→
> v8 用单个 fixture 的 summary 相等（**仍可平凡通过**：若 fixture 只触发一个
> detector，其余 detector 两边都是 0，相等毫无意义）→
> v9 加**正控 + 非平凡守卫**。R2 第 3 轮三位专家一致指出了这个盲点。

```js
// 步骤 1（非平凡守卫）：先证明基线 fixture 真的能触发东西
//   否则后面的「相等」是 0 == 0，什么都证明不了
assert(withoutConfig.summary.files_analyzed >= 2);
assert(withoutConfig.summary.cyclic_dependencies >= 1);
assert(withoutConfig.summary.total_smells >= 1);

// 步骤 2（正式断言）：放入生成的 .archlint.yaml，逐字段比对全部 summary 字段
//   不是只比总数——逐字段才能发现「某个 detector 被单独关掉」
for (const field of ALL_SUMMARY_FIELDS_EXCEPT_GRADE) {
  assert(withConfig.summary[field] === withoutConfig.summary[field],
         `generated config changed ${field}`);
}

// 步骤 3（正控，证明这套比较有区分力）：
//   构造一个「确实改变行为」的对照组，断言我们的比较方法能发现差异。
//   实测可用：把 fixture 的 b.ts 改造成不再 import a.ts（消掉循环）
//   → cyclic_dependencies 从 1 变 0。断言：
assert(detectDifference(fixtureBrokenCycle) === true);
```

**正控为什么不可省**：一个「永远返回相等」的实现（比如两个路径都读错成同一个文件）
也能通过步骤 2。步骤 3 证明比较逻辑真的能区分两个不同输入——这正是 v7 犯的错的解药：
**先证明观测方法有检验力，再用它下结论**。

**为什么用 `summary` 而不是 `detectors list`**：`summary` 来自**真正执行的那次扫描**；
`detectors list` 是静态展示、不读配置，对「配置是否生效」零检验力。

**失败即 FAIL，不得 SKIP**（R2 专家 B 的 T-2）：输出无法解析成 JSON → **FAIL** 并打印
原始输出片段。只有 archlint 未安装才 SKIP，且必须写明 reason。

**AC-DEPLOY-003-06（不产生虚假安全感——正向 + 反向断言，v9 更新）**：

```js
// 正向：文件头必须说明「空」是刻意的，并给出证据与替代开关
assert(content matches /deliberately contains no configuration keys/i);
assert(content contains 'archlint detectors list');       // 说明它不读本文件
assert(content contains 'layers');                        // 说明为何不含 layers
assert(content contains '--detectors');                   // 指出真正有效的开关

// 反向：不得写死会随 archlint 版本漂移的字面量
assert(!/\b\d+\s+detectors\b/i.test(content));            // 不写死计数
assert(!/\b0\.\d+\.\d+\b/.test(content));                 // 不写死版本号

// 反向：不得出现任何配置键（v9 的核心：既然 rules:/ignore: 都无效，就一个都别写）
assert(!/^rules:/m.test(content));
assert(!/^ignore:/m.test(content));
```

最后两条是 v9 新增的关键反向断言：**既然实测证明 `rules:` 和 `ignore:` 都被静默忽略，
生成的文件里就不该出现它们**——出现即意味着我们又交付了一份看起来在配置、
实际什么都不做的文件。

**AC-DEPLOY-003-07（能力探测，不是失败断言——v10 重写）**：

> v9 的原版把「`ignore:` / `rules:` 无效」写成**通过条件**。
> R2 第 4 轮三位专家一致指出极性反了——专家 A：*"the test passes only while a bug
> exists. When archlint fixes `ignore:`, the suite goes red for a correct upstream
> change — that is noise, not signal, and it will be 'fixed' by deleting the test,
> losing the knowledge."*  完全正确，已改为**探测**。

```js
// probeArchlintConfigSupport() —— 不做断言，只回答三个问题
//   1. `ignore:` 是否生效？   （忽略掉构成循环的文件后，files_analyzed 是否下降）
//   2. `enabled:false` 是否生效？（关掉 cyclic_dependency 后该计数是否为 0）
//   3. `rules:` 是否改变检测器集合？
//
// 探测结果决定行为，而不是决定测试红绿：
const support = probeArchlintConfigSupport(fixture);

if (support.ignoreWorks || support.disableWorks) {
  // archlint 修好了 → 打印一条提示，指向模板注释，需人工决定是否简化模板
  console.warn(
    '[archlint] config keys now take effect (ignore:%s, disable:%s). ' +
    'The generated .archlint.yaml comment says they do not; ' +
    'consider simplifying init. See docs/plans/2026-11-10-resolve-p1c-design.md §3.4.',
    support.ignoreWorks, support.disableWorks);
}
// 测试在「archlint 支持或不支持」两种世界里都通过。
// 知识活在模板注释与这条 warning 里，不活在一条会腐烂的红灯里。
```

**为什么改成探测**：一条「只在别人有 bug 时才绿」的测试，最终命运是被删掉。
而它承载的知识（这些键不可靠）是真实的、需要保留的。
**把它变成 warning，绿灯不再骗人，知识也不会因红灯被误判为噪音而丢失。**

**实验 E（v10 新增，回答「只有注释的文件是否等价于无文件」）**：

> R2 第 4 轮专家 B：*"no experiment tests 'a comment-only .archlint.yaml exists'.
> If archlint 0.16.0 parses an empty file differently from no file
> (e.g. skips built-in defaults, errors, or changes the detector set),
> the template's 'honest empty file' premise is unverified."*

```js
// 已实测（含 fixture 副本重跑一次以排除环境噪声）：
const none       = runArchlint(fixtureWithoutConfig);
const commentOnly = runArchlint(fixtureWithCommentOnlyConfig);
for (const field of ALL_SUMMARY_FIELDS_EXCEPT_GRADE) {
  assert(commentOnly.summary[field] === none.summary[field]);
}
// 实测值：files_analyzed=2, cyclic_dependencies=1, total_smells=1 —— 两者完全一致
```

这条是**整个生成模板的前提**：若注释文件会改变 archlint 行为，
模板就该重新设计。实测证明不会。**它是本设计中唯一一条「先验证前提本身」的断言。**

**Gate 6 必须接受只有注释的配置文件（v11：已实测，不再断言）**：

> 三位专家一致追问：「若 Gate 6 的有效性判断要求文件里有某些键，
> 只有注释的文件会被判为『未配置』，v7 的失败模式会在 Gate 层重现」。
> 并且指出我原来写的 `archlintStatus === 'PASS'` **是臆造的字段名**，
> 属于「同一类未验证前提」。

**实验 F（读源码实测，`githooks/pre-commit:4376`）**：

```bash
if [ -f "$PROJECT_ROOT/architecture.yaml" ] \
   || [ -f "$PROJECT_ROOT/.architecturerc" ] \
   || [ -f "$PROJECT_ROOT/.archlint.yaml" ]; then
```

**Gate 6 的「配置是否有效」只看文件存在（`-f`），完全不解析内容。**
所以只有注释的 `.archlint.yaml` 会被正常接受。

**真实字段名**（`githooks/pre-commit` 内）：`GATE_6_STATUS`（`PASS`/`FAIL`）
与 `GATE_6_REASON`（`architecture_skip_exemption` / `mixed` / 各语言 skip 原因），实测来自 `githooks/pre-commit:4835`。
**不存在 `archlintStatus` 这个字段**——v10 写它是错的。

```js
// 断言用真实字段名：
assert(gate6.GATE_6_STATUS === 'PASS');
assert(!gate6.GATE_6_REASON);                     // PASS 时不带 skip reason
assert(stderr does NOT contain 'ARCHITECTURE CONFIG MISSING');
// 必须证明 archlint 真的跑了（而非「什么都没做所以没报错」）：
assert(gate6.stdout matches /archlint|Architecture/);
```

**必须绑一条「archlint 确实执行」的正向证据**（R2 第 5 轮专家 B 的关键提醒）：
只断言「不含 MISSING」在 archlint 未安装、Gate 6 提前 SKIP 时也会通过。
这正是平凡通过的老问题，在这个 AC 上重现了——现在补掉。

**这条 AC 的语义还有一个副作用，必须写明**：
既然 Gate 6 只看存在性，那么**用户随便放一个空文件也能过 Gate 6**。
这不是本 sprint 引入的（是既有行为），但它说明
「Gate 6 通过」从来就不等于「架构被检查了」。
这正是 §3.4 里 Gate 6 输出要打印实际扫描摘要的理由——
**存在性检查无法承载「检查了什么」的语义，只能靠输出补**。

> **注意**：这些测试会让 archlint 调用次数增加，而 archlint 在 Windows 上
> 每次约 15–60 秒（实测，个别 fixture 曾 >2 分钟超时）。
> **BUILD 阶段必须标记为慢测试**：本地默认跳过，CI 全跑。
> 这条不是建议——本轮设计取证就因此多次中断。

**能力探测结果必须落地成机器可读产物（v11，三位专家一致）**：

> 专家 C：*"`console.warn` does not solve the original problem — it converts a red
> signal into an easily-ignored line. CI logs are noisy; nobody triages warnings."*
> 专家 A：*"Emit to a machine-readable artifact ... so it's visible not ignorable."*

```js
// 探测结果写入 .archlint-probe.json（不是只打 warning）
{
  "archlint_version": "<实测版本>",
  "ignore_takes_effect": false,
  "disable_takes_effect": false,
  "probed_at": "<ISO timestamp>",
  "design_reference": "docs/plans/2026-11-10-resolve-p1c-design.md#34"
}
```

**一个非阻断的检查读它**：若 `ignore_takes_effect || disable_takes_effect` 为 true
（即 archlint 修好了），打出一条**显式**的提示并指向模板注释，
但不让主测试套件变红。这样知识存在文件里、可被脚本查询，而不是躺在日志里。

**探测本身必须可证伪（v11，专家 C 第 3 条）**：

> 专家 C：*"`probeArchlintConfigSupport` itself must parse archlint's output ...
> A false negative here silently disables the warning."*

探测不能靠字符串匹配，必须靠**可测量的输出变化**：

```js
// probe 的 fixture 必须含一个「该键本应抑制的违规」：
//   基线（无配置）           → cyclic_dependencies >= 1   ← 若为 0 说明 fixture 无效
//   加 ignore: [构成循环的文件] → 若 ignore 生效，该计数应降到 0
// 探测结论 = (抑制后计数 < 基线计数)
// 并先断言基线 >= 1，否则「没有可抑制的违规」会被误判为「键无效」
assert(baseline.cyclic_dependencies >= 1);   // fixture 非平凡守卫
const ignoreWorks = (withIgnore.cyclic_dependencies < baseline.cyclic_dependencies);
```

**正控必须覆盖 ≥2 个不同 summary 字段（v10 强化，R2 第 4 轮专家 C）**：

> 专家 C：*"Positive control only exercises the `cyclic_dependencies` field.
> The original bug was 'a config that disables a *different* detector would still pass.'
> A comparator that only checks one field passes the positive control
> while remaining blind to other fields."*

```js
// 正控 1：改 b.ts 去掉 import → cyclic_dependencies 1→0，total_smells 1→0
// 正控 2：改文件数量 → files_analyzed 2→3
// 两个正控必须命中**不同**字段，才证明比较器不是只在某一维上有分辨力
assert(detectDifference(ctrl1).changedFields.has('cyclic_dependencies'));
assert(detectDifference(ctrl2).changedFields.has('files_analyzed'));
assert(detectDifference(ctrl1).changedFields.size >= 2);  // 至少两个字段同时变化
```

**Gate 6 的输出要求（虚假安全感的正解）**：PASSED 时必须同时打印本次扫描的
实际结果摘要，**取自同一次扫描的 JSON 输出**：

```
Gate 6 PASSED — archlint: 13 findings-eligible detectors, 0 smells, 42 files
（数据来自本次 scan 的 summary，不是另跑一次 detectors list）
```

只打印 PASSED 而不说明覆盖范围，正是虚假安全感的来源。
**必须同一次调用取得**（R2 第 2 轮专家 A 第 2 条：分两次调用会产生
配置解析与执行之间的 TOCTOU）。

**SKIP 与 PASS 的机械区分**（第 3 轮专家 C 第 4 条：*"CI 中 SKIP 与 PASS 的区分
需机械定义（退出码? journal 字段?），否则 gate 12b 无法接线"*）：

| 状态 | 退出码 | journal 字段 | 可接线 |
|------|--------|--------------|--------|
| PASS | 0 | `ARCHLINT_STATUS=PASS` + `ARCHLINT_DETECTORS=<N>`（均为本设计新增字段） | gate-coverage 记 PASS |
| SKIP（archlint 不可用） | 0 | `ARCHLINT_STATUS=SKIPPED` + `ARCHLINT_SKIP_REASON=<原因>`（本设计新增） | gate-coverage 记 **SKIP**（非 PASS） |
| FAIL（真跑失败） | 1 | `ARCHLINT_STATUS=FAIL`（本设计新增） | BLOCK |

断言「字段存在且取值正确」，而非仅断言退出码——只测退出码会把
「没跑」和「跑过了」混为一谈，这正是 gate-coverage 四态设计要解决的问题。
**金样快照不依赖 archlint，始终必须通过**（archlint 缺失时它仍是唯一有效断言）。

---

## 3. 设计与取舍

### 3.1 三个解析函数：由生成器产出，不内联复制（v2 修正）

**v1 的设计是错的。** 我原本主张 pre-push 内联 `_hook_tier_base` / `_hook_resolve` /
`_hook_resolve_dir` 三个函数（约 60 行），理由是「多一个 source 依赖就多一个失败面」。
三位评审专家一致指出这个理由不充分，专家 B 说得最准：

> *"Trade A duplicates ~60 lines of resolve logic in two installed files; nothing prevents
> the two copies from diverging — the exact 'global-first vs project-first' bug this sprint
> fixes, reborn as drift."*

他是对的。**本 sprint 的全部目的就是消灭「同一份解析顺序被写两遍」，而我的方案会造出第二个副本。**
60 行重复在 6 个月后必然漂移，届时 bug 形态与今天一模一样。

**修正方案**：三个函数由 `scripts/generate-hook-resolution.cjs` **一并生成**到
`githooks/hook-module-resolution.sh`，pre-commit 与 pre-push 都 **source 同一个生成文件**。

- 生成器已存在并已生成该文件（第 21 行 `TARGET`），只需增加函数段
- pre-commit 已经在 source 它（用于 `HOOK_*_TIERS`），无需改动 source 逻辑
- pre-push 新增 source，与 pre-commit 用**同一份**函数实现
- 漂移在物理上不可能：只有一份实现，且是生成物

这同时满足原本的担忧：生成文件已随 `HOOK_FILES` 安装（`hook-module-resolution.sh`
就在清单里），不存在「新增一个部署单元」的问题——**它本来就在**。

新增 AC 见 REQ-RESOLVE-003。

### 3.2 生成表缺失时 pre-push 的行为

pre-commit 的选择是 FATAL 退出（「运行在没有解析顺序的世界里，hook 找不到自己的依赖」）。
pre-push 采用同样策略，但**只对 Gate M 降级为 SKIP 而非整个 push 失败**：
pre-push 有 8 道门，用一道门的依赖缺失阻断整次 push 会误伤其他 7 道。

**决定**：生成表缺失 → Gate M 记 SKIP 并写明 reason（沿用既有的 `GATE_M_SKIP_REASON` 机制，实测见 `githooks/pre-push:155`），
其他门照常运行。这与 hook 现有「工具缺失 → SKIP 不 BLOCK」的约定一致
（Gate 8 除外，安全门 fail-closed）。**但**：不得静默——reason 必须写进 journal。

具体到可验证形式（回应评审「如实报错不可验证」）：

| 项 | 值 |
|----|-----|
| stderr 子串 | `hook-module-resolution.sh not found` 与 `Gate M skipped` |
| journal `GATE_M_SKIP_REASON` | 精确等于 `hook-module-resolution.sh could not be sourced` |
| 退出码 | 其他 gate 全通过时为 0（不阻断 push） |
| 反向断言 | **不得**出现 `ADAPTER_DIR="$SCRIPT_DIR"` 之类的静默退化（那会让「找不到」和「找到但版本错」不可区分） |

### 3.3 清单完整性断言的形式

关键设计点：断言必须**枚举目录**，而不是枚举一份期望清单。
枚举期望清单是「再写一遍清单」，漏文件时同样漏。

```
正确：for f in readdir(hooks/, recursive): assert f in ALL_DEPLOYED_FILES
错误：assert ALL_DEPLOYED_FILES == [...手写的12个...]   ← 漏了照样绿
```

这条原则直接来自本次复盘：**上一 sprint 的 bug 正是一份「看起来对但漏了三个文件」的清单。**

### 3.4 架构配置生成内容的边界（v9：`rules:` 与 `ignore:` 都被实测证明不可靠）

> 这一节记录两次自我纠错。**结论是：gen 出来的 `.archlint.yaml` 必须是空配置（仅注释）。**

**实验证据**（同一份 fixture：`src/a.ts` ↔ `src/b.ts` 循环 import，archlint 0.16.0）：

| 实验 | `.archlint.yaml` | `files_analyzed` | `cyclic_dependencies` | `total_smells` |
|------|------------------|------------------|----------------------|----------------|
| A | 无配置 | 2 | 1 | 1 |
| B | `rules: { code_clone: { enabled: true } }` | 2 | 1 | 1 |
| C | `rules: { cyclic_dependency: { enabled: false } }` | 2 | **1** | **1** |
| D | `ignore: ["src/b.ts"]` | **2** | **1** | **1** |

**四项结论**：

1. `rules:` 块**不影响检测器启用集合**（B 与 A 的 15 个 summary 字段逐一对齐，0 差异）
2. 显式 `enabled: false` **被静默忽略**（C 仍报出 1 个循环依赖）
3. `ignore:` 块**同样被静默忽略**（D 把 `src/b.ts` 列入忽略，`files_analyzed` 仍是 2，
   循环依赖仍是 1）—— 这一条由 R2 第 3 轮专家 B 质疑、v9 实测确认
4. `archlint detectors list` **不加载项目配置**（任何配置下都返回 13 enabled）

**这三条合起来意味着**：**本仓库现有 `.archlint.yaml` 里的 `ignore:` 和
`rules.exclude:` 很可能也在被静默忽略**，包括它为了避开 mirror 重复而写的那一大串
排除项。这是一个独立的、既有的缺陷，**超出本 sprint 范围**，但必须记下来（见 §7 后续）。

**v9 的生成内容：只有注释，没有任何配置键**

```yaml
# archlint configuration — generated by `xp-gate init`
#
# This file deliberately contains no configuration keys.
#
# That is not an omission. Verified against archlint 0.16.0:
#   - listing detectors under `rules:` does NOT change which detectors run
#   - `enabled: false` is silently ignored
#   - `ignore:` entries are silently ignored
#   - `archlint detectors list` does not read this file
# So a hand-written rule or ignore list here would give the appearance of
# configuration while changing nothing. Keeping the file empty is honest.
#
# Deliberately NOT included: `layers:`. archlint does not execute a layers
# block, so generating one would teach a rule that never runs
# (see #686 / #690 / #692).
#
# To change archlint's behavior, use its CLI flags (`-d/--detectors`,
# `-e/--exclude-detectors`, `--all`) — those are verified to take effect.
```

> 注释里点明「`-d/--detectors` / `-e` 是已验证生效的开关」，
> 是因为我们用过它们（`-d` 出现在本仓与其他项目的调用里）；
> 不写这条，用户会以为这个工具无法配置。

**那这个文件还有什么用？** 三个作用，都不是「配置」：

1. Gate 6 的**存在性前置条件**（当前 `pre-commit:4838` 无文件即阻断提交）
2. 一个**说明载体**，把「别在这写规则，写了也不生效」讲给下一个人
3. 将来 archlint 修好这些键时，改这个文件的注释即可，不必改生成逻辑

**「虚假安全感」的真正解法是输出可见性**：

- Gate 6 在 PASSED 时打印**本次扫描的实际结果摘要**，数据取自
  **同一次调用的 JSON `summary`**，而不是另跑一次 `detectors list`。
- 这样「检查了什么」与「结果是什么」来自同一个观察，不可能彼此漂移。

**为什么不再声称「空配置检查得更多」**：v7 那个说法是错的（实验 B/C 已证伪）。
正确说法是：**空配置不假装自己配置了什么**。这个理由不需要任何 archlint 内部语义支撑。
   让「检查了什么」在安装那一刻就可见，而不是靠用户去翻配置。

**Gate 6 的对应改动**：Gate 6 输出中要写明本次实际运行的检测器数量，
不得只打印「PASSED」。一个不说明覆盖范围的 PASSED 正是虚假安全感的来源。

生成前探测 archlint 是否存在；不存在时**仍写文件**（纯 YAML，无工具也能被 Gate 6 读到），
但提示用户安装 archlint，并明确说明「未安装时本配置不产生任何检查」。

---

## 4. 发版硬门槛（本次 sprint 的验收标准）

用户决策：以下三条为**发版**的前置条件，本次不执行发版。

| # | 门槛 | 本 sprint 是否闭合 |
|---|------|-------------------|
| 1 | `HOOK_FILES ∪ GATE_FILES`（实测）`∪ MODULE_FILES`（本设计新增）覆盖 `hooks/` 全部文件，漏一个则测试红 | ✅ AC-DEPLOY-002-02 |
| 2 | `init --global` 后的全新项目能成功提交一次（端到端契约测试） | 部分：AC-DEPLOY-003-02 反证全局不写；门槛 2 的「能提交」依赖门槛 3 的项目级配置 |
| 3 | Gate 6 无配置时的行为合理：项目级 init 生成默认配置 | ✅ AC-DEPLOY-003-01/02/03/04 |

**门槛 2 的准确表述需要澄清**：`init --global` 是全局安装，项目侧配置本就该由项目级
`init --core-only` / `--full` 提供。所以端到端契约测试的正确形态是：

```
init --global（装工具链） → cd 新项目 → init --core-only（生成 .archlint.yaml） → git commit 成功
```

此形态纳入本 sprint 的验证。

---

## 5. 不做的事（明确边界）

- **不发版**（用户决策：三条硬门槛满足后另起 sprint 发版）
- **不做 P1-B / P1-D / P1-E / P1-F**（依赖链与风险，见 sprint-breakdown §3）
- **不重构 pre-push 的其他 7 道门**（只动 adapter-common 解析这一段）
- **不给全局安装写架构配置**（用户明确区分：架构配置是项目属性）
- **不在 pre-push 内联复制三个解析函数**（v1 的错误决定，v2 改为生成器产出单一实现）
- **不维护「archlint 生效规则清单」**（评审指出它会漂移；改为行为验证 + 金样快照）

---

## 5.1 v2 相对 v1 的实质修正（评审 5 轮 0% 后）

| v1 的问题 | v2 的改法 |
|-----------|-----------|
| 取舍 A：pre-push 内联 60 行解析函数 | **删除该取舍**。函数由生成器产出到已存在的 `hook-module-resolution.sh`，pre-commit/pre-push 共用一份（REQ-RESOLVE-003） |
| AC-01 是 grep 负向断言 | 改为行为断言：fixture 同时放两版 adapter，断言 source 到项目版 |
| AC-02「如实报错」不可验证 | 明确 stderr 子串 + journal reason 精确值 + 否定断言（无静默退化） |
| AC-DEPLOY-002-02 无排除策略 | 显式最小排除清单，且排除清单自身被测试钉住 |
| 缺「声明 ≠ 安装」 | 新增 AC-DEPLOY-002-05 |
| AC-DEPLOY-003-04 无验证机制 | 行为验证（真跑 archlint）+ 金样快照；明确 archlint 缺失时记 SKIP 不算 PASS |
| AC-DEPLOY-003-02「任何架构配置」范围模糊 | 枚举 5 条具体路径 + HOME 前后递归 diff |
| AC-RESOLVE-002-02「or equivalent guard」含糊 | 指明具体文件、具体函数，并加「守卫真的执行」的测试 |

## 5.2 v3 相对 v2 的实质修正（第 2 轮评审 5 轮 0% 后）

第 2 轮确认 v2 已解决首轮全部 8 条批评（专家 A: "genuinely addresses all eight
first-round criticisms"），但三位专家**同时**指出一个 v2 完全遗漏的维度：

| v2 的问题 | v3 的改法 |
|-----------|-----------|
| **遗漏存量用户**：只为新装设计，老安装的生成文件不含函数段，source 成功但调用失败 | 新增 **REQ-RESOLVE-004**（整个 REQ，6 条 AC）：版本标记 + 运行时 `declare -F` 自检 + 陈旧 fixture 行为测试 + 升级动作验证 + 安装后逐字节一致 + 生成先于执行 |
| `--check` 只保证仓库副本新鲜，不保证部署副本新鲜 | AC-RESOLVE-004-05：对**部署路径**跑一致性检查 |
| 排除清单自测不可机械验证 | AC-DEPLOY-002-02 具体化为「与期望字面量完全相等 + Object.isFrozen」 |
| `grep -c "^_hook_resolve()"` 漏掉 `function x()` 与缩进写法 | 改用 `grep -cE '^\s*(function\s+)?_hook_resolve\(\)'` |
| `--check` 的手改检测缺失败模式规格 | AC-RESOLVE-003-03 明确退出码 1 + stderr 子串 + fixture 测试 |

**这次暴露的方法论问题**（值得记下）：我连续两轮都在为「新装用户正确」而设计，
把「存量用户已经装了什么」当成背景而非约束。
**这正是本 sprint 要修的那类缺陷的同构版本**——pre-push 与 pre-commit 不一致，
本质也是「两个副本各自演化，没人检查它们是否还一致」。
存量安装与新设计之间，同样是一对必须显式对齐的副本。

## 5.3 v4 相对 v3 的实质修正（第 3 轮评审 5 轮 0% 后）

第 3 轮三位专家一致认为 v3 已闭合存量升级主路径（专家 A：「AC-01/02/03/04 构成完整闭环」），
剩余问题全部是**具体化**而非设计缺陷：

| v3 的问题 | v4 的改法 |
|-----------|-----------|
| 自检只写 pre-push，但 **pre-commit 也 source 同一文件** | AC-RESOLVE-004-02 改为「每个消费 hook 各一次」；AC-03 陈旧 fixture 两个 hook 各跑一次 |
| 「同一出口」只能靠 reason 字符串区分 missing/stale | 新增 `details.skip_kind`（missing\|stale），两值各有 fixture 断言 |
| AC-04 写「update-hooks **或** install.sh」——二者皆可 | 钉死为 `xp-gate update-hooks`（README 里的文档命令）；install.sh 兜底另由 AC-RESOLVE-002-03 覆盖 |
| **v3 未发现**：prepack 不重生成生成物 → 发布的包里是旧文件 | 新增 AC-RESOLVE-004-04a：prepack 先跑生成器 + 用 `npm pack --dry-run` 验证 tarball 内含量 |
| AC-05「逐字节相同 **或** --check」不是一个谓词 | 改为单一 `readFileSync` 字符串相等 |
| AC-06 未给可机械验证的断言形式 | 改为行号比较：`generate_line < copy_loop_line` |
| 「用户永不升级」只有症状没有暴露 | 新增 AC-RESOLVE-004-07：schema<2 时 upgrade hint 进 stderr |
| 排除清单「每项在真实 hooks/ 出现」对 `.DS_Store` 不成立 | 改为「每项在 fixture 中可构造出现且被正确跳过」 |
| archlint 的 SKIP 与 PASS 未机械区分 | 明确三元组：退出码 + `ARCHLINT_STATUS` 字段（本设计新增）值（PASS/SKIPPED/FAIL） |

**v3→v4 发现的真问题**：AC-RESOLVE-004-04a 是这三轮里最有价值的发现——
`prepack` 不重新生成生成物，意味着**即使所有 AC 都绿，发布出去的包仍可能是坏的**。
这个缺口在 v1/v2/v3 里都不可见，因为它不在「代码正确性」维度上，
而在「构建链路完整性」维度上。专家 B 用一句「the AC as written can pass via
install.sh while the real user path stays broken」把它逼了出来。

## 5.4 v5 相对 v4 的实质修正（第 4 轮评审 67% 后）

第 4 轮首次出现 APPROVED（专家 A/B 通过且无阻塞项，专家 C 持保留）。
专家 C 的 4 条具体化意见全部成立：

| v4 的问题 | v5 的改法 |
|-----------|-----------|
| AC-RESOLVE-001-02「无静默退化否定断言」未说明否定**什么** | 改写为 `assert stdout does NOT contain "PASSED - Gate M"` — 「静默算作通过」的可观察形态 |
| AC-RESOLVE-003-01「三函数可查到」未点名 | 逐个 `declare -F` 三个函数名，任一缺失独立失败 |
| AC-RESOLVE-004-05 裸 `readFileSync` 相等会被尾随换行/CRLF 虚假失败 | 只规范化**尾随换行**；**不**规范化 CRLF（行尾被改是 #546 类真缺陷，必须失败） |
| AC-DEPLOY-002-02 未断言枚举器真的读冻结清单（内联跳过也能过） | 新增：运行时替换导出的常量为额外条目，断言枚举器因此跳过同名 fixture 文件——内联硬编码则替换无效，测试失败 |

**专家 A 抓到的一个真实笔误**：我在发给评审的正文里把排除清单写成
`[' .gitkeep', '.DS_Store']`（`.gitkeep` 前多一个空格）。若该笔误进入代码，
`toEqual` 断言将永远失败。设计文档本身无误，但这提醒了一件事：
**评审材料与设计文档必须同源**，否则评审的是另一个东西。
今后提交评审时应直接引用文档内容，而不是在 prompt 里重打一遍。

## 5.5 v6 相对 v5 的实质修正（第 5 轮评审 0% 后）

第 5 轮专家 B 明确 APPROVED（confidence 9，无阻塞项），专家 A、C 各提出实质意见。
其中两条是**技术性质疑，不是措辞问题**，且都成立：

| v5 的问题 | v6 的改法 |
|-----------|-----------|
| 专家A+C：替换 `Object.freeze` 导出常量「可能不可实现」，机制未指定 | 改为**显式函数参数注入** `enumerateUndeclared(ignoredNames = NON_DEPLOYABLE)`，配**正反两向断言**（传了就忽略 / 不传就报告）。实测确认 `module.exports.X = ...` 确实可赋值，但那依赖未定义约定，不再使用 |
| 专家A：`norm` 把 `\n+$` 折叠成 `\n`，使「零尾换行」与「一个尾换行」判为相等，掩盖真实字节差异 | 去掉折叠。改为三条断言：尾部至多一个换行、以换行结尾、严格 `===` 相等 |
| 专家A：`stdout/stderr` 子串断言脆弱，应以 journal 结构化字段为主 | AC-RESOLVE-001-02 主/辅分层：journal 字段是主证据，文本是辅助 |
| 专家A/C：AC-RESOLVE-003-02「必须为 0」是负向断言，正则还漏写法 | 加**正向主证据**（生成文件确实定义三函数 + 两个 hook 能 source 到），负向降为辅助并扩充正则 |
| 专家A：REQ-003/004 无交互 AC，schema 与函数可能各自漂移 | 新增 AC-RESOLVE-004-08：同一文件里联合检查 schema 与三函数 |
| 专家C：AC-RESOLVE-004-03 的「不出现 command not found」是负向 grep | 加正向主证据（`details.skip_kind == "stale"`，本设计新增字段，在任何 gate 运行前写入），负向降为「排除错误实现」的辅助 |
| 专家C：AC-RESOLVE-001-02 消费者集合未枚举 | 显式枚举 `pre-commit` + `pre-push` 两个，各跑一次 |
| 专家C：`$HOME` 递归 diff 环境脆弱且是负向断言 | 改为**沙箱化 HOME fixture**，且加正向断言（全局安装确实写入它该写的文件） |
| 专家B（非阻塞）：AC-DEPLOY-003-04 的「之类」是开放式列表 | 钉死为 `ARCHLINT_BAD_DIAGNOSTICS`（本设计新增冻结常量） |
| 专家B（非阻塞）：AC-RESOLVE-001-04「仍能继续」未固定 | 精确为 exit 0 + `details` 中无 `skip_kind` 键 |

**五轮评审的净收获**（哪些是真问题，不是扯皮）：

1. **存量用户升级路径**（第 2 轮）——整个 REQ-RESOLVE-004，最大的盲点
2. **prepack 不重生成**（第 3 轮）——构建链路缺口，「AC 全绿但包是坏的」
3. **内联复制 60 行**（第 1 轮）——我原本会亲手重造要修的缺陷
4. **负向断言偏多**（多轮）——「没找到」不证明「行为对」
5. **冻结常量替换不可实现**（第 5 轮）——设计里写了测不出来的测试

这五条没有一条是我自己复查能发现的。评审的价值不在投票比例，在于逼出这些。

## 5.6 评审通过后的非阻塞待办（BUILD 阶段实现时确定）

第 6 轮 **100% 共识（2 轮，3/3 APPROVED）**。三位专家一致认为剩余项均非阻塞，
且都属于「BUILD 阶段用失败测试就能发现」而非「必须现在定清楚」。原样记下，不丢：

| 项 | 专家意见 | 归属 |
|----|----------|------|
| AC-RESOLVE-004-04a | `npm pack --dry-run` 的 tarball 解析依赖 npm 版本与 packlist 规则，「含函数段」需要固定一条提取命令 | BUILD：确定提取命令 |
| AC-DEPLOY-003-04 | 金样快照的更新策略未定（提交入库 vs 每次重生成；漂移如何处理） | BUILD：定策略 |
| AC-RESOLVE-004-06 | 行号断言 `generate_line < copy_loop_line` 对格式变化脆弱，结构化标记更稳 | BUILD：可改为结构标记 |
| AC-RESOLVE-002-02 | 「守卫真的执行」缺少可观察量，应绑定 journal 字段或 stderr 标记 | BUILD：定观测量 |
| AC-RESOLVE-004-02 | missing/stale 的 journal 字段值未在 AC 内联枚举（已在 §2 表格中） | BUILD：照表格实现 |
| AC-RESOLVE-001-01 | 「v1 实现下必然失败」是理由不是断言（AC-02 已覆盖可观察量） | 无需处理 |

**这些不写在这里的代价**：评审意见散落在对话里，BUILD 时想不起来。
写进设计文档，实现阶段按表逐条落地。

## 5.7 v7 相对 v6 的实质修正（R2 设计评审 5 轮 0% 后）

R2 三位专家一致 REQUEST_CHANGES，意见高度收敛。**其中最关键的一条直接推翻了我的技术前提。**

| R2 的问题 | v7 的改法 |
|-----------|-----------|
| **方案3 制造虚假安全感**：三位专家一致，专家 C 定级 Critical | 不只是改措辞——**实测后发现原方案比批评更糟**，见下 |
| 方案1：提交进 git 的生成物与生成器构成双副本，无漂移守卫 | 新增 AC-RESOLVE-003-05：`--check` 重生成并比对，本地测试 + CI 各跑一次 |
| 方案4/pre-commit：生成物缺失或陈旧时 pre-commit 行为未定义 | 新增 AC-RESOLVE-003-06：两消费方各给显式处置，可不同但必须明确且有测试 |
| 方案2：递归枚举缺 symlink/大小写/Windows 分隔符防护 | 写进 AC-DEPLOY-002-02 实现规则：不跟随 symlink、路径归一化、深度上限、断言无 symlink |

**方案 3 的实测反转（这轮最有价值的发现）**

专家说「生成 2 条规则的配置会让用户以为架构被检查了」。我去实测，结果更严重：

```
$ npx archlint detectors list
13 detectors ✅ enabled by default
18 detectors ❌ disabled by default
```

**写 `enabled: true` 的 2 条规则不会「多检查 2 条」，而是会把另外 11 个默认启用的
检测器关掉**——archlint 以配置为准，配置文件里列了规则就替换默认集。

也就是说：v6 方案不是「检查得少」，是**「主动关掉一半检查，还显示 PASSED」**。
这比不生成配置更危险，因为不生成时 Gate 6 至少会响亮地报错。

**修正**：生成**空配置 + 自述头部**（`ignore:` 只影响扫描范围，不影响检测器集合），
让 13 个默认检测器全部生效；文件头写明「空不是遗漏」；`init` 输出实际检测器数量；
Gate 6 PASSED 时必须一并打印检测器数量；新增 AC-DEPLOY-003-05 用
「配了配置后启用数 ≥ 没配置时」做机械化断言（以 archlint 自身输出为准，不维护规则清单）。

**方法论教训**：如果我只按评语把措辞改得更谨慎（写个免责注释），
就会交付一个「有注释但仍然关掉 11 个检查」的方案。
**评审给的是方向，实测才能给出正确解**——这次两者差了整整一个数量级。

## 5.8 v8 相对 v7 的实质修正（R2 第 2 轮评审 0% 后）

> **这一节记录的是一次我自己造成的错误，比 v7 的记录更重要。**

**v7 我向评审报告了一个「实测反转」**：说写 2 条 `enabled: true` 规则会关掉
另外 11 个默认检测器。三位专家中有两位接受了这个论证并在此基础上评审。

**v8 实测证明这个结论是错的。** 用同一份 fixture（`a.ts` ↔ `b.ts` 循环依赖）：

| 配置 | `cyclic_dependencies` | `total_smells` |
|------|----------------------|----------------|
| 空配置 | 1 | 1 |
| `code_clone: {enabled: true}` | 1 | 1 |
| `cyclic_dependency: {enabled: false}` | **1** | **1** |

15 个 summary 字段逐一对齐，**0 差异**。显式 `enabled: false` 也无效。
`archlint 0.16.0` 的 `rules:` 块不影响检测器启用集合。

**我错在哪里（两个独立的错误，必须分开记）**：

1. **用 `detectors list` 当证据，而它不读项目配置**。
   我在两个 fixture 里放了完全不同的配置，它都返回 13 —— 我当时把这理解为
   「默认集被保留」，实际是「这个命令根本不看配置」。
   **一个恒返回相同值的观测，对任何假设都没有检验力**，我当时没想到这一层。
   （这正是 R2 第 2 轮专家 B 的 T-1 批评。）
2. **从「13 个默认启用」跳到「写 2 条会关掉 11 个」，是一个没有验证的推断**。
   我把它写成了「实测发现」，但实测只做了第一步（数出 13），
   第二步（验证规则块是否影响启用集）根本没做。

**v8 的修正**：

| 项 | v7 | v8 |
|----|----|----|
| AC-DEPLOY-003-05 | `detectors list` 前后计数比较（恒真，零检验力） | 行为级：同 fixture 有无配置的 `summary` 逐字段相等 |
| AC-DEPLOY-003-06 | 断言文件含 `'13 detectors by default'`（绑死版本） | 正向断言 3 条 + **反向断言不含任何版本号/计数** |
| 生成模板 | 含 `archlint 0.16.0 enables 13 detectors by default` | 只给命令，不给数字与版本 |
| Gate 6 输出 | 另跑一次 `detectors list` 取计数（TOCTOU） | 取**同一次扫描** JSON 的 summary |
| 空配置的理由 | 「比规则清单检查得更多」（错） | 「不与 archlint 内部语义打赌；`rules:` 键语义已被实测证明不可靠」 |
| 对用户的说辞 | 承诺规则清单会关检查 | 如实说明「错误的 key 会被静默忽略」并给出证据编号 |

**这次错误的真正代价**：v7 那份论证写得很有说服力（有实证、有表格、有数字），
评审中两位专家接受了它。**如果我没有在 v8 主动重测，这个错误会直接进入 BUILD**，
最终交付一份基于错误前提的测试——那个测试永远绿，因为它测的是一个不存在的机制。

**对自己立的规矩**：将来凡是写「实测发现 X」，必须先回答
「我的观测方法能区分 X 与 not-X 吗」。`detectors list` 不能区分，
因为我无论怎么改配置它都返回同一个数。

## 5.9 v9 相对 v8 的实质修正（R2 第 3 轮评审 0% 后）

三位专家一致指出 v8 的核心 AC **仍可平凡通过**，并且专家 B 追出了第二个问题。
两条都成立：

| v8 的问题 | v9 的改法 |
|-----------|-----------|
| AC-DEPLOY-003-05 用单个 fixture，只触发 `cyclic_dependencies`，其余 detector 两边都是 0 ——「相等」是 `0 == 0` 的平凡结论 | 加**非平凡守卫**（先断言基线 `total_smells >= 1` 等）与**正控**（构造一个确实不同的输入，断言比较逻辑能发现差异） |
| **专家 B**：`ignore:` 从未被行为验证；若它和 `rules:` 一样被静默忽略，模板就是「看起来有保护、实际什么都没做」 | **实测确认它确实被忽略**（实验 D），据此把生成文件改为**不含任何配置键**，并新增 AC-DEPLOY-003-07 把「这些键无效」这件事本身钉住 |
| 生成模板仍含 `ignore:` 块 | 删除，只留注释 |

**实验 D 的意义超出本 sprint**：`ignore:` 被静默忽略意味着**本仓库现有
`.archlint.yaml` 里那一大串 `ignore:` 与 `rules.exclude:` 很可能从未生效**，
包括它为了避开 mirror 副本重复而写的排除项。这是一个既有的独立缺陷
（Code Clone 检测器可能一直在报 mirror 之间的重复），**不在本 sprint 处理**，
但必须记为后续项——见 §7。

**专家 B 关于「自我记录是否该留在设计文档」的意见（Q6）**：
他建议把自审内容移到 PR 描述或 postmortem，设计文档只留可证伪的 AC 与一行理由，
理由是「spec 里的叙述性自省会腐烂并被当成权威引用」。

**我部分采纳**：AC 与生成模板保持精简（只留正确结论），
但**这份记录保留**——因为本 sprint 的交付物是「架构整改设计」，
而这次错误的形态（用恒等观测当证据）与要修的缺陷同属一类：
**一个看起来在验证、实际什么都没验证的东西**。
删掉它，下一个维护者很可能重犯。将来若这份文档变长压垮可读性，
再拆分到 `docs/incidents/`，但不删除。

---

## 6. 风险

| 风险 | 缓解 |
|------|------|
| **生成配置改变既有检查结果** | 生成**不含任何配置键**的文件；AC-DEPLOY-003-05 用「非平凡守卫 + 正控 + summary 逐字段相等」 |
| **archlint 的 `rules:`/`ignore:` 语义不可靠**（v9 实测：两者都被静默忽略） | 生成文件不写这些键；AC-DEPLOY-003-07 把「当前版本下无效」这件事钉住，archlint 修好时测试会失败并提醒我们简化 |
| **本仓既有 `.archlint.yaml` 的排除项可能从未生效**（v9 实测推论） | **本 sprint 不处理**，记为 §7 后续项（需先确认 Code Clone 是否一直在报 mirror 重复） |
| archlint 在 Windows 上每次调用 15–60 秒（实测），新 AC 会增加调用次数 | BUILD 阶段把架构行为测试标记为慢测试，本地默认排除、CI 全跑 |
| **用户在 Gate M 长期 SKIP 而不自知**（R2 专家 A/B 均提） | `details.skip_kind`（置于既有 `details.skip_reason` 旁）；AC-RESOLVE-004-07 的 upgrade hint；连续 SKIP 由既有 `gate-coverage` 四态（PASS/DEBT/SKIP/FAIL）承接，不新造状态源 |
| 生成物与生成器漂移（R2 三位专家一致） | AC-RESOLVE-003-05：`--check` 比对，本地测试 + CI 各一处 |
| pre-commit 与 pre-push 降级行为不对称且未定义 | AC-RESOLVE-003-06/007：两方各给显式处置，且由**同一个测试文件的两个 case** 绑定 |
| 递归枚举在 Windows 上因分隔符/大小写/symlink 产生不稳定结果 | AC-DEPLOY-002-02 实现规则：不跟随 symlink、POSIX 归一化、深度上限 8、断言无 symlink |
| 生成器增加函数段后，Gate 12b 可能因内容变化误报 | 生成器改动后立即重生成；Gate 12b 失败信息已含修复命令 |
| pre-push 新增 source 依赖，安装时生成文件缺失则 Gate M 失效 | AC-RESOLVE-001-02 / 004-02 的 journal reason 断言；该文件本就在 `HOOK_FILES` 中 |
| 生成 `.archlint.yaml` 与用户已有配置冲突 | AC-DEPLOY-003-03：存在任一配置即不覆盖 |
| `hooks/lib/` 纳入并集后改变安装行为 | AC-DEPLOY-002-05 用安装后实际存在性断言；lib 本就已安装，不改变行为 |
| archlint 在 CI 不可用导致行为验证长期 SKIP | 金样快照不依赖 archlint，始终执行；SKIP 必须带 reason 且计入 gate-coverage 的 SKIP 态；AC-DEPLOY-003-05 在 archlint 缺失时同样记 SKIP 而非 PASS |
| 上一 sprint 教训：worktree 的 node_modules 是空壳导致 Gate 5 假绿 | 本 sprint 起跑前已建 junction，冒烟测试确认 7 tests 通过 |

**R2 评审指出的「改动面是否可控」**：本设计触及 6 个生产文件
（`githooks/pre-push`、`githooks/pre-commit`、`scripts/generate-hook-resolution.cjs`、
`githooks/hook-module-resolution.sh`（生成物）、`src/npm-package/lib/deploy-manifest.js`、
`src/npm-package/lib/init.js`）+ 1 个删除（顶层死副本）+ 测试。

改动面可控的关键理由：**pre-push 只动 adapter-common 解析这一段（约 60 行），
其余 7 道门不动**。把它当重构而不是重写，是这一条风险最低的做法。

---

## 7. 本 sprint 发现但**不处理**的问题（后续项）

设计过程中实测发现的独立缺陷。写在这里是因为它们比代码本身更容易丢。

| # | 发现 | 证据 | 为什么不现在修 |
|---|------|------|----------------|
| 7.1 | archlint 0.16.0 的 `rules:` 与 `ignore:` **两个键都被静默忽略** | §3.4 实验 C/D | 是 archlint 上游行为，不是本仓代码；本 sprint 只能绕开（生成空配置） |
| 7.2 | **本仓 `.archlint.yaml` 的排除项很可能从未生效**，包括为避开 mirror 副本重复而写的那一大串 | 由 7.1 推论 | 需先确认 Code Clone 是否一直在报 mirror 间的重复；若成立会是一个大噪音源，属独立排查 |
| 7.3 | `archlint detectors list` 不读项目配置 | §3.4 | 上游行为；已在设计中改为不用它做证据 |
| 7.4 | archlint 在 Windows 上单次调用 15–60 秒；`dist/` 等大目录下曾出现 >2 分钟超时 | 本设计取证过程 | 性能问题，需单独测量（按 `~/.dsh/AGENTS.md` 的六条性能规则做 ABBA） |
| 7.5 | `Gate 6` 无配置即阻断提交（`githooks/pre-commit:4838`），自 2026-05-04 起 | 已知 | 本 sprint 的 REQ-DEPLOY-003 正是它的解 |

> 7.1/7.2 值得单独开 issue：如果 `ignore:` 真的从未生效，那么
> 「Code Clone 检测器把 mirror 与源文件判为重复」这件事可能一直在发生，
> 而本仓的应对方式是**加更多 ignore**——加在一份不生效的配置里。

---


---

## 8. 本次设计过程的记录

六轮需求评审 + 四轮设计评审，收敛轨迹 0%/0%/0%/67%/0%/**100%**（R1）
与 0%/0%/0%/0%（R2，持续收敛中）。

设计过程中我自己犯的错误，以及一次**差点进入交付的错误结论**，
已单独记入：
[`docs/incidents/2026-11-10-identity-observation-as-evidence.md`](../incidents/2026-11-10-identity-observation-as-evidence.md)

一句话摘要：我曾把 `archlint detectors list` 的输出当作「配置是否生效」的证据，
但该命令不读项目配置、恒返回同一值。基于它得出的结论是错的，
差一点让一个**永远为真、什么都没验证**的测试进入 BUILD。

**之所以把这件事单独写下来而不是从设计文档里删掉**：
本 sprint 要修的缺陷（清单少了文件却看起来完整、两个 hook 各自解析却看起来一致）
与这个错误是**同一形态**——一个看起来在验证、实际什么都没验证的东西。
删掉它，下一个维护者很可能重犯。

详细判据见该 incident 文档的末节。

---

## 9. 反臆造机制（从纪律升级为脚本）

### 9.1 四次臆造与它们的共同形态

本设计过程中，我在**同一类错误**上栽了四次，每次都发生在自认为很小心的时候：

| # | 臆造内容 | 形态 | 被抓到的方式 |
|---|---------|------|-------------|
| 1 | `gate6.archlintStatus === 'PASS'` | 虚构了一个不存在的字段名 | R2 第 5 轮专家 A/B |
| 2 | summary 的 16 字段清单 | 跑过但**记错了自己跑出来的结果** | R2 第 6 轮专家 B |
| 3 | 「v11 清单多了 architecture_grade」 | **凭记忆描述自己的实测**，方向还反了 | R2 第 7 轮专家 B |
| 4 | `details.skip_kind` 写成既存事实 | 把自己要新增的字段说成现有的 | R2 第 8 轮三位专家 |

**共同形态**：把「我以为的」当成「我确认过的」。
每一次都写得很具体（有字段名、有表格、有代码），**具体性掩盖了无依据**。

### 9.2 为什么纪律不管用

第 1 次被抓到后我改了那一处；第 2、3、4 次仍然发生。
期间我并不缺乏警惕——恰恰相反，每次评审前我都反复自查。

**纪律失效的原因是可预见的**：自查用的是同一套记忆，而错误就出在记忆里。
**用记忆检查记忆，等于没检查。** 这正是本项目一直在修的缺陷形态：
一个看起来在验证、实际什么都没验证的东西。

### 9.3 机制：`scripts/check-design-evidence.cjs`

任何设计文档中断言了具体值的行，必须在同一段落内携带出处，否则 **exit 1**：

| 标记 | 含义 |
|------|------|
| `` `githooks/pre-push:155` `` | `file:line` 引用 |
| `` $ archlint --version `` 及其后原始输出 | 命令 + 输出 |
| `exit=0` | 捕获到的退出码 |
| `实测` | 明确标注为测量所得 |
| `本设计新增` / `本设计要新增` | 明确标注为设计决策 |
| `需实现` / `实现任务` | 明确标注为待实现 |

被检查的「具体值」包括：点号字段访问（`a.b.c`）、`ALL_CAPS_CONSTANT`、
`path.join(...)`、以及内联代码中的带引号输出串。

**fenced code block 若引导行提到了具体文件**（如「实测 `githooks/pre-push:155`：」），
块内所有值视为已引用——整段是从该文件抄来的，不需要逐行标注。

### 9.4 有效性实测

把这个脚本跑在本文档上：

```
$ node scripts/check-design-evidence.cjs docs/plans/2026-11-10-resolve-p1c-design.md
首版正则：  74 处 finding  → 大量误报（把真实源码引用块当成无出处）
修正正则后：24 处 finding  → 剩余确实都是真问题
```

剩余 24 处正是 `HOOK_ADAPTER_DIR_TIERS` / `skip_kind` / `GATE_M_SKIP_KIND` /
`ARCHLINT_EXPECTED_VERSION` 这类值——**它们本来就应该被标记为「新增」而不是陈述句**。

**脚本自身的测试证明它有区分力**（10/10 通过，`scripts/__tests__/check-design-evidence.test.cjs`）：

```
✔ fabrication 1 — invented field name in inline code       ← 必须被抓到
✔ fabrication 2 — field list with no provenance            ← 必须被抓到
✔ fabrication 4 — new field asserted as if existing        ← 必须被抓到
✔ file:line citation in the same paragraph                 ← 必须放行
✔ shell command plus captured exit code                    ← 必须放行
✔ explicit new-design marker                               ← 必须放行
✔ explicit implementation-task marker                      ← 必须放行
✔ fenced block introduced by a source file name → self-citing
✔ prose without inline code is not inspected
✔ every finding carries a line number
ℹ pass 10  fail 0
```

**写这个脚本时我同样犯了错，而且是被自己的测试抓出来的**：

| 错误 | 后果 | 怎么发现 |
|------|------|----------|
| 点号字段正则要求 ≥2 个点 | `gate6.archlintStatus`（1 个点）**抓不到**——恰好漏掉第 1 次臆造 | 测试「fabrication 1」失败 |
| `CITATION_PATTERNS` 含 `PASS` | 「PASS」是**被断言的值**，却成了「引用标记」，等于任何断言状态的行都自证 | 测试「fabrication 1」失败 |
| fence 索引算法错误 | 代码块内外判断全反 | 4 个测试同时失败 |
| 标记只在紧邻行生效 | 「本设计新增」在引言行、代码在 3 行后，够不到 | 测试「new-design marker」失败 |

**这四次都是「检查器自己没被检查」**——正是本项目一直在修的缺陷形态。
解法不是更小心，是**先写会失败的测试**。这一条现在是脚本的验收标准，不是建议。

脚本把「我自查过了」变成了「机器查过了」。

### 9.5 接入方式

```bash
node scripts/check-design-evidence.cjs docs/plans/*.md
```

- 本地：`npm test` 中的一个测试调用它（对 `docs/plans/` 下由本 sprint 新增的文档）
- CI：`.github/workflows/quality-gates.yml` 增加一步，与 AC 校验同一 job

> **脚本自己遵守本设计的原则**：宁可误报让人补一行标记，
> 也不要漏报让人以为查过了。误报的代价是加一行注释，漏报的代价是第 5 次臆造。

### 9.6 这条机制能防住什么、防不住什么

**能防住**：把未验证的值写成陈述句。这是四次臆造的共同入口。

**防不住 1 —— 把已验证的值记错**（第 2、3 次的形态）。
脚本只能检查「有没有标出处」，不能检查「标了出处的那句话是否忠于出处」。

**对它的补充措施**：凡是加了 `实测` 标记的值，出处必须包含
**原始输出**（不是复述），且原始输出要能让读者自己复现命令。
本文档的实验 A/B/C/D/E/H 都按这个格式写——贴命令、贴输出、贴退出码，不写转述。

**防不住 2 —— 散文里断言的测量值**（R2 第 10 轮专家 A 第 1 条）。
脚本只检查 `fenced block` 与 `inline code`，因此像「1609 行」「24 处 finding」
这类写在散文里的数字**不在检查范围内**。

> 专家 A 原话：*"it inspects only inline-code/field-access/const/path.join/
> quoted-output lines, so prose assertions of measured values are outside its scope…
> add one line stating the checker's scope so future authors don't over-trust it."*

**接受，并且明确写下这个边界**：本脚本检查的是
**「被断言为代码/字段/常量的值」**，不检查散文数字。
理由是散文数字的假阳性率极高（「3 条理由」「前 5 类」这类结构数字不是测量值），
一旦误报频繁，脚本就会被关掉——那才是真正的失效。
**散文里的测量值目前靠人工复核，这是已知缺口，不是已解决的问题。**

**防不住 3 —— `实测` 标记是自证的**（专家 A 第 2 条）。
作者可以只写「实测」而不给 `file:line` 或命令输出就通过。
**接受为残余风险**：`file:line` 和「命令+输出」两种标记也都被接受，
且本文档的实践是把两者与 `实测` 同时写出。若将来发现「只写实测不给出处」的滥用，
再把 `实测` 从可单独生效的标记降级为「必须与 `file:line` 或命令输出同时出现」。
