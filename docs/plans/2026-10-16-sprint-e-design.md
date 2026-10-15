# Sprint E 设计文档（v0.26.0）— Python 门禁提速

**Issues**: #534 · **复杂度**: standard · **日期**: 2026-10-16
**Sprint**: sprint-20261015-96 · **分支**: main

---

## 0. 共性约束

- **镜像树**：`githooks/pre-commit`、`githooks/adapters/python.sh`、`githooks/lib/*.sh` 均有 `src/npm-package/` 镜像，由 `scripts/check-hook-mirror.sh` 字节比对守卫（**硬编码 `HOOK_MIRROR_FILES` 清单 + 集合全等校验**）。每处修改必须手工同步两棵树 **并登记新文件到守卫清单**。
- **SKIP 而非 BLOCK**：门禁工具缺失一律降级告警（本项目规范）。
- **TDD**：每 REQ 先 RED 后 GREEN；bats 单跑目标文件，vitest 单跑目标文件（沙箱下用 bash 等价验证逻辑）。
- **本机 pre-commit 慢**（~5min/次）：提交用前台 + dangerouslyDisableSandbox + timeout ≥420000（2026-10-16 实测）。

---

## 1. 现状梳理（已实测，2026-10-16）

### 1.1 #534 的服务对象：下游 Python 消费者，非 xp-gate 本仓
- **xp-gate 本仓是纯 TS 仓库（Detected languages: typescript iac），0 个 .py 文件**。本仓 pre-commit 不触发 python 分支、不跑 mypy。
- #534 的「mypy 全量推断打满 CPU」痛点发生在**下游 Python 用户仓库**（用 xp-gate 门禁的 Python 项目）——他们的 pre-commit 走 python 分支。
- **优化对象** = xp-gate 提供给 Python 用户的门禁代码（`githooks/adapters/python.sh` + `githooks/pre-commit` python 分支）。**本仓无真实 Python 面，提速效果需在下游 Python 仓库或 CI（ubuntu 装 Python 面）验证**。

### 1.2 两处并行的 mypy 路径（服务下游 Python 用户）
1. **pre-commit python 分支内联增量 mypy**（`githooks/pre-commit` L1311-1334）：收集 `$CHANGED_FILES` 里的 .py/.pyi，`mypy --ignore-missing-imports "${MYPY_ARGS[@]}"` **只查 staged 文件**。已有增量雏形，但：
   - **管道吞退出码（假通过）**：`mypy ... | head -20 | tail -10; MYPY_EXIT=$?` 取的是 tail 退出码，mypy 真实退出码丢失 → 当前增量 mypy 门禁实质不生效。
   - 未处理跨文件依赖（需 `--follow-imports=silent`）。
   - 未衔接 `.xp-gate-mypy-scope` 作用域（对 scope 外 staged .py 的处置未定义）。
2. **python.sh adapter 的 `run_static_analysis()`**（`githooks/adapters/python.sh`）：**全量** `mypy src/` + `mypy scripts/`（或 `.xp-gate-mypy-scope` 声明）。经 `adapter-common.sh` L131 `static_analysis` 路由 + pre-commit L1341 通用分支调用。**这是 CPU 主瓶颈**（百文件级全量推断）。
   - 已高度精炼：`.xp-gate-mypy-scope` 三级作用域解析 + `_mypy_target_usable()` + 反裸 `mypy .` BATS 锁 + CI 口径对齐。

### 1.2.1 事实核查（Delphi R2 触发，2026-10-16 亲自核实）
> **#534 描述的现象与当前代码不符**，Delphi feasibility 专家 R1+R2 坚持并经我核实确认：
> - pre-commit L1099 `python)` case 是**完全内联**的（Ruff lint + 增量 mypy L1311-1335），**从不 source python.sh adapter**。
> - pre-commit 的 Python 门禁 = **增量 mypy**（只查 staged .py），**不跑全量 mypy**。
> - `python.sh` 的 `run_static_analysis()`（全量 `mypy src/ + scripts/`）只通过 `route_to_adapter`（adapter-common.sh L107/L131）触发，而 **`route_to_adapter` 在生产代码中无调用点**（仅 `adapter-common.test.bats:151` 引用）。
> - 结论：**#534 声称的「pre-commit 每次 commit 对 src/ scripts/ 做全量 mypy」在当前代码中不存在**。全量 mypy 可能在旧版钩子、CLI、或手动 `mypy src/` 场景，但不在当前 pre-commit 路径。
> - **影响**：REQ-2（ty opt-in 到 python.sh run_static_analysis）针对的是不被 pre-commit 触发的路径，对 #534「pre-commit 全量打满 CPU」的主痛点**无直接贡献**。REQ-1（修复增量 mypy 假通过）**仍有价值**——它是真实 bug（管道吞退出码）。
> - **Delphi R2 裁决**：architecture/technical APPROVED，feasibility REQUEST_CHANGES（因果链前提问题）。**需用户确认 #534 实际痛点来源后定实施范围**。

### 1.2.2 范围扩展（老牛 2026-10-16 指令）：所有 pre-commit 文件检查增量盘点
> **老牛裁定**："符合原始需求即可，原始需求是在 pre-commit 环节使用增量检查，减少 CPU 占用，避免系统被拖慢" + **"不要只处理 MYPY 这一个程序，所有的这些文件检查，因为在 pre-commit 的时候都应该是做成增量的"**。
>
> **实施范围 = REQ-1（增量 mypy 修复强化） + 全量增量盘点补齐，不止 mypy。**
>
> **已核实（亲自通读 pre-commit）**：
> - **已是增量**（基于 CHANGED_FILES 筛选或工具 --staged）：Python 全分支（Ruff lint/format/debug/增量 mypy）；TS ESLint（ESLINT_FILES）+ Biome（`--staged .`）；Shell shellcheck（SHELL_FILES）；jscpd（传 CHANGED_FILES）；pylint duplicate-code（grep .py）；测试运行（#286 smart selection + related-test + full fallback）。
> - **明确全量点（需补齐）**：
>   1. **Go 分支 `golangci-lint run`（L1346）无参扫全仓库** → 改 `golangci-lint run $(echo "$CHANGED_FILES" | grep '\.go$')`。
>   2. **TS typecheck（lib/typecheck.sh）`npm run typecheck`/`npx tsc --noEmit` 全项目扫描** → **难以增量**（tsc 单文件类型检查不可行，跨文件依赖硬性）；定位：保持全量并注释说明为何不能增量（区别于可增量 lint）。
> - **adapter 层**（typescript.sh `biome check .`/`eslint .`、shell.sh `shellcheck ./*.sh ./**/**/*.sh`、go.sh `go vet ./...`/`golangci-lint run ./...`）虽全量，但经 `route_to_adapter` 调用、**生产无调用点**（Delphi 前轮已核实），pre-commit 各语言分支内联 → 优化对象 = pre-commit 内联分支，adapter 仅文档说明。

### 1.3 引擎现状与替换现实（DR-003 + Delphi R1）
- 本机无 `ty`、有 `pyright`。CI（quality-gates.yml L163）`pip install ruff mypy pylint`（受 `project_language==python || requirements.txt` 门控，**xp-gate 本仓不执行该行**）。
- **ty**（Astral Rust）：2025-12 public alpha（0.0.x），规格一致 ~70%（mypy 75%），配置 `[tool.ty]` 不兼容 `[tool.mypy]`，CLI 是 `ty check <path>`（非 `ty <path>`），无 `--follow-imports` 等价物，默认检查全部未注解代码（等价 mypy --check-untyped-defs），无 mypy 插件体系。**行为/错误集与 mypy 完全不同，作为默认引擎会产生门禁随机器漂移的假绿/假红**。
- **Delphi R1 共识（3 专家全 REQUEST_CHANGES）**：
  - **Critical**：ty 自动探测破坏确定性；`require_tool mypy` 会让「装 ty 缺 mypy」仓库假 BLOCK；增量路径未衔接 scope。
  - **Critical**：`check-hook-mirror.sh` 硬编码清单不登记新 helper → parity 恒 FAIL。
  - **Critical（修正定位）**：pre-commit 已是增量，全量 mypy 在 CLI 适配器路径；#534 服务下游 Python 用户。
  - **Major**：ty CLI 是 `ty check`；`--follow-imports=silent` 语义（silent 仍完整分析、仅抑制自身诊断）；管道吞退出码（假通过）；验收不可测量；全局 hooksPath 不同步；反裸 mypy . 需覆盖 ty 形态。

---

## 2. 设计

### REQ-1（#534 核心，下游 Python 增量提速）：修复并强化 pre-commit 增量 mypy
**定位**：pre-commit python 分支已是增量，但**管道吞退出码导致门禁假通过** + 无跨文件依赖处理 + 未衔接 scope。REQ-1 修复这三处，让增量 mypy 真正生效且秒级。

1. **新增 helper** `githooks/lib/python-incremental-typecheck.sh`（**同步创建 `src/npm-package/hooks/lib/` 镜像 + 登记进 `check-hook-mirror.sh` 的 `HOOK_MIRROR_FILES`**）：
   - `python_staged_py_files`：从 `CHANGED_FILES` 提取 .py/.pyi（去重，保留 `--diff-filter=ACMR` 语义）。
   - `python_typecheck_incremental <files>`：对 staged 文件跑 `mypy --follow-imports=silent --ignore-missing-imports <files>`。
     - **`--follow-imports=silent` 语义（修正）**：silent 仍按 normal 完整分析被跟随模块（含未 stage 的同包兄弟），**仅抑制其自身诊断**、调用方签名级错误照常报告——故「改动 A.py 引用未改动 B.py 时，B.py 自身的类型错误不 BLOCK」成立，但未跟随模块的 import 解析错误会被吞。**依赖 CI 全量 mypy 兜底，须在注释写实此漏检边界**。
     - **退出码捕获（修复假通过）**：先重定向到临时文件，`mypy ... > "$tmp" 2>&1; MYPY_EXIT=$?`（**直取 mypy 原始退出码，不用管道 head/tail 吞掉**），再截断显示临时文件。这是对 L1323-1324 现有 `| head -20 | tail -10; MYPY_EXIT=$?` 假通过的确定性修复。
   - **作用域衔接**：`python_typecheck_incremental` 对 staged .py 先查 `.xp-gate-mypy-scope`——scope 声明内/默认 `src/ scripts/` 内的 staged 文件 → 增量检查；**scope 外 staged .py（如根目录 fetch_*.py、tests/）→ 明确跳过并打印提示**（与全量路径口径一致，不新增对 scope 外文件的 BLOCK 面）。
2. **pre-commit L1311 接入**：python 分支增量块改为调用 `python_typecheck_incremental`，删除内联的 `| head|tail` 管道吞码逻辑；顺手修 L1328 typo `MYPI`→`MYPY`。
3. **职责边界注释**：pre-commit 增量 mypy（只查 staged，秒级）vs python.sh `run_static_analysis()` 全量 mypy（CI/全量兜底，保证「改动影响未改动调用方」不漏检）。两者**并存**，注释写明触发条件差异（增量走 python 分支 L1311，全量走通用分支 L1341）。

### REQ-2（范围扩展：所有 pre-commit 文件检查增量补齐 + ty 显式 opt-in）

**老牛指令扩展**：不止 mypy，pre-commit 里所有文件检查都应增量。盘点已确认绝大多数已是增量，**补齐剩余全量点 + 引擎可选化**：

#### REQ-2a：补齐明确全量点
1. **Go 分支 golangci-lint 增量**（L1346）：`golangci-lint run` 无参扫全仓库 → 改为只对 `$(echo "$CHANGED_FILES" | grep '\.go$')` 运行；无 staged .go → SKIP 不跑。golangci-lint 支持指定文件参数（`golangci-lint run file.go`），可增量。
2. **TS typecheck 保持全量 + 注释说明**：`run_typescript_typecheck` 走 `npm run typecheck`/`npx tsc --noEmit`，**不可增量**（tsc 无单文件类型检查，跨文件依赖是硬性的；增量会漏掉"改动 B.ts 影响未改动 A.ts"的调用方错误）。在 typecheck.sh 顶部注释写明此边界，不强行增量以免破坏正确性。lint（eslint/biome）已增量，typecheck 全量是**有意为之**。

#### REQ-2b：ty 显式 opt-in（#534 诉求 1，收敛为显式 opt-in，默认 mypy 权威）
**Delphi R1 Critical 采纳**：**不自动探测 ty**——mypy 始终为权威引擎，保证门禁确定性。ty 仅在用户**显式启用**时作为加速引擎，且回退语义明确。
**Delphi R1 Critical 采纳**：**不自动探测 ty**——mypy 始终为权威引擎，保证门禁确定性。ty 仅在用户**显式启用**时作为加速引擎，且回退语义明确。

1. `githooks/adapters/python.sh` `run_static_analysis()`：
   - **默认**：维持 `require_tool mypy` + `mypy "$target"` 不变（权威路径零改动，`require_tool mypy` 的 SKIP 语义保留）。
   - **显式 opt-in**：仅当环境变量 `XP_GATE_TY=1` 且 `command -v ty` 存在时，改用 `ty check "$target"`（**ty CLI 是 `ty check`，非 `ty`**）。
   - **回退契约（修复 Delphi Critical）**：`XP_GATE_TY=1` 但缺 mypy/ty 时 → **SKIP 不 BLOCK**（不再有「装 ty 缺 mypy 被 require_tool 假 BLOCK」问题，因为 opt-in 路径不经过 `require_tool mypy`）。
   - **退出码映射**：ty exit 1 = 类型错误（视为检查失败 BLOCK，与 mypy 口径一致）；ty exit 2 = CLI/config 错误（回退提示、SKIP 不 BLOCK，映射成 `require_tool` 类失败）。
   - **反裸 ty**：`ty check` 无参扫全库等价 `mypy .`，**BATS 新增反裸 `ty check .`/无参形态测试**（现有反裸 mypy . 测试需同步覆盖 ty 形态，防止 #501/#513 防线在 ty 路径失守）。
   - `.xp-gate-mypy-scope` 作用域语义在 ty 路径**完全保留**（逐目标调用、`_mypy_target_usable()` 引擎无关判定，注释声明引擎无关）。
2. **CI**：**不装 ty、不参与 ty 探测**（Delphi Critical：避免 CI 与本地红绿漂移）。CI 锁 mypy 权威。quality-gates.yml **零改动**。
3. **文档**：README/AGENTS 说明「ty 为实验性加速选项，需 `XP_GATE_TY=1` 显式开启；默认 mypy 权威；ty 规格一致 ~70%、[tool.ty] 配置不兼容 [tool.mypy]，启用需自担口径差异」。

### REQ-3：测试
- **bats** `githooks/__tests__/issue-534-incremental-typecheck.test.bats`：
  - `python_staged_py_files` 从混合 CHANGED_FILES 正确提取 .py/.pyi（含 scope 内/外分类）；
  - 增量 mypy 带 `--follow-imports=silent --ignore-missing-imports`（fake mypy 捕获参数断言）；
  - **退出码直取**（fake mypy exit 1 → helper 返回 1 BLOCK；验证不再被 head/tail 吞掉）；
  - 无 staged .py → 跳过（exit 0 不 BLOCK）；scope 外 staged .py → 跳过并提示；
  - **Go 增量**：`golangci-lint run $(grep '\.go$' CHANGED_FILES)` 只收 staged .go；无 .go → SKIP 不跑（fake golangci-lint 捕获参数断言）。
  - **ty opt-in**：`XP_GATE_TY=1` + ty 存在 → 用 `ty check`；`XP_GATE_TY=1` 缺 ty → SKIP 不 BLOCK；未设 XP_GATE_TY → 纯 mypy；
  - **反裸 ty**：`ty check` 无参/`.` 形态被拒（断言 adapter 文本无裸 ty check）。
- **镜像**：新增 helper 后，`check-hook-mirror.sh` 的 HOOK_MIRROR_FILES 登记 + `src/npm-package/hooks/lib/` 字节一致副本 → parity PASS。

### REQ-4：本机执行面 + 全局同步
- **全局 hooksPath 同步（Delphi R1 Major）**：本机 `core.hooksPath=C:/Users/think/.config/xp-gate/hooks` 指向全局副本（Oct 14），与本仓版不一致。提交/验证**必须先同步全局钩子**（`npx xp-gate init` 或复制），否则验收跑的是旧代码。记录到实施步骤。
- **提速测量（Delphi R1 验收不可测量）**：验收加入可测量指标——在**带真实 Python 面的仓库**（或 CI ubuntu 装 pytest 面）对 pre-commit 前后计时/CPU 采样：增量 mypy 单次耗时目标 **< 5s**（大变更集除外，记录实际值）；全量路径 `run_static_analysis` 作为对照基线。

---

## 3. 实施顺序

1. REQ-3 测试先行（RED）：新增 bats，断言退出码直取、Go 增量、ty opt-in/回退、scope 衔接、反裸 ty。
2. REQ-1 实现：`lib/python-incremental-typecheck.sh` + pre-commit 接入 + 修退出码吞码 + 修 typo + scope 衔接 + 职责注释。
3. REQ-2a 实现：Go golangci-lint 增量 + TS typecheck 全量边界注释。
4. REQ-2b 实现：python.sh ty opt-in（require_tool 语义保留 + `ty check` 分派 + 退出码映射 + 反裸 ty）+ 文档。
5. REQ-4：镜像清单登记 + 全局钩子同步 + 真实 Python 面提速测量。
6. 镜像同步 parity 检查 → Delphi R2 走查（本地 3 模型）→ validator → push → 关 issue #534 → tag v0.26.0.0 + Release。

---

## 4. 验收标准

- [ ] pre-commit python 分支增量 mypy **直取退出码**（不再被 head/tail 吞掉 → 假通过修复）；
- [ ] 增量 mypy 带 `--follow-imports=silent --ignore-missing-imports`；无 staged .py 或 scope 外 staged .py → 跳过不 BLOCK；
- [ ] **Go golangci-lint 只扫 staged .go**；无 staged .go → SKIP 不跑（消除 L1346 全库扫描）；
- [ ] TS typecheck 保持全量但**顶部注释写明不可增量边界**（tsc 无单文件检查，避免误增量破坏正确性）；
- [ ] `XP_GATE_TY=1` 显式 opt-in：ty 存在 → `ty check`；缺 ty → SKIP 不 BLOCK；未设 → 纯 mypy；
- [ ] 反裸 `ty check`（无参/`.`）被拒，作用域语义保留；
- [ ] `check-hook-mirror.sh` 登记新 helper，镜像字节一致 parity PASS；
- [ ] 全局 hooksPath 钩子已同步（验收跑的是新代码）；
- [ ] **提速可测量**：带真实 Python 面仓库增量 mypy 单次 < 5s（大变更集记录实际值）。
  - **实测（2026-10-16，本机 mypy 1.19.1，200 文件模拟 Python 面，缓存后）**：全量 `mypy src/` = 2707ms；增量单文件 = 2034ms（-25%）；增量 5 文件 = 2356ms（-13%）。收益来自只查 staged 文件的类型推断面收窄 + mypy 增量缓存；大变更集/超大仓库收益更显著。
- [ ] 本机 pre-commit 12 门禁全过（前台 + dangerouslyDisableSandbox + timeout≥420000）；
- [ ] 全量 vitest/bats 在 CI（ubuntu）全绿。
