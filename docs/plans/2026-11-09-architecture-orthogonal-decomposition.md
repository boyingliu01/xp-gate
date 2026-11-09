# XP-Gate 架构正交分解与迭代研发计划

- 日期：2026-11-09
- 状态：规划，待评审（本文只做梳理与判断，不改代码）
- 触发：用户指出「issue 反复发生是架构性原因」，要求先做正交分解、根治土壤，再处理上层 issue
- 关联：#778 #779 #782 #783 #769 #738 #715 #752 #747 #746 #750 #744，以及历史 #495 #500 #505 #542 #658 #688
- 前置诊断：`2026-11-07-self-architecture-governance.md`（四原则）、`2026-11-08-mirror-duplication-decision.md`（选项 A/B/C）、`2026-11-07-mirror-reevaluation.md`（S1–S4）、`2026-11-08-iteration-speed-diagnosis.md`（P0–P3）

---

## 0. 一句话结论

60 个 open issue 不是 60 个独立缺陷，是**同一组架构缺口在不同表面的投影**。实测确认四个结构性根因全部仍然活着（其中两个在一周前被认为已修，实际未修）：

1. **同一逻辑多份实现，且无契约测试强制一致**（hook / CLI / skill 三执行面 + shell/TS 双实现 + 4 树镜像）
2. **安装部署链路的"装哪些文件"清单手写了 4 处且互不一致**（这是 #783/#769 以及一个比它们更严重的未报告缺陷的共同根因）
3. **门禁序号是位置标签却被当身份用，≥6 处命名空间各自声明同一张编号表**
4. **全局 vs 项目优先级在 pre-push 侧仍是 global-first**（与设计意图相反，pre-commit 已于 #505 修复，pre-push 从未接入）

**优先级**：先 P0 架构根治（消除土壤）→ P1 已被架构修好自然关闭的 issue → P2 剩余独立 issue。

---

## 1. 实测证据：四个根因在主干上的实时状态

### 根因 ① 多实现无契约 —— 仍然活着

| 证据 | 位置 |
|---|---|
| shell/TS 双实现：`src/gates/gate-{3,7,8,9}.ts` 文件头自认 "TypeScript rewrite of githooks/adapters/gate-N.sh" | `src/gates/gate-9.ts:2` |
| 同一 `src/build-integrity/gate-10.ts` 被 pre-commit 的 Gate 9 与 pre-push 的 Gate 10 **同时引用**，挂不同门号 | `githooks/pre-commit:5126-5131`、`githooks/pre-push:476-481` |
| 三条执行路径（hook/CLI/skill）结论可不同，**无任何测试断言一致** | #778（open） |
| TS 模块名残留：`src/gates/gate-9.ts` 自认 "Gate 10 SAST"（文件名先于 #677 重编号） | `src/gates/gate-9.ts:2` |

### 根因 ② 安装清单 4 处手写且互不一致 —— 比 #783 更严重的新发现

同一份"要装哪些文件"手写在 **4 处**，决策各不相同：

| 位置 | 白名单 | 布局 |
|---|---|---|
| `src/npm-package/lib/shared-utils.js:70`（init/setup-global 用） | 5 文件：pre-commit/pre-push/post-commit/post-merge/hook-module-resolution.sh + lib/ | flat |
| `src/npm-package/lib/update-hooks.js:165`（update-hooks 用） | **3 文件：pre-commit/pre-push/post-merge**（缺 post-commit、缺 hook-module-resolution.sh、不拷 lib/） | nested（`destDir/adapters/`） |
| `src/npm-package/scripts/sync-package-content.js:255`（prepack 用） | HOOK_FILES 6 文件 | — |
| `scripts/check-hook-mirror.sh:20` | HOOK_MIRROR_FILES 47 对 | — |

**两个直接后果**：
- `xp-gate update-hooks --scope hooks` 会装出一个**缺 `hook-module-resolution.sh`** 的 hooks 目录 → pre-commit fail-closed **FATAL**（`pre-commit:82-89` 明确"缺解析顺序就退出 1"）。即 update-hooks 会把一个能工作的安装破坏成提交不可用。
- update-hooks 的 copyAdapters 拷 **nested**（`destDir/adapters/`），而 shared-utils 拷 **flat**——全局安装时 update-hooks 会造出 `~/.config/xp-gate/adapters/adapters/` 双层嵌套。
- `githooks/install.sh:20` 的 `GATE_SCRIPTS` 不含 `gate-registry.sh`（也不含 gate-12/gate-6-layers），shell 安装链路完全不部署 registry。

### 根因 ③ 序号当身份用 —— CLI 侧三套编号并立

| 消费者 | 9 号 | 10 号 | 状态 |
|---|---|---|---|
| `githooks/gate-registry.sh`（钩子事实源） | build-integrity | sast | ✅ |
| `gate-runner.js:658-679` | Build Integrity ✅ | SAST ✅ | 已对齐（#677 成果） |
| `gate-coverage.js:63-66,95-96` | **SAST ❌** | **Build Integrity ❌** | **#738 未修，且被 `gate-coverage.test.js:84-95`（AC-636-02）固化为规格** |
| `check.js:86,306` 帮助文本 | **sast ❌** | **build ❌** | **新发现的第 4 处漂移** |
| `bin/xp-gate.js:515` | 只注册 gate-0..11 子命令 | gate-12/13 无 CLI 入口 | registry 有 12/13 行但 CLI 不可达 |

另有 `pre-push` 的 Gate 10 = Build Integrity（与 registry 的 10=sast 冲突），registry 数据模型**只覆盖 pre-commit 的 0–13，对 pre-push 的 M/M2/ML/UI/MW/S 零约束**。

### 根因 ④ pre-push 优先级反转 —— 活的 bug

- 设计意图（3 处独立声明一致）：**project-first**。`hook-module-resolution.js:95-106` "PRECEDENCE IS PROJECT-FIRST, on purpose"，记录 global-first 曾让项目 `githooks/` 不可达（#495）。
- pre-commit：已修（#505 生成表数据驱动，`pre-commit:243` 消费 `HOOK_ADAPTER_DIR_TIERS`）。
- **pre-push：`pre-push:534-545` 仍是手写 global→project→script 级联，注释甚至写 "3-tier resolution (global → project → script dir)"**，与设计直接矛盾。pre-push 对 #505 生成表的引用数 = **0**。
- 后果：全局安装 + 项目自带 `githooks/adapter-common.sh` 的机器上，**同一次 push 的 pre-commit 用项目副本、pre-push 用全局副本**——两个 hook 解析不同的 adapter-common。

### 附带实测发现（归入根因 ② 的盲区）

- `src/npm-package/hook-module-resolution.sh`（**顶层**，非 `hooks/` 下）是 **global-first 的过期副本**（git 最后修改于 #548，从未被 f7e15b1c 的 project-first 修复更新）。它**无任何代码消费**（install.sh 引用的是 `$HOOKS_DIR/` 下那份），是一份被遗忘的死副本，但被 git 跟踪且不在任何 parity 检查清单内——正是"检查覆盖 5%"盲区的实例。目前无线上影响（不被部署），但是结构性地雷。
- `src/principles`(118) ↔ `src/npm-package/principles`(107) 文件数不等：差异全部是 `__tests__/`（canonical 有、mirror 无），属有意排除，非漂移。
- **顶层死副本 `src/npm-package/hook-module-resolution.sh` 是三重盲区产物**：`check-hook-mirror.sh:20` 的 `HOOK_MIRROR_FILES` 比对的是 `githooks/ ↔ src/npm-package/hooks/`（两份皆 project-first，正确）；`ROOT_MIRROR_FILES`（:25）不含它；`sync-mirrors` 的 5 对也不含它；`MIRROR_PATH_FILTER` 又把整个 `src/npm-package/` 排除出 lint。即它**不被 lint、不被 parity、不被 sync**——被 git 跟踪却无人消费无人检查。这正是 `2026-11-07-mirror-reevaluation.md` §8.2「775 文件/11 万行处于双重盲区」的活样本。

### 根因 ⑤（勘察补充）：镜像 parity 只覆盖 5%，修复全 opt-in，当前有 4 处活漂移

第三方实测（git hash-object 逐文件，byte-identical 验证）：

- **镜像总量**：`src/npm-package` 跟踪 1006 文件 / 184,701 行，其中 **775 文件 / 110,282 行（59.7%）是纯字节复制且不在任何 parity 清单**。`check-hook-mirror.sh` 清单式覆盖 **50 个文件 = 5%**。镜像占全仓 49.8% 代码行（11.4 万行），真实生产代码仅 4.3 万行——「维护量是认知量的 5 倍」。
- **同步机制 5 组但互不统属**：prepack `sync-package-content.js`（syncHooks/syncAdapters/syncSkills/syncPlugins/syncModules）+ 4 个 `check-*-mirror.sh`（只检测不修复）+ Gate 12b（仅比对**暂存**文件，未暂存的 canonical 编辑不可见）+ 专用 parity 测试 + CI Mirror Parity job。`mirror-sync.js` 的 KNOWN_PAIRS 只有 **5 对**，不含 mutation/mock-policy/plugins/scripts-delphi/gates(生成)——`xp-gate sync-mirrors` 修不了它们。且 **sync-mirrors 在 package.json scripts / CI / pre-commit / pre-push 中零引用**——只能靠人手动记起。
- **4 处活漂移（勘察实测时正在发生）**：
  1. `githooks/adapters/csharp.sh` canonical 被编辑（#718 workspace 消歧 +62 行）但镜像未同步——未提交的工作区漂移，Gate 12b 形态；
  2–4. `plugins/{claude-code,opencode,dsh}/skills` 三棵 canonical 插件技能树（**被 .gitignore 排除，parity 在 git 层面看不见**）——`test-specification-alignment/AGENTS.md` 缺末尾换行，上个 commit `9e8b399d` 一次改 9 份副本仍漏掉这 3 棵。
- **技能副本全景**：1 个 canonical `skills/` → **7 个副本**，其中 3 个 gitignore 的插件技能树无任何检查覆盖。
- **结构性悖论**（pre-commit:1128-1134）：镜像若参与 lint/jscpd 会因 100% whole-file clone 触发结构上无法清零的 Gate 6 告警；若排除（MIRROR_PATH_FILTER）则 55% 代码逃出质量体系。当前选后者。`src/npm-package/gates/`（.gitignore:18，prepack 生成）是「镜像即构建产物」的成功先例。

### 根因 ⑥（勘察补充）：测试性能 —— vitest 185.7s + BATS 单进程顺序跑真实 hook + Gate 5 恒带 --coverage

第三方实测（`.xp-gate/reports/` + `.xp-gate/audit.jsonl`，30 次提交）：

- **vitest 墙钟 185.69s**（tests 累计 1016.2s，启动税主导）。最慢单文件：`phase-transition.test.js` **184.8s/103 例**（每例多次 `execSync('git …')`）、`gate-5-runner-error.test.ts` 159.4s/13 例（每例起 bash→真实 pre-commit hook）、`config-enforcement.test.ts` 159.1s/28 例（每例起 tsx+全 rules 引擎）。
- **BATS 234 文件 / 1,603 例由单个顺序 bats 进程跑**，其中 **102 个文件直接执行真实 `githooks/pre-commit`**（对临时 git repo，hook 内 12 道门逐个 spawn shellcheck/eslint/jscpd/lizard/tsc/npm pack…）。
- **Gate 5 永远带 `--coverage`**（`pre-commit:3300/3315/3361/3373` 四分支全带）：即使只跑 1 个测试文件也给**整棵树** v8 插桩——单测试文件 5.1s→34.7s（`2026-11-07-iteration-speed-baseline.md` D7 实测定性）。
- **工具探测即成本**（`remaining-65s-bottleneck-analysis.md`）：tsx 空跑 2.3s、semgrep --version 11.7–13.7s、`npx -y mypy` 4.3s、`npx -y ruff` 5.9s。
- **审计日志实测**：gate-10 中位 57.3s / **max 168s**、gate-1 19.2s、gate-5 13.9s（max 49s）。
- **测试内 npx 反模式**：`boy-scout-integration.test.ts:283-352` 6 处 `execAsync('npx tsx …')` 每例起一个 npx→tsx 子进程（该文件实测 22.6s）；`boy-scout.test.ts:737` 与 `ui-detector.test.js:375` 的注释自认「spawning npx tsx per test re-resolves…」是历史反模式。
- **结构性浪费**（baseline 文档 W1–W5）：全树扫描与 diff 无关（Gate MP 10–32s）、同一棵树被 5 道门重复解析、无输入仍起工具、固定启动税（25 处 node -e、68 处 git 子进程）、Gate MW 绑定精确 HEAD。`.stryker-tmp/` 427MB 6 个 sandbox 副本占磁盘。

**优化方案已存在但未实施**：`2026-11-07-iteration-speed-optimization-design.md` 的 O1–O11（探测缓存/输入短路/node 原生 type-stripping）+ `2026-11-07-mirror-reevaluation.md` 的 S1–S4，均处于「待评审/待决策」状态。输入短路（P0-A/P0-B）已由 `2026-11-09-gate-input-shortcircuit-result.md` 落地（gate-9 −21%、python-health −57.7%，ABBA 12 轮负载校验有效）。

---

## 2. 正交分解：架构应该分成哪几块

当前架构的纠缠点：**"门禁是什么"（身份）、"门禁怎么跑"（执行）、"门禁装到哪"（部署）、"门禁结论怎么报"（输出）四件事互相引用、各自重复声明**。正交分解目标：每件事只有一个可执行的真相来源。

| 正交关注点 | 当前（纠缠） | 目标（单一事实源） | 消除的 issue 类 |
|---|---|---|---|
| **身份层**：门禁 name↔number↔impl↔blocks | registry（仅 pre-commit、不被部署、不被执行路径查询）+ CLI 侧 4 处手写编号 | registry 升格为**唯一身份源**，CLI/hook/push 全部派生；编号退化为显示标签 | #738 #769 #715 #717 类 |
| **执行层**：门禁逻辑 | shell 实现 + TS 实现双份；三执行面各跑各的 | TS 为唯一实现（hook 调 node），或保留 shell 但加**三路径等价性契约测试** | #778 #632 #633 #649 |
| **部署层**：装哪些文件、装到哪 | 4 处手写清单 + 3 套安装器（init/update-hooks/install.sh）| **1 份部署清单（数据）+ 1 个安装器**，其余消费它；发布产物含契约测试 | #783 #769 #771 #770 #741 #756 |
| **解析层**：模块/adapter/gate 查找顺序 | pre-commit 用生成表（已对），pre-push 手写（错），JS 侧 doctor 用 JS 模块 | 生成表为唯一顺序源，pre-push 接入；消除手写级联 | #495 #500 类 + pre-push 反转 |
| **输出层**：verdict/report/audit | quality-status 键 / history 短键 / pre-push 数组 id / audit gate_id 四种命名空间 | 统一 verdict schema + 单一 report key 命名 | #777 doctor pending 硬编码、#772 |

---

## 3. 优先级 1（最高）：架构根治 —— 消除反复滋生 issue 的土壤

按"根因消除量 / 风险"排序。**全部走 sprint flow（这是真正的 complex 级横切变更）**，但建议先做 P1-A/P1-B 两个独立 sprint，因为它们互相解耦。

### P1-A 部署链路单一事实源（吸收 #783 #769 #771 #770 #741 #756 + 未报告的 update-hooks FATAL）

**根因**：安装清单手写 4 处 + 3 套安装器。
**做法**：
1. 把"xp-gate 安装到用户机器时，hooks 目录 / adapters 目录 / 全局目录各应有哪些文件"声明为**一份数据清单**（JSON 或 JS 常量），init/update-hooks/install.sh/setup-global 全部消费它。
2. copyHooks 白名单改为**枚举包内 hooks/ 实际文件**（或至少断言"包内每个 .sh 都在清单里"），不再硬编码 5 个名字。
3. 给发布链路加**契约测试**（范式 `plugins/dsh/src/contract.test.ts` / `scripts/__tests__/package-lock-registry.test.cjs`）：`npm pack` 后断言 tarball 内 hooks/ 含 registry + 所有 gate-*.sh，且安装到临时目录后 pre-commit 能 source 到 registry。**这正是 #783「发布即翻车」缺的那道网**（规则 4：契约先测）。
4. 统一 3 套安装器为 1 套（或至少统一白名单来源），消除 flat/nested 布局矛盾。
5. `LAYER_CHECKER_MISSING` 在 architecture.yaml 存在时升 BLOCK（#783 建议 3）。
**验收**：update-hooks 后 pre-commit 不 FATAL；install 后 registry 可被 source；契约测试在 pack 后红→绿。

### P1-B 门禁身份单一事实源（吸收 #738 #715 #769 的编号面 + check.js 漂移）

**根因**：编号是位置标签却被当身份用，≥6 处命名空间各自声明。
**做法**：
1. registry 增加 pre-push 行（M/M2/ML/UI/MW/S/10-build），pre-push 也 source 它。
2. `gate-coverage.js` 的 GATE_TABLE + PRODUCER_KEYS **从 registry 派生**（detect-deps.js 已示范从 registry 读行），删除 63-66 行交换表与 95-96 行手写表；**同步修正 `gate-coverage.test.js:84-95`——它当前把反向映射钉为规格，是漂移的背书**。
3. `check.js:86/306` 帮助文本改为从 registry 生成（或只打印 name 不打 number）。
4. `bin/xp-gate.js:515` 的 `i<=11` 循环改为遍历 registry，支持 gate-12/13 子命令（或显式声明 hook-only）。
5. **删除 `githooks/gate-9.sh` 死文件**（5 份字节副本，#717 遗留），把 `resolveGateScript(9)` 的 CLI fallback 指向正确实现。
6. 修正 registry 对 gate 6 的 impl 声明（当前写 inline，实际执行 gate-6-layers.sh）。
**验收**：一条跨侧一致性测试同时读 registry + gate-runner + gate-coverage + check.js + pre-push 语义并比对；#738 可关闭。

### P1-C 解析层收敛（吸收根因 ④ + #495 类复发）

1. pre-push 的 adapter-common 级联改为消费 `HOOK_ADAPTER_DIR_TIERS`（接入 #505 生成表），删除 534-545 手写 global-first 链。
2. 删除顶层死副本 `src/npm-package/hook-module-resolution.sh`（过期 global-first，无消费者），并在 sync 清单断言它不存在（防再生）。
3. 评估 `project_nested` 条件冗余 tier 与 flat-shadowed-nested 不变量（agent 2 指出 flat 拷贝遮蔽 repo nested 源码，#718 时间窗内会改变 gate 行为）——这是 P1-A 部署统一后的自然结论。

### P1-D 执行层等价性契约（吸收 #778，为 P2 双实现收敛铺路）

1. 三路径契约测试：给定 fixture 项目 + 预期 verdict，分别走 hook / CLI /（skill 断言复用 CLI 调用）三路，断言结论一致。
2. 发布 capability matrix：哪条路能跑哪些门（当前 CLI 结构性缺席 0/1/5/9/11/12/13），让 "not run from the CLI" 成为契约而非脚注。
3. （后续，非本轮）shell/TS 双实现收敛为 TS 唯一实现——这是最大手术，放 P1-D 契约就位后再做，避免无网状态下大改。

### P1-E 镜像重复治理（按 11-08 决策文档已定的方案执行）

- 11-08 文档已建议 **选 B（移出 git，prepack 生成），分两步**：先 adapters（293 文件，最大块），后 principles/hooks-lib/build-integrity。
- 11-07 reevaluation 补充：**先做 S1 盘点 + 让 parity 覆盖全部纯复制文件**（盲区 59.7%→0），再做 B。以及"选项 A 两件事（阻断式漂移门禁 + mirrored header）作为任何选项的共同前提"。
- **新增实测（第三勘察）**：parity 清单只覆盖 50/1006 文件 = **5%**；`xp-gate sync-mirrors` **零接线**（不在 npm scripts / CI / pre-commit / pre-push），默认 dry-run、`--write` opt-in；当前 **4 处活漂移**（csharp adapter 工作区漂移 + 3 棵 gitignore 插件技能树，其中 `test-specification-alignment/AGENTS.md` 缺末尾换行，上个 commit 改 9 份副本仍漏这 3 棵）。技能副本全景：1 canonical → **7 个副本**，3 棵 gitignore 插件技能树无任何检查覆盖。
- **决策点（用户一周前未拍板，本文再次提请）**：选 A/B/C？mirror-parity CI 语义能否从"两文件相等"改为"生成可复现"？

### P1-F 测试性能根治（吸收 #640 的测试侧 + 11-07 设计文档的 O1–O11）

**根因**：启动税主导（tsx/工具探测/子进程），非测试逻辑本身。
**实测基线**（第三勘察）：vitest 墙钟 185.69s（tests 累计 1016s）；BATS 234 文件单进程顺序跑、102 个文件直接跑真实 pre-commit；Gate 5 恒带 `--coverage`（单文件 5.1s→34.7s）；gate-10 审计中位 57.3s/max 168s。
**做法**（按 11-07 设计文档 O1–O11 的优先级，此处只列本轮可落地的）：
1. **Gate 5 去掉恒定 `--coverage`**（`pre-commit:3300/3315/3361/3373` 四分支）：commit 时只跑增量相关测试，coverage 交给 CI（CI 已在跑）。这是单笔最大的收益（5.1s→34.7s 的插桩税直接消失）。**注意**：这是行为变更，需用户确认——commit 时是否还需要覆盖率门禁。
2. **测试内子进程反模式**：`boy-scout-integration.test.ts` 6 处 `npx tsx` 改一次解析（`boy-scout.test.ts:737`/`ui-detector.test.js:375` 已有先例注释）；`phase-transition.test.js` 103 例的 `execSync('git …')` 改用 in-process git 库或共享 fixture repo；`config-enforcement.test.ts` 28 例每例起 tsx+全 rules 引擎 → 改为单进程多用例。
3. **BATS 并行化**：run-bats.cjs 单顺序进程跑 234 文件 → 按文件分片并行（bats 本身不支持，需 runner 层做）。102 个跑真实 hook 的文件是主要成本。
4. **工具探测缓存**：semgrep --version 11.7–13.7s、npx -y mypy/ruff 4–6s/工具的探测成本，用短 TTL 缓存（注意 #779/#782 的 EPERM 教训：缓存不能把"工具故障"伪装成"未安装"）。
5. **vitest maxWorkers/pool 显式配置**（11-08 文档 P1-1，仍未做）。
**验收**：全量 vitest 185s→目标 <90s；BATS 有分片；Gate 5 commit 时不带 coverage；每项收益按 AGENTS.md 六硬规则 ABBA 测量并报告负载。
**关联**：#640（pre-commit 7.3 分钟冷启动）的测试侧部分由此吸收；#779（check --all 117s）的 CLI 侧由 #782 的 node-direct tsx 吸收。

---

## 4. 优先级 2：你点名的几个重点问题在主干上是否已修

| 问题 | 一周前结论 | **当前主干实测** | 证据 |
|---|---|---|---|
| 全局 vs 项目 hook 优先级搞反 | 未核实 | **pre-commit 已修（#505 project-first）；pre-push 仍反转（global-first，活 bug）** | `pre-push:534-545` 手写 global-first；引用生成表计数=0 |
| 代码多处完全重复 | 未核实 | **仍存在且量化**：429 镜像文件/~30,404 行；principles 118↔107（测试有意排除）；gate-9.sh 死文件 5 份副本；copyHooks 双实现 | §1 根因 ① + 实测 |
| 门禁序号漂移多端不一致 | #738 报过 | **未修，且新增 2 处**：gate-coverage 反向映射仍在（被测试固化）；check.js 帮助文本旧编号；pre-push Gate10 语义冲突 | §1 根因 ③ |
| 自动化测试性能低下 | 未核实 | **部分改善但基线仍差**：phase-transition 85→49.9s 等 4 文件已优化，全量 vitest 253→224.7s；但 **vitest 仍无 maxWorkers/pool 配置**（P1-1 未做），且实测墙钟 **185.7s**（tests 累计 1016s，启动税主导）、BATS 234 文件单进程顺序跑（102 个跑真实 hook）、**Gate 5 恒带 `--coverage`**（单文件 5.1s→34.7s）、工具探测即成本（semgrep --version 11.7–13.7s、npx mypy/ruff 4–6s）、gate-10 审计中位 57.3s/max 168s | 第三勘察实测 `.xp-gate/reports/` + `audit.jsonl`；vitest.config.ts 无并发配置 |

**结论**：你担心的四个重点问题，**没有一个在主干上彻底解决**。两个（优先级反转、序号漂移）在 pre-commit 侧修了，但在 pre-push / CLI / 帮助文本侧活着；重复与测试性能是"改善了一半"。这正好印证"先修架构土壤"的判断——上半修了的那些，又在下半复发。测试性能尤其如此：4 个大文件优化了，但 Gate 5 恒定插桩、BATS 顺序跑真实 hook、工具探测启动税三个结构性浪费**原封未动**。

---

## 5. 优先级 3：逐 issue 归因 —— 哪些会随架构修复自然消除

60 个 open issue 按"是否被 P1 架构修复吸收"分三类。

### 第一类：架构修复后自然关闭（无需单独代码改动）—— 约 14 个

| Issue | 归因 | 被哪个 P1 吸收 |
|---|---|---|
| #783 gate-6-layers 不部署 | 部署清单手写 | P1-A |
| #769 registry 不部署 + blocks 冲突 | 部署清单 + registry 派生 | P1-A + P1-B |
| #738 CLI 编号 9/10 双轨 | 编号手写 | P1-B |
| #778 三执行面不一致 | 无契约 | P1-D |
| #715 Gate 6 双执行面分叉 | 身份/执行面 | P1-B + P1-D |
| #777 doctor pending 硬编码 | 输出层 schema | P1-D（统一 verdict 后 pending 名单可派生） |
| #771 uninstall 不点名 + exit0 | 部署/退出码语义 | P1-A（统一安装器时顺带统一退出码） |
| #770 uninstall 删他人 .sh | 部署清单 | P1-A |
| #773 update-skill --all 全拒仍 exit0 | 退出码语义 | P1-A（同 #771） |
| #741 uninstall --global 不删 skill（死代码） | 部署清单 | P1-A |
| #756 backup 只增不减 | 部署/安装器 | P1-A |
| #754 Gate 4 函数体提取缺陷 | **已修未关**（280e0b7e + 8e03b0a4） | 直接关单 |
| #740 Gate MW Windows 路径 | **已修未关**（随 0.36.0.0） | 直接关单 |
| #720 REQ-670 混入 53 条 AC | spec 数据质量 | 独立小修（清理 spec），非架构 |

### 第二类：独立缺陷，架构修复不吸收，需单独 TDD —— 约 28 个

按簇：
- **lizard/CogC 簇（7）**：#747（P1 bug，lizard 1.25 三计数缺陷）、#746、#744、#750（needs-design 独立基线）、#748、#727、#729。这是 Gate 3 的能力扩展，独立专题。
- **Gate 3/8/9/13 实现缺陷（6）**：#737（ccn-report --root 被忽略）、#734（只 diff 扫描）、#732（扩展名 regex 漏 .mjs/.cjs/.mts/.cts）、#736（detect-secrets --update 提示不存在）、#735（Windows 反斜杠 baseline 抖动）、#701（UTF-8 reactor 排除）、#703（JaCoCo 非 ASCII 路径）、#708（JDK 版本下限提示）。
- **Delphi 外部提供者（3）**：#711（channels external 非完整关闭）、#707（base_url ${VAR} 展开）、#705（5xx 丢弃错误体）。
- **mutation（1）**：#752（prepare 污染工作树 + 断言必然假）——需查 gate-m.ts 当前实现，可能与 P1-D 等价性测试相关。
- **语言/CI（3）**：#730（多语言自动注册，中型 feature）、#731（CI setup-dotnet）、#706（kotlin BATS 夹具）。
- **其他实现（7）**：#728（archlint layer_violation 恒 0）、#764（Gate 4 formatSummary 误判 FAIL）、#772（Gate 12 字符串累加拆假文件名）、#751（sync-version sed 兜底）、#742（sync-version 测试 hardening）、#720（spec 清理）。

### 第三类：设计/追踪/PoC，架构修复不直接关闭 —— 约 18 个

- **ARCH 规则系列（11）**：#690–#700、#685。其中 #690/#698 needs-design、#698 口径未澄清。**建议**：Gate 4 刚因 #754 暴露解析缺陷，先稳定解析器再逐条加规则（每周 1–2 条进 sprint）。
- **追踪/索引单（5）**：#638、#685、#610、#609、#608——更新文档/关单，不写代码。
- **设计/PoC（7）**：#606（风险分级）、#608（例外注册表）、#539（PoC JEV）、#562（阈值 60→80，等真实覆盖率数据）、#640（pre-commit 性能，部分被 #782/#779 工作覆盖）、#734（设计）、#638（追踪）。

### 归因总结

- **会自然消除/直接关单**：14 个（23%）
- **需单独 TDD 但不与架构耦合**：28 个（47%）
- **设计/追踪/延期**：18 个（30%）

**关键判断**：约 1/4 的 open issue 是架构病的症状。P1 做完后，这批不需要逐一定修。同时有 6 个（#754 #740 等）是**已修未关**——应立即关单，这是最快的"清池"动作。

---

## 6. 执行顺序建议

```
第 0 步（今天，半小时）:
  - 关单已修未关的 #754 #740（核实测试绿后直接 close）
  - 给 #783/#782/#769/#771 标注"归入 P1-A 架构修复，不单独修"

Sprint 1（P1-A + P1-C，部署+解析，约 2–3 天）:
  - 最高杠杆：消除 update-hooks FATAL + registry 不部署 + pre-push 优先级反转
  - 这三个都是"用户机器上正在发生"的缺陷，优先于一切优化
  - 契约测试先写（规则 4）

Sprint 2（P1-B，身份单一事实源，约 2 天）:
  - registry 派生 CLI + 删 gate-9.sh 死文件 + 修 gate-coverage 测试背书
  - 完成后 #738 #715 #769(编号面) 关闭

Sprint 3（P1-D，等价性契约 + 输出层，约 2–3 天）:
  - 三路径契约测试 + capability matrix + 统一 verdict schema
  - 完成后 #778 #777 关闭

Sprint 4（P1-F，测试性能，独立于发布链路，风险低可提前）:
  - Gate 5 去恒定 --coverage（需用户确认行为变更）
  - 测试内子进程反模式 + BATS 分片并行 + vitest maxWorkers
  - 每项收益按六硬规则 ABBA 测量

Sprint 5（P1-E，镜像治理，按 11-08 决策执行，需用户拍板 A/B/C）:
  - S1 盘点 → 阻断式漂移门禁 + mirrored header → adapters 移出 git

并行/穿插（第 2 类独立缺陷）:
  - lizard/CogC 簇（#747 P1 优先）作为独立专题分支
  - 其余中小组按 TDD 逐个 PR

第 3 类:
  - 不进本迭代排期，注明阻塞条件
```

**建议的 sprint flow 用法**：P1-A/P1-B/P1-C/P1-D 各是一个 complex 级 sprint（触及发布链路/核心契约，HARD-GATE 的 Delphi 评审在这里值回票价）。P1-F 测试性能风险低、收益可测量，可作为第一个"练手"sprint 先做（它不触及发布链路，即使出错也不影响已发布用户）。不要把 60 个 issue 塞进一个 sprint。

---

## 7. 需要用户拍板的决策点

1. **镜像治理选 A/B/C**（11-08 文档三问仍未答）：维持现状+补防线 / 移出 git 由 prepack 生成 / 拆 workspace 多包。本文倾向 B 分步（先 adapters），但需你确认。
2. **P1-A 是否包含"统一 3 套安装器为 1 套"**：收益大但触及面广；也可先只统一白名单来源（数据化），安装器保留 3 套但消费同一清单。后者风险低，建议先做后者。
3. **已修未关的 6 个 issue**：授权我核实测试绿后直接 close，还是你想逐个看？
4. **#783 的 BLOCK 化时机**：architecture.yaml 存在时 LAYER_CHECKER_MISSING 升 BLOCK，会让存量未部署成功的用户升级后提交失败。接受吗？

---

## 8. 与上一轮规划的关系

上一轮（按 issue 打包）结论"不建议对 60 个 issue 启动 sprint flow"**仍然成立**，但理由升级了：不是"issue 太多装不下"，而是"其中 14 个是架构病的症状，单独修会复发"。正确的载体是 **4 个架构 sprint（P1-A/B/C/D）**，它们吸收掉症状类 issue 后，剩下的 28 个独立缺陷按常规 TDD PR 处理，18 个设计/追踪单不进代码迭代。
