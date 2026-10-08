# Changelog

All notable changes to this project will be documented in this file.

## [0.20.1.0] - 2026-10-08

### Fixed

**机器侧修复入库批（#501 / #499 / #452，Delphi 走查两轮达成共识）**

- **Gate 8 密钥扫描改为 fail-closed（#499）——行为变更**: gitleaks 未安装或以非 0/1 退出码崩溃时，此前一律 SKIP（零防护静默放行），现在直接 **BLOCK** 并给出分平台安装指引。`detect-secrets-hook` + `.secrets.baseline` 同时存在时追加二级基线比对扫描（只拦基线外的新密钥；文件清单 NUL 直通管道，绕开命令替换吞 NUL 的 bash 限制）。6 份随包 bash 副本字节同步；CI `first-commit-gates` 预装 gitleaks（版本钉在 v8.30.1）。**存量用户注意**：升级后首次提交若未装 gitleaks 会被阻断，按提示安装即可（brew/winget/install-gitleaks.sh）。
- **机器侧适配器修复入库（#501）**: `adapters/python.sh` 的 mypy 口径对齐 CI type job（`mypy src/` + `mypy scripts/`，永不写裸 `mypy .`——后者会扫进从未声明的调研脚本与 tests/，实测 87 条假错并阻断包括纯文档在内的任何提交）、pytest 默认 `-m "not e2e"`、覆盖率阈值回归 pyproject `[tool.coverage.report] fail_under` 单一事实源（删除硬编码 `--cov-fail-under`）、mutmut 缺失时回退 `python3 -m mutmut`；`adapters/powershell.sh` 支持 `.xp-gate-powershell-coverage-ignore` 项目级覆盖率豁免（每行一个 glob，`#` 注释，全排除时跳过 coverage 而非静默忽略）、Pester 5 `New-PesterConfiguration` 现代配置对象（Pester 4 参数集在 5.x 直接报错且静默产出零覆盖）、删除假阈值 WARNING+exit 0。两份契约由新增的 `adapter-mypy-pester-scope.test.bats` 双向锁定（含"不得写回裸 mypy ."）。
- **`.warnings-baseline.json` 自动初始化的可见性与工作区卫生（#452 REQ-2/3/4）**: 执行路径的自动初始化现在区分并打印 **Baseline created/updated**，且逐一列出自动登记的条目（此前只有一条计数）；hook 在自动改写该入库文件后将其 `git add` 进本次提交，预算更新随引发它的提交走，不再留下一个无解释的 ` M .warnings-baseline.json` 工作区脏改动。
- **`CHANGED_FILES` 剔除字节镜像路径（Gate 2/3/4/6 等 lint 语料口径统一）**: `src/npm-package/**` 是字节镜像，归 CI Mirror Parity 管（Gate 6 的 MIRROR_EXCLUDE、#494 的测试选择已确立该原则）。此前 Gate 2 的 jscpd 语料含镜像，源文件与镜像同改时被判 100% 全文克隆，撞上 Gate 6 "≤5 条警告必须清零"规则后**任何**镜像化文件的编辑都无法通过提交——且该警告结构性无法清除。现在镜像路径只从 lint 语料中剔除；**早退判断改用未过滤的原始暂存清单**，纯镜像提交仍会执行无条件的 fail-closed Gate 8 密钥扫描，不留下安全旁路。
- **`sync-package-content.js` 新增 `--fix`**: 漂移门禁先于同步执行并 exit 1（CI Mirror Parity 依赖"漂移即失败"而非"静默自愈"，故不能调换顺序），导致漂移发生后按提示运行脚本自己也修不了——先 exit 了。`--fix` 跳过漂移门执行真正同步；无参调用语义不变。

### Fixed (docs)

- **#432 收尾**: `docs/CAPABILITIES.md`、`docs/MANIFEST.md`、`githooks/TOOL-INSTALLATION-GUIDE.md`、`plugins/opencode/README.md`（含镜像）残留的 "Gate 0-9 / 10 道门禁" 全部对齐为 **Gate 0-11 + Gate 12（12 道编号门禁 + 文件卫生 warning-only）**；四处 "工具缺失 → SKIP" 契约声明同步补充 Gate 8 fail-closed 例外。
- **#425 收尾**: `scripts/__tests__/delphi-external-review.test.cjs` 与 `code-walkthrough-doc.test.cjs` 的 markdown JSON 示例提取正则改为 CRLF 兼容（`\r?\n`），Windows `core.autocrlf=true` 工作树下不再误报"文档缺示例"。

## [0.20.0.0] - 2026-10-08

### Fixed

**缺陷批（`fix/batch-defects-20261007`，逐个 open issue 复现后修复）**

- **Gate 8 把干净扫描误判成"有发现"，gitleaks 在钩子 PATH 上时每次提交都被掐断（#493）**: #449 把判决改为读取 gitleaks 的 JSON 报告工件（方向正确），但读计数的那行写的是 `grep -c '"RuleID"' … || echo 0`——`grep -c` 在零匹配时**既打印 0 又以 1 退出**，于是 `|| echo 0` 追加出第二行，`GITLEAKS_FINDINGS` 变成 `$'0\n0'`，判决表里 `= "0"`、`= "?"` 两个字符串比较全部落空，干净扫描走进 fail-closed 的 else 分支 `exit 1`。本仓库自己的运行逃过了这一劫只因为 gitleaks 不在 git 钩子的 PATH 上（走 SKIP），而 .bats 从未进 CI（#484），所以这条红直到本次手工全量 bats 运行（57 文件 351 ok / 53 not ok）才被看见。现改为 `grep -o … | wc -l | tr -d '[:space:]'`：只输出一个值，且顺带修正"数行数不等于数发现"（紧凑 JSON 把 N 个 finding 写在一行时旧代码报 1）；工件存在但不是 JSON 数组形状时保留 `?` 语义判 SKIP，绝不宣称 PASS（#449 的 fail-closed-on-the-claim 不动）。新增 8 条 AC-493 用例，其中计数用例是**从生产文件抽取那行表达式再执行**（此前的测试逐字誊写了缺陷，因此它记录 bug 而不是抓 bug），另有桩驱动的门禁级判决用例（`[]`→PASS、有发现→仍 exit 1、无工件→SKIP）与全库同类写法守卫；同类写法在 `githooks/pre-commit`（两处 `grep -c '.' || echo "0"`，下游用 `-gt` 比较故当前无可观测后果，属 #489 那类等踩的写法）与 `githooks/adapters/iac.sh` 的 checkov 计数一并清除。6 份 gate-8 副本（含 `githooks/gates/` 下那份从未被 source 的参考实现）字节同步。

- **Gate 5 把"根项目收集不到的镜像路径"当测试目标，于是只同步随包镜像的提交被误 BLOCK（#494）**: `vitest.config.ts` 从 #418 起把 `src/npm-package/{principles,mutation,mock-policy,build-integrity}/`、`plugins/`、`skills/` 整批排除在根项目外（它们是 `src/`、`skills/` 下同名文件的字节一致镜像），但 Gate 5 的 smart selection 仍照原样把 `git diff --cached` 的结果喂给 vitest。目标全部不可收集时 vitest 报 `No test files found` 并 exit 1，门禁把它读成"测试失败"——本次同步 `src/npm-package/mutation/**`（#480 的镜像回写）就撞在这上面，且此前只有 `^plugins/[^/]+/` 一条过滤规则说明这个坑只被踩过一次、没被系统化。新增 `select_root_suite_targets()`：镜像路径映射回 canonical 双生子、无对应物且不可收集的整行剔除、镜像与 canonical 同时出现折叠为一个，`CHANGED_TEST_FILES` 与 `CHANGED_SRC_FILES` 两处选择都经过它，剔除发生时打印 was/now（绝不静默改目标）。5 条 AC-494 用例从随包 `pre-commit` 抽出该函数**执行**，并与 `vitest.config.ts` 的 test exclude 逐棵对账（下限 8 次探测防伪通过），同时断言两份随包副本都定义并调用了它。机器级钩子此前停在 #449 之前的单体 `pre-commit`（`doctor --sync-hooks` 从不覆盖，即 #488 的现场），因此本仓库的提交一直跑的是旧门禁——这也是 #493 在本仓库长期不可见的原因。

- **Gate 10 一次暂存 ≥2 个受支持文件时静默杀死提交（#490）**: `githooks/gate-10.sh` 把换行拼接的 `SEMGREP_FILES` 作为**单个**参数交给 `semgrep scan`，于是 semgrep 收到 `$'app.ts\nlib.ts'` 这样的非法扫描根并报 `Invalid scanning root`；单文件提交只是碰巧没有换行才看起来正常（#475 现场报告的"时好时坏"即此）。现改为逐行展开成 `SEMGREP_ARGS` 数组并以 `"${SEMGREP_ARGS[@]}"` 传参，且每个元素统一加 `./` 前缀——被跟踪的路径可以合法地以 `-` 开头（`git add -- ./-o.ts`），裸进 argv 就是选项，一个恶意或误名的文件足以改写它本该受限的那次扫描。5 个 BATS 用例锁定数组展开、`-` 开头与含空格文件名，并断言三份随包副本（`githooks/`、`src/npm-package/`、`src/npm-package/hooks/`）字节一致。
- **`FAIL_LINES` 提取在消费方 wrapper 里泄漏 errexit，钩子在所有门禁打印 PASS 之后死掉（#489）**: 门禁模块是被 source 进 pre-commit 的，管道里 `grep` 零命中返回 1 时，`set -e` 上下文直接终止提交且不留任何输出。现改用 `sed -n '1,10p'`（同时补上 v0.9.2 head→sed 迁移漏掉的一处）并以 `|| true` 收尾；AC-489-02 在两份随包副本上都钉住该形态。
- **Gate M 把测试树里的基础设施当生产代码评分（#480）**: 过滤器只按文件名排除 `*.test.*`，`tests/e2e/helpers/e2e-server.ts` 这类不改名的测试设施因此进入 Stryker，用 60% 的生产阈值评出一个结构性不可达的 0%，掐断 push。现按整段路径（`(^|/)(tests?|__tests__)/`）排除，且 Round 2 之后所有排除规则读取**同一个**分隔符视图（此前只有树段规则读 `normalized`，`.test.`/`_test.`、Java/Kotlin 与 `/adapters/` 读原始路径，Windows 反斜杠路径被两套口径同时评判）；`*.spec.*` 也与 pre-push 的过滤链对齐；Java/Kotlin 的 `Test/Tests/IT/Spec` 结尾匹配不再要求前一个大写字母（`[A-Z]Test\.` 只命中 `MyTest.java`，主流命名 `FooTest.java` 此前一直漏排）。新增 bash↔TS 过滤链 parity 测试，并把 `src/test-utils/`、`src/mytests/` 这类生产路径的豁免写成断言。
- **`doctor` 判已安装技能新鲜度时把行尾差异报成 Outdated（#439）**: frontmatter 正则只认 LF，退化分支做字节比较，`core.autocrlf=true` 的工作树下 13 个技能里 12 个被假报过期并推荐带破坏性的 `update-skill --all`，唯一一条真差异被噪声淹没。现 `extractSkillVersion` 与内容比较都按 LF/CRLF/孤立 CR 三种约定归一。
- **`doctor` 的 hook 同步与漂移检查漏掉 `githooks/lib/`（#488）**: pre-commit 运行期 source `lib/*.sh`，安装副本缺文件或停留在旧版会让钩子直接死在 source 那一行，而 `--sync-hooks` 从不复制、漂移检查从不看这些文件。现在 lib/ 下每个文件都有独立的 PASS/FAIL 标签与 0o755 权限同步。
- **全新 Qoder 安装被误判为 opencode（#424）**: `detectPlatform` 只认 `~/.qoder/skills`，而 brand-new 安装还没有 `skills/`，于是 `configureQoderDelphiAgents` 部署零个 Delphi agent；同时 `detect-deps.js` 与 `shared-paths.js` 各有一份实现可发散。现任何 `~/.qoder` 内容都计为标记，`detect-deps.js` 改为 re-export 同一函数（引用相等），两标记并存时的优先级写入 AC-424-04。
- **Gate 0 的 `[skip-version-check]` 提示与真实契约不符（#450）**: 旧文案"include [skip-version-check] in commit message"让人以为正文任意位置放标记即可，实际要求标记在**首行行首**、带 `chore:`/`docs:`/`release:` 前缀、且只覆盖构建工具链路径。提示已按真实契约重写；Round 2 之后新增一组 BATS 在运行期从随包真实 `pre-commit` 抽出该门禁块**执行**（工具链路径放行、生产源码仍 exit 1、未列类型被拒、标记只在首行生效），不再只断言文案。
- **回归测试在 Windows 工作树下把 markdown 里的 JSON 示例读成"文档漂移"（#425）**: 提取示例的正则按裸 `\n` 写，CRLF 工作树必然不匹配。新增 `scripts/lib/read-markdown.cjs` 统一归一并声明其范围（只有 CRLF——唯一写入方是 git checkout，孤立 CR 无生产者，git 对路径里的控制字符是引用而非透传）。
- **sprint-gate 的解析链测试不再执行真实契约（#431）**: `sprint-gate.test.bats` 与脚本实际解析顺序脱钩后一直绿着，等于没有守卫。已恢复为对真实合同的断言。
- **`scripts/test-plugins.sh` 永久红（#486）**: 它把 MSYS 的 `REPO_ROOT` 插进 `node -e` 的路径参数，在 Windows/Git Bash 必然假失败，且与全绿的 `.mjs` 孪生并存、无人调用——两个半都留着只会训练团队忽略红色。已删除该脚本并把引用（含 `AGENTS.md`、`plugins/AGENTS.md`、clipboard-vision 各副本测试）指向 `.mjs`，`dead-plugin-test-script.test.cjs` 守卫"删得干净、且没把两个半都删掉"。
- **`ARCHITECTURE.md` 的门禁计数陈旧（#432）**: 与 `pre-commit`/`pre-push` 现状对齐。
- **语言检测对没有配置文件的语言视而不见（#468）**: `detectProjectLanguages()` 只按 `configFiles` 判定，而 shell/powershell 两项的 `configFiles` 是空数组，于是 147 个 `.sh` + 27 个 `.ps1` 的仓库在 `doctor`/`check-tools` 里根本不出现。现加入扩展名兜底，且**只对没有配置文件可依的语言生效**（IaC 注册了 `yaml/yml`，全局兜底会把任何有 CI YAML 的仓库判成 IaC 项目），扫描跳过 `node_modules/`、`.git/` 等依赖与 VCS 目录；遍历顺序改为字典序以保证可复现。

### Changed

- **未知命令行参数不再静默 no-op（#488 #416 #502，Round 1/2/3 评审追加）**: `xp-gate doctor` 接受的 flag 是 `--fix`、`--sync-hooks`、`--force`、`--install-tools`、`--json`、`--format`（Round 2 条目把这张表错写成了"hook 相关的两项"，掩盖了 `--force` 与 `--install-tools` 也是已实现的选项，而 `--json`/`--format json` 是 v0.13.x #304 就承诺过、直到本批才真正落地的机器可读输出）。技能命令的 flag 白名单**按命令划分**而不是全局一张表（`install-skill` 只吃 `--verbose`/`--force`，`update-skill` 只吃 `--verbose`/`--all`/`--check`，`uninstall-skill` 只吃 `--force`）——被解析成功但从不消费的 flag 同样是被忽略的选项。**这是破坏性变更**：此前 `--offline` 之类已从用法里移除的写法会 exit 0 并假装执行，升级后任何依赖该行为的脚本会 exit 1 并列出该命令真正支持的 flag。迁移：**逐条对照上面这张表核对，不要直接删 flag** —— `--force` 是发散副本覆盖前的显式裁决门，删掉它反而会让机器独有的内容被静默覆盖（正是 #493 长期不可见的成因）；`--install-tools` 删掉后 `--fix` 只报告不安装，也是有意行为。
- **Delphi 外部评审在配置边界 fail fast（#429）**: `api_key` 环境变量未设置由 WARNING 改为 exit(1)，`validateProviders` 现在校验 profile 内全部 provider（含未被任何专家引用的）。**这是破坏性变更**：历史遗留的不完整 `.delphi-config.json` 在升级后首次调用即硬失败，没有降级开关——这是有意的，因为配置不完整的评审产出的是不可用而非"部分可用"的凭据。迁移：升级后先跑一次单席位冒烟（`node scripts/delphi-external-review.cjs --expert architecture --mode code-walkthrough --round 1 --profile <p> --config .delphi-config.json --input-file <小文件>`；`--round` 是 runner 的必需参数，Round 2 那条写法漏了它，照抄的人会拿到 `Missing required arguments: --round`，分不清是自己的配置没修好还是发布说明写错），把缺失的 `${ENV}` 补齐。
- **`install-skill`/`update-skill` 改为复制随包整目录（#416）**: 原先从 GitHub main 分支拉单个 `SKILL.md`，13 个技能里 8 个的 `references/`、`templates/`、`scripts/` 全部缺失且技能运行时引用悬空；`update` 还会先删空目标目录再只写回一个 `SKILL.md`。现在从 npm 包内 `skills/<name>/` 整目录复制、无网络请求，"本包不含该技能"的检查发生在任何删除动作之前，`download-skill.js` 随之下线。文档（`README.md`、两份 `AGENTS.md`）同步改为"bundle-copied"。
- **语言检测开始要求 shell/powershell 工具链（#468 的可见后果）**: 检出的语言集合变大后，`check-tools` 会开始提示安装 `shellcheck` 等。工具缺失仍按仓库既有契约降级为 SKIP、不阻断提交；不需要该语言的显式传 `--languages`（`--languages shell` 与 `--languages=shell` 两种写法现在都生效，此前空格形式被静默忽略）。

**上一批（同一版本内，先前会话完成）**

### Fixed

- **Qoder Delphi 专家 agent 声明的模型从未生效**: `plugins/qoder/agents/delphi-*.md` 的 `model` 字段写成裸模型名（`Qwen3.7-Max` / `GLM-5.2` / `DeepSeek-V4-Pro`），而 Qoder Custom Agent 要求 `"[DisplayName](modelId)"` 格式；格式不符或模型已不在内置目录中时 Qoder 不报错，三个专家于是静默跑在同一个模型上，违反"三个不同可执行模型 ID"契约。模板现改为 `qfmodel` / `gfmodel` / `dfmodel` 三个 0.1× 内置模型，并新增模板格式回归测试。**但隔离复测（修好格式后新开会话再派发）表明这不足以恢复契约**：平台对 `subagent_type` 派发只采纳 Custom Agent 的角色提示词，`model` 绑定被忽略、执行模型固定为会话模型，因此本条只是消除声明层面的非法绑定；真实边界与迁移指引见下方 Changed 条目。
- **`init --global` 不部署 Qoder 专家 agent**: `configureQoderDelphiAgents()` 只在 local init 调用，全局安装的用户拿不到任何 agent 模板。现在 `setupGlobal` 同时部署到 `~/.qoder/agents/`（已存在的用户自定义文件仍不覆盖）。
- **单测污染 npm 包模板**: `init.test.js` 用 `fs.writeFileSync` 直接向 `src/npm-package/plugins/qoder/agents/delphi-architecture.md` 写入 `'arch expert'` / `'TEMPLATE CONTENT'` 且从不恢复，跑完测试后发布用模板被替换成 1 行垃圾内容。改为断言包内真实模板内容，不再写模板目录。
- **Delphi agent 部署缺少失败隔离与自检**: `configureQoderDelphiAgents()` 抛错会在 hooks/adapters 已复制之后中断整个 setup；包内模板若丢失 model 绑定会被原样部署；旧格式（裸模型名）模板被保留时完全无提示；非 Qoder 平台跳过时静默无输出。现在 (1) 调用点改用 `deployQoderDelphiAgents()` 包裹 try/catch，失败只降级为一条 SKIP 告警；(2) 部署前校验模板绑定，不合法即跳过并告警；(3) 审计已部署模板（见下条）；(4) 跳过时输出检测到的平台名。新增 `__tests__/qoder-delphi-agents.test.js` 覆盖以上不变量与三处模板镜像。
- **Delphi agent 陈旧绑定检测只看格式、且依赖包内模板存在**: 只校验 `"[Name](modelId)"` 形状时，"格式合法但 modelId 与本版本不同"（角色重绑或 Qoder 目录改名后）的已部署文件完全静默，叠加"已存在不覆盖"就永远修不好——这正是 #417 故障类的复发通道；且 `agentSrcDir` 缺失时提前 return，保留文件的诊断分支整段不可达。现在改为解析出已部署文件与随包模板的 modelId 并比对，不一致即点名文件并给出"删除 → 重跑 `init` → 重启会话"提示；审计逻辑独立于部署循环，模板缺失时仍会检查 `delphi-*.md`；绑定正则改为只读 frontmatter 内成对引号的 `model:` 行（避免正文示例误判）；模板全部被拒时输出 `rejected` 计数而非"no agent templates found"。（审计保证的是"声明与本版本模板一致"；由于平台不采纳 subagent 的 `model` 绑定，一致的有效声明并不恢复三模型执行，见 Changed 条目。）
- **`uninstall` 后 Qoder 专家 agent 孤儿留存**: 部署足迹已扩到 `~/.qoder/agents/`，卸载不清理且下次安装因"不覆盖"继续跳过。卸载摘要现在明确提示这些用户文件的残留路径与手工清理方式。
- **`init` 在三条绑定都合法时仍让人误以为契约已恢复**: 审计只在不合法时告警，绑定全部正确的用户看完 `xp-gate init` 会认为三个专家已各跑一个模型，而实测（2026-09-23）平台根本不采纳该绑定。Qoder 分支现在无论审计结果如何都会打印一条平台边界提示：subagent 派发不采纳 `model` 绑定、原生路径只是同模型三角色自查、契约合规需在 `.delphi-config.json` 配外部 provider；非 Qoder 平台不打印。`qoder-delphi-agents.test.js` 锁定这两个方向。
- **外部 Delphi 评审超时硬编码 30s，真实代码走查必然失败**: `scripts/delphi-external-review.cjs` 对 provider 请求固定使用 30000ms，而 code-walkthrough 输入通常 35–55KB，网关响应实测 50–180s（且与输入长度不单调），于是技术角与可行性角每次都超时，Gate MW 的三模型凭据无法通过这条唯一合规路径取得。现在超时可通过 `--timeout-ms`（整数 1000–600000，非法值直接退出）或 provider 的 `timeout_ms` 配置，优先级为 CLI > provider > 30000（默认不变），超时错误信息同时给出提升方式；新增 `resolveTimeoutMs()` 与 `--timeout-ms` 回归测试。
- **`readQoderModelId` 接受未加引号的绑定，与自身文档矛盾**: 文档要求 `model: "[Name](modelId)"` 成对引号形式，正则却还有一条无引号分支，导致手改成未加引号的文件通过 `init` 审计（审计承诺"声明与本版本模板一致"）而 Qoder 实际按非法值处理，回退到会话模型；同时 `init` 在模板全部被拒时先打印 `rejected` 计数再打印"no agent templates found"，并在没有部署任何文件时也输出平台边界提示。现在正则只认双/单引号两种形式，`reportQoderAgentDeployment` 仅在随包模板存在时输出，平台边界提示仅在实际部署或保留了文件时输出。
- **Gate 6 因 `.git/hooks/` 安装副本而恒定 BLOCKED**: `xp-gate init` 会把 `githooks/lib/*` 按字节复制进 `.git/hooks/lib/`，archlint 却把 `.git/` 当源码树扫描，于是安装副本与规范文件配成一对 HIGH CodeClone；`--fail-on high` 下任何触及该库的提交都会被阻塞（其余 MEDIUM 回归只列不拦，且每次采样集合不同，看起来像门禁抖动）。`.archlint.yaml` 现在 `ignore` 里排除 `.git/**`（消除其 DeadCode 误报），并按本文件已记录的"克隆对须两侧同时排除"约定在 `rules.code_clone.exclude` 补 `.git/**` 与 `githooks/lib/**`；`archlint-config.test.cjs` 锁定这三条排除项。

- **Gate 5 把 vitest 的"零测试文件"退出当测试失败，无测试文件的仓库每次提交被 BLOCK（#498）**: vitest 有三种非失败退出，前两种已被 #454（Windows EPERM runner error）与 #473（partial 运行的全局覆盖率阈值）收进 `handle_test_failure` 分类器，第三种 `No test files found, exiting with code 1` 仍直接落进 `❌ BLOCKED - Tests FAILED`。判定新增在共享分类器内（`is_no_test_files_found` 必须同时满足"命中该签名"且 `has_real_failure_marker` 为假，真实失败绝不因签名共现被放过），输出 `⏭️ SKIPPED - no test files matched` 并置 `TESTS_SKIPPED=true`——**不宣称 PASS**，测试存在性由 Gate 5a 与 CI 负责。守卫按 **runner** 划界而非按分支标签：#454 把保护挂在标签叫 "Non-TypeScript" 的分支上，而 `adapters/typescript.sh` 的 `run_tests` 同样跑 `npx vitest run`，于是一个没有 `package.json` 的 TS 项目走进那条分支就被误阻断（本 issue 的现场）；真正的非 vitest runner（pytest/go/jest）保持"任意非零即 BLOCK"，边界是重申而非放宽。测试侧把两处依赖注释行数的断言（`grep -B10`、`PRODUCING_COMMAND_LOOKBACK_LINES = 12`）换成结构判定：以缩进深度区分"同臂的 handler"与"上游的 producing command"，因为 #498 让该间距从 3 行涨到 13 行，任何行数上限都会重新变成缺陷。新增 `gate-5-no-test-files.bats` 6 条（判决文案、镜像副本字节一致、awk 区间证明 handler 真的接线）与 `scripts/__tests__/gate-5-runner-error.test.ts` 的分支下限守卫，端到端由 `gate-5a-block.test.bats` 14/14 覆盖。

- **BATS fixture 未与执行环境隔离，断言跑在崩溃或随机器漂移的 hook 上（#497）**: 三种泄漏各自都能把一个红测试伪装成绿。① fixture 只装 `pre-commit` 不装 `githooks/lib/*.sh`，被 source 的库缺失时钩子死在 source 那一行，断言读到的是崩溃输出而非门禁判决；现 `setup()` 安装 lib/ 全部文件。② Gate MW 凭据校验要求 `expires - timestamp === 3600` 且未过期，fixture 里两次独立 `date -u` 相差 1 秒即被拒——现由同一个 `date -u +%s` 基推导两个字段。③ 机器工具链直接参与判决：AC-TDD-001-12 暂存 `.py` 会路由到 pytest 覆盖率段，该段对缺失的必需工具按设计 fail-close，于是同一条测试取决于本机装没装 pytest；现与 jscpd 一样**桩化工具，而不是假设它存在**。同时修正一条本身就是缺陷的 fixture 测试文件：`test('foo', () => {})` 在全局关闭的 vitest 配置下必然 `Cannot find 'test'`，改为显式 import。

- **`doctor` 用字节比较 `core.hooksPath`，配置正确的 Windows 机器恒报 FAIL 且 `--fix` 消不掉（#496）**: `git config` 在 Windows 回读正斜杠形式（`C:/Users/...`），而 `path.join` 生成的常量是反斜杠形式，`hooksPath !== GLOBAL_HOOKS_DIR` 因此永真；`--fix` 写入同一值后回读仍是斜杠形式，FAIL 无法清除。新增 `pathsEquivalent()`：折叠分隔符、去尾斜杠、盘符大小写归一（POSIX 前导 `/` 是内容不是分隔符，保留），两处比较点（`checkGlobalHooks` 与 `fixGlobalHooksPath`）全部改走它。实测本机 `strictEqual === false` 而 `pathsEquivalent === true`，doctor 由 FAIL 转 PASS；4 条 AC-496 用例含近似前缀不等价（`/xp-gate` ≠ `/xp-gate/hooks`）与"两处字节比较站点已消失"的反空断言。

- **`doctor` 既不检测也不同步实际执行的门禁模块（#495）**: pre-commit 把 `GATE_DIR` 解析到全局 adapters 目录（`if [ -f "$ADAPTER_DIR/gate-3.sh" ]`），Gate 3/4/7/8/9/10 的实现都在那里执行，而 `checkAdapters()` 只证明文件**存在**、hook 漂移检查只到 hook 文件与 `lib/`。结果是本仓库的门禁修复在这台机器上既惰性又不可见——**#493 长期看不见的真因就是它**。doctor 现在按 hook 自己的 3 级解析顺序打印 `ADAPTER_DIR`/`GATE_DIR`，逐模块比内容（平铺副本优先、nested 仅作 flat 缺失时的对应物，与 `resolve_adapter_path()` 一致），并把漂移分为"安装副本陈旧""安装副本较新""双向发散"。`--sync-hooks` 覆盖这些模块，但只要安装副本持有仓库没有的行就**拒绝覆盖**（那是机器独有的加固，静默删除比漂移更糟），需要 `--sync-hooks --force` 显式裁决；`Gate scripts` 的 PASS 文案同时降级为"仅存在性"。本机实测 8 个模块双向发散（`gate-4.sh` 缺 88 行 / 独有 15 行、`gate-8.sh` 缺 47 行 / 独有 39 行、`typescript.sh`、`python.sh`、`powershell.sh`、`gate-10.sh`、`iac.sh`）。6 条 AC-495 用例跑在合成的 repo+install 树上，钉住查找顺序、三态判决与拒绝覆盖后文件字节不变。

- **`doctor` 的信任面在两个方向上同时说谎：诊断被超时丢弃、零差异被判成"安装副本较新"（#495 Round 2、#502、#503）**: 上面那条 #495 把自己要消灭的失败模式继承了回来。三处：**(a)** 漂移 FAIL 是在被 `Promise.race` 竞速的全局诊断内部算出来的，10s 超时一到就整体丢弃，doctor 在陈旧模块之上打印 `All checks passed`——正是本 issue 立项理由；现在 `timedOut` 被解构出来、强制计入 issue 数，并**同步重算** hook/module 漂移而不是扔掉。**(b)** `contentDelta` 会折叠行尾与缩进，因此一份仅 CRLF 不同的副本产生零差异，却落到"installed copy is newer than githooks/ (0 line(s) absent from the repo)"分支，输出一个方向为假、且 `--fix` 永远消不掉的 FAIL；零差异现在是明确说明"仅行尾/缩进不同"的 PASS。**(c)** 修复面与诊断面对"操作哪个仓库"口径不一：`diagnoseModuleDrift` 认 `XP_GATE_REPO_ROOT`，`syncModulesFromRepo` 读 `process.cwd()`，于是文档里的"仓库外执行 `--sync-hooks`"会一边报漂移一边什么都不同步；两者现在共用同一条 env 契约，没有 canonical `githooks/` 时 loudly 报错并 exit 1，而非静默 no-op。此外 `lib/` 共享库原先无条件覆盖，而 gate 模块遇到机器独有内容会拒绝覆盖——同一次发布里两套"销毁他人工作"的标准，现 `lib/` 走同一道发散守卫，被拒绝的文件逐个以 `⚠️  X NOT synced — install has N unique line(s)` 打印并指向 `--sync-hooks --force`。检测范围也从只查全局 adapters 目录扩到项目 tier（project 模式下 `ADAPTER_DIR` 解析到 `<repo>/githooks` 且平铺副本先于 nested 生效），FAIL 文案点名"执行自项目 tier"。**这条因果在本轮被实测推翻，以下为准**：`ADAPTER_DIR` 的第一档是全局目录，只要 `~/.config/xp-gate/adapter-common.sh` 存在（本机即在），hook 就永远解析到全局 tier，项目 tier 的平铺副本根本不执行——本仓库在 #493 之后仍继续执行旧 `iac.sh` 的那份遮蔽源是**全局**平铺副本对安装器写入的 nested 副本（#500），不是项目 tier；"执行自项目 tier"的文案只在真没有全局安装的机器上成立。Round 3 因此把诊断重写成单一解析模型（见下一条），本条保留原文是为了让读者看得见结论是如何被推翻的，而不是把它悄悄改掉。`--fix` 不再为新检出的语言调用包管理器（`--install-tools` 显式 opt-in，用法行同步），`xp-gate install` 也不再把自己的退出码等同于 doctor 的诊断码——诊断不是安装失败。守卫新增 3 个文件：`doctor-drift-round2.test.js`（超时/零差异/项目 tier）、`doctor-repair-boundary.test.js`（`KNOWN_FLAGS`、`--install-tools` 门、install 码边界、用法行），以及 `doctor-module-resolution-parity.test.js`——后者从 `githooks/pre-commit` 抽出 `resolve_adapter_path()` 本体在 bash 下执行，与 `listExecutedModules` 在同一棵树上逐个模块对账，补上"JS 镜像 hook 查找顺序却无守卫"这个缺口（同一 range 里已有先例）。

- **`doctor` 的执行面由两套解析模型决定，修复面还留着两条越界（#495 Round 3、#500、#502、#488、#429）**: 上一轮的两处"已修"各自只覆盖了一半。**诊断侧**：`listExecutedModules` 与 `syncModulesFromRepo` 各写了一份 hook 查找顺序，且都没有 `$SCRIPT_DIR` 这一档（`githooks/pre-commit:34-40` 的最后一档），于是"安装副本缺失"被报成"读不到的执行副本 FAIL"，而真正执行的那一档根本没被看；`adapter-common.sh` 也被塞进门禁模块链，而它在 `GATE_DIR` 解析之前就被 `ADAPTER_DIR` source（`githooks/pre-commit:41`）。现在两侧共用一个解析模型（`resolveExecutedModuleDirs()` + `executedModulePath()`，含全局/项目/script-dir 三档与 `resolve_adapter_path()` 的平铺优先顺序），非执行副本改为 `Non-executed copy: <name>` WARN（附绝对路径、不计入 issue 数）——#500 的安装残留因此**可见**而不被误报成漂移，FAIL 文案按 tier 点名实际执行来源。**修复侧**：同一条命令面里并存两套销毁标准——`fixStaleHooks()` 用 `updateHooks({force:true, noBackup:true, scope:'all'})` 无条件覆盖 hooks/adapters/门禁模块（`force` 还会让 `update-hooks` 的本地改动守卫直接返回 0，无备份抹掉机器独有内容），而同一批发布的 `syncModulesFromRepo()` 对同类风险明确拒绝并保留字节；另外 `fixIssues()` 里 `fixMissingCliTools()` 仍无条件 `require('./bootstrap.js')` 并 `execSync` 安装 CLI，`xp-gate install` 末尾又自动跑 `doctor --fix`，与 #502 立项理由同类。现在 `fixStaleHooks()` 不再调用 `updateHooks`，改用 `planStaleHookSync()` 逐文件判定：只刷新"仓库领先、安装侧无独有行"的安全项（逐条 `copyFileSync` + `chmod 755`，不再产生 `.bak` 垃圾，也不再写任何被拒绝的文件），发散/读不到的文件逐个点名并要求先人工裁决；平铺 adapter 条目**仅在该文件已存在时**才纳入同步计划，否则修复本身就会新植一份 #500 残留；CLI 工具安装改由 `--install-tools` 门控，`printCliToolGuidance()` 保持无条件（报告不是操作机器），`require('./bootstrap.js')` 在全文件只剩一处。**机器可读输出**：`--json`/`--format json`（#304 承诺至今）现在真正可用——stdout 只输出一个可解析文档、人类报告被抑制、超时后 issue 数强制 ≥1（修复后重诊断超时同样只报"WARN：修复结果未被确认"而非 clean，并把 hook/模块漂移重新计入），且 `--json`/`--format` 与 `--fix`/`--sync-hooks` 互斥（只读诊断不得顺手改机器）、未知 `--format` 值 exit 1。**发布说明侧**：`--round` 漏写、doctor flag 表面被写成两项、以及"项目 tier 平铺残留才是遮蔽源"的因果错误全部改正（见上两条）。守卫：`doctor-module-resolution-parity.test.js` 扩到 6 种布局 × 三档来源在 bash 里跑 hook 原文对账（AC-495-11/12/21/22），新增 `doctor-executed-surface.test.js`（AC-495-14..19，7 条）、`doctor-machine-mutation.test.js`（AC-502-04/05 + AC-495-20，3 条）、`doctor.test.js` 三条 `--json` 断言（AC-488-08），以及 `scripts/__tests__/changelog-documented-commands.test.cjs`——它从 runner 自己的 `missing.push()` 守卫和 `doctor.js` 的 `KNOWN_FLAGS` 反查发布说明里每条命令，把"文档教的命令跑不通"钉成回归门禁（AC-488-06/07、AC-429-05）；Round 3 的可行性席位进一步指出 help 行只列了两组 flag 却没说机器可读模式与 `--fix`/`--sync-hooks` 互斥，读者会以为 `doctor --fix --json` 可用，用法行现在明写这一点，同时该门禁的两个解析函数改为自校验形状并与 `missing.push` 的条数交叉核对，避免"解析少读一项→守卫静默放行"。

- **Round 4（可行性席位）在同一命令面上又抓到两个 #488 类缺陷，均已修复（#488、#502）**: `--force` 只被 `--sync-hooks` 消费，`doctor --force` 与 `doctor --fix --force` 此前被接受、零输出、零效果——正是 #488 立项要消灭的"接受但不执行"类；`--install-tools` 只被 `--fix` 消费、且是唯一会往机器装工具链的 flag，却在任何路径上都被接受。两者现在在错误组合下 exit 1 并给出正确用法（`--sync-hooks --force` / `--fix --install-tools`）。同时，所有建议 `--sync-hooks --force` 的地方（hook 拒同步、模块拒同步、`--fix` 发散拒绝）现在都说明该覆盖**没有自动备份、工具无法撤销**，要求先自行留存副本——此前整个命令面只有破坏性操作，没有一行恢复指引。实现上把 doctor 的 flag 契约抽成纯函数 `doctorFlagContract()` 并导出：关于"哪些组合被接受"的断言因此不再需要真跑 `--sync-hooks`（那会把仓库文件覆盖到本机安装副本上）才能成立。守卫：AC-488-09（两条拒绝）、AC-502-06（无备份恢复文案）。

- **`sync-package-content.js` 在 require() 时不再整仓同步（PR #506 CI Gate 5 的真凶）**: 脚本此前在模块顶层无条件 `main()`，任何只是想导入 `checkDocsDrift`/`checkAdapterDrift` 的测试都会在运行中途重建整个 npm-package 镜像；CI 上这会把 canonical #452 已提交、镜像侧从未入库的 `warnings-baseline-budgets.test.ts` 重新生成为新的未跟踪文件，被 `vitest-worktree-guard`（#428）正确判为测试污染而掐断。现在 `main()` 只在脚本被直接执行时运行（require 零副作用），缺失的字节级一致镜像文件随本版补齐，镜像同步恢复为 no-op。AC-TDD-005-04。

- **本轮新增上报**: #499/#501 — 机器副本独有、从未入库的 Gate 8 加固（detect-secrets 二级扫描 + gitleaks 缺失即 BLOCK），后者与 AGENTS.md"工具缺失 → SKIP 而非 BLOCK"契约冲突，需要人工裁决而非默默回收（`--sync-hooks` 现在会拒绝覆盖并逐个点名，见上一条 (c)）；#500 — 安装器只写 `adapters/<lang>.sh`（nested），而 `resolve_adapter_path()` 优先读平铺副本，于是平铺的旧副本永久遮蔽刚装好的那份（实测 `powershell.sh` nested 已等于仓库当前版本、flat 仍是 8 月旧版），全局模式下适配器修复必然不生效——本批只补齐**检测面**（执行来源按 tier 诊断并点名，未执行的残留以 `Non-executed copy` WARN 单独列出，见上一条），布局根修仍开放；#502 — `doctor --fix` 会为新检出的语言直接调用包管理器（Round 2 只门控了 `langIssues` 分支，`fixIssues()` 里的 `fixMissingCliTools()` 到本轮才一并门控，见上一条）；#503 — `xp-gate install` 采用 doctor 的诊断退出码作为自己的（本批已修）；#504 — `scripts/__tests__/gate-5-runner-error.test.ts` 的端到端用例在 149 文件并行下超过其内层 `execFileSync` 的 120s 上限而假红（单独运行 13/13 通过，124s），需要把该用例的 timeout 与并行负载解耦，否则"真实 hook 运行"这条断言在 CI 上不可依赖。另把"把模块查找顺序的原语从 `doctor.js` 里抽出来共用"记为重构候选（评审 Round 1 的 Minor，当前由 parity 测试钉住正确性，不阻塞发布）。

### Changed
- **delphi-review 的 Qoder 章节按实测重写**: 原文承诺"绑定格式正确即可让三个专家各跑一个内置模型"。2026-09-23 的隔离复测否定了这一承诺：三份 `~/.qoder/agents/delphi-*.md` 绑定为 `qfmodel`/`gfmodel`/`dfmodel` 且格式正确，文件修复**之后**新开一个会话（新 CLI 进程，注册表必然加载新绑定）再并行派发三个专家，`turn.started` / `model.request.started` / `model.response.completed` 记录到的 `model` 仍是三个独立的 `is_subagent:true` turn 全部落在会话模型上（架构角与会话模型同名、无判别力，判定依据是绑 `dfmodel` / `gfmodel` 的技术角与可行性角同样落在会话模型上）。故章节改为明示：Custom Agent 路径只能提供**同模型、三角色**评审，其共识不满足"三个不同可执行模型 ID"契约，也不得用作 Gate MW 的三模型凭据；契约合规仍需外部 provider（`.delphi-config.json`）。同时保留并说明绑定格式要求、`subagent_type` 派发方式、注册表需重开会话、部署不覆盖 + `init` 审计与升级步骤；同步更新 `docs/CAPABILITIES.md` 与各 skill 镜像。
- **Execution Verification 不再接受专家自述，且验证口径纠正**: 验证步骤要求以平台执行记录核对模型。原文给的 Qoder 口径（`~/.qoder/logs/runs/*/manifest.json` 的 argv `--model`）实测记录的是会话/进程启动模型、对 subagent 无判别力，已改为 `~/.qoder/logs/sessions/<project>/<sessionId>/segments/*.jsonl` 里 `model.request.started` 事件的 `model` 字段（OpenCode 仍为 provider 调用日志）；并补充"平台把 subagent 固定到会话模型时该检查根本无法通过"的处置说明。
- **根 lockfile 的 registry 归一化为 `registry.npmjs.org`**: `package-lock.json` 里 127/555 条 `"resolved"` 指向 `registry.npmmirror.com`（开发者用户级 `~/.npmrc` 的镜像被 npm 原样写入），使 CI 安装的 tarball 来源变成第三方镜像。现只改 `"resolved"` 的来源（scheme+authority，`integrity`/`version`/路径/格式不动，127 插入/127 删除全部落在 `"resolved"` 行），并新增 `scripts/normalize-lock-registry.cjs`（`npm run normalize-lock`：检测走 `JSON.parse` 语义，判净条件收紧为 `https:` + 裸 `registry.npmjs.org`（带非默认端口、带凭据、带 query、明文 http、无法解析与非字符串的值都算 offender，不再静默跳过；文本切出的 tail 与 URL 解析出的 tail 不一致、或改写结果等于输入时一律拒绝自动改写），改写是按 URL 值的定点文本替换（与行尾/空格无关）并按唯一 URL 去重；canonical 主机上的端口与凭据只上报、不擅自改路由；改写后深比较前后 JSON 树，任何非 `resolved` 叶变化直接抛错，残留非空即 exit 1；写盘 `${pid}.tmp` + `try/finally` 原子改名）+ `scripts/__tests__/package-lock-registry.test.cjs` 守护（31 条：锁仓不变量 + 纯函数边界（CRLF/紧凑排版/端口/凭据/query/legacy 树/共享 URL/幂等/畸形输入/解析失败）+ `normalizeFile` 落盘与 mtime 不变 + CLI 退出码与逐目标容错；判净与修复共用 `findRegistryOffenders` 以免"守护判红、工具说没事"，同时另加一条**只读原文、不受工具影响**的哨兵（`"resolved"` 文本计数等于解析计数、所有 http(s) 值以 canonical 前缀开头）补掉共用分类器的自证死角；CLI 默认目标测试运行在临时副本上，守护测试绝不改写被跟踪的 lock）；`.gitattributes` 补 `package-lock.json text eol=lf`（原先只对 `.sh` 与 hook 强制 LF）。**镜像 tarball 与官方 tarball 是否字节一致已实测证实**：逐条向 `registry.npmjs.org` 取 `versions[ver].dist.integrity` 与 lock 比对，`checked=555 mismatch=0 missing=0`，覆盖 ubuntu CI 永不下载的平台门控二进制。取舍记录见 `docs/plans/2026-09-30-package-lock-registry-normalization.md`：实测 npm 11.17.0 的 `replace-registry-host`（`npmjs`/`never`/`always`/显式主机四种取值）都不能改变 npm 写入 `resolved` 的镜像主机（该选项只在下载期改写主机，见计划 §2 M8），仓库级 `registry=https://registry.npmjs.org` 又会在官方 registry 不可达的机器上让 `npm install` 直接失败，因此采用"归一化 + 可离线修复 + CI 守护"；增量 `npm install` 每次只会写回 1 条，守护据此给出可一键执行的修复路径。同步移除 `cross-platform-ci.yml:69` 的 `npm ci || npm install` 兜底（它会静默重装并重写工作区 lock，把漂移信号降级）。**注意**：这是供应链卫生改进，不是修 CI —— 归一化前的 lock 在 GitHub runner 上同样能装。

## [0.19.3.0] - 2026-09-24

### Fixed
- **Gate 11 (`sprint-gate.sh`) 解析链回归 (#430)**: 镜像同步意外回滚了 2026-08-03 的 mirror-only 热修，导致 `xp-gate init` 安装的项目中 Gate 11 因解析链断裂而静默跳过。现将 `SCRIPT_DIR` tier 恢复到 canonical `githooks/pre-commit`（tier 顺序 GATE_DIR → repo-root → SCRIPT_DIR，带 BEGIN/END 标记），并以 5 个 BATS 测试锁定（tier1/2/3/none + npm 镜像字节一致性）。
- **镜像 executable bit 回归 (#430)**: `sprint-gate.sh` 与 `clipboard-vision.sh` 的镜像副本在 resync 中从 100755 退化为 100644；597 对镜像 mode 审计已归零。
- **插件 manifest 门禁计数陈旧 (#430)**: Qoder 与 Claude Code 的 plugin.json description 由 "10 quality gates (Gate 0-9), Sprint Flow (11 phases)" 更正为 "12 pre-commit gates (Gate 0-11), 8 pre-push gates, Sprint Flow (6 phases)"。

### Changed
- **Qoder 插件与 npm 镜像全量重同步 (#430)**: 13 个 canonical `skills/**` 同步进 `plugins/qoder/skills/**` 及 npm 镜像（sprint-flow 2.0.0 → 2.1.0）；7 个被 canonical 镜像取代的 legacy 技能树（30 文件）删除；`src/npm-package/plugins/dsh/**` 快照首次纳入跟踪。

## [0.19.2.0] - 2026-09-22

### Fixed
- **npm 发布包缺失 `gate-10.sh` (#411)**: `files` 数组遗漏 `gate-10.sh`，导致发布 tarball 缺该文件、全局安装后 `doctor --fix` 从包根恢复时静默失败。新增回归测试锁定两条不变量：包根 `gate-*.sh` 必须全部列入 `files`，且 `files` 必须覆盖 doctor `EXPECTED_GATE_SCRIPTS`。

## [0.19.1.0] - 2026-08-30

### Fixed
- **PowerShell Pester 测试运行器超时保护 (#406)**: 为 PowerShell Pester 测试执行添加超时防护，避免无响应的 Pester 测试进程挂起并阻塞门禁链路。

## [0.19.0.0] - 2026-08-24

### Added
- **DeepSeek Harness (DSH) 原生插件 (`@boyingliu01/dsh-plugin-xp-gate`)**: 以原生插件契约 (`name`/`inject`/`apply`) 集成 gate-check / gate-principles / gate-arch 三个确定性质量门禁工具，并随包捆绑 12 个 SKILL.md 技能 (Issue #393)。

### Changed
- dsh 插件接入 build/version/test 流水线：`sync-package-content.js` (PLUGINS)、`sync-version.cjs` (targets)、`build-plugin.mjs` (~platform dsh)、`test-plugins.mjs` (manifest 校验)。

## [0.18.6.0] - 2026-07-29

### Added
- **clipboard-vision skill (#379)**: 跨平台剪贴板图片识别 skill，支持 Windows (PowerShell) 和 WSL/Linux/macOS (bash+xclip/osascript)。使用 `CLIPBOARD_VISION_API_KEY` 环境变量配置 API key，通过 LOCAL/Qwen3.5-122B-A10B 视觉模型将剪贴板截图转为文字描述。包含 `describe-clipboard.ps1`（Windows）和 `describe-clipboard.sh`（跨平台 bash）双脚本实现。

## [0.18.5.1] - 2026-08-26

### Fixed
- **PowerShell 测试超时保护 (#405)**: `run_tests` / `run_coverage` 现在通过 GNU `timeout` 包裹 `Invoke-Pester`，默认 300s（可用 `XP_GATE_POWERSHELL_TEST_TIMEOUT_S` 覆盖）。此前若某个 Pester 测试挂起（例如测试点源了脚本、脚本体执行 WMI/注册表/计划任务扫描），`git commit` 会无限阻塞。现在超时后会打印清晰警告并返回非零退出码，而非永久挂起。

## [0.17.0.0] - 2026-07-22

### Added
- **Sprint 初始化 CLI (`xp-gate sprint-init`)**: Phase 1 PREP 自动创建 sprint-state.json，消除编排器"记住"手动写入状态文件的依赖。
- **Phase-Transition 程序化强制执行 (#366)**: 三层强制机制 — Layer 1 sprint-init 自动初始化 + Layer 2 TodoWrite 嵌入式调用 + Layer 3 sprint-gate.sh 门禁检查。
- **SKILL.md 结构化重写**: frontmatter WHAT/WHEN/NOT WHEN/TRIGGERS 完整描述、Phase 1 展开（触发条件/输入/步骤/输出）、门禁条件表、状态机图、决策记录模板、失败处理策略。

### Changed
- Sprint-flow SKILL.md 从纯文本指令升级为结构化状态机文档，支持程序化验证。

## [0.16.0.0] - 2026-07-22

### Added
- **PowerShell 适配器原生支持 (#357)**: Gate 3/7/8/9 TypeScript 模块支持 PowerShell 项目语言检测与路由；PowerShell 项目自动路由到 PSScriptAnalyzer 规则。
- **Python 环境健康检查 (#356)**: 双层架构 — Layer 1 bash preflight（pre-commit 热路径，零延迟）+ Layer 2 TypeScript 完整诊断（CLI/doctor 按需运行）；Windows Store 存根自动过滤。
- **分层测试分析 (#359)**: `xp-gate test-layers` 报告 unit/integration/e2e 测试分布与源文件-测试文件配对统计；analytics-only 模式，不 BLOCK 提交。
- **PBT 检测 (#337)**: `xp-gate pbt` 检测 fast-check/jsverify/jest-property/ava-fast-check 框架使用情况并输出覆盖率报告；analytics-only 模式，不 BLOCK 提交。
- **TypeScript Gate 共享基础设施**: `src/gates/common.ts` 提供 `isToolAvailable()` 3层检测、`runTool()` spawnSync 封装、`recordAudit()` 审计日志、`getChangedFiles()`/`detectProjectLang()` 等通用功能。

### Fixed
- **OpenCode plugin shell:true (#365)**: 修复 gate-runner.js 中 `runTsGate()` 在 Windows 下未设置 `shell: true` 导致 `npx tsx` 启动失败的问题。

### Changed
- **ESLint 配置优化**: 测试文件 (`__tests__/**/*.ts`, `*.test.ts`) 关闭 `@typescript-eslint/no-explicit-any` 规则；`src/npm-package/coverage/` 加入 ignores。

## [0.15.4.0] - 2026-07-22

### Changed
- **`xp-gate install` 一键安装**: 重写为 `init` + `baseline` + `bootstrap` + `doctor --fix` 的完整编排，用户只需记一个命令。
- **`xp-gate doctor --fix` 自动修复增强**: 自动同步过时 hooks（update-hooks）、自动安装缺失 CLI 工具（bootstrap）、自动安装缺失语言工具（install-tools）。
- **`xp-gate init` 默认创建 baseline**: Boy Scout Rule 开箱即用，不再需要 `--baseline` flag。
- **`xp-gate uninstall` 清理增强**: 自动清理 `.xp-gate-config.json` 和 `.warnings-baseline.json`。

### Added
- **pre-commit audit 覆盖**: Gate 0（版本一致性）、Gate 9（构建完整性）、Gate 11（Sprint Flow）补充 audit 记录，实现全门禁审计追踪。
- **Sprint Flow Phase 4 集成**: 新增 `xp-gate check --all` 步骤，自动运行所有可用质量门禁。

## [0.15.3.0] - 2026-07-22

### Added
- **多语言质量门禁完善**: 自动检测项目语言 + 检查/安装语言特定工具 + 项目级配置持久化。
- **`xp-gate detect-languages` CLI**: 检测项目使用的编程语言，生成 `.xp-gate-config.json` 配置文件。
- **`xp-gate check-tools` CLI**: 检查每种语言所需的质量门禁工具可用性（必需/可选分类）。
- **`xp-gate install-tools` CLI**: 自动安装缺失的语言特定工具（支持 `--dry-run` 和 `--yes`）。
- **`language-tools.js` 模块**: 12 种语言的工具注册表（TypeScript/Python/Java/Go/Kotlin/Swift/Dart/Flutter/C++/Shell/PowerShell/IaC）。
- **`xp-gate init` 增强**: 初始化时自动检测项目语言、检查工具状态、提示安装缺失工具。
- **`xp-gate doctor` 增强**: 诊断报告中显示语言特定工具状态。
- **pre-commit hook 增强**: 读取 `.xp-gate-config.json` 作为语言检测的补充来源（优先级：override > config file > extension detection）。

### Changed
- **多语言模式完善**: 每个项目支持多语言模式，不再要求单一语言。工具缺失时优雅降级（SKIP 而非 BLOCK）。

## [0.15.1.0] - 2026-07-22

### Added
- **Gate 1 Python 增强**: `ruff format --check` 格式检查 + `breakpoint()`/`pdb.set_trace()` 调试语句检测（阻塞提交）。
- **Gate 1 JS/TS 增强**: `debugger` 语句检测（阻塞提交）。
- **Java JaCoCo 检测**: `_detect_jacoco_configured()` 函数，未配置 JaCoCo 时覆盖率检查降级为 SKIP 而非 BLOCK。
- **语言覆盖 3-tier 优先级**: `.xp-gate-lang` 文件 > `git config xp-gate.lang` > `XP_GATE_LANG` env（deprecated warning）。
- **Python Principles 适配器增强**: `extractFunctions()` 返回 startLine/length/params；`extractClasses()` 返回 startLine/length/methodCount；新增 `extractExports()` 方法。

### Changed
- **Windows 兼容性**: 所有 `/dev/stdin` 替换为 `fs.readFileSync(0,'utf8')`（10 处），解决 Git Bash 下路径不存在问题。
- **python3 依赖移除**: pre-commit/pre-push/gate-9 中所有 `python3` 调用替换为 Node.js 等效实现（时间戳、JSON 解析、报告写入）。
- Python 适配器 `getCodeBlock` 上限从 50 行提升到 200 行。

### Fixed
- 修复 Windows Git Bash 下 Gate 1 因 `/dev/stdin` 不存在而静默失效的问题 (#361)。
- 修复 Windows 下 `python3` 不可用导致时间戳/报告生成失败的问题 (#362)。
- 修复 Java 项目无 JaCoCo 时覆盖率门禁误阻塞的问题 (#363)。

## [0.14.30.0] - 2026-07-22

### Added
- **Sprint State 双层强制执行机制**: Layer 1（phase-transition 前置检查，确保前一 Phase 已完成）+ Layer 1.5（Phase 6 completed 自动提醒运行 sprint-audit）+ Layer 2（`xp-gate sprint-audit` CLI，检查 phase 覆盖度、时间记录、输出物、状态一致性）。
- **`xp-gate sprint-audit` CLI 命令**: 最终完整性审计，verdict 分级（PASS / PASS_WITH_WARNINGS / FAIL / SKIP），支持 `--json` 和 `--dir` 参数，报告持久化到 `.sprint-state/audit-report.json`。
- **PHASE_NAMES 共享常量**: 从 `phase-transition.js` 导出，供 `sprint-audit.js` 引用。
- **20 个新测试**: 8 个 Layer 1 前置检查测试 + 12 个 Layer 2 审计测试，33 个测试全部通过。

### Changed
- `phase-transition.js`: 新增 Layer 1 前置检查逻辑 + Layer 1.5 自动提醒 + PHASE_NAMES 导出。
- `orchestration-rules.md`: 新增 Step 4（Phase 6 CLOSE 后运行 sprint-audit）。
- 架构基线更新（`.architecture-baseline.json`）。

## [0.14.29.0] - 2026-07-22

### Changed
- 版本号升级至 0.14.29.0（npm registry 版本占用，顺延发布）。
- 功能内容与 0.14.27.0 一致：Qoder Delphi Agent 自动部署 + 文档同步。

## [0.14.27.0] - 2026-07-22

### Added
- **Qoder Delphi Agent 自动部署**: `xp-gate init` 检测 Qoder 平台时自动部署 3 个 Custom Agent（架构/技术/可行性）到 `.qoder/agents/`，使用 Qwen3.7-Max、GLM-5.2、DeepSeek-V4-Pro 内置模型，零配置开箱即用。
- **Agent 模板分发**: 新增 `plugins/qoder/agents/` 目录，随 npm 包同步分发。`configureQoderDelphiAgents()` 函数幂等部署，不覆盖用户自定义。
- **3 个单元测试**: 覆盖部署、用户自定义保护、非 Qoder 平台跳过三个场景。

### Changed
- README.md: 新增 Qoder 插件说明，Delphi Review 平台适配描述。
- CAPABILITIES.md: Delphi 专家配置区分 Qoder（零配置）和 OpenCode（外部 API）两平台。
- AGENTS.md: Qoder plugin 描述更新，含 Delphi agent 自动部署。
- SKILL.md: 各平台副本同步（delphi-review 模型选择策略）。

### Infrastructure
- `init.js` 新增 `configureQoderDelphiAgents()` 函数，平台感知安装流程。
- `sync-package-content.js` 自动同步 `plugins/qoder/agents/` 到 npm 包。

## [0.14.23.0] - 2026-07-21

### Added
- **Delphi Review 跨模型评审 (Qoder)**: 新增 `scripts/delphi-external-review.cjs` 脚本，通过 OpenAI-compatible API 直接调用外部模型（DeepSeek/Qwen/GLM），实现 Qoder 平台真正的跨模型交叉评审。支持 profiles 配置切换、混合模式（local + external）、4 层 JSON 容错提取、分级重试策略。
- **.delphi-config.json profiles**: 配置文件支持多 profile（如 default/starter），一键切换不同模型组合。支持 `provider: "local"` 混合模式渐进式配置。
- **设计文档**: `docs/superpowers/specs/2026-07-21-delphi-review-qoder-cross-model-design.md` — 经 Delphi 两轮评审通过的设计方案。

### Changed
- Qoder SKILL.md / INSTALL.md / AGENTS.md 更新：移除 opencode.json 引用，改为 Bash 调用外部脚本模式。
- `.delphi-config.json.example` 重构：profiles + providers + experts 新格式，含 starter 混合模式示例。
- `sync-package-content.js` 新增 `syncScripts()` 函数，打包时自动复制 `delphi-external-review.cjs` 到 npm 包。

### Infrastructure
- 29 个单元测试覆盖脚本所有纯逻辑函数（parseArgs, readConfig, validateCrossProvider, extractJsonFromResponse 等）。
- npm 包分发：脚本通过 sync-package-content.js 自动同步到 `src/npm-package/scripts/`。

## [0.14.16.0] - 2026-07-20

### Fixed
- npm publish 版本冲突修复 — 0.14.15 已被占用，升级到 0.14.16 重新发布

## [0.14.15.0] - 2026-07-20

### Added
- **#350 File Hygiene Gate (Gate 12)**: 新增 `gate-12-file-hygiene.sh`，检测 staged files 中的 trailing whitespace、missing EOF newline、merge conflict markers、oversized files (>1MB)。Conflict markers 硬阻断，其他问题仅警告。
- **#351 YAML/JSON Syntax Validation**: Gate 12 集成 YAML/JSON 语法校验（Check 5），使用 Python yaml 模块（YAML）和 Node.js JSON.parse（JSON）检测语法错误。语法错误硬阻断。

### Fixed
- **#354**: npm-package hooks 镜像同步 — `src/npm-package/hooks/gate-8.sh` 中 GIBLEAKS_CMD 拼写错误修复（githooks 源已在 v0.14.12 修复）
- **#348**: doctor 性能进一步优化 — EXEC_TIMEOUT_MS 从 3000ms 降至 1500ms；新增全局诊断超时保护 (10s)；upgrade check 独立 3s 超时，防止网络延迟叠加

### Infrastructure
- pre-commit hook 集成 Gate 12（source gate-12-file-hygiene.sh），含 3-tier fallback 路径解析
- npm-package 镜像同步（gate-12-file-hygiene.sh + pre-commit）

## [0.14.12.0] - 2026-07-17

### Fixed
- **#354**: gate-8.sh typo (GIBLEAKS_CMD → GITLEAKS_CMD) - 修复 secret scanning fallback 路径失效
- **#349**: install-skill --force 不清理目标目录 - backup 后显式 rmSync 防止 stale references 残留
- **#347**: update-skill --all 解析错误 - CLI dispatcher 在 extractPositionalArg 之前检测 --all flag
- **#348**: doctor 性能优化 (43s → 2-3.5s) - 并行化所有检查项 + 所有 execSync 调用添加 3 秒超时
- **#341**: ARCH-03 PROJECT_SUBDIR 在多语言 monorepo 中丢失 - 从已修改文件路径派生 PROJECT_SUBDIR，向上遍历查找项目标记
- **#342**: sync-package-content test 改进 - 从 Node native test runner 迁移到 Jest，消除同义反复测试

### Enhanced
- **#333**: xp-gate check CLI 从覆盖 2/11 gates 扩展到覆盖所有 11 道 gates + alias 映射 (version/lint/dup/complexity/principles/tests/arch/iac/secrets/sast/build/sprint)

### Test
- doctor.test.js 异步 mock 基础设施修复 - 为 CI 失败的 17 个测试添加 util.promisify.custom 支持
- 跨平台测试兼容性 - update-hooks.test.ts (Windows fs.access), sprint-discovery.test.ts (path.join), ui-detector.test.ts (spawnSync shell:true)

## [0.14.10.0] - 2026-07-15

### Added
- **#343 Sprint State Manager**: 集中式状态管理 — `SprintStateManager` (JS CommonJS) 提供 `read()`/`write()`/`transitionPhase()`/`rollback()` API，统一 schema 验证 + 自动迁移 + 原子写入
- **#338 Auto-Render Enforcement**: 通过 `onTransition` 回调机制实现 Phase 转换后自动渲染进度看板，消除文本级 MUST 指令的不可执行性
- **#339 Gate MW Provenance Validation**: pre-push 新增溯源验证 — 检查 `experts[]` (≥3)、`consensus` (≥90%)、`walkthroughHash` (SHA-256 跨平台验证)、`generatedAt`，防止 LLM 伪造 walkthrough 结果
- **Migration Mechanism**: 自动迁移遗留 sprint-state.json (无 `_schema_version`) 到 v1 schema，备份原文件，记录迁移警告
- **Grace Period Support**: Gate MW 溯源验证支持 `XP_GATE_MW_GRACE_DAYS` 环境变量 (默认 30 天)，旧格式 walkthrough 获得 WARNING 而非 BLOCK

### Changed
- **Reader Refactoring**: 4 个 reader 统一使用 `SprintStateManager` — `sprint-status.js`、`sprint-discovery.js`、`next-sprint.js`、`sprint-state-io.ts`
- **Version Tracking**: `install-skill.js` 使用 `getCliVersion()` 读取实际版本号 (从 VERSION 文件)，替代硬编码 `'1.0.0'`
- **Test Updates**: 7 个测试文件更新以适配 v1 schema — `sprint-state-manager.test.js` (15 tests)、`sprint-status.test.js`、`sprint-discovery.test.ts`、`sprint-recorder.test.ts`、`span-tracer.test.ts`、`sprint-state-io.test.ts`、`install-skill.test.js`

### Fixed
- **#332**: `install-skill` 现在记录实际 CLI 版本而非硬编码 `'1.0.0'`，`upgrade --apply` 同步已修复
- **#334**: 验证多语言检测正常工作 — `PROJECT_LANGS` 基于文件扩展名检测，混合技术栈项目所有语言均受门禁保护

### Architecture
- **Module Separation**: `SprintStateManager` 拆分为 `sprint-state-manager.js` (核心 API) + `sprint-state-migrator.js` (迁移逻辑)，满足 god-class 规则 (≤15 methods)
- **Atomic Write Pattern**: 所有状态写入使用 tmp + rename 模式，防止并发写入导致数据损坏
- **Observer Pattern**: `transitionPhase()` 支持 `onTransition` 回调，渲染失败降级为 WARNING 而非 BLOCK

## [0.14.9.0] - 2026-07-13

### Added
- **#332 (P0 Bugfix)**: `upgrade --apply` 现在更新已安装的 skills — `handleApplyMode()` 在升级 OpenCode 插件后调用 `updateSkill(null, { all: true })`，修复了升级后 skill 版本不更新的 bug
- **#332 (Doctor)**: `doctor` 新增 Check 9 (`diagnoseInstalledSkills()`) — 对比已安装 skills 与 npm 包内置 SKILL.md 内容，检测版本不一致
- **#328**: mutation 模块测试覆盖 — 5 个新测试文件 (stryker-runner, mutmut-runner, runners-index, init-baseline, update-baseline), 136 个测试
- **#329**: adapter 镜像漂移检测 — `checkAdapterDrift()` 在 `sync-package-content.js` 中使用 SHA-256 哈希比对 `githooks/adapters/` (源) 与 `src/npm-package/adapters/` (镜像)，不一致时阻断 prepack。`copy-skills.sh` 新增 `--verify` 模式进行 checksum 校验。7 个测试
- **#322**: Phase 2/6 DESIGN 路由优化 — `CONTEXT.md` 存在时跳过 brainstorming，直接使用已有设计上下文进入 autoplan/delphi-review

### Changed
- **#329**: `copy-skills.sh` 新增 `--verify` 参数 — 复制后通过 SHA-256 比较验证文件完整性

### Fixed
- 修复 `mutmut-runner.test.ts` 中未使用的 `callCount` 变量 (lint 错误)
- 修复 `update-baseline.test.ts` 中空 arrow function (lint 警告)

## [0.14.8.0] - 2026-07-13

### Added
- **#327**: Mock-policy 单元测试覆盖 — `gate-m3.test.ts` (17 tests) + `schema.test.ts` (23 tests)，共 40 个新测试
- **#323**: 恢复 `xp-gate next-sprint` 命令 — 从 git history 恢复 `next-sprint.js` (129 lines) + `next-sprint.test.js` (14 tests) + CLI 注册
- **#325**: Quality Gate Enhancement (Delphi APPROVED, 100% consensus) — Boy Scout Rule (`boy-scout.ts`) 差异化警告执行 + 13 语言适配器 (java/kotlin/cpp/objectivec 等) + baseline CLI (`xp-gate baseline`) + pre-push Gate M/MD/ML/MW/MS 兼容验证

### Changed
- **#324**: Sprint branch cleanup 设计文档状态 DRAFT → APPROVED — Phase 6/6 CLOSE 已包含完整分支清理步骤 (保存分支信息 → worktree remove → branch -D → push --delete → 关闭遗留 PR)，13 个遗留 sprint 远程分支已清理

### Fixed
- **#326**: Principles rules 单元测试验证 — 确认 15 个规则测试已存在 (100 tests, 16 files, 1462 lines)

## [0.14.7.0] - 2026-07-12

### Changed
- **#321**: `sprint-status.js` 迁移至 6-phase 命名（PREP/DESIGN/BUILD/VERIFY/SHIP/CLOSE），替换旧 11-phase schema。向后兼容旧 sprint-state.json（未识别的 phase key 显示原始值）

### Fixed
- 归档 stale sprint-2026-07-09-01 状态至 `.sprint-history/`
- `gates/README.md` TODO 状态更新 — 准确标记完成/延期项，补充 monolithic pre-commit 设计说明
- `whalecloud-java` PMD 自定义规则 TODO 标记为 Deferred，同步 npm-package 镜像

## [0.14.6.2] - 2026-07-10

### Added
- **#313**: OpenCode plugin 新增 `session-reload-model` tool — 在切换模型供应商配置后，将 `oh-my-openagent.json` 中的 sisyphus 模型同步到 OpenCode SQLite DB，确保 session 恢复后使用新的 provider/model 配置

## [0.14.3.0] - 2026-07-09

### Fixed
- **#311**: Sprint-flow Phase 5 SHIP → CLOSE 增加 HARD-GATE，确保 merge to main + release 完成后才进入 Phase 6，防止 worktree 清理残留和 UAT 验收未合并版本。新增 sprint-state 备份步骤。
- **#312**: pre-commit 增量门禁优化 — 无代码文件变更时 Gate 5 跳过测试运行；Gate 1/7/10 增加变更范围感知，非匹配文件 skip，大幅减少 release commit 耗时

## [0.14.2.0] - 2026-07-09

### Added
- **#310**: OpenCode plugin 新增 session-rename tool — 支持手动指定标题或从最近 10 条用户消息中自动生成标题，直接操作 OpenCode SQLite 数据库，零新依赖

## [0.14.1.0] - 2026-07-09

### Fixed
- **#305**: Sprint-flow BUILD 阶段新增 TDD-GATE 强制执行 — 在 BUILD 入口验证 failing test 存在后才允许 delegation (AGENTS.md + SKILL.md + phase-3-build.md)
- **#307**: CI Mutation Testing 修复 — update-hooks.test.js 中 getProjectHooksDir 测试现在创建 .git 目录隔离，不再因 Stryker 沙箱环境失败

### Changed
- **#306**: Sprint-flow DESIGN 阶段路由分叉 — 根据 PREP 的 `change_type` 区分新产品设计 vs 增量优化路径，增量变更跳过 autoplan 直接进入 lightweight delphi-review
- **#308**: Sprint 迭代结束归档 — CLOSE 阶段新增 Part A.5 ARCHIVE，将 .sprint-state/ 归档到 .sprint-history/ 供后续回溯

## [0.14.0.0] - 2026-07-08

### Added
- **`xp-gate install`**: one-step install command (init + bootstrap + doctor) (#301)
- **`xp-gate uninstall --purge`**: full cleanup of ~/.xp-gate/, ~/.config/xp-gate/, git core.hooksPath, and project .xp-gate/ (#301)
- **GATE_TOOLS classification**: tools cataloged by gate (PLATFORM/IAC/LINT/TEST/MUTATION), cross-referenced via `verify-tool-map.js` (#304, #302)
- **`detectProjectLang()`**: 12-language detection from project markers (tsconfig.json, go.mod, pyproject.toml, etc.) (#304)
- **`doctor --format json`**: machine-readable JSON output for script integration (#304)
- **`bootstrap --lang ts/py/go`**: language-specific tool install support (#304)
- **`postinstall` hint**: npm install -g prints next-steps guidance (#301)

### Fixed
- **gate-9.sh**: GATE 10 → GATE 9 in header, echo messages, and audit log variable naming (#303)
- **doctor**: grouped output by gate category, missing pre-push tools now detected
- **bootstrap/home resolution**: uses shared-paths.js `HOME_DIR` (incl. USERPROFILE) consistently across all commands

### Changed
- **init.js / install-cmd.js**: `copyHooks`/`copyAdapters` extracted to `shared-utils.js` (DRY)
- **Delphi-reviewed**: design doc passes 3-expert consensus (Round 2, 100%); code-walkthrough passes 2-expert consensus (Round 3, 100%)

## [0.13.1.0] - 2026-07-08

### Fixed
- **doctor/bootstrap**: `checkCliTool()` no longer returns false negatives on Windows — uses `where` (Windows) / `which` (Unix) for PATH resolution, explicit `shell` option (`cmd.exe` / `/bin/sh`), platform-appropriate stderr redirection (`2>nul` vs `2>/dev/null`), and 15s timeout for Python tool cold start (#299)

## [0.13.0.0] - 2026-07-08

### Changed
- **Sprint Flow Compact Redesign**: 11-phase model → 6-phase model (PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE) (#290)
  - Reduces cognitive load from 11 phases to 6, addressing user feedback about losing track of current phase
  - All HARD-GATEs preserved (Delphi consensus internal to DESIGN, UAT mandatory in CLOSE)
  - `render-sprint-progress.cjs` updated with full backward compatibility for legacy `sprint-state.json` files
  - CLI params (`--stop-at`, `--resume-from`, `--phase`) accept both old and new phase names
  - 11 reference files merged into 6; all templates updated; all 7 plugin mirrors synced

### Fixed
- Closes #272 (Sprint Flow step adherence 65% — workflow too complex)
- Closes #290 (RFC: Sprint Flow redesign — compact 7-phase flow + visual progress indicator)

## [0.12.11.0] - 2026-07-06

### Fixed
- **Gate 1**: pre-commit and TypeScript adapter now run tsc on test files — detects type errors in `__tests__/` when tsconfig.json excludes them (#293)
- **Gate 1 (Biome)**: inverted condition fixed — Biome check now actually runs when `biome.json` exists (was: only warned when missing) (#292)

### Changed
- **npm-package mirror**: `src/npm-package/hooks/adapter-common.sh` synced to match githooks (missed from PR #288)

## [0.12.10.0] - 2026-07-06

### Fixed
- **Gate M**: `detect_mutation_testable()` no longer requires stryker config file — checks `package.json` dependency first, then `npx` availability (#288)
- **Gate 5**: sprint-flow tests now compatibile with vitest — `process.exit()` replaced with `describe`/`it`/`beforeAll` wrappers; standalone `node script.js` mode preserved
- **Gate 3 (CI)**: lizard path exclusions + `tr '\n' ' '` fix for find newline bug; non-blocking in CI
- **doctor test AC-004-02**: cache version `999.999.999`→`0.1.0` so `compareVersions` correctly returns `outdated=false`; all AC-004 tests set `XP_GATE_CACHE_DIR`
- **check-version**: `XP_GATE_DIR` changed from IIFE constant to runtime `xpGateDir()` supporting `XP_GATE_CACHE_DIR` env var injection
- **large-file threshold**: raised from 650→1000 in `config.ts` and `.principlesrc`; updated all test assertions

## [0.12.4.1] - 2026-07-03

### Fixed
- **Gate 4**: `principles/index.ts` CLI entry now works under `npx tsx` (ESM `require.main` guard) — was silently producing empty output
- **Gate 9/10 variable collision**: Semgrep SAST (`gate-9.sh`) used `GATE_9_STATUS` overwriting Build Integrity result; renamed to `GATE_10_STATUS`
- **npm-package mirror sync**: `src/npm-package/principles/index.ts` now matches source-of-truth; architecture baseline re-snapped

### Changed
- **Gate 5 vitest optimization**: single `vitest run --coverage` replaces separate test+coverage runs, saving ~40s
- `githooks/adapters/python.sh`: replace `tail -30` with FAILED-line grep for actionable test failure output

## [0.12.4.0] - 2026-07-03

### Refactor
- Project slimming: remove dead code, stale docs, abandoned TUI panel
  - `src/npm-package/skills/`, `src/npm-package/sprint-flow/`, `src/npm-package/build-integrity/`
  - `src/npm-package/gate-*.sh`, `src/npm-package/lib/next-sprint.js`
  - `plugins/opencode/tui-plugin.ts/.tsx`, `src/npm-package/lib/shared-phase-constants.*`
  - 10 stale design docs, `.github/workflows/mutation-test-go.yml`
- Gate 6 arch fixes: reduce `getLatestTimestamp` complexity, split `updateHooks` into focused functions
- `gate-m3.ts`: skip non-existent files instead of ENOENT crash
- Init/gate scripts: sync global hooks to latest, clean project-level hooksPath

## [0.12.3.0] - 2026-07-03

### Added
- **OTel GenAI 可观测性** — debugger 模块新增 OpenTelemetry GenAI span tracing、token 差异追踪、批量导出，零性能开销（`--observability` 开关）。
- `src/debugger/span-types.ts`: OTel GenAI 语义约定类型 (SpanKind, Attributes, OperationType)
- `src/debugger/token-delta.ts`: 差分 Token 用量追踪
- `src/debugger/span-tracer.ts`: 层级 Span 树构建器 (max_depth=10)
- `src/debugger/batch-exporter.ts`: 异步批量 Span 导出
- `src/debugger/sprint-state-io.ts`: 共享 sprint state I/O（消除 CodeClone）
- `src/debugger/evolution-logger.ts`: 函数式模式，避免 archlint DeadSymbol 误报
- 8 个测试文件，68+ 新测试，1835+ 总测试通过

### Fixed
- **Gate 6 Boy Scout Rule**: span-types.ts 导出数从 11 降至 10 以满足 `clean-code.many-exports`
- **Gate 6 DeadSymbol**: evolution-logger.ts 从 class 重构为函数式模式以满足 archlint 追踪

## [0.12.2.0] - 2026-07-02

### Changed
- README.md: 全量重写 README/CAPABILITIES.md，修复已知 10 项 doc-vs-script drift

### Added
- **Gate M: Multi-language mutation testing** — LangAdapter system now routes mutation testing to language-specific runners: Stryker (TypeScript), Mutmut (Python), gomutants (Go), PITest (Java/Kotlin).
- **PitestRunner** — Full PITest integration for Java/Kotlin via Maven (`mvn pitest:mutationCoverage`) and Gradle (`info.solidsoft.pitest` plugin). Supports dual build-tool detection, JSON report parsing (Maven timestamped-dir + Gradle fixed-path), and per-file test matching.
- **Go mutation testing** — Incremental mutation for Go files via `gomutants` with auto-fallback detection (GOPATH/GOMODCACHE).
- **Per-language pre-push sections** — Separate Gate M sections for TypeScript, Python, Go, Java, Kotlin in `githooks/pre-push` with graceful SKIP when tools are missing.

### Changed
- **gate-m.ts refactored** — Extracted `findJavaTestFile`/`findKotlinTestFile` helpers to comply with architecture linter cognitive complexity thresholds. Replaced inline `RunMutationOptions` import with cleaner runner-based abstraction.
- **Architecture baseline updated** — Regenerated `.architecture-baseline.json` to clear pre-existing smell noise from stale baseline hash.

## [0.11.4.0] - 2026-06-30

### Added
- **Gate M: Go mutation testing** — Incremental mutation for Go files via `gomutants` (szhekpisov/gomutants). Per-push section in pre-push with `GATE_M_GO_STATUS` journaling. Graceful SKIP when tool not installed.
- **Gate M: Java mutation testing** — Incremental mutation for Java files via PITest with dual build-tool support (Maven `pom.xml` + Gradle `build.gradle`/`build.gradle.kts`). `PitestRunner` class with `test-compile` step, JSON report parsing, Maven timestamped-dir + Gradle fixed-path report scanning.
- **Gate M: Kotlin mutation testing** — Java/Kotlin share PITest runner (JVM bytecode level). Auto-detected via `build.gradle(.kts)` + `info.solidsoft.pitest` plugin.
- **Pre-push adapter detection** — `detect_go_mutation_testable()`, `detect_pitest_testable()` in `adapter-common.sh`. Go uses `GOMUTANTS_AVAILABLE`/`GO_MUTATION_TOOL`; Java/Kotlin use `PITEST_AVAILABLE`.
- **PitestRunner** — 311 lines, 18 unit tests. Maven (`mvn test-compile org.pitest:pitest-maven:mutationCoverage -DoutputFormats=JSON`) and Gradle (`./gradlew pitest` or `gradle pitest`) support.

## [0.11.0.0] - 2026-06-26

### Added
- **Gate 9: Build Integrity** — New pre-commit gate that verifies TypeScript compilation (`tsc --noEmit`), package manifest integrity (`npm pack --dry-run`), and import path legality. Blocks commits with broken builds.

### Changed
- **Breaking**: Pre-commit gate renumbering: Gate 9 (SAST) → Gate 10; Gate 10 (Sprint Flow) → Gate 11. TOTAL_GATES=11, reportVersion "2.0". Re-run `xp-gate init` to update hooks.
- **Breaking**: Pre-push gates renamed to M-prefix scheme: M2→MD (Mock Density), M3→ML (Mock Layering), Delphi→MW (Code Walkthrough), Gate S→MS (Sprint Flow).
- Pre-push Gate 10 (Build Integrity) retained as defense-in-depth check.

## [0.10.17.0] - 2026-06-26

## [0.10.13] - 2026-06-24

### Fixed

- **Auto-upgrade notification visibility (#212, #216)** — Upgrade results were written only to `stderr`, invisible to OpenCode users. Upgrade notice is now displayed as a banner in the TUI sidebar panel, with `stderr` retained as a fallback for npm-only users without TUI registration.

- **Sprint Flow TUI panel auto-registration (#214, #240)** — The TUI sidebar panel required separate registration in `~/.config/opencode/tui.json`, but documentation never mentioned this. Now `xp-gate init` auto-creates the TUI config, and `xp-gate doctor --fix` (new Check 9) repairs missing/corrupt registrations.

- **Early-phase placeholder rendering (#247)** — When Sprint Flow is starting but no sprint data exists yet, the panel now shows "初始化中..." (`.sprint-state/` detected) or "准备中..." (`.worktrees/` detected) instead of a blank panel.

- **Corrupt JSON resilience** — `doctor --fix` now backs up corrupt `tui.json` as `.corrupt-{timestamp}.bak` and rebuilds from scratch. Atomic writes via `renameSync` prevent partial-file reads.

### Added

- **doctor Check 9: TUI registration** — Detects missing/corrupt `~/.config/opencode/tui.json` and auto-repairs via `--fix`.

## [0.10.8] - 2026-06-23

### Fixed

- **qoder plugin version sync** — `plugins/qoder/plugin.json` was not included in `scripts/sync-version.sh`, causing it to remain at 0.8.17 while all other components advanced to 0.10.x. Now synced as part of the standard version bump process.
- **npm-package qoder mirror** — `src/npm-package/plugins/qoder/plugin.json` also fixed (was 0.8.17 → 0.10.7, now 0.10.8).

## [0.10.7] - 2026-06-23

### Fixed

- **sprint-flow orchestrator stall (#248)** — Phase 0 and Phase 1 were incorrectly dispatched to subagents, causing interactive skills (brainstorming, autoplan, to-issues) to hang. Restored orchestrator-direct execution for all interactive phases, restored the Background Task Resume Protocol lost during the SKILL.md slim refactor (commit `c0c52f4`), and expanded audit to all 13 sprint-flow skills.
  - **Phase 0 THINK**: brainstorming now runs in orchestrator (interactive — requires user decisions)
  - **Phase 1 PLAN**: autoplan + to-issues run in orchestrator (interactive); delphi-review dispatched to subagent (non-interactive)
  - **Phase 6 SHIP**: finishing-a-development-branch + ship run in orchestrator (interactive — merge/PR decisions)
  - **Phase 7 LAND**: land-and-deploy runs in orchestrator (interactive — deploy verification)
  - Phase 2 BUILD (ralph-loop), Phase 3 REVIEW (delphi-review + test-alignment), Phase 5 FEEDBACK (learn/retro/debug) remain subagent-dispatched (all non-interactive)
  - Added Background Task Resume Protocol to orchestration-rules.md and auto-estimate phase doc

## [0.10.6] - 2026-06-23

### Fixed

- **TUI plugin exports field** — npm package `src/npm-package/package.json` had no TUI exports field, causing sidebar to break. Added proper exports entry.

## [0.10.5] - 2026-06-23

### Fixed

- **npm-package mirror sync** — `GoMutantRunner` and all Go mutation testing files (`go-mutant-runner.ts`, `runners/index.ts`, `gate-m.ts` test discovery, `go-mutant-runner.test.ts`) were committed to `src/mutation/` in v0.10.4.0 but not mirrored to `src/npm-package/mutation/`
  - This means npm users did not actually receive Go mutation support in v0.10.4
  - All 4 files now correctly mirrored so `@boyingliu01/xp-gate@0.10.5` distributes Go mutation testing properly
- Architecture baseline updated to account for pre-existing mirror duplication smells (CodeClone between `src/mutation/` and `src/npm-package/mutation/`)

## [0.10.4] - 2026-06-23

### Added

- **#160: Go mutation testing (Gate M)** — `GoMutantRunner` spawns `gomutants` (v0.4.0) to run mutation testing on Go source files
  - Auto-routed via `runnerRegistry` when `.go` files change on pre-push
  - Parses `test_efficacy` score + per-file `mutations[]` array with status counting
  - Go test file discovery (`foo.go → foo_test.go`) integrated into `findTestFileForSource`
  - 11 unit tests for `GoMutantRunner` (isAvailable, spawn args, timeout, JSON parsing)
  - CI workflow `mutation-test-go.yml` for E2E Go mutation regression testing
  - New workflow job: setup Go 1.26 → install gomutants → create fixture → gate-m E2E

### Changed

- Architecture baseline updated to account for pre-existing smells in `gate-m.ts`

## [0.10.3] - 2026-06-22

### Added

- **Gate 10: Build Integrity Check (pre-push)** — catches broken package references that all previous gates missed. Three checks run in parallel:
  - `tsc --noEmit` — type-check the project (incremental with `.tsbuildinfo` caching)
  - `npm pack --dry-run` — verify package manifest includes expected files
  - Import resolver — detect relative imports that escape the package boundary or target nonexistent files (the original bug: `tui-plugin.ts` importing `../../src/...` which didn't exist in the published npm package)
  - New module: `src/build-integrity/gate-10.ts` with `runTscCheck`, `runPackCheck`, `runImportCheck`, `runGate10`, and `main` CLI
  - Integrated into `githooks/pre-push` (runs after Gate S, before Gate M)
  - 63 unit tests (40 import-resolver, 10 tsc/pack, 13 orchestrator) — all passing
- **#246: ESLint config warning** — pre-commit now warns when eslint is in devDependencies but no `.eslintrc*` / `eslint.config.*` is found (non-blocking, informational)

### Changed

- **Pre-push report** now tracks individual gate statuses (Gate 10, M, M-Python, M2, M3, UI, Delphi) instead of a single verdict
- **npm package sync** now includes `build-integrity/` module; `src/npm-package/package.json` files array updated

## [0.10.2] - 2026-06-22

### Changed

- **VERSION bump to 0.10.2.0** (npm 0.10.0 and 0.10.1 were pre-published before sprint fixes landed; this release carries all v0.10.1 fixes to a publishable version)

## [0.10.1] - 2026-06-22

### Fixed

- **ESM type-only exports**: `src/mutation/runners/index.ts` changed `export { Interface }` to `export type { Interface }` — prevents `tsx` runtime crash on pre-push Gate M (`MutationFileReport` is a TS interface, `export { }` tries to re-export as runtime value in ESM)
- **Gate 5a compliance**: Added `@no-test-required` annotations to all 4 mutation runner files (`types.ts`, `stryker-runner.ts`, `mutmut-runner.ts`, `index.ts`) and their npm prepack mirrors — new `.ts` files without test pairs now pass Gate 5a on main
- **Lint cleanup**: `tui-plugin.ts` removed unused constants, test file replaced `as any` with `as unknown as typeof base`
- **OpenCode TUI plugin**: fixed type errors and dead code

## [0.10.0] - 2026-06-22

### Added

- **Python mutation testing (Gate M)**: LangAdapter architecture with `MutationRunner` interface, `StrykerRunner` (TypeScript) and `MutmutRunner` (Python). `gate-m.ts` routes by file extension and runs each language's native mutation tool.
  - MutmutRunner: mutmut v3.x compatible — backup/restore `pyproject.toml`, emoji progress parsing, preserves existing user config (`paths_to_exclude`, `timeout`, etc.)
  - Shell integration: `detect_python_mutation_testable()`, `run_mutation()` in python.sh, pre-push Python Gate M section
  - Runner registry pattern extensible for future languages (Go, Java, etc.)

### Fixed

- **OpenCode TUI plugin**: removed `as any`, inlined constants to avoid bundling `src/`, synced to 3 locations
- **gate-m.ts**: removed dead `errorFiles` variable, added `groupByRunner()` routing for multi-language mutation
- **Delphi review**: experts read from worktree (not stale main repo files) to prevent hallucination

## [0.9.3] - 2026-06-18

### Added

- **OpenCode TUI sidebar slot plugin**: `plugins/opencode/tui-plugin.ts` renders Sprint Flow progress in the OpenCode sidebar. Registers via `"./tui"` subpath export. Shows phase status, REQ-level progress, metrics, and staleness detection. 30 unit tests covering all pure functions.
  - `readSprintState()`: reads `.sprint-state/sprint-state.json`
  - `renderSprintSidebar()`: renders phase lines with ✓/→/·/○ status symbols
  - `isStale()`: detects >1h inactivity

## [0.9.2] - 2026-06-18

### Fixed

- **Windows bash hooks compatibility (#187, #168)**:
  - `detect_os_env()`: Cross-platform OS detection using `uname -s` + `${OSTYPE-}` fallback
  - `head→sed`: 46 replacements across 15 hook/adapter files — `sed -n '1,Np; Nq'` with early exit
  - `[[ ]]→[ ]`: 47 POSIX-compatible conditional expressions in adapter-common.sh + install/verify scripts
  - `brew→winget/pip`: Windows tool install hints in Gate 8 and Gate 9 files
  - **Plugin stretch goal**: Replaced 6 `head` usages in p3c-java + whalecloud-java plugin scripts
  - **CI**: New `windows-gitbash-hooks` job in cross-platform CI workflow
  - **Docs**: Windows setup section in `TOOL-INSTALLATION-GUIDE.md`
  - All 37 githooks `.sh` files now `head`-free, 33/33 acceptance criteria passed

## [0.9.1] - 2026-06-18

### Refactored

- **Skill Slimming Sprint**: 4 skills trimmed to ≤12KB each (total 90KB→27KB, -70%)
  - `admin-template-guidelines`: 28KB → 4.4KB (6 rules → `references/rule-{1..6}.md`)
  - `test-specification-alignment`: 23KB → 7.4KB (CN/EN dedup, `references/`)
  - `delphi-review`: 18KB → 7.8KB (templates → `references/`)
  - `ralph-loop`: 21KB → 7.3KB (merge `components/` → `references/components.md`)
- Mirrors synced across all 4 plugin platforms (claude-code/opencode/qoder)
- Fixes #236 (skill token slimming), #237 (subagent dispatch model error — root cause: sdxl-v1 model not available for deep tasks, mitigated by g-deepseek-v4-flash)

## [0.9.0] - 2026-06-18

### Breaking Changes

- **Gate 5a-BLOCK**: New `.ts/.tsx` files without corresponding tests now BLOCK commits (previously WARNING only). Modified files remain WARNING. Escape valve: `SKIP_GATE_5A_BLOCK=1` (non-main/master branches only).
- **Gate M2**: Mock density threshold lowered from 50% to 30%. Phase 1: WARNING mode (no blocking). Phase 2: will enable BLOCK after baseline analysis. Configurable via `.mockpolicyrc`.

### Added

- **REQ-TDD-004**: 24 BATS tests for Gate 5a-BLOCK (14 scenarios) and Gate M2 threshold (10 scenarios)
- **REQ-TDD-005**: `checkDocsDrift()` unit tests (5 tests) with testable refactor — function now accepts path params and returns boolean instead of `process.exit(1)`
- **Gate 5a config exclusions**: `node_modules/`, `.next/`, `.nuxt/`, `dist/`, `build/`, `.turbo/`, `.cache/`, and config files (`vitest.config.*`, `vite.config.*`, `tsconfig.*`, etc.)

### Changed

- **REQ-TDD-003**: Skill references synced across npm mirrors (ralph-loop, sprint-flow, phase-2-build)
- **Gate 5a**: New `.ts/.tsx` files without tests now BLOCK (previously WARNING)

## [0.8.21] - 2026-06-17

### Refactored

- **Sprint Flow SKILL.md 大幅精简 (-64%)** — `skills/sprint-flow/SKILL.md` 从 76KB/1,444 行减至 27.8KB/491 行。所有 Phase 详细指令提取到 `references/phase-*.md`（13 文件，120KB）。编排规则提取到 `references/orchestration-rules.md`（17KB）。移除重复内容：Anti-Patterns、Output Format、Security Notes、Scope。使用示例 11→3。Phase 2/6/7/8 引用文件精简为 `@see SKILL.md` 指针。完整验证：13 个参考文件 + 6 个模板全部就位。

### Fixed

- **#232 — npm-publish CI 在 squash-merge 后未触发** — `.github/workflows/npm-publish.yml` 移除 `paths: [VERSION]` 过滤器。根因：GH Actions `paths` 过滤在 squash-merge commit 上不可靠（PR #231/#233 均受影响）。已存在的"Check existing CLI version"步骤提供等效的防重复保护。

### Changed

- 镜像同步：精简后的 sprint-flow skill 同步到 claude-code / opencode / qoder 插件目录及 npm 包内
- `@boyingliu01/xp-gate@0.8.21` 和 `@boyingliu01/opencode-plugin@0.8.21` 手动发布到 npm
- Git tag `v0.8.21` 创建并推送，GitHub Release 已创建
- `latest` dist-tag 修正为 0.8.21（CI 自动发布的 0.8.20 曾覆盖了 latest tag）

## [0.8.20] - 2026-06-17

### Fixed

- **#227 (P0) — xp-gate principles 在 npm global install 下找不到 principles/index.ts** — `src/npm-package/lib/principles.js` `findPrinciplesEntry()` 首位添加 `../principles/index.ts` 候选路径（npm bundled 布局）。`plugins/qoder/bin/xp-gate-check` 添加 `principles/index.ts` fallback 路径。
- **#228 (P1) — xp-gate install-skill 在 Qoder 下安装到 ~/.config/opencode/skills/** — 静态 `SKILLS_DIR` 改为动态 `getSkillsDir()`，按 `detectPlatform()` 返回 qoder/claude-code/opencode 对应 skills 目录。
- **#229 (P2) — xp-gate init 未写入 templateDir** — `installLocal()` 和 `setupGlobal()` 的 `updateConfig()` 加入 `templateDir: TEMPLATE_DIR`，确保写入正确的 platform 对应路径。

### Changed

- `src/npm-package/lib/install-skill.js`: 移除重复的 `detectPlatform` 导入（`detect-deps.js`），统一使用 `shared-paths.js` 版本。

## [0.8.19] - 2026-06-17

### Fixed

- **#218 — Delphi review Round 1→Round 2→Round 3 缺乏自动化调度机制** — `skills/delphi-review/SKILL.md` 新增 Orchestrator Dispatch Rules 章节（~76 行），定义自动多轮循环伪代码、终止结果输出格式、与 orchestrator 的交互约定。`skills/sprint-flow/references/phase-1-plan.md` 重写 Step 2b→Step 2c，delphi-review 在 subagent 内部自动多轮，只有最终 REQUEST_CHANGES（自动修复仍失败）才暂停。`skills/sprint-flow/references/phase-3-review.md` code-walkthrough subagent 自动多轮 + 自动修复尝试。全流程暂停点审计移除 Phase 6 冗余 PR 确认。
- **#225 — autoplan 被错误 dispatch 到 subagent 导致交互中断** — Phase Subagent Dispatch Matrix 拆分行：autoplan（`❌ orchestrator 直接执行`），delphi-review + to-issues（`✅ subagent`）。Phase 1 描述和完整流程箭头图更新。

### Changed

- **全流程暂停点审计** — 审计 Phase -0.5 到 Phase 8 所有暂停点，发现并移除 Phase 6 冗余双重确认（`finishing-a-development-branch` Step 2 已让用户 4 选 1，Step 3 重复确认）。暂停点从 3 个降至 2 个（仅保留 `finishing-a-development-branch` 和 `land-and-deploy 失败`）。
- **Middleware 暂停点矩阵更新** — `skills/sprint-flow/references/components/middleware.md` 移除 `ship PR` 暂停行，添加 #218/#225 变更说明。Delphi review 暂停点从"每轮暂停"改为"自动修复仍失败才暂停"。

## [0.8.18] - 2026-06-16

### Added

- **#181 — Qoder 平台 PreToolUse hook guard** — 新增 `plugins/qoder/hooks/hooks.json` + `bin/sprint-flow-guard.sh` + `bin/xp-gate-check`，与 Claude Code 插件结构对齐。PreToolUse 拦截 Edit/Write/ApplyEdit，读取 `.sprint-state/delphi-reviewed.json`，verdict != APPROVED 时 deny。PostToolUse 运行 principles check（graceful degradation）。Stop hook 输出提示信息。
- **#182 — Git-level Sprint Flow enforcement** — 新增 `githooks/sprint-gate.sh` 独立验证脚本。Pre-commit Gate 10：Phase 2 (BUILD) 时强制要求 delphi-review APPROVED。Pre-push Gate S：Phase 2+ 时强制要求 specification.yaml 存在 + delphi-review APPROVED。非 sprint 项目自动 SKIP（无 `.sprint-state/` 目录）。jq 缺失时 WARN 但 ALLOW（graceful degradation）。17 个 BATS 测试全部通过。
- **#183 — Qoder 插件 manifest + hooks 集成** — `plugins/qoder/plugin.json` 新增 `"hooks": "./hooks/hooks.json"` 字段，版本同步到 0.8.18。`githooks/verify.sh` 新增 4 项检查：sprint-gate.sh + Qoder hooks/hooks.json + sprint-flow-guard.sh + xp-gate-check。

### Changed

- **Pre-commit 从 9 gates 扩展到 10 gates** — Gate 10 (Sprint Flow Enforcement) 插入在 Gate 9 之后。Quality report 更新：TOTAL_GATES=10，新增 gate10_sprint_flow 字段，console 输出新增 Gate 10 行。
- **Pre-push 新增 Gate S** — Gate S (Sprint Flow) 插入在 Gate M 之前。验证 sprint state 一致性，确保 push 前 design review 已完成。

## [0.8.17] - 2026-06-16

### Added

- **#212 — OpenCode plugin auto-update** — `chat.message` hook triggers version check on first user message; inline semver compare (no external deps); npm registry dist-tags fetch (5s timeout, fail silent); 24h cache to `~/.xp-gate/opencode-plugin-version-check.json`; debounced one check per session.
- **#214 — `xp-gate sprint-status` CLI** — New command: `xp-gate sprint-status [--json] [--watch] [--dir <path>]`; table render with 11 phases, status icons, durations; REQ-level progress in BUILD phase; `--json` mode; `--watch` mode with fs.watch/fs.watchFile fallback + SIGINT cleanup; path traversal protection on `--dir`. 13 vitest tests passing.

## [0.8.16] - 2026-06-16

### Fixed

- **#217 — Sprint Flow Phase 0 subagent 卡死** — Phase Dispatch Matrix 中 Phase 0 THINK 的 `category` 从 `deep` 改为 `unspecified-high`，`load_skills` 从 `["brainstorming"]` 改为 `[]`。根本原因：`brainstorming` 为交互式 skill，注入独立 subagent session 后无用户可交互而卡死；`deep` 类别不适合结构化文档生成。
- **#210 — Gate 4 SOLID 检查在目标项目中永远被跳过** — `githooks/gate-4.sh` 和 `githooks/gates/gate-4-principles.sh` 新增第三级 fallback：检查 `$HOME/.config/xp-gate/modules/principles`（全局安装路径），确保 `xp-gate init` 未复制 `src/principles/` 到目标项目时 Gate 4 仍可执行。同时修复了 FAIL 分支中硬编码的 `src/principles/index.ts` 路径，改用 `$PRINCIPLES_DIR` 变量。
- **#211 — Gate M 变异测试在目标项目中永远被跳过** — `githooks/pre-push` 新增第三级 fallback：检查 `$HOME/.config/xp-gate/modules/mutation/gate-m.ts`，确保全局安装路径下仍可执行变异测试。
- **#188 — templateDir 指向 OpenCode 残留路径** — 已有 `xp-gate doctor --fix` 自动检测和修复机制（`shared-paths.js` 的 `getTemplateDir()` + `detectPlatform()`），该 issue 涉及的代码逻辑已完整实现，确认有效。
- **#216 — 本地 opencode-plugin 版本滞后无通知** — `xp-gate doctor` 新增 OpenCode 插件版本检测（Check 8）：读取 `~/.config/opencode/node_modules/@boyingliu01/opencode-plugin/package.json` 版本，与 xp-gate CLI 版本比对，不一致时输出 WARN 提示及手动升级命令。

## [0.8.15] - 2026-06-16

### Changed
- Version bump to 0.8.15.

## [0.8.14] - 2026-06-16

### Fixed
- **Doctor test timeout** — `seedVersionCache()` now writes to `os.homedir()/.xp-gate/` instead of `tmpHome/.xp-gate/` to match `check-version.js` which uses `os.homedir()` (not `process.env.HOME`) to compute `XP_GATE_DIR` at module load time.
- **AC-004-03 corrupt cache test ENOENT** — same root cause; corrupt cache write now targets correct path.

### Added
- **`check-version.js`** — per-version npm registry cache with skip logic; avoids network calls when cached version matches local version.
- **`upgrade.js`** — auto-update infrastructure for skill/plugin updates.
- **`post-merge` hook** — automatic update checks after git merge/pull.
- **`xp-gate-version-check.sh`** — Claude Code plugin version check hook.

### Changed
- All 870 npm-package tests pass (62 test files), all 10 pre-commit gates pass 10.0/10.

## [0.8.12] - 2026-06-15

### Changed
- **Gate 3/4/7/8/9 extracted from monolithic pre-commit** — cyclomatic complexity (Gate 3), principles checker (Gate 4), IaC security (Gate 7), secret scanning (Gate 8), and SAST security (Gate 9) each moved to standalone `githooks/gate-N.sh` files. BATS test suite added for all five (12 tests, all passing). Pre-commit script reduced by ~280 lines; each gate now self-contains its audit journaling.

### Fixed
- **#184 — Gate 3 and Gate 4 unconditional PASS overrides** — extraction naturally removed the `GATE_3_STATUS="PASS"` / `GATE_4_STATUS="PASS"` fallthrough that silently overrode actual skip/warning statuses.
- **#213 — pre-push DOC_ONLY bypass for new branches** — `git diff-tree HEAD` on a new branch with no base reported the entire file tree. Fixed by using `git diff MERGE_BASE...HEAD` to correctly compute the push diff.
- **#185 — 10× `✅ ... (SKIP)` output violations** — all pre-commit Gate 6 (architecture + Boy Scout) and pre-push Gate M2 (mock density) SKIP scenarios now use `⏭️  SKIPPED` prefix instead of `✅` checkmark. PASS now exclusively means the check actually ran.

## [0.8.11] - 2026-06-14

## [0.8.9] - 2026-06-11

### Fixed
- **#208 — OpenCode plugin's 3 tools were broken after clone** — `gate-check`, `gate-principles`, `gate-arch` shelled out to `xp-gate` subcommands that were never registered (`xp-gate check`, `xp-gate principles`, `xp-gate arch`) and to the wrong archlint package name (`npx archlint check` instead of `npx @archlinter/cli scan`). `gate-check` and `gate-arch` had no fallback path either, so they silently no-opped or crashed.

### Added
- **3 new CLI subcommands** — `xp-gate check <path>`, `xp-gate principles <path>`, `xp-gate arch [--config ...]`. Total registered subcommands grew from ≥11 to ≥15. Each one is the canonical implementation for the OpenCode plugin tool of the same name; both call paths produce identical output.
- **OpenCode plugin npx-tsx fallback for all 3 tools** — every tool now uses a chained shell-out (`command -v xp-gate && xp-gate <cmd> || npx -y tsx <source>`) so the tools work both with a globally installed `xp-gate` CLI and from a fresh clone of the repo. Matches the existing graceful-degradation pattern from the Claude Code plugin's `xp-gate-check`.
- **Plugin↔CLI contract documentation** — `plugins/opencode/README.md` now explicitly documents that `gate-check`/`gate-principles`/`gate-arch` are dual-surface (OpenCode tool + CLI subcommand) and that both paths produce identical output.

### Follow-up
- **#209 filed** — investigate why the OpenCode plugin originally shelled out to never-registered subcommands. Suggests CI check to diff plugin shell-outs against `bin/xp-gate.js` `COMMANDS` map to prevent future drift. Backlog (p3-low).

## [0.8.8] - 2026-06-09

### Fixed
- **#186 — P1: Global version mismatch detection** — `xp-gate doctor` now detects when installed config version differs from package version. `xp-gate doctor --fix` auto-syncs config version and updates global hooks from package source.
- **#187 — P2: Windows/Qoder bash hooks pip3 compatibility** — Replaced `pip3` with `pip` in pre-commit lizard install message and TOOL-INSTALLATION-GUIDE.md for cross-platform compatibility.
- **#188 — P2: templateDir pointing to OpenCode residue path** — `shared-paths.js` now dynamically resolves `TEMPLATE_DIR` based on detected AI agent platform (opencode/claude-code/qoder). `xp-gate doctor` validates templateDir against current platform; `--fix` auto-corrects it.

## [0.8.2] - 2026-06-08

> **Note**: This entry was marked "Unreleased" in error during 0.8.x rapid iteration. The features below shipped as part of the 0.8.2 → 0.8.8 release wave on 2026-06-08/09. See issue #205 for the fix.

### Added
- **#135 — OpenCode plugin auto-configure in xp-gate init** — `xp-gate init` now detects opencode.json in the project root and automatically injects the bundled plugin path. No more manual editing of opencode.json after npm install.
- **Gate 0: SKIP_VERSION_CHECK env var bypass** — add `SKIP_VERSION_CHECK=1` env var as a reliable bypass for `git commit -m` (which can't use the `[skip-version-check]` commit message prefix since COMMIT_EDITMSG isn't populated before the pre-commit hook runs). Usage: `SKIP_VERSION_CHECK=1 git commit -m "message"`
- **#148 — Resume Gate stale detection** — Add RESUME GATE to sprint-flow with 5 validations: sprint ID consistency, phase ordering, git isolation branch reachability, file mtime staleness vs phase completion time, specification.yaml staleness for `--resume-from build`
- **#137 — Ralph-loop objective TDD enforcement** — Add pre-REQ git HEAD snapshot baseline, L1b git-diff based test-first ratio check (test_lines ≥ 40%), L1b-alt test file presence check
- **#142 — VERSION serialization changeset model** — Add `.sprint-state/changesets/` directory for atomic version tracking. changeset JSON includes id, sprint_id, old/new version, change_type, files_changed. Created on every VERSION bump in Phase 6 before commit.
- **#144 — Sprint lock prevent concurrent sprints** — Add `.sprint-state/sprint.lock` lockfile mechanism. Phase -1 checks for existing lock, detects stale (24h+ or orphan worktree). Non-stale active lock BLOCKs new sprint. Phase 8 releases lock on cleanup.
- **#146 — sprint-state.json enforcement** — Phase Transition Gate now verifies `phase_history` includes current phase with `completed_at` set. BLOCK if entry missing or completed_at is null, with clear remediation instructions.

### Changed
- `release: v0.8.1.1` — adapter deduplication + Gate 0 bypass fix (committed directly as 8cb552c, no CHANGELOG entry at time of micro bump)

## [0.8.1] - 2026-06-07

### Fixed
- **#170 — pre-push hook fatal: bad object on remote branch deletion** — detect `local_sha=000...000` for branch deletion events and skip validation
- **#171 — archlint configured but not enforced** — install `@archlinter/cli@0.16.0`, create `.archlint.yaml`, update pre-commit hooks with `npx --no-install` support
- **#172 — ui-detector.ts coverage below 80%** — add 18 new CLI tests (direct process mocking), line coverage 96.52%
- **#173 — boy-scout.ts function coverage 56%** — add 17 new tests including `runEnforcement`, `parseArgs`, `splitCsvArg`, `showHelp`; 92% line, 91% function
- **#174 — many-exports.ts + lsp.ts branch coverage** — add targeted tests for branch/edge cases; 100% line coverage for both files
- **#176 — documentation version markers stale** — update all 25+ AGENTS.md files and README.md from v0.5.1 to v0.8.1
- **#175 — Gate 0 script file exemption** — exempt `.sh` files from "source code" detection in version consistency check; commits containing only shell scripts no longer require VERSION/CHANGELOG update
- **#177 — adapter deduplication** — add `syncAdapters()` to sync-package-content.js so `githooks/adapters/` is the single source of truth; `npm-package/adapters/` is now a build artifact. Fixes java.sh divergence (whalecloud grep typo)
- **Gate 0 bypass fix** — `[skip-version-check]` now reads from COMMIT_EDITMSG and allows build-tooling files (adapters/, scripts/, hooks/) while still blocking production source code

### Removed
- **SonarQube Gate 8** — full deletion of SonarQube support: `docs/sonarqube-setup.md`, `sonar-project.properties`, `.github/workflows/sonarqube.yml`, design plans, AGENTS.md references

## [0.8.0] - 2026-06-06

### Fixed
- **#143 — SHA self-reference paradox in pre-push** — resolve circular dependency when checking HEAD vs remote
- **#154 — coverage config drift** — fix vitest coverage configuration consistency
- **#155 — command injection SAST** — secure git diff calls with spawnSync array args
- **#157 — mutation timeout** — increase stryker dry-run timeout to 600s matching `stryker.conf.json`
- **#167 — fake tsc@2.0.4 blocking First Commit Gates** — resolve phantom tsc dependency issue

### Changed
- **#149 — expand first-commit-gates CI** — exercise all 6 quality gates in CI pipeline
- **#150 — mutation watchdog** — add actionable PR comment + watchdog on timeout
- **#153 — reduce all functions CCN** — refactor to ≤10 threshold, remove dual-tier system
- **#163 — pre-push code-walkthrough** — resolve SHA self-reference paradox

## [0.7.2] - 2026-06-06

### Removed
- **Issue #140 — skill evaluation/certification artifacts** — 彻底清理 xp-gate 中所有与 skill 评估/验证/认证无关的历史残留内容：
  - 删除 `docs/skill-validation/` 完整目录（validation framework、methodology、summary、eval-cases、promptpressure）
  - 删除 `docs/skill-validation-framework.md` 和 `docs/skill-validation-methodology-landscape.md`
  - 删除 `docs/plans/*skill-cert*` 3 份设计文档
  - 删除 `docs/fusion/matt-pocock-skills-vs-xgate-analysis.md`
  - 删除 `skills/*/evals/` 和 `skills/*/evolution-*` 共 8 个源文件 + npm-package 镜像副本中 6 个对应文件
  - 删除 `.github/workflows/skill-cert-eval.yml` 独立 workflow
  - 从 `.github/workflows/quality-gates.yml` 移除 `skill-cert-check` job 及相关引用
  - 清理 `AGENTS.md`、`CAPABILITIES.md`、`docs/AGENTS.md` 中所有 skill-cert 耦合描述
- **Root 目录清理**：
  - 删除残留 `architecture-report.sarif.json`
  - 移动 `specification-fix-issues.yaml` → `docs/plans/`
  - 更新 `.gitignore` 覆盖 transient 报告文件

## [0.7.1] - 2026-06-06

### Fixed
- **Issue #147 — Gate 1 lint errors** — 修复 Gate 1 lint 错误并拆分 boy-scout 测试，使其通过 large-file 规则（PR #147）
- **Issue #139 — stale promptfoo refs** — 清理 promptfoo 历史残留引用、同步 npm-package skills 副本、为轻量级 Delphi route 强制启用 gate（PR #139）
- **vitest coverage 排除 .worktrees** — `vitest.config.ts` 在 coverage.exclude 中补齐 `.worktrees/**`（test.exclude 已有，coverage 缺漏），避免 worktree 残留 HTML 报告 JS 文件被纳入 coverage 总数（之前导致 Gate 5 阈值误判）

### Changed
- **Version consolidation 0.7.1** — 合并 0.6.2（main 上累积未发布的 bugfix #139/#147）+ 0.7.0（Qoder 集成迭代分支引入的 MINOR bump），统一对齐到 0.7.1 作为下一个发布版本
- **VERSION 同步覆盖扩展** — 同步更新 `src/npm-package/plugins/claude-code/.claude-plugin/plugin.json` 内嵌副本（sync-version.sh 当前未覆盖此路径，已手工修正）
- **AGENTS.md 版本注释** — `src/npm-package/AGENTS.md` 的 stale 版本注释（0.5.1 → 0.7.1）

### Notes
- Issue #144（分布式事务：active sprint instance lock + rebase-before-commit guard）仍为 OPEN，本版本未实现
- `npm-publish` workflow 仅在 `VERSION` 文件变更时触发——这是 #139/#147 此前未触发发布的根因（两个 bugfix 均未 bump 版本）

## [0.5.1] - 2026-05-30

### Added
- **REQ-1: xp-gate uninstall CLI** — 完整卸载命令，镜像反转 init，支持 dry-run/force 参数，manifest 文件跟踪
- **REQ-2: xp-gate doctor CLI** — 诊断命令，检查 config/hooks/adapters/core.hooksPath/env，支持 --fix 自动修复
- **REQ-3: xp-gate migrate CLI** — v0.4.x 迁移助手，自动清理 ~/.npmrc GitHub Packages PAT 残留
- **REQ-5: Windows 兼容验证** — CI matrix 添加 windows-latest runner，Node 18/20/22 LTS 全部通过

## [0.6.2] - 2026-06-04

### Added
- **sprint progress renderer** — `scripts/render-sprint-progress.cjs` 可执行 Node.js 脚本，读取 sprint-state.json 并输出 ASCII 进度看板（替代纯声明式模板渲染）

### Changed
- **sprint-flow SKILL.md** — PHASE TRANSITION RULES Step 4 和 `--status` 参数改为调用 `node scripts/render-sprint-progress.cjs`（确定性渲染，不再依赖 AI 主动执行模板）
- **plugin/skill 副本同步** — qoder + npm-package sprint-flow SKILL.md 同步更新

## [0.6.1] - 2026-06-04

### Added
- **sprint-flow VERSION-GATE** — Phase 6 SHIP 强制每个 sprint bump PATCH 版本，确保 skill-only 变更也触发 npm 发布
- **skill-cert CI job** — quality-gates.yml 新增 skill-cert-check job，PR 中 skills/ 目录变更时自动触发 skill-cert 评估（continue-on-error）
- **sprint progress dashboard** — 进度看板模板 + `--status` 参数（sprint-2026-06-04-01 交付）

### Changed
- **版本 bump 规则** — 每完成一个 sprint 统一 bump PATCH，不区分 skill/code 变更类型

## [0.4.1.0] - 2026-05-30

### Fixed
- **Issue #80: Delphi-review skip prevention** — LLM 可跳过 delphi-review 直接进入 BUILD，新增三层防御架构：L1 PreToolUse Hook 物理拦截 (IDE 层)、L2 DELPHI-GATE Phase 2 入口门禁 (SKILL.md)、L3 状态文件输出 (delphi-review APPROVED 后生成 .sprint-state/delphi-reviewed.json)
- **Issue #82: Phase 5 FEEDBACK bypass** — Phase 4 推迟后跳过 Phase 5 直接进入 Phase 6，新增 Phase 4→5→6 双重硬门禁：Phase 5 声明"不可跳过" + Phase 6 入口验证 feedback-log.md 存在

### Added
- **plugins/claude-code/bin/delphi-review-guard.sh** — PreToolUse Hook 守卫脚本，检查 .sprint-state/delphi-reviewed.json，不支持 jq 时优雅降级

### Changed
- **middleware.md 状态机增强** — 添加 DELPHI-GATE + Phase 5 硬门禁转换规则（"永远不可自动跳过"）
- **README.md** — 新增 v0.4.x → v0.5.x 迁移指南，移除 GitHub PAT 认证步骤，安装流程简化为 `npm install -g xp-gate`
- **MANIFEST.md** — 7 个 `bash <(curl ...)` 安装命令标注为 "LEGACY - GHP version only"
- **CHANGELOG.md** — 补充 REQ-6 迁移相关变更记录

## [0.3.2.0] - 2026-05-28

### Fixed
- **sync-version.sh CRLF** — 去掉 `set -euo pipefail` → `set -eu`，Windows Git Bash 不再报错 `$'\r': command not found` 和 `invalid option name`（fixes #74-A）
- **Ship workflow version drift** — pre-commit hook 新增 Gate 0 版本门禁，在 main/master/develop 等保护分支上强制 VERSION/CHANGELOG 更新，防止绕过 ship 流程（fixes #74）

### Added
- **.gitattributes** — `*.sh text eol=lf` 确保所有 shell 脚本统一 LF 行尾，彻底解决跨平台 CRLF 问题
- **Sprint-Flow Phase 7 LAND** — 集成 `land-and-deploy` skill，PR 创建后自动 merge + 等 CI + canary health check（fixes #71-A）
- **Sprint-Flow Phase 8 CLEANUP** — 自动 `git worktree remove` + sprint-state.json 更新 + 残留检测（fixes #71-B）
- **Gate 0 version consistency check** — 保护分支提交需包含 VERSION 或 CHANGELOG.md 变更，绕过条件收紧为 `chore:/docs:/release:` 前缀 + 无源码变更
- **Phase 7 health check + auto-rollback** — SLA 指标（HTTP 200, 错误率 <1%, p99 <2s），部署失败自动 `git revert` merge commit

## [0.3.1.1] - 2026-05-25

### Fixed
- **ralph-loop dispatch** — `category="build"` (invalid) → `category="unspecified-high"`，修复 skill 静默加载失败
- **TDD 纪律注入** — subagent context 显式注入 TDD 铁律 + Mock 边界，不再依赖 `load_skills` 软约束
- **测试基础设施先行** — 业务代码 dispatch 前检查 test-utils.ts 存在性及接口契约（createTestApp, withTestDb）
- **状态机一致性** — 新增 test_infra_check/dispatch/ready 状态，所有路径经 test_infra_ready 再进 in_progress
- **引用一致性** — `slices-manifest.json` → `specification.yaml` 在 2 个组件文档中修正

### Added
- **L1b 测试先行比率门** — 新增测试行数 / (新增测试 + 新增实现) ≥ 40%
- **4 个 eval 用例** — ralph-015 (category 修正) + ralph-016/017/018 (test-infra 场景覆盖)
- **Progress Log 增强** — `**Test infra**` 字段（generated/existing/skipped/fallback）
- **Memory.md 扩展** — Progress Log Schema 新增 `test_infra_status` 字段定义

## [0.3.1] - 2026-05-25

### Fixed
- **Pre-push hook crash** — Gate M 不再因 `src/mutation/gate-m.ts` 不存在而崩溃，改为优雅跳过并输出警告（fixes #63）

## [0.2.0] - 2026-05-21

### Added
- **`/to-issues` skill** — 垂直切片问题拆分，Delphi Round 2 APPROVED (3/3)
- **`/improve-codebase-architecture` skill** — 定期架构健康检查，发现架构腐化和死代码
- **CC-010: Many Exports Rule** — 单模块导出数 ≤10 个（named exports + re-exports），解决#61 分层架构治理问题
- **brainstorming 增强** — 自动创建 `CONTEXT.md` + `ADR` 记录共享语言，Delphi Round 2 APPROVED (3/3)
- **Delphi Review 增强** — specification.yaml 新增 User Stories 层级，增加 US→REQ→AC→test 追溯链
- **Sprint Flow 集成 `/to-issues`** — Phase 1 PLAN 和 Phase 2 BUILD 融入任务拆解流程
- **Matt Pocock 5 Skills 融合分析文档** — `docs/fusion/matt-pocock-skills-vs-xp-gate-analysis.md`

### Changed
- **Clean Code 规则** — 9→10 条（新增 many-exports CC-010）
- **README.md** — 新增"最大化 XP-Gate 价值"实战指南章节
- **sprint-flow** — Phase 1→2 融入 `/to-issues` 任务拆解
- **13 语言适配器** — TypeScriptAdapter 新增 `extractExports()` 方法
- **Brainstorming** — 增加 CONTEXT.md 惰性创建机制（≥2 领域术语才生成）

### Documents
- `docs/fusion/matt-pocock-skills-vs-xp-gate-analysis.md` — 融合矩阵与执行状态

## [0.1.2] - 2026-05-20

### Added
- **xp-gate npm 包** — `npm install -g xp-gate` 零安装体验，无需 clone 仓库
- **`xp-gate init`** — 初始化项目，自动安装 hooks + adapters + 依赖检测
- **`xp-gate install-skill <name>`** — 从 GitHub 按需下载并安装 AI 技能
- **`xp-gate update-skill <name>`** — 更新已安装的 Skill 到最新版本
- **`xp-gate uninstall-skill <name>`** — 卸载指定 Skill
- **依赖检测** — `detect-deps.js` 支持 superpowers/gstack 版本检查
- **安装回滚机制** — 安装失败自动恢复备份，保证干净状态
- **离线缓存** — `xp-gate install-skill --offline` 使用本地缓存
- **配置文件** — `~/.config/xp-gate/xp-gate.json` 记录已安装 Skills 和元数据

### Changed
- **快速开始** — README 新增 "方式零：零安装（推荐）"
- **依赖检测路径** — 同时搜索 `~/.config/opencode/skills/` 和 `~/.config/opencode/` 两个位置

### Documents
- 设计文档：docs/plans/2026-05-19-xp-gate-zero-install-design.md v2.0
- 评审报告：docs/plans/2026-05-19-xp-gate-zero-install-consensus-report.md
- 需求规格：docs/plans/2026-05-19-xp-gate-zero-install-specification.yaml

## [0.1.1] - 2026-05-09

### Added
- **ralph-loop skill** — REQ 级别迭代构建模式，Delphi 双专家 APPROVED (9/10)
- **逐 REQ 迭代** — 每个 REQ dispatch 独立 subagent，干净上下文，token 节约 40-67%
- **全量回归测试** — 每个 REQ 完成后运行 ALL tests，检测跨 REQ 回归
- **拓扑排序** — Kahn's algorithm 处理 depends_on 依赖，循环依赖自动检测
- **分类 Learnings** — permanent（架构级始终传递）+ contextual（最近 3 条滑动窗口）
- **3 层验证 Gate** — L1: typecheck+lint → L2: 全量测试 → L3: coverage ≥ 80%
- **崩溃恢复** — atomic checkpoint + git history 天然持久
- **完整的 eval 测试集** — 15 个测试用例覆盖所有关键路径
- **Phase 2 BUILD ralph-loop 模式** — sprint-flow 文档已更新

### Changed
- **Phase 2 BUILD 默认行为** — ralph-loop 从"可选模式"升级为默认模式
  - `/sprint-flow "需求"` → 自动使用 ralph-loop 逐 REQ 迭代
  - `/sprint-flow "需求" --mode parallel` → 旧有并行模式（可选）
- **maturity**: ralph-loop beta → stable

### Documents
- docs/ralph-loop-design.md v4.0 — 完整设计文档 + Delphi 评审记录
- skills/ralph-loop/references/phase-2-build-ralph.md — 集成文档重写
- skills/sprint-flow/SKILL.md — Phase 2 默认行为更新，参数交互更新

## [0.1.0] - 2026-05-05

### Added
- **Sprint Flow 全流程编排** — 一键启动 Think→Plan→Build→Review→Ship 7 阶段开发流水线
- **Phase 0: THINK** — brainstorming 需求探索，HARD-GATE 设计未批准不可实现
- **Phase 2: PARALLEL BUILD** — dispatching-parallel-agents 并行任务分发，executing-plans 隔离执行
- **Phase 3: REVIEW** — browse 浏览器自动化测试，test-spec-alignment 测试对齐
- **Phase 5: FEEDBACK** — retro 工程回顾，systematic-debugging 根因调试
- **Phase 6: SHIP** — finishing-a-development-branch 4 选项发布决策 (merge/PR/discard/keep)
- **Web 前端支持** — web-nextjs/web-react/web-vue 项目类型检测
  - design-shotgun UI 设计多版探索、qa 系统化测试、design-review 视觉审计、benchmark Core Web Vitals
- **移动端支持** — mobile-flutter/mobile-react-native 项目类型检测
  - flutter.sh 适配器 (flutter analyze/test)、flutter-test integration
- **CI/CD 集成** — GitHub Actions workflow (.github/workflows/quality-gates.yml)
- **负载/压力测试** — k6/locust/gatling 工具映射、.sprint-load-test.yaml 规范
- **API 测试** — Phase 3 API 自动化测试支持 (Go/Spring Boot/Django)
- **安全审计** — gstack/cso 全面替代 security-scan (15 phases 安全审计)
- **完整文档体系**：
  - README.md 全面重写 (381 lines，12 语言适配器 + Sprint Flow 流程图 + 配置说明)
  - ARCHITECTURE.md 新增 (818 lines，5 层架构图 + 分层详解 + 数据流)
  - CAPABILITIES.md 新增 (300 lines，完整能力清单矩阵)
- **project type 自动检测** — 8 种项目类型 (web/mobile/backend)

### Changed
- **Sprint Flow Phase 0** — office-hours → brainstorming (HARD-GATE 机制)
- **Sprint Flow Phase 3** — cross-model-review → delphi-review --mode code-walkthrough
- **6 道质量门禁适配 Flutter/PowerShell** — flutter.sh + powershell.sh 适配器
- **pre-commit 钩子** — 支持 React Native 检测 (package.json + react-native)
- **adapter-common.sh** — flutter/powershell 语言检测

### Fixed
- #6: specification-generator 触发器集成到 delphi-review
- #11/#13/#15: 管道退出码、pytest 误报、分支覆盖率
- #17: 6 个新语言适配器 (cpp/swift/objectivec/dart/flutter/powershell)
- #18: PowerShell 质量门禁
- #20: 质量门禁报告汇总
- #21: Stryker Mutation Testing Gate
- #26: cross-model-review → delphi-review --mode code-walkthrough
- #28: Web 前端项目支持
- #29: dispatching-parallel-agents 并行执行
- #30: Phase 0 brainstorming 替代 office-hours
- #31: Phase 6 finishing-a-development-branch
- #32: Phase 5 retro + systematic-debugging
- #33: 移动端支持 (Flutter/RN)
- security-scan → cso 安全能力覆盖验证

### Language Support (12 adapters)
TypeScript, Python, Go, Shell, Java, Kotlin, C++, Swift, Objective-C, Dart, Flutter, PowerShell

## [0.0.6] - 2026-04-30

### Added
- **Gate 9: Architecture Quality** - Clean Architecture layer boundary validation
  - TypeScript: archlint (@archlinter/cli) >= 2.0.0
  - Python: import-linter >= 2.0.0
  - Go: arch-go >= 1.7.0
  - Java: ArchUnit
  - C++: Phase 2 roadmap (requires `.skip-architecture-cpp` marker)
- **architecture.yaml** template with layer definitions and rules
  - 14 architecture rules: ARCH-001 to ARCH-014
  - Layer boundary enforcement (Domain, Application, Infrastructure, Presentation)
  - Circular dependency detection
  - Baseline/ratchet mode support
  - SARIF output integration
- **version-parser.ts**: Tool version compatibility checker
- **Gate 9 bats tests**: 18 test cases for shell script validation

### Changed
- Gate count: 8 → 9 (added Architecture Quality)
- TOOL-INSTALLATION-GUIDE.md: Added architecture tool installation
- README.md: Added Gate 9 documentation
- specification.yaml: Added REQ-ARCH-001 to REQ-ARCH-009

### Delphi Review Verified
- Round 1 → Round 2 → APPROVED (100% consensus, 9.67/10 confidence)
- Experts: delphi-reviewer-architecture, delphi-reviewer-technical, delphi-reviewer-feasibility
- Critical issues fixed: tool name, version checks, C++ skip marker

## [0.0.4] - 2026-04-14

### Fixed
- **Issue #7**: Code walkthrough pre-push hook CLI invocation error
  - Root cause: OpenCode CLI doesn't support skill subcommands
  - Solution: Replace CLI call with file validation (`.code-walkthrough-result.json`)
  - Hook validates: commit match, verdict=APPROVED, not expired (<1hr)
  - Skill executes in Agent session, writes result file
  - Decision: "mandatory but manually triggered" quality gate
- **Delphi Review**: code-walkthrough Round 1-3 → APPROVED (Expert A/B 9/10)

### Changed
- `githooks/pre-push`: 305 → 145 lines (file validation only)
- `skills/code-walkthrough/SKILL.md`: 276 → 469 lines (added result output)
- OpenCode environment: synced with latest fixes

### Added
- **specification-generator UPDATE mode**: Modify existing spec with Delphi review

## [0.0.3] - 2026-04-14

### Added
- **Boy Scout Rule** (Gate 8): Differential warning enforcement for historical projects
  - `boy-scout.ts`: File classification, delta calculation, baseline management
  - `baseline.ts`: Warning history storage (.warnings-baseline.json)
  - New files: zero-tolerance, Modified files: decrease-or-maintain
- **Objective-C Adapter**: Regex-based extraction for .m/.mm files
  - @implementation/@interface parsing
  - Objective-C method declarations
- **C++ Adapter**: Regex-based extraction for .cpp/.c/.h files
  - Function extraction with const/override/noexcept
  - Class/struct with inheritance
- **Gate 7 CCN**: lizard integration for C++/Objective-C cyclomatic complexity
- **Test annotations**: @test REQ-XXX, @intent, @covers AC-XXX format
- **specification.yaml**: YAML-based requirements and acceptance criteria

### Changed
- Gate count: 7 → 8 (added Boy Scout Rule)
- Language adapters: 7 → 9 (added C++, Objective-C)
- Test count: 166 → 257 tests
- Coverage: 94% → 85%+ (still above threshold)

### Fixed
- TypeScript strict mode issues in test files
- AdapterFactory null return type handling
- LSP rule parameter type annotation

### XP Consensus Verified
- Gate 1: PASS (TypeScript + Tests + Coverage)
- Navigator Phase 1: REQUEST_CHANGES
- Navigator Phase 2: APPROVED (confidence 10/10)
- Arbiter: APPROVED

## [0.0.2] - 2025-04-11

### Added
- **Hook-based Quality Gates**: Code-level enforcement replacing soft prompt constraints
- **Iron Law Workflow**: Mandatory verification before implementation
- **Delphi Review System**: Multi-expert consensus (≥90% threshold)
- **XP Consensus Engine**: Driver + Navigator + Arbiter decision workflow
- **Code Walkthrough**: Multi-model post-commit review
- **Test-Specification Alignment**: Two-phase verification

### Changed
- Addressed AI agent "shortcut-taking" problem from v0.0.1
- Zero-tolerance for quality gate tools availability
- No degradation on cost/environment issues

### Design Decisions
- Hook-based gates over stronger prompts (100% reliability vs ~30%)
- SARIF 2.1.0 output for IDE integration
- Skills as SKILL.md markdown (not executable code)

## [0.0.1] - 2025-03-XX

### Added
- Initial XP-Gate framework
- Principles checker with Clean Code + SOLID rules
- Git hooks framework
- Basic skill structure

### Known Issues
- AI agent shortcut-taking behavior (addressed in v0.0.2)

## [Unreleased] - v0.9.6.0

### Added
- **Python Mutation Testing (Gate M)**: 首次为 Python 项目提供增量变异测试支持
  - 工具：mutmut (pytest-native, CLI 友好，增量支持)
  - 阈值：默认 60%，关键路径 80%
  - 超时：120s（超时允许推送但警告）
  - 文件过滤：自动排除 `test_*.py`、`/tests/`、`__pycache__`
  - 配置：支持 `.mutmut.conf` 和 `mutmut_config.py`
  - 基线：扩展 `.mutation-baseline.json` 支持 Python 分数
  - 集成：Pre-push 钩子，位于 TypeScript Gate M 之后
  - 参考：`docs/plans/2026-06-21-python-mutation-testing-integration.md`

### Changed
- `README.md`: 更新 Pre-push 门禁表格，添加 Python Gate M
- `githooks/pre-push`: 添加 Python 变异测试集成
- `githooks/adapters/python.sh`: 新增 `run_mutation()` 函数
- `githooks/adapter-common.sh`: 新增 `detect_mutation_testable()` Python 支持
- `src/mutation/gate-m-python.ts`: 新增 TypeScript 运行器
- `src/mutation/types.ts`: 扩展类型定义支持多语言基线
- `.gitignore`: 添加 `.mutation-baseline.json`

### Technical Debt
- 待创建 Python 突变测试用例 (`src/mutation/__tests__/gate-m-python.test.ts`)
- 待更新 CAPABILITIES.md 添加 Python 突变测试能力说明
- 待创建 mutmut 配置模板 (`templates/.mutmut.conf.example`)
