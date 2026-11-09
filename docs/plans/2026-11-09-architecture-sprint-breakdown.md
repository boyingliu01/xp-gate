# 架构修复拆分方案：五个 P1 的 REQ/AC 边界、依赖与估算

- 日期：2026-11-09
- 状态：待评审（拆分方案，供用户决定本次 sprint 范围）
- 关联 issue：#789（索引）#790（镜像 A/B/C）#791（Gate 10 性能负结果）
- 前置文档：`2026-11-09-architecture-orthogonal-decomposition.md`（根因实测）
- 目的：在启动 sprint-flow 之前，把五个架构 P1 拆成可独立验收的 REQ 边界，标明依赖与估算，供用户决定「本次 sprint 做多少」

---

## 0. 结论先行

五个 P1 **不是一个 sprint 的合理粒度**。它们之间有硬依赖链（P1-A → P1-C → P1-B → P1-D），每个都是 complex 级横切变更，各自的 BUILD→VERIFY→SHIP 都能独立构成一个 sprint。

**建议**：本次 sprint-flow 只做 **P1-A + P1-C**（部署 + 解析，依赖关系最紧、都是用户机器上正在发生的活 bug），其余四个作为后续独立 sprint。若用户坚持单 sprint 推进全部五个，则 DESIGN 阶段必须把它们拆成 5 个 REQ slice，且 SHIP 会是一个跨越发布链路 + 核心契约 + 测试套件的巨型 PR——风险显著高于逐个 sprint。

下文给出每个 P1 的 REQ/AC 边界，用户可据此判断粒度。

---

## 1. 依赖图（决定先后顺序的硬约束）

```
P1-A 部署链路单一事实源
  │
  ├─→ P1-C 解析层收敛（pre-push 接入生成表；前提：部署层统一，否则 pre-push 部署的解析表版本不一致）
  │      │
  │      └─→ P1-B 身份单一事实源（registry 派生 CLI；前提：registry 能部署到消费者 = P1-A；pre-push source registry = P1-C）
  │             │
  │             └─→ P1-D 执行等价性契约（断言三路径结论一致；前提：身份层统一，否则连"哪道门"都对不齐）
  │
  └─→ P1-E 镜像治理（独立，但需用户拍板 A/B/C；部署清单统一后，镜像移出 git 的打包组件归属更清晰）

P1-F 测试性能 —— 完全独立，可最先做（不触及发布链路，风险最低）
```

**关键依赖解释**：
- P1-B 的「registry 派生 CLI」要求 registry 存在于消费者机器——这正是 P1-A 修的部署缺陷（#769）。若先做 P1-B，CLI 从 registry 读，但消费者机器上没有 registry，派生逻辑无意义。
- P1-D 的「三路径等价」要求三道门有统一身份——P1-B 的产物。否则契约测试连"对比哪道门的结论"都无法表达。
- P1-C 的「pre-push 接入生成表」要求 pre-push 部署的 hook-module-resolution.sh 是 project-first 版本——P1-A 统一部署后才能保证。

---

## 2. 各 P1 的 REQ/AC 边界

### P1-A 部署链路单一事实源
**吸收 issue**：#783 #769 #771 #770 #741 #756 + 未报告的 update-hooks FATAL
**触及面**（实测）：
- `src/npm-package/lib/shared-utils.js:62-86`（copyHooks 5 文件 flat）
- `src/npm-package/lib/update-hooks.js:159-189`（copyHooks 3 文件 nested，缺 post-commit + hook-module-resolution.sh + lib/）
- `src/npm-package/lib/uninstall.js:868`（注释自认"必须与 copyHooks 列表同步"）
- `src/npm-package/lib/init.js:667/689/747`（三个 copyHooks 调用点：local/template/global）
- `githooks/install.sh:20`（GATE_SCRIPTS 不含 registry）
- `src/npm-package/lib/doctor.js:1764-1771`（EXPECTED_GATE_SCRIPTS 不含 registry）
- `src/npm-package/scripts/sync-package-content.js:255`（prepack HOOK_FILES 6 文件）

**REQ-A1（部署清单数据化）**：声明一份部署清单（包内 hooks/ 各文件 → 安装目标位置），init/update-hooks/install.sh/setup-global/uninstall 全部消费它。
- AC-A1-1：清单是单一数据文件/常量，5 个消费方读取它而非各自硬编码
- AC-A1-2：断言"包内 hooks/ 下每个 .sh 都在清单里"（新增 gate 脚本时漏改清单会测试失败）
- AC-A1-3：update-hooks 后 `.git/hooks/` 含 hook-module-resolution.sh（当前缺，导致 pre-commit FATAL）

**REQ-A2（安装器统一白名单来源）**：三套安装器（init/shared-utils、update-hooks、install.sh）消费同一清单。
- AC-A2-1：update-hooks 与 init 的 hooks 白名单来自同一数据源（消除 5 文件 vs 3 文件分歧）
- AC-A2-2：flat/nested 布局矛盾消除（update-hooks 不再造 `adapters/adapters/` 双层嵌套）
- AC-A2-3：`githooks/install.sh` 的 GATE_SCRIPTS 从清单派生（含 gate-registry.sh）

**REQ-A3（发布契约测试）**：`npm pack` 后断言 tarball hooks/ 含 registry + 所有 gate-*.sh；安装到临时目录后 pre-commit 能 source 到 registry。
- AC-A3-1：契约测试在 pack 后运行（范式 `plugins/dsh/src/contract.test.ts`）
- AC-A3-2：模拟全局安装后，`source ~/.config/xp-gate/hooks/hook-module-resolution.sh` 成功且 project-first
- AC-A3-3：#783 建议 3——architecture.yaml 存在时 LAYER_CHECKER_MISSING 升 BLOCK（此条需用户确认时机，见 §4 决策点）

**估算**：3–4 天（TDD：先写部署契约测试 RED → 清单数据化 → 三安装器改消费 → 契约 GREEN）。触及发布链路，Delphi HARD-GATE 值回票价。

---

### P1-C 解析层收敛
**吸收根因**：④ pre-push 优先级反转 + 顶层死副本
**触及面**（实测）：
- `githooks/pre-push:534-545`（手写 global→project→script，引用生成表计数=0）
- `githooks/pre-commit:243`（已正确消费 HOOK_ADAPTER_DIR_TIERS）
- `src/npm-package/hook-module-resolution.sh`（顶层死副本，global-first 过期，三重盲区）
- `scripts/generate-hook-resolution.cjs`（生成器）

**REQ-C1（pre-push 接入生成表）**：pre-push 的 adapter-common 级联改为消费 HOOK_ADAPTER_DIR_TIERS，删除手写 global-first 链。
- AC-C1-1：pre-push 引用 hook-module-resolution.sh / HOOK_ADAPTER_DIR_TIERS（当前计数=0）
- AC-C1-2：全局安装 + 项目自带 githooks/adapter-common.sh 时，pre-push 与 pre-commit 解析到同一份（新增 bats 断言）
- AC-C1-3：pre-push 对项目级 adapter-common 的解析顺序与 pre-commit 一致（project-first）

**REQ-C2（删顶层死副本 + 防再生）**：删除 `src/npm-package/hook-module-resolution.sh`（顶层），sync 清单断言它不存在。
- AC-C2-1：该文件从 git 移除
- AC-C2-2：sync-package-content / check-hook-mirror 断言顶层无此孤儿（防再生）
- AC-C2-3：确认无任何部署路径消费它（install.sh 引用的是 $HOOKS_DIR/ 下那份，已验证）

**估算**：1–2 天。依赖 P1-A（部署统一后 pre-push 部署的解析表才是 project-first 版本）。

---

### P1-B 身份单一事实源
**吸收 issue**：#738 #715 #769（编号面）
**触及面**（实测）：
- `githooks/gate-registry.sh`（14 行 registry，pre-commit source 但执行路径不查它）
- `src/npm-package/lib/gate-runner.js:658-679`（已对齐：9=build/10=sast）
- `src/npm-package/lib/gate-coverage.js:63-66,95-96`（反向映射 + 手写 GATE_TABLE）
- `src/npm-package/lib/__tests__/gate-coverage.test.js:84-95`（把反向映射钉为规格 AC-636-02）
- `src/npm-package/lib/check.js:86,306`（帮助文本旧编号）
- `src/npm-package/bin/xp-gate.js:515`（i<=11 截断，gate-12/13 无 CLI）
- `src/gates/gate-9.ts:2`（文件名残留，自认 Gate 10）
- `githooks/gate-9.sh` 死文件 5 副本（githooks/、githooks/adapters/、npm-package/、npm-package/hooks/、npm-package/adapters/）

**REQ-B1（registry 升格为身份源，CLI 派生）**：gate-coverage.js 的 GATE_TABLE + PRODUCER_KEYS 从 registry 派生，删交换表。
- AC-B1-1：gate-coverage.js 不再手写 9/10 映射（从 registry 读）
- AC-B1-2：修正 gate-coverage.test.js:84-95——它当前把反向映射钉为规格，是漂移背书，必须改为断言"CLI 与 registry 一致"
- AC-B1-3：check.js 帮助文本从 registry 生成（或只打 name 不打 number）

**REQ-B2（registry 覆盖 pre-push）**：registry 增加 pre-push 行（M/M2/ML/UI/MW/S/10-build），pre-push source 它。
- AC-B2-1：registry 含 pre-push 8 道门的行
- AC-B2-2：pre-push source registry（当前 grep 零命中）
- AC-B2-3：pre-push 的 Gate 10=Build Integrity 与 registry 一致（消除冲突）

**REQ-B3（删 gate-9.sh 死文件）**：删除 5 份副本，CLI fallback 指向正确实现。
- AC-B3-1：5 个 gate-9.sh 副本全部从 git 移除
- AC-B3-2：resolveGateScript(9) 的 CLI fallback 不再指向死文件
- AC-B3-3：issue-532 bats（要求 5 份 verdict 字节一致）改为断言"gate-9.sh 不存在"或删除

**REQ-B4（CLI 子命令支持 12/13）**：bin/xp-gate.js 遍历 registry 而非 i<=11。
- AC-B4-1：`xp-gate gate-12` / `gate-13` 子命令可达（或显式声明 hook-only 并文档化）

**估算**：2–3 天。依赖 P1-A（registry 部署）+ P1-C（pre-push source registry）。

---

### P1-D 执行等价性契约
**吸收 issue**：#778 #777
**触及面**（实测）：
- 三执行路径：hook（githooks/pre-commit 5559 行）/ CLI（src/npm-package/lib/check.js + gate-runner.js）/ skill（skills/*/SKILL.md）
- shell/TS 双实现：src/gates/gate-{3,7,8,9}.ts（TS rewrite of gate-N.sh）
- 输出层 4 种命名空间：quality-status 键（gateN_slug）/ history 短键（gateN）/ pre-push 数组 id（字符串 '10'/'M'）/ audit gate_id（gate-N 连字符）

**REQ-D1（三路径等价性契约测试）**：fixture 项目 + 预期 verdict，走 hook/CLI/skill 三路断言一致。
- AC-D1-1：契约测试对至少 3 道门（如 Gate 3/4/8）跑三路并比对 verdict
- AC-D1-2：承认 #789 Delphi 结论——「字节相同 verdict 不可实现」（bash/node/LLM 上下文非确定），契约断言的是**结论等价**（PASS/FAIL/SKIP + 违规计数），非字节相同
- AC-D1-3：skill 执行面复用 CLI 调用（skill 不直连 shell 实现）

**REQ-D2（capability matrix）**：发布哪条路能跑哪些门（当前 CLI 结构性缺席 0/1/5/9/11/12/13）。
- AC-D2-1：matrix 由 registry + 执行路径能力派生，非手写
- AC-D2-2："not run from the CLI" 成为契约输出而非脚注

**REQ-D3（统一 verdict schema）**：quality-status/history/pre-push/audit 四种命名空间收敛。
- AC-D3-1：统一 verdict schema（status/reason/evidence/duration）
- AC-D3-2：report key 命名单一来源（从 registry 派生）
- AC-D3-3：doctor pending 名单（#777）从 schema 派生，非硬编码

**估算**：3–4 天。依赖 P1-B（身份统一）。注意：这是为后续"shell/TS 双实现收敛为 TS 唯一实现"铺路——收敛本身是更大手术，不在本次。

---

### P1-F 测试性能根治
**吸收 issue**：#640（测试侧）#779（CLI 侧部分）
**触及面**（实测，第三勘察）：
- `githooks/pre-commit:3300/3315/3361/3373`（Gate 5 四分支恒带 --coverage）
- `src/npm-package/lib/__tests__/phase-transition.test.js`（184.8s/103 例，每例 execSync git）
- `scripts/__tests__/gate-5-runner-error.test.ts`（159.4s/13 例，每例起真实 pre-commit hook）
- `src/principles/__tests__/config-enforcement.test.ts`（159.1s/28 例，每例 tsx+全 rules）
- `src/principles/__tests__/boy-scout-integration.test.ts:283-352`（6 处 npx tsx）
- `scripts/run-bats.cjs`（234 文件单进程顺序跑，102 个跑真实 hook）
- `vitest.config.ts`（无 maxWorkers/pool）

**REQ-F1（Gate 5 去恒定 --coverage）**：commit 时只跑增量相关测试，coverage 交 CI。
- AC-F1-1：pre-commit Gate 5 四分支不带 --coverage（或仅在显式 coverage 模式带）
- AC-F1-2：CI 仍跑全量 coverage（不降低覆盖率门禁）
- AC-F1-3：⚠ 行为变更——需用户确认 commit 时是否保留覆盖率门禁（见 §4）
- AC-F1-4：ABBA 测量收益（单测试文件 5.1s→34.7s 的插桩税消失）

**REQ-F2（测试内子进程反模式）**：
- AC-F2-1：boy-scout-integration 6 处 npx tsx 改一次解析（先例 boy-scout.test.ts:737）
- AC-F2-2：phase-transition 103 例共享 fixture repo（或 in-process git）
- AC-F2-3：config-enforcement 28 例单进程多用例

**REQ-F3（BATS 分片并行）**：run-bats.cjs 按文件分片并行。
- AC-F3-1：234 文件不再单顺序进程跑
- AC-F3-2：分片不破坏 bats 的顺序语义假设（需验证）

**REQ-F4（vitest 并发显式配置）**：maxWorkers/pool 配置。
- AC-F4-1：vitest.config.ts 显式配置并发
- AC-F4-2：ABBA 测量（注意 8 核机器负载噪声，六硬规则）

**REQ-F5（工具探测缓存）**：semgrep --version 11.7-13.7s、npx mypy/ruff 4-6s 的探测成本，短 TTL 缓存。
- AC-F5-1：探测结果缓存（TTL 内不重探）
- AC-F5-2：⚠ 缓存不能把"工具故障"伪装成"未安装"（#779/#782 EPERM 教训）——必须区分 NOT_RUN 与 NOT_INSTALLED

**估算**：2–3 天。**完全独立**，可最先做（不触及发布链路，风险最低）。

---

### P1-E 镜像治理（需先拍板 A/B/C，独立 sprint）
**吸收 issue**：#790（决策单）
**触及面**（实测，第三勘察）：
- 429 镜像文件 / 30,404 行（adapters 293 + principles 107 + hooks/lib 21 + build-integrity 8 + skills 若干）
- parity 覆盖 50/1006 文件 = 5%；775 文件/110,282 行在盲区
- sync-mirrors 零接线（不在 npm scripts/CI/hooks）
- 4 处活漂移：csharp adapter + 3 棵 gitignore 插件技能树
- 技能副本全景：1 canonical → 7 副本

**前置决策**（用户拍板，见 §4）：A/B/C 三选。分析倾向 B 分步（先 adapters）。
**估算**：B 方案分两步——adapters（293 文件）3–4 天 + 其余 2–3 天。需先做 S1 盘点 + parity 覆盖全部纯复制文件（盲区 59.7%→0）。

---

## 3. 建议的执行顺序（按依赖 + 风险）

| 顺序 | P1 | 理由 | 前置 |
|---|---|---|---|
| 1 | **P1-F** 测试性能 | 完全独立、风险最低、收益可立即 ABBA 测量。可作为"练手"sprint 验证流程 | 无 |
| 2 | **P1-A** 部署链路 | 消除用户机器上正在发生的 update-hooks FATAL + registry 不部署。最高杠杆 | 无 |
| 3 | **P1-C** 解析层 | 修 pre-push 优先级反转（活 bug） | P1-A |
| 4 | **P1-B** 身份层 | registry 派生 CLI，删死文件 | P1-A + P1-C |
| 5 | **P1-D** 执行契约 | 三路径等价 | P1-B |
| 6 | **P1-E** 镜像治理 | 需 A/B/C 拍板，最大手术 | P1-A（部署统一后打包组件归属清晰） |

**推荐本次 sprint**：**P1-A + P1-C**（Sprint 1，按 #789 执行顺序），或 **P1-F**（若想先以低风险练手验证 sprint-flow 流程）。

---

## 4. 需用户拍板的决策点（汇总 #789 §决策 + #790 三问 + 新增）

### 镜像治理（#790，P1-E 前置）
1. 选 A（维持+补防线）/ B（移出 git，prepack 生成，分步先 adapters）/ C（拆 workspace 多包）？分析倾向 B 分步。
2. 若选 B：可否接受「仓库内 src/npm-package 归零」作为硬门禁（pre-commit 拦截任何非 prepack 生成的文件进入该目录）？
3. 顺序：是否先做 `xp-gate audit --stats` 语言分布测量（若 12 语言实际只用 3 种，应先砍语言再清镜像）？

### 部署/身份（P1-A/P1-B）
4. P1-A 是否包含「统一 3 套安装器为 1 套」？建议先只统一白名单来源（数据化），安装器保留 3 套但消费同一清单（风险低）。
5. #783 的 LAYER_CHECKER_MISSING 升 BLOCK 时机——会让存量未部署成功的用户升级后提交失败。接受吗？

### 已修未关
6. 授权核实测试绿后直接 close #754 #740（已修未关）？

### 测试性能（P1-F，行为变更）
7. Gate 5 commit 时是否保留覆盖率门禁？CI 已在跑，commit 时可去掉（AC-F1-3）。

### 范围（本次 sprint）
8. 本次 sprint 粒度：P1-A+P1-C（推荐）/ P1-F（练手）/ 全部五个（巨型）/ 其他组合？

---

## 5. 与 sprint-flow 的衔接

- 本方案是 sprint-flow **DESIGN 阶段 grill-with-docs 的输入**，不是替代。启动 sprint 后，R1 需求评审会逐个 REQ 与你确认 AC，R2 Delphi 评审设计方案。
- §4 的 8 个决策点，按 sprint-flow 规则应记录到 `.sprint-state/decisions.md`（DR-NNN 模板）。
- 若本次 sprint 只做 P1-A+P1-C，则 DESIGN 阶段只需评审这两个 P1 的 REQ/AC（§2 的 P1-A/P1-C 两节），其余四个 P1 的 REQ 作为后续 sprint 的 backlog（#789 索引单已固化）。
- 僵尸 sprint-20261103-68 的处置：用 `sprint-init --force`（CLI 内置取代机制，自动备份旧状态到 `.sprint-history/`），不伪造 VERIFY 完成。
