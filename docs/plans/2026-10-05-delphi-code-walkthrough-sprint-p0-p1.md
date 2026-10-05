# Delphi Code-Walkthrough 评审记录 — sprint/2026-10-03-p0-p1-gates

日期：2026-10-05 · 模式：`code-walkthrough` · 席位：g-glm-5.3-flash / g-qwen3.8-flash / g-deepseek-flash

## 结论

**未达 ≥90% 共识。** 最后一轮 2/3 APPROVED（architecture conf=7、technical conf=9、feasibility REQUEST_CHANGES conf=6）。

关键事实：**每一轮提出的真实缺陷都被修掉了**，共 8 个。剩余分歧集中在两类——「prompt 预算截断导致的不可审计」与「已被驳回/属既有设计属性」。

## 评审驱动的修复（按提出轮次）

| 轮 | 发现 | 处置 | commit |
|---|---|---|---|
| R5 | Gate 4 `if run_tsx; then` 把 exit 1（真实 error 违规）与 exit 2（工具故障）混为一谈，error 级违规走 SKIP 分支并打印 PASSED | 引入 0/1/2 三态退出码，四份 gate-4 全部改为 `-ge 2` 分支 | `040b796` |
| R7 | `mergeConfig` 只对 `rules` 深合并，`output`/`performance` 浅合并会丢兄弟默认值 | 新增 `mergeSection` | `ed0629c` |
| R7 | `git ls-files` 有 `maxBuffer` 无 `timeout`，卡死的 git 会挂住 pre-commit hook | 加 30s 上限；索引不可读时显式报错而非伪装成「无过期条目」 | `29554a1` |
| R9 | `isEntryStale` 有一行重复守卫（两个席位独立指出）；exit-code 新分支无任何测试守护 | 删重复行；补 5 个 BATS（对修复前代码 3/5 红，修复后 5/5 绿） | `87924a1` |
| R10 | 用法错误仍 `return 1`：空输出 + exit 1 被门禁读成「检查通过、零违规」，等于门禁空转 | 改为 exit 2；同步更新断言旧值的 `index.test.ts` | `13eb22e` |
| R10 | `$PRINCIPLES_FILES` 未加引号：含空格路径被拆成 3 个不存在的路径，Gate 4 打印 PASSED | 改用数组展开（同 `adapters/powershell.sh` 既有做法），实测 3→1 | `13eb22e` |

R5 那条是本轮评审最有价值的产出：它是上一个修复自身引入的漏洞，静态审查没看出来，交叉评审看出来了。

## 已驳回（附证据）

| 编号 | 主张 | 驳回依据 |
|---|---|---|
| FC-03 | `--apply` 会无条件清空 baseline | `boy-scout.ts:607` 的写入在显式 `--apply` 之后，默认 dry-run |
| FC-06(R7) | `isRuleEnabled` 首字母切分会误判 | 15 个 rule ID 均只含一个点，两个 group 名都存在；拼错的键实测无法禁用真实规则 |
| FC-08 | 256MiB `maxBuffer` 会 OOM | `maxBuffer` 是截断上限非预分配；实测 112KB 输出 → 堆增量 241KB |
| MC-03 | exit≥2 走 SKIP 使门禁「无告警地长期静默失效」 | 前提部分成立（126/127 确实归入 SKIP），但「无痕迹」不成立：`gate-4.sh:126` 已将 status 写入 audit 日志。且该 fail-open 是**全仓既有约定**——`gate-8.ts:73`、`gate-9.ts:65` 对任意非零退出都 SKIP，比本改动更宽松。建议的「SKIP 聚合监控」属功能请求，另案处理 |
| FC-06(R11) | `requested_model` 区分大小写而 `resolved_model` 不区分，不对称 | 这个不对称正是规范本身：AGENTS.md:203 原文为 "distinct trimmed requested model IDs" |
| FC-05 | DSH 插件 `delphi-run.ts` 作为第二个 producer 不写 `channel`，会被新校验拒绝 | 该文件全文无 `writeFile`，注释明确说只「整理成可写成证据的数据」；唯一写盘者是 `scripts/delphi-external-review.cjs`，它写 `channel` |

## Prompt 工程教训（影响结论可信度，需如实记录）

三个席位都是推理模型，在本机存在 prompt 体积上限：实测 `g-glm-5.3-flash` 40KB 成功（225s）、50KB 崩溃（305s，`0xC0000409` + libuv `UV_HANDLE_CLOSING` 断言，表现为 "Network error."）。

由此产生两类噪声，**都不是代码缺陷，而是我构造 prompt 的方式造成的**：

1. 早期把整份 240KB diff 塞进去 → 席位直接崩溃，误判为「模型不可用」。
2. 后期压缩到 25KB → 核心 hunk 被截断，席位花整轮报告「无法审计」。R10 尤其典型：架构席位预算 42KB，而按文件路径排序恰好把三份 gate-4 脚本（最重要的文件）切在了边界之外，它的抱怨是**准确的**。

修正：按重要性排序 + 每席位独立预算 + 显式列出任何因体积省略的文件。R11 三个席位全部正常完成。

## 待办

- 共识未达标，不得推送。要么继续迭代，要么由用户裁定是否以现有 2/3 + 全部真实缺陷已闭环为依据放行。
- `channel` 不变量目前仅靠约定维持（无测试防止未来 producer 漏写），值得补一条断言。
- SKIP 聚合监控（MC-03 建议）另开 issue。

---

# 追加：完整覆盖评审 Round 1 处置记录（2026-10-06）

上一节记录的是分片评审（R5–R11）的收尾状态：2/3 APPROVED、共识未达标、不得推送。
按用户裁定「当前分支跑一次完整覆盖评审」，在 `fix/p0-false-blocks-436-428` 上以
`--range origin/main..HEAD` 重跑了一次完整覆盖评审。Round 1 三席位：
technical **APPROVED**(conf 8)、feasibility **REQUEST_CHANGES**(conf 7)、architecture **REQUEST_CHANGES**(conf 7)。

三条意见逐条核对后处置如下。「已修」都给 commit 与验证；「已驳回」给可复现证据；「记录决定」说明为什么不改。

## 已修（本轮）

| 编号 | 缺陷 | commit |
|---|---|---|
| FC-06 | `pruneBaselineEntries` 无条件小写归一，在大小写敏感文件系统上把 `src/A.ts` 与 `src/a.ts` 当同一路径 | `28ac7dc` |
| FC-07 / MN-02 | runner-error 判别模式是 vitest 默认 reporter 的形态，却没有东西在版本漂移时报警 | `18df4fa` |
| FC-10 / FC-06(R11) | `requested_model` 大小写敏感而 `resolved_model` 不敏感——不对称是对的，但当时只是口头解释 | `18df4fa`（AC-423-08 把两种改法分别钉住） |
| FC-15 | `MAX_HANDROLLED_BLOCK_SITES = 3` 断言的是数量而非性质：新加一个合法 fallback 会红，vitest 分支自己手写 BLOCKED 反而能过 | `18df4fa` |
| MI-04 | Gate 4 把检查器报告固定写到 `/tmp/principles-output.json`，同机并发提交互相覆盖，一份干净运行能抹掉另一份的发现 | `c50d3ab` |
| FC-09 | hook 库的依赖完整性无断言：旧测试只抽查 6 个库里的 2 个，也没有规则阻止库文件 source 到安装目录之外 | `d1ff40a` |
| MI-01 | gate-4 注释声称「pre-commit 只有 `set -o pipefail`、没有 `set -e`」，并把它钉在 AC-454-08 上——而该测试不存在 | `d1ff40a` |
| MI-02 / FC-11 | `138d33e` 顺手把仓库默认 Delphi profile 改成个人网关 `whalecloud` | `38e03c9` |
| FC-16 | prompt 体积上限只写在本文档里，工具没有任何强制，下一次评审仍会用崩溃来重新发现它 | `df5521c` |
| FC-13 | `.warnings-baseline.json` 里 `config.ts:1`、`config-enforcement.test.ts:2` 两条是幽灵额度：两个文件今天实测 0 告警 | `876cc4e` |

## 已驳回（附可复现证据）

| 编号 | 主张 | 驳回依据 |
|---|---|---|
| MAJ-01 | 仓库根目录「被跟踪的」`.code-walkthrough-result.json` 缺 `channel`、且 commit/branch 指向别的分支 | 前提不成立：`git ls-files` 里没有该文件，`git check-ignore -v` 命中 `.gitignore:159`，取消跟踪正是本分支 `0189782` 做的事。文件确实以旧 HEAD 躺在工作区，但 Gate MW 要求 `commit == git rev-parse HEAD`，一份绑定 `208f8fa` 的证据不可能放行 `df5521c`；发布前由本轮评审重新生成 |
| FC-17 / FC-04 | 证据文件的 branch/commit 与评审 HEAD 不一致 | 与 MAJ-01 同源，且是机制正常工作的表现：不一致就是会被拒。本轮要求的是在最终 HEAD 上重新生成，而不是把旧文件改到匹配 |
| FC-05（前提部分） | 「未提供文档承诺的 `getEffectiveConfigFor`」 | 该函数存在（`src/principles/config.ts:393`），并有 AC-457-16 两条测试钉住「按 ruleId 报告真正生效的阈值」与「未知/畸形 ruleId 抛错而非回默认值」。残余部分（`Violation.effectiveThreshold`）见下方「记录的决定」 |
| FC-08 | `loadConfig` 对显式传入但缺失的 configPath 只 warn 后回退默认，等于 fail-open | 已在 `f992290` 修掉：`config.ts:166-171` 对 caller 命名的路径 `throw`，注释里点名 FC-08。今天的行为是 exit 2 → Gate 4 SKIP，不是「零违规」PASS |
| FC-12 | `.gitignore` 新增 `.cw-*` / `.adv-*` 等前缀过宽 | 该问题在 `0fb10a5` 里已经反转：前缀规则被删掉、验证期草稿统一收进 `.agent-tmp/`，理由就写在 `.gitignore:31-34` 的注释里（`.cw-*` 会吞掉恰以该前缀开头的正常文件）。当前 `.gitignore` 已无这些前缀 |
| FC-14 | 本 PR 新增的 `lib/sprint-gate-report.sh` 里 `local _out=… _field _detail _detail` 重复声明 | 属实，已在 `c5c68b8` 删掉：`grep -c '_detail _detail' githooks/lib/sprint-gate-report.sh` 现为 0 |

## 记录的决定（不改代码，但必须留下理由）

**FC-05 / MAJ-03 — `Violation` 上不追加 `effectiveThreshold`。**
设计文档曾承诺两件事：`getEffectiveConfigFor(ruleId)` 与 `Violation.effectiveThreshold`。前者已交付并有测试。
后者刻意不做：告警由 15 个规则模块 × 9 个语言适配器共同产出，把「本次生效阈值」塞进每条 `Violation`
需要在每个产出点透传一次，等于给同一个事实造第二个真值源——而 #457 要解决的恰恰是两个真值源
（`Rule.threshold` 快照 vs 运行时生效值）互相说谎。消费方要生效阈值时，正确入口是
`getEffectiveConfigFor(violation.ruleId)`：一次查表，永远与 `check()` 读同一份 `activeConfig`。
代价说清楚：这个约定仍然只靠文档与 JSDoc 维持，`Rule.threshold` 的类型也仍然是普通 `number`，
所以「按 `rule.threshold` 判断」在类型层面依然不会被拦下。把它彻底封死需要把 `Rule` 的默认值与
生效值拆成两个类型，属独立重构，另案。

**MAJ-02 — Gate 4 三份副本暂不抽 `lib/principles-run.sh`。**
指控成立：调用与退出码分派逻辑在 `githooks/gate-4.sh`、`githooks/adapters/gate-4.sh`、
`githooks/gates/gate-4-principles.sh` 各存一份，且已分叉（实测 `diff` 三份差异都在 20 行以上：
adapters 副本没有 repo-local tsx 分支，gates 副本连 `PRINCIPLES_BASE` 锚定都没有）。
现在抽取会引入比它消除的更多风险，理由是可复现的而不是体面的：
1. 抽取后 hook 需要 source `$GATE_DIR/../lib/principles-run.sh`。第三层解析（全局 adapters）下
   `$GATE_DIR` 是 `~/.config/xp-gate/adapters/`，其同级 `lib/` 并不存在——`copyAdapters()` 只复制
   `adapters/*.sh` 与 `adapter-common.sh`，`copyHooks()` 只把 `hooks/lib/` 放进 `hooks/`。
   也就是 #473 那个「装了的 hook source 不到库」的故障，会在第三层原样复发；
2. `githooks/gates/gate-4-principles.sh` 既无人 source、也不在镜像守卫覆盖范围内（`check-hook-mirror.sh`
   只钉 `githooks/` ↔ `src/npm-package/`），把它一起抽取等于给一个孤儿文件加安装依赖；
3. 本轮真正的风险（共享 `/tmp` 报告互相覆盖，MI-04）已单独修掉，不必借抽取之名做大改。
后续 issue 需要同时交付：库安装路径的第三层解析（adapters 目录可见 `lib/`）、孤儿副本的去留决定、
以及把三份收敛成一份后的行为测试。

**MI-01（后半）— 不统一全仓的退出码捕获习语。**
Grep 结果：`VAR=$?` 独立成行的写法在 `pre-commit`/`pre-push`/各 gate 脚本共 37 处。逐处抽查未发现
被中间命令污染 `$?` 的实例（管道处之所以安全，是因为 hook 开了 `set -o pipefail`）。
把 37 处改成 `|| VAR=$?` 是一次与任何已知缺陷无关的全仓改写，风险大于收益。
Gate 4 保留内联写法的原因也不同：那个模块除了被 hook source，还被 bats 测试在 `set -u` 子 shell 里
直接 source，内联形式在 errexit 下同样正确。AC-454-08 钉住的就是这一点（含一个真的跑 `set -e`
看两种写法分化的反空洞用例）。

**MI-03 — 429/budget_exceeded 的网关语义暂不外提成 provider 配置。**
同意「下一个网关接入时要再加分支」。但把它做成配置项，需要先有一份以上真实网关的 429 语义可比对；
现在抽象出来的是一个样本上的猜测。留待第二个网关接入时按实际差异抽形。

**MI-05 — 进程级 `activeConfig` 不拆成上下文对象。**
`resetActiveConfig()` 与重复 `setActiveConfig()` 告警（FC-02）已经把「同进程顺序处理两个项目配置」
从隐含契约变成会说话的状态。真要拆成显式上下文对象，触及 15 个规则模块的签名，属独立重构，另开 issue 追踪。

**MN-01 — `listTrackedFiles` 跑全量 `git ls-files` 的性能。**
在超大 monorepo 上确实偏慢，但两条护栏已在位：`timeout` 30s（`29554a1`）与索引不可读时显式报错而非
伪装成「无过期条目」。按仓库规模优化（pathspec 收窄）留待真实反馈，不预防性复杂化。

**MN-03 — `GATE_TS_TYPECHECK_CMD` 优先于 package.json。**
优先级顺序就写在 `githooks/lib/typecheck.sh:13-17`（库文件头部，改这段逻辑的人必读的位置），
且第 1 项注释明确「explicit override, same precedent as SKIP_VERSION_CHECK」。
本仓库 CONTRIBUTING.md 没有环境变量小节（grep 无命中），为这一条新开一节不值当；
若后续再加「Gate 覆盖变量」小节，把这两个一起写进去。

**FC-03 — 回滚粒度。**
成立：`#457`（15 规则模块 + config.ts 重写 + analyzer）与 `#454/#452/#423` 同分支同 PR，
若 #457 的全局配置方案在真实项目里出问题，无法只回滚它。本分支按 REQ 分提交已经为回滚留了抓手，
逐个 REQ 的提交集合（`git log --oneline origin/main..HEAD` 可复核；revert 时按从新到旧的顺序整组退）：

| 主题 | 提交集合 |
|---|---|
| #452 baseline prune / 额度 | `28ac7dc`、`876cc4e`、`29554a1` |
| #454 + #473 Gate 5 判定与库安装 | `138d33e`、`e4d60d4`、`452f4e4`、`18df4fa`、`d1ff40a` |
| #436 Gate 1 走项目自己的 typecheck | `428e50f`、`8195b44` |
| #428 Windows 全量测试 + 工作树守卫 | `a966006`、`2ec8dc4` |
| #475/#476/#477/#478 钩子行为 | `8758177`、`11ad3c9`、`1fe2dd9`、`c5c68b8`、`70c2a54`、`af027da` |
| #423 Delphi 证据 channel | `0189782`（`18df4fa` 里含 AC-423-08 的对称性用例） |
| #457 principles 配置生效 + Gate 4 | `852e364`、`ed0629c`、`51d8e72`、`093ff36`、`2ff4a4e`、`13eb22e`、`87924a1`、`040b796`、`f992290`、`c50d3ab`、`df5521c`、`38e03c9` |

#457 自身面最大。要回滚它而保留其余主题，需要整组退掉其 config/analyzer 主线（`852e364`…`f992290`）
与依赖它的 Gate 4 退出码链（`040b796`、`13eb22e`、`c50d3ab`）——这些提交互为前提，部分回滚会让
Gate 4 的 `-ge 2` 分支读不到约定；`df5521c`（prompt 预算）与 `38e03c9`（profile 归属）不依赖 #457，
可单独保留。这组映射写在这里，是为了下次不必在事故现场重新推导。
流程结论：下一个「面最大」的 REQ 应当在 Phase 3 就拆成独立 PR，而不是在评审阶段用提交顺序补救。

## 环境发现（影响本轮验证可信度，必须记录）

本轮全部提交的门禁汇总都由 **机器级安装的旧副本** 产生，不是仓库里的 `githooks/`：
`core.hooksPath = C:/Users/think/.config/xp-gate/hooks`，其 `pre-commit:1400` 仍是
`jscpd --config jscpd.conf.json …` 的修复前形态（无 `resolve_jscpd_config` 探测），
在一次提交中以「❌ BLOCKED - Required tool 'jscpd' not available for Gate 2」形式出现过，
重跑则变成「command not found → 当作重复代码告警 → PASS」。同一份旧 `validate-code-walkthrough.cjs`
也是 Gate MW 的实际执行体（其校验比仓库副本弱）。

后果：本文档上面所有「Gate x PASS」的验证记录，证明力只到「装了的旧钩子没反对」为止，
不等于本分支修复后的钩子行为。修复动作是 `npx xp-gate doctor --sync-hooks`，
但它改的是机器级目录、影响本机所有仓库，属需用户裁定的操作，未擅自执行。
在此之前，涉及钩子行为的结论以仓库内直接跑 `bash githooks/pre-commit` 或 bats 用例为准。


## 本轮补齐时发现的两处证据质量缺陷

**1. `specification.yaml` 从加 AC-457-14 那次起就不是合法 YAML。**
`js-yaml` 在 178 行报 `bad indentation of a mapping entry`：AC-457-14 的 plain scalar 里写了
`……正是 #457 要消除的 fail-open……`，而 YAML 把「空格 + `#`」当注释起点，标量在那里被截断，
后面两行续行就成了非法缩进。已改为全角引号包裹的「#457」，现在解析通过：15 个 REQ / 56 个 AC，ID 无重复。

为什么一路没人撞到：`src/npm-package/lib/test-alignment.ts:132` 的 `parseSpecification()` 是
**正则抽取**，从不按 YAML 解析。于是一份任何 YAML 解析器都读不进来的规格文件，照样能通过对齐检查——
这正是「检查器读的格式与文件真正的格式不是同一个」的失配。
待裁定：是否补一条「`specification.yaml` 必须能被 js-yaml 解析」的守卫用例（目前仓库里没有）。

**2. 技能的受跟踪副本与 canonical `skills/` 漂移，漂移内容是已废止的策略。**
先分清两类目录，否则会开出错误的处方：
- `plugins/{claude-code,opencode,dsh}/skills/` 被 `.gitignore:134-143` 标为 build artifact，**不入库**。
  本机副本确实旧（opencode 那份 27 项差异，含仍在教「至少 2 个 provider」「2/3 多数裁决」的
  `INSTALL.md`/`round-templates.md`），但那是 `scripts/build-plugin.sh` 重跑就能刷新的本地状态，
  不是仓库缺陷，也不需要提交。
- 真正入库的漂移只有 **3 个文件 × 2 个副本**：`plugins/qoder/skills/` 与
  `src/npm-package/plugins/qoder/skills/` 下的 `delphi-review/SKILL.md`、
  `delphi-review/references/requirements.md`、`sprint-flow/references/phase-2-design.md`。
  `src/npm-package/{skills,plugins/{claude-code,dsh,opencode}/skills}` 实测与 canonical 逐字节一致——
  也就是说 #423 之后的文档修订同步了 npm 发布副本，唯独漏了 qoder 这两处（审计脚本按 tracked 文件比对，
  74 个跟踪文件里命中 3 个）。

危害不是「文档旧了」，而是这两份副本是 Qoder 平台实际加载的技能：
`requirements.md` 的证据示例缺 `channel`，照它写出的 `.code-walkthrough-result.json` 会被 Gate MW 判 FAIL；
`SKILL.md`/`phase-2-design.md` 缺 #423 之后补上的执行校验表述。
本轮把改到的 `code-walkthrough.md` 同步到全部 9 份副本（校验：9 份 SHA-256 全等 canonical），
上述 3 个文件的回灌单独一个提交，避免把机械修复和内容改动混在同一次评审输入里。

## 待办（本轮记录，未动代码）

- **`scripts/test-plugins.sh` 在 Windows/Git Bash 上必然假失败。** 第 7 行
  `REPO_ROOT="$(cd … && pwd)"` 得到 `/d/projects/xp-gate`，随后被插进 `node -e "…readFileSync('$REPO_ROOT/…')"`，
  node 按当前盘根解析成 `D:\d\projects\xp-gate\…` → `ENOENT`，输出「✗ Claude hooks.json invalid JSON」
  「✗ OpenCode package.json invalid JSON」——三个 manifest 其实都合法。修法是一行
  （`pwd -W 2>/dev/null || pwd`，同仓 `detect_os_env()` 的既有思路），但它已被
  `scripts/test-plugins.mjs` 取代：本轮实测 `node scripts/test-plugins.mjs` 全绿（Failed: 0），
  而 `.sh` 没有任何 CI job 或脚本调用。所以真正要裁定的是**删除还是修复**——留着一个会自己造
  假失败的测试脚本，比缺它更糟。另开 issue，本分支不动。
- `specification.yaml` 缺一条「必须能被 js-yaml 解析」的守卫（现在靠正则抽取，格式坏了也过）。
- 技能副本缺一条 tracked 文件的逐字节 parity 守卫：`hook-mirror`/`hook-lib`/`delphi-runner` 三套守卫
  都只钉脚本副本，`plugins/qoder/skills` 与 `src/npm-package/plugins/qoder/skills` 这次的漂移无人拦截。
- MAJ-02（Gate 4 抽库 + 安装器第三层解析）、MI-05（进程级 `activeConfig`）、MC-03（SKIP 聚合监控）、
  `pruneBaselineEntries` 不剪零告警条目——理由见上文「记录的决定」。

# 追加：Round 2 结果与处置（2026-10-06）

评审区间 `af027da..6ebbd5a`，输入按席位分别装配到 38461 / 39538 / 36944 字节（system+user，UTF-8）。

| 席位 | 模型（requested/resolved） | Round 1 | Round 2 |
|---|---|---|---|
| architecture | g-glm-5.3-flash / glm-5.3-flash | REQUEST_CHANGES(7) | **未产出：两次 "Network error."（38461 字节，`retryable:false`）** |
| technical | g-qwen3.8-flash / qwen3.8-flash | APPROVED(8) | APPROVED(9)，2 major / 3 minor |
| feasibility | g-deepseek-flash / deepseek-flash | REQUEST_CHANGES(7) | APPROVED(7)，6 major / 7 minor |

## 一个必须记录的测量反转：40000 不是「安全值」

同一个 `g-glm-5.3-flash` 席位，Round 1 在同量级 prompt 下答完（225s），Round 2 在 **38461 字节**
（低于 AC-457-19 的默认预算）连续两次以 "Network error." 失败；同时另两个席位在 39538 / 36944 字节都成功。
用小 prompt（约 100 字节）冒烟重跑该席位 7 秒返回正常，排除了网关整体故障。
结论：**prompt 上限是席位（模型）属性，不是全局属性**——`max_prompt_bytes` 的存在是对的，
但「默认 40000 经验安全」这句话没有依据，它只是当时那一次实测的取值。
Round 3 因此把装配体积压到 ~35KB（diff 改用 `-U0`，三个配置文件的 diff 换成处置表里的事实陈述），
并把这条反转写进评审输入，而不是悄悄把预算调大。

## Round 2 发现的逐项处置

| 编号 | 提出 | 处置 | 落点 / 理由 |
|---|---|---|---|
| 非法 `max_prompt_bytes` 静默回退 | technical MN-02 + feasibility | **已修** | `0a6ce31`：值存在但无法生效时打 WARNING，未设置与合法值保持静默；AC-457-19 同步补这句 |
| pickaxe 可能多命中、缺「命中数=1」断言 | feasibility | 驳回 | `git log` 新→旧，`tail -1` 取的是**最旧**命中即引入提交；零命中时 `[ -n "$fix_commit" ]` 直接失败并说明原因；取到的副本还必须含 `/tmp/principles-output.json` 否则再失败。三种失配都可见，不存在「静默取错父」 |
| 「测试引用的每个 AC 必须存在于 spec」应落地为守卫 | technical MC-02 + feasibility | 记录决定 + 实测规模 | 全量扫描（canonical，168 个测试文件，排除 npm 镜像与 `.xp-gate/`）：**97 个 AC 引用在 `specification.yaml` 中不存在，分布在 22 个 REQ**（001–006、010、174、327、337、356、357、359、379、428、436、458、475、476、477、478、59）。AC-478-01..04 只是其中 10 处引用的一小部分。守卫一旦上线即全仓红，写齐 22 个 REQ 不是本分支范围；另开 issue，附上面这份规模数据作为工作量依据 |
| MAJ-02 延后必须绑定 issue 与交付批次 | feasibility | 记录决定 | 与上一轮同一结论；issue 待用户裁定后创建（见文末「需要用户裁定的三件事」） |
| 跟踪态技能副本无 parity 守卫 | feasibility | 记录决定 | 守卫要做的是 `plugins/qoder/skills/**` 与 `src/npm-package/plugins/qoder/skills/**` 两处对 `skills/**` 逐字节比对，可以复用 `check-hook-mirror.sh` 的形状；但它是新面（74 个跟踪文件）且与本分支的 P0 误阻断无关，另开 issue |
| `.bats` 不在任何自动执行路径 | feasibility | 记录决定 | 加 CI job 需要先在 CI 里装 bats-core，且要决定跑哪几个文件；本分支只做了一件相关的事——把 `6ebbd5a` 的自曝缺陷讲清楚。另开 issue |
| `FC-01/MC-01` 没有代码级降级开关 | feasibility | 记录决定 | 「validator 与 producer 成对回滚」已在文档写明；加降级开关等于给 #423 留一个零成本绕过口，与该修复的初衷相反 |
| 旧机器级钩子导致「谁在最终环境验证钩子行为」缺位 | feasibility | 记录决定 | 见下方新增环境发现；本轮的可验证证据是仓库内直接跑的 bats，合并前的钩子行为验证需要用户裁定 `doctor --sync-hooks` |
| `test-plugins.sh` 删除 vs 修复 | technical MN-01 + feasibility | 记录决定 | 已在上一节「待办」写明两条路，倾向删除（`.mjs` 孪生版本全绿且无人引用）；等裁定 |
| `filesystemFoldsCase` 在大小写敏感 APFS 卷上误判 | technical MN-03 | 记录决定 | 后果是 fail-safe（保留条目不误删）；环境变量覆盖属增强，另案 |
| `max_prompt_bytes` 语义（system+user 之和）未写进配置注释 | feasibility | 记录决定 | AC-457-19 与代码一致（求和），注释补充随下一次配置文档改动一起做 |
| `getEffectiveConfigFor` 只切第一个点，三段式 ruleId 会被误解析 | feasibility | 记录决定 | 当前 15 个 rule ID 均为 `group.name` 形态且由既有测试钉住形状；前瞻性提示 |
| `Violation.effectiveThreshold` 缺类型层强制 | feasibility | 记录决定 | 与上一轮同一结论：不引入第二真值来源 |
| hooksPath / prompt 预算不对称 / Boy Scout 复发等 7 条 minor | feasibility, technical | 记录决定 | 均为观察项或已在处置表内，逐条见席位原文 |

## 新增环境发现（影响的不只是本分支）

`core.hooksPath` 指向的旧机器级钩子在 Gate 2 把 **已经安装** 的 jscpd 判定为「required tool not available」并 BLOCK。
根因不是缺依赖：`node_modules/jscpd/bin` 与 `node_modules/.bin/jscpd` 都在，
而是 git 钩子进程的 PATH 不含 `./node_modules/.bin`（npm lifecycle 才会注入）。
把该目录加进 PATH 后同一次提交即通过（`0a6ce31`）。
这是陈旧副本的第二个具体后果——仓库内修复后的 gate-2 走的是「运行错误 vs 重复发现」三态分类、
且遵循「工具缺失 = SKIP」；陈旧副本这里直接 BLOCK，等于把已修好的误阻断在提交路径上又制造了一遍。
