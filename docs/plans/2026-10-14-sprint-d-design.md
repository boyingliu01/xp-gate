# Sprint D 设计文档（v0.25.0）— 效能与迁移路径

**Issues**: #516 #399 #410 #511 #519 · **复杂度**: standard · **日期**: 2026-10-14

---

## 0. 共性约束

- **镜像树**：`githooks/pre-commit`、`githooks/pre-push`、`githooks/adapter-common.sh`、`githooks/lib/*.sh`、`githooks/adapters/python.sh` 均有 `src/npm-package/` 镜像（`scripts/check-hook-mirror.sh` 字节比对守卫）。每处修改必须手工同步两棵树后再提交。
- **SKIP 而非 BLOCK**：门禁工具缺失一律降级告警，语义完全保留（本项目规范）。
- **TDD**：每 issue 先 RED 后 GREEN；bats 单跑目标文件，vitest 单跑目标文件。

---

## 1. #516 — Gate 5 Python 默认启用 pytest-xdist 并行

**痛点**：Python 门禁串行跑全量（实测 30-45min），并行 `-n auto --dist loadfile` 实测 2.5min，12x 提效。

**设计**：

1. `adapter-common.sh` 新增 `python_xdist_args()`：探测 `python -c "import xdist"`（stdout 静默），
   - 可用 → 输出 `-n auto --dist loadfile`；
   - 不可用 → 输出空串 + stderr 一行告警（`⚠ pytest-xdist 未安装，Gate 5 降级串行…建议 pip install pytest-xdist`）。**绝不 BLOCK**。
2. 消费点（三处，全部走同一 helper）：
   - `adapters/python.sh` `run_tests()` / `run_coverage()`：`pytest $XDIST_ARGS --exitfirst …`；
   - `pre-commit` Python coverage 分支的裸 `pytest` 调用。
3. `--dist loadfile`（非默认 `load`）：按文件分组，规避跨文件共享状态并行冲突（issue 实测 2555 条零随机失败）。
4. coverage 兼容：pytest-cov 与 xdist 正常联动（worker 各自测量、主进程合并），`fail_under` 判定不受影响，无需特殊处理。
5. `--exitfirst` 与 xdist 兼容（首个失败终止全组），现有参数不动。

**测试**（`adapter-python-xdist.test.bats`）：
- xdist 可用（fake PATH：python stub 输出 exit 0）→ helper 输出含 `-n auto --dist loadfile`；
- 不可用 → 输出空 + 提示含 `pytest-xdist`；
- python.sh run_coverage 在无 xdist 环境仍串行成功（降级不 BLOCK）。

---

## 2. #399 — Python 智能测试选择（三层策略，对齐 TS #286）

**设计**：

1. 新文件 `githooks/lib/python-test-selection.sh`（镜像 `src/npm-package/hooks/lib/`），纯函数、可单测：
   - `select_python_test_strategy <test_count> <src_count> <deps_changed>` → 输出 `full | changed-tests | related | skip`：
     - `deps_changed=1`（pyproject.toml / requirements*.txt 变更）→ `full`（依赖变更可能破坏任何测试）；
     - `test_count > 20` → `full`；
     - `test_count > 0` → `changed-tests`；
     - `src_count > 0` → `related`；
     - 否则 → `skip`。
   - `python_related_tests <src_file>`：对 `src/foo/bar.py` 依次探测
     `tests/foo/test_bar.py`、`tests/foo/bar_test.py`、`tests/test_bar.py`、`tests/bar_test.py`、
     `src/foo/test_bar.py`、`src/foo/bar_test.py`、`src/foo/__tests__/test_bar.py`、
     `src/test_bar.py`、`src/bar_test.py`（dir 内平铺 + `__tests__/`），存在则输出（去重）。
2. `pre-commit` Python coverage 分支重构：
   - 计算 `PY_CHANGED_TEST_FILES`（`(^|/)test_[^/]*\.py$|_test\.py$`）与 `PY_CHANGED_SRC_FILES`（.py 非测试）；
   - 按策略分流：
     - `full` → 维持现状全量 + fail_under；
     - `changed-tests` / `related` → 只跑目标文件（带 `--cov` source、**不带** `--cov-fail-under`，子集覆盖率全局无意义），置 `PARTIAL_TEST_RUN=true`；
     - `skip` → 不跑 pytest，输出 skip 说明，置 `PY_TEST_SKIPPED=true`（Stage 2 跳过强制）。
   - xdist 参数叠加（#516 helper）。
3. `lib/coverage-total.sh` `enforce_python_coverage`：感知 `PARTIAL_TEST_RUN=true` → 阈值不满足时降级 WARN（对齐 TS 分支 #286 语义）；全量跑维持 BLOCK。

**测试**（`issue-399-python-test-selection.test.bats` + 既有 issue-523 测试扩展）：
- 策略函数五分支真值表；
- related lookup 在 fixture 树上命中/不命中；
- enforce_python_coverage 在 PARTIAL_TEST_RUN=true 时 <80% 返回 0 且输出 warn。

---

## 3. #410 — Gate M (Python) Windows 原生支持（消除死锁 + pytest-gremlins 引擎）

**死锁机理**：`detect_python_mutation_testable` 只查 mutmut 是否安装；Windows 原生 mutmut 3.x `run` 必然 exit 1（fork 依赖）→ 装了必被拦、卸了必 SKIP。

**设计**（短期 + 中期一并落地）：

1. **平台感知检测**（`adapter-common.sh`，镜像三处同步）`detect_python_mutation_testable` 重排：
   - gremlins 可用（`python -c "import pytest_gremlins"`）→ return 0（引擎 gremlins，全平台）；
   - mutmut 可用且非 Windows（`uname -s` 非 `MINGW*|MSYS*`）→ return 0（引擎 mutmut）；
   - mutmut 可用且 Windows 且 `wsl mutmut --version` 成功 → return 0（引擎 mutmut/wsl）；
   - 其余 → return 1，stderr 打印：死锁说明 + 安装建议（`pip install pytest-gremlins`，要求 Python ≥3.11）。
2. **TS 侧同源修复** `mutmut-runner.ts` `isAvailable()`：win32 且 native `mutmut --version` 成功时，改为**优先探测 WSL**；WSL 不可用则 route=unavailable（当前实现 native 成功即 route=native，Windows 上 `run` 必败 → 死锁）。纯 Unix 语义不变。
3. **新引擎** `src/mutation/runners/gremlins-runner.ts`：
   - probe：`python -c "import pytest_gremlins"`；
   - run：`pytest --gremlins --gremlin-targets=<dirs> --gremlin-report=console --gremlin-parallel --gremlin-cache`（超时/升级杀进程与 MutmutRunner 同构）；
   - 解析 console 报告：`Zapped: N gremlins (P%)` / `Survived: N gremlins` → killed/survived/total/score；两行均缺 → report=null（非阻塞）；
   - `index.ts` 导出；gate-m.ts Python 路由改为：gremlins 可用 → GremlinsRunner，否则 MutmutRunner。
4. **文档**：SKILL/README 不动；Gate M 输出文本标明引擎名，便于事后取证。

**测试**：
- bats `issue-410-python-mutation-platform.test.bats`：fake PATH 模拟 mutmut/WSL/gremlins 四象限；
- vitest `gremlins-runner.test.ts`：console 输出解析（正常/缺行/零突变体）、probe 失败路径；
- vitest mutmut-runner 补 win32-native-no-wsl → unavailable 分支。

---

## 4. #511 — gitleaks 缺失迁移路径（保持 fail-closed）

**设计**（probe-and-prompt，不静默自动装）：

1. `scripts/install-gitleaks.sh`：补 Windows 分支（`uname -s` MINGW*/MSYS* → GitHub releases 下载 windows zip，解出 `gitleaks.exe` 到脚本目录并提示加入 PATH）；linux/darwin 逻辑不动。
2. `scripts/install-pre-commit.sh` / `scripts/install-all.sh`：安装完成后探测 gitleaks：
   - 已装 → 打印版本；
   - 缺失 → 打印显著 notice（#499 起 Gate 8 fail-closed，缺失将 BLOCK 提交）+ 给出一键命令 `bash scripts/install-gitleaks.sh`；`--with-tools` 传参时直接尝试安装。
3. `src/npm-package/lib/init.js`：hook 安装完成段同样探测 + notice（extract `probeGitleaksNotice()` 导出，便于单测）。
4. 钩子 fail-closed 语义**零改动**（#499 契约不回退）。

**测试**：bats（installer probe 输出含 notice、已装路径打印版本）；vitest init probeGitleaksNotice（missing/found/命令注入安全——仅打印不执行）。

---

## 5. #519 — phase-transition 时序守卫 + before/after 回显 + 字段归一

**设计**：

1. **时序守卫**（`phase-transition.js` CLI 层）：`status === 'completed' && phase >= 2` 时，读 state：phase n-1 的 history 条目必须为 `completed|skipped`，否则拒绝（exit 1），报错含 history 摘要（每相 `n:name:status` 列表）+ 提示 `--force`。`--force` 显式覆盖，输出 WARN 并继续。
2. **before/after 回显**：CLI 在 transition 前捕获 before（顶层 phase/status + 目标条目旧状态），执行后打印对比行（`phase: 3 in_progress → 3 completed` 风格），让"命令没跑"与"跑了没生效"在输出层可区分。
3. **transition 审计**：`transitionPhase`（manager 层）成功写盘后追加 `.sprint-state/transition-audit.jsonl`（timestamp/from/to/from_status/to_status），best-effort（写失败仅 WARN），与 gate 审计日志同风格。
4. **字段归一**（`sprint-state-migrator.js`）：migrateState 中 `if (!entry.phase_name && entry.name)` → `entry.phase_name = entry.name`（phase 1 遗留 `name` 归一，保留 `name` 字段不删除以保证读取兼容；`entry.phase_name && !entry.name` 亦同步回填 name）。

**测试**（vitest 扩展 phase-transition.test.js / sprint-state-manager.test.js / sprint-state-migrator 相关）：
- 跳阶段被拒且报错含 history 摘要；`--force` 放行；
- 正常时序（n-1 completed / skipped）不受影响；
- 每次转换输出含 before/after 行；
- audit 文件逐条 JSON、字段齐全；
- migrateState 把 `name: 'PREP'` 归一为 `phase_name`。

---

## 6. 实施顺序与发布

1. #516 → 2. #399（同文件域，先 helper 后策略）→ 3. #410 → 4. #511 → 5. #519 → 镜像同步 parity 检查 → 走查（delphi 外部三模型）→ validator → push → 关 issue → tag v0.25.0.0 + Release。
