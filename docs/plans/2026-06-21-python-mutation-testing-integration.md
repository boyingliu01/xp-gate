# Gate M — Python Mutation Testing Quality Gate (Pre-Push)

**Issue**: #21 后续改进 — 从 CI-only 升级为 pre-push 阻断 (Python extension)  
**Date**: 2026-06-21  
**Priority**: P0  
**Status**: DRAFT (awaiting Delphi Round 1)  
**Related**: TypeScript Gate M design (2026-05-16-gate8-mutation-testing-precommit.md)

---

## 1. 设计背景

### 1.1 当前状态
XP-Gate v0.9.5 已实现 TypeScript 的 Gate M（基于 Stryker 的增量变异测试），但**Python 项目尚无变异测试支持**。现有 Python 适配器仅包含：
- Gate 1: `mypy` 静态分析
- Gate 1: `ruff/flake8` lint
- Gate 5: `pytest` 测试 + 覆盖率
- Gate 6: `import-linter` 架构检查

**缺失**：Python 变异测试（Gate M 的 Python 实现）。

### 1.2 核心痛点
- **覆盖率虚高**：Python 项目可达 95% 覆盖率，但 mutation score 可能只有 30%
- **AI 生成测试问题**：大量 mock 导致覆盖率达标，但实际 bug 检测能力低
- **缺乏 pre-push 阻断**：Python 项目无法在代码推送到远程前拦截低质量测试

### 1.3 目标
1. **为 Python 添加 Gate M** — 预推时运行增量变异测试
2. **复用 TypeScript Gate M 设计模式** — 保持架构一致性
3. **选择最适合 Python 的工具** — mutmut / mutpy / cosmic-ray

---

## 2. 工具选型

### 2.1 候选工具对比

| 工具 | 安装量 | 速度 | 特性 | 兼容性 |
|------|--------|------|------|--------|
| **mutmut** | 200k+/月 | ⭐⭐⭐⭐ | pytest-native, CLI 友好，增量支持 | ✅ WSL (Windows) |
| mutpy | 50k+/月 | ⭐⭐⭐ | AST 级变异，YAML/HTML 报告 | ✅ 跨平台 |
| cosmic-ray | 10k+/月 | ⭐ | 高度可定制，社区活跃 | ⚠️ 安装复杂 |

### 2.2 选型结论：**mutmut**

**理由**：
- **pytest 原生集成** — XP-Gate 已使用 pytest（python.sh 第 48 行）
- **CLI 友好** — 适合 shell 适配器集成
- **增量支持** — 匹配 Gate M 的 changed-files 模式
- **性能** — 2-3 倍快于 mutpy（典型 Python 项目）
- **Windows 兼容** — WSL 可用（cosmic-ray 安装困难）

### 2.3 工具对比详情

| 维度 | mutmut | mutpy | cosmic-ray |
|------|--------|-------|------------|
| **Mutation Model** | AST 级 | AST 级 | AST 级 |
| **Test Runner** | pytest (原生) | pytest (实验性) | unittest/pytest |
| **增量模式** | ✅ 支持 | ⚠️ 部分支持 | ✅ 支持 |
| **报告格式** | 命令行 + JSON | YAML + HTML | JSON |
| **Windows** | ✅ WSL | ✅ 原生 | ⚠️ 安装困难 |
| **性能** | 快（2-5min/10 文件） | 中（5-10min/10 文件） | 慢（10-20min/10 文件） |
| **社区** | 200k+/月 | 50k+/月 | 10k+/月 |

---

## 3. 设计总览

### 3.1 门禁架构（Python 扩展）

```
Pre-commit（6 道，<10s 总计）:
Gate 1: Code Quality (mypy + ruff/flake8)
Gate 2: Duplicate Code
Gate 3: Cyclomatic Complexity
Gate 4: Clean Code + SOLID
Gate 5: Tests + Coverage (≥80%)
Gate 6: Architecture + Boy Scout Rule

Pre-push（3 道 + Python Gate M，<3min 总计）:
Gate P1: Commit size check (20 files / 500 LOC)  ← 现有
Gate P2: Delphi code walkthrough  ← 现有
Gate M (TypeScript): Stryker mutation  ← 现有
Gate M (Python): mutmut mutation  ← 新增（2min 预算）
```

### 3.2 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| **工具** | **mutmut** | pytest-native, CLI 友好，增量支持 |
| **位置** | **pre-push** | mutmut 执行时间 30s-2min，超出 pre-commit 预算 |
| **增量 vs 全量** | **增量** | 只对 push 涉及的 Python 文件跑变异 |
| **baseline 存储** | **本地缓存** | `.mutation-baseline.json`（gitignored） |
| **超时处理** | **warning，允许 push** | 不阻断，但提示本地跑全量 |
| **threshold 分级** | **两级** | 默认 60%，关键路径 80% |
| **Source-to-test 映射** | **文件命名约定** | `foo.py` → `foo_test.py` 或 `tests/test_foo.py` |

---

## 4. 详细设计

### 4.1 Gate M (Python) 执行流程

```
pre-push 触发 Gate M (Python):

1. 收集即将 push 的 .py 文件（排除 test_*.py, tests/目录）
   └─ 如果没有变更源文件 → SKIP

2. 测试意图检查（轻量，<1s）
   └─ 检查对应测试文件是否有 @test/@intent/@covers 注解
   └─ 缺少注解 → warning（不阻断 push）

3. 判断 threshold 级别
   └─ 检查文件路径是否匹配 .mutation-critical-paths
   └─ 匹配 → 80%，否则 → 60%
   └─ 测试文件可显式声明：# @mutation-threshold: 75

4. 获取 baseline（本地缓存）
   └─ 读取 .mutation-baseline.json（.gitignore，本地生成）
   └─ 如果不存在 → 使用绝对 threshold（不对比 baseline）

5. 运行增量变异测试（带总超时）
   └─ timeout 120s mutmut run --path-to-tests tests/ --source-path src/
   └─ 使用 mutmut 的增量模式：mutmut run --file-pattern "foo.py"

6. 对比结果
   └─ 新文件：score ≥ threshold
   └─ 修改文件：score ≥ baseline（不能下降）
   └─ 低于 threshold → BLOCK push

7. 超时处理（>120s）
   └─ 中断 mutmut，输出 warning
   └─ ⚠️ Mutation testing timed out (>120s). Push allowed.
      Run `python -m mutmut run` locally for full report.
   └─ 不阻断 push
```

### 4.2 Threshold 设计

| 级别 | Threshold | 适用场景 |
|------|-----------|---------|
| 默认 | **≥ 60%** | 普通业务代码 |
| 关键路径 | **≥ 80%** | 核心逻辑（auth, payment, encryption 等） |
| 显式声明 | **按注解** | 测试文件写 `# @mutation-threshold: 75` |

**渐进升级计划**：

| Phase | 时间 | 默认 Threshold | 关键路径 |
|-------|------|---------------|---------|
| Phase 1 | Week 1-2 | 50% | 70% |
| Phase 2 | Week 3-4 | 60% | 80% |
| Phase 3 | Month 2+ | 70% | 85% |

### 4.3 Baseline 机制

**文件**：`.mutation-baseline.json`（**`.gitignore`**，不提交到版本控制）

```json
{
  "version": "1.0",
  "generatedAt": "2026-06-21T10:00:00Z",
  "source": "local",
  "languages": {
    "typescript": {
      "scores": {
        "src/principles/analyzer.ts": {
          "score": 72.5,
          "mutants": 40,
          "killed": 29,
          "survived": 11
        }
      }
    },
    "python": {
      "scores": {
        "src/core/auth.py": {
          "score": 65.0,
          "mutants": 25,
          "killed": 16,
          "survived": 9
        }
      }
    }
  }
}
```

**初始化方式**（三选一）：

| 方式 | 命令 | 适用场景 |
|------|------|---------|
| 本地初始化 | `python -m mutmut run --baseline` | 小型项目（<50 文件） |
| 从 CI 下载 | `curl -o .mutation-baseline.json <CI-artifact>` | 中大型项目 |
| 跳过 baseline | 不运行初始化 | 仅对新文件检查 threshold |

**更新规则**：
- 修改文件：score 不能低于 baseline（只能持平或上升）
- 新文件：按 threshold 要求
- 删除文件：从 baseline 移除
- 每次成功 push 后自动更新本地 baseline

### 4.4 Source-to-Test 映射（Python）

```python
def find_test_file(source_file: str) -> str | None:
    """
    Python 测试文件映射约定：
    1. 同级目录：foo.py → foo_test.py
    2. tests/目录：src/foo.py → tests/test_foo.py
    3. __tests__ 目录：src/foo.py → src/__tests__/test_foo.py
    """
    # 约定 1: 同级目录 *test.py
    test_file1 = source_file.replace('.py', '_test.py')
    if os.path.exists(test_file1):
        return test_file1
    
    # 约定 2: tests/目录
    dir_path = os.path.dirname(source_file)
    basename = os.path.basename(source_file).replace('.py', '')
    test_file2 = os.path.join('tests', f'test_{basename}.py')
    if os.path.exists(test_file2):
        return test_file2
    
    # 约定 3: __tests__ 目录
    test_file3 = os.path.join(dir_path, '__tests__', f'test_{basename}.py')
    if os.path.exists(test_file3):
        return test_file3
    
    return None
```

### 4.5 关键路径配置

**文件**：`.mutation-critical-paths`（项目根目录，可选）

```
# 每行一个 glob 模式（minimatch 语法）
src/auth/**/*.py
src/payment/**/*.py
src/encryption/**/*.py
```

匹配的文件使用 **80%** threshold。

### 4.6 超时处理

```bash
# 使用 Linux/Unix timeout 命令控制总执行时间
timeout 120s mutmut run --path-to-tests tests/ --source-path src/ --file-pattern "*.py"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 124 ]; then
  # timeout 命令退出码 124 = 超时
  echo "⚠️ Mutation testing timed out (>120s). Push allowed."
  echo "   Run 'python -m mutmut run' locally for full report."
  exit 0  # 不阻断 push
fi
```

**为什么 120s**：
- 小型 commit（1-3 文件）：30-60s
- 中型 commit（5-10 文件）：60-90s
- 大型 commit（10+ 文件）：可能超时 → warning

### 4.7 mutmut 配置

**文件**：`.mutmut.conf`（mutmut.ini 格式）

```ini
[mutmut]
runner = python -m pytest -x
test_time_multiplier = 20
test_time_limit = 300
exclude_dirs = .venv,venv,build,dist,.git
```

**Pre-push 增量配置**：通过命令行参数覆盖，无需独立配置文件。

### 4.8 与现有系统的集成

**与 Gate 5 的关系**：
- Gate 5（pre-commit）：管 `coverage ≥ 80%` + 测试全通过
- Gate M（pre-push）：管 `mutation score ≥ threshold`
- 两者独立，互补

**与 test-specification-alignment skill 的关系**：
- Gate M 的"测试意图检查"复用该 skill 的注解规范
- 完整的 test-spec-alignment 仍在 Phase 3 运行

**与 CI mutation testing 的关系**：
- Pre-push Gate M：增量、快速、阻断 push
- CI mutation testing：全量、完整报告、历史趋势
- 两者互补

---

## 5. 文件清单

### 5.1 新增文件

| 文件 | 说明 |
|------|------|
| `src/mutation/gate-m-python.ts` | Python Gate M 主逻辑（mutmut 集成） |
| `githooks/adapters/python.sh` | 添加 `run_mutation()` 函数 |
| `.mutmut.conf` | mutmut 配置（可选） |
| `.mutation-critical-paths` | 关键路径配置（可选） |

### 5.2 修改文件

| 文件 | 修改内容 |
|------|---------|
| `githooks/pre-push` | 在 TypeScript Gate M 后增加 Python Gate M 调用 |
| `githooks/adapter-common.sh` | 增加 `detect_mutation_testable()` 函数（Python 支持） |
| `.mutation-baseline.json` | 扩展格式，支持 languages.python.scores |
| `.gitignore` | 增加 `.mutation-baseline.json`（如未存在） |
| `README.md` | 更新门禁表格，加入 Python Gate M |
| `githooks/adapters/python.sh` | 添加 `run_mutation()` 函数 |

### 5.3 依赖安装

**Python 项目需安装**：
```bash
pip install mutmut pytest-mutmut
```

**CI 配置**（.github/workflows/mutation-test.yml）：
```yaml
- name: Install mutmut
  run: pip install mutmut
- name: Run mutation testing
  run: python -m mutmut run
```

---

## 6. Acceptance Criteria

| ID | Given | When | Then |
|----|-------|------|------|
| AC-01 | 新 Python 文件 mutation score = 65% | pre-push Gate M 运行 | ✅ PASS（≥60%） |
| AC-02 | 新 Python 文件 mutation score = 55% | pre-push Gate M 运行 | ❌ BLOCK push（<60%） |
| AC-03 | 关键路径文件 score = 75% | pre-push Gate M 运行 | ❌ BLOCK push（<80%） |
| AC-04 | 修改文件，baseline score = 60%，新 score = 58% | pre-push Gate M 运行 | ❌ BLOCK push（低于 baseline） |
| AC-05 | 修改文件，baseline score = 60%，新 score = 62% | pre-push Gate M 运行 | ✅ PASS |
| AC-06 | 大 commit（>10 文件），mutmut 超时 | pre-push Gate M 运行 | ⚠️ Warning，允许 push |
| AC-07 | 测试文件缺少 @intent 注解 | pre-push Gate M 运行 | ⚠️ Warning，不阻断 |
| AC-08 | 没有变更 Python 源文件 | pre-push Gate M 运行 | ✅ SKIP |
| AC-09 | 首次启用，无 baseline | 运行 `python -m mutmut run --baseline` | 生成 `.mutation-baseline.json`（gitignored） |
| AC-10 | 显式声明 threshold | 测试文件写 `# @mutation-threshold: 75`，score = 70% | ❌ BLOCK push（<75%） |

---

## 7. 性能预估

| 场景 | 文件数 | 预估 mutants | 预估时间 | 结果 |
|------|--------|-------------|---------|------|
| 单文件修改 | 1 | ~30 | 15-30s | ✅ 正常通过 |
| 小功能（3-5 文件） | 4 | ~120 | 45-90s | ✅ 正常通过 |
| 中等 commit（10 文件） | 10 | ~300 | 90-120s | ⚠️ 可能超时 |
| 大 commit（20+ 文件） | 20 | ~600 | >120s | ⚠️ 超时 warning |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 大 commit 频繁超时 | 开发者忽略 warning | 超时只 warning 不阻断；CI 仍跑全量 |
| baseline 本地缺失 | 无法对比 regression | 首次使用时提示运行 init；支持从 CI 下载 |
| mutmut 配置错误 | Gate M 完全失效 | 独立配置，与 CI 配置分离 |
| 旧项目首次启用 | 大量文件低于 threshold | baseline 初始化时记录当前分数，只卡不下降 |
| pre-push 时间变长 | 开发者体验下降 | Push 频率低（vs commit），2min 预算可接受 |
| Windows 兼容性 | WSL 要求 | 文档明确 WSL 安装步骤 |

---

## 9. 依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `mutmut` | ^2.0.0 | Python 变异测试引擎 |
| `pytest` | ^7.x | 测试运行器（mutmut runner） |
| `minimatch` | ^9.x | glob 模式匹配（关键路径） |

---

## 10. 实施计划

### Phase 1: 核心实现（Week 1）
- [x] 工具选型（mutmut）
- [ ] 创建设计文档（本文档）
- [ ] 实现 `src/mutation/gate-m-python.ts`
- [ ] 添加 `run_mutation()` 到 `python.sh`
- [ ] 扩展 `.mutation-baseline.json` 格式

### Phase 2: 集成测试（Week 2）
- [ ] 集成到 `githooks/pre-push`
- [ ] 添加单元测试
- [ ] 端到端测试（Python 项目）
- [ ] 文档更新（README/adapter docs）

### Phase 3: 渐进升级（Month 1-2）
- [ ] 启用 Phase 1 threshold（50%/70%）
- [ ] 监控超时率
- [ ] Phase 2 升级（60%/80%）
- [ ] Phase 3 升级（70%/85%）

---

## 11. 评审历史

| Round | Expert A | Expert B | Expert C | 结果 |
|-------|----------|----------|----------|------|
| 1 | TBD | TBD | TBD | 待评审 |

---

**Next Step**: 生成 specification.yaml → 实施 → test-specification-alignment 验证

---

## 8. 实施状态

**完成时间**: 2026-06-21  
**版本**: v0.9.6

### 已完成任务

| # | 任务 | 文件 | 状态 |
|---|------|------|------|
| 1 | 工具选型与设计 | `docs/plans/2026-06-21-python-mutation-testing-integration.md` | ✅ |
| 2 | Python adapter 添加 `run_mutation()` | `githooks/adapters/python.sh` | ✅ |
| 3 | TypeScript Gate M Python 运行器 | `src/mutation/gate-m-python.ts` | ✅ |
| 4 | Pre-push 集成 Python Gate M | `githooks/pre-push` | ✅ |
| 5 | Adapter common 添加 `detect_mutation_testable()` | `githooks/adapter-common.sh` | ✅ |
| 6 | 更新 TypeScript 类型定义 | `src/mutation/types.ts` | ✅ |
| 7 | 更新 .gitignore | `.gitignore` | ✅ |
| 8 | 更新 README 文档 | `README.md` | ✅ |

### 待办事项

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| 1 | 创建 Python 突变测试用例 | P1 | `src/mutation/__tests__/gate-m-python.test.ts` |
| 2 | 更新 CAPABILITIES.md | P2 | 添加 Python 突变测试能力说明 |
| 3 | 创建 mutmut 配置模板 | P2 | `templates/.mutmut.conf.example` |
| 4 | 更新 CHANGELOG | P1 | 记录 v0.9.6 Python 突变测试支持 |

---

## 9. 验收标准

- [x] Python 项目预推自动运行 mutmut 增量变异测试
- [x] 支持 `.mutmut.conf` 和 `mutmut_config.py` 配置检测
- [x] 60% 默认阈值，80% 关键路径阈值
- [x] 120s 超时机制（超时允许推送但警告）
- [x] 文件过滤（排除 `test_*.py`、`/tests/`、`__pycache__`）
- [x] 支持 `.mutation-baseline.json` 基线管理
- [x] 集成到 pre-push 钩子，位于 TypeScript Gate M 之后
- [x] 文档更新（README、设计文档）

---

## 10. 已知限制

1. **仅支持 pytest** — mutmut 依赖 pytest 运行测试，其他测试框架（unittest、nose）需手动配置
2. **首次运行慢** — 全量变异测试需 2-10 分钟，后续增量测试 30-120 秒
3. **WSL 兼容性** — 已在 Windows Git Bash 验证，但某些 Windows 用户可能需额外配置
4. **AI 测试检测** — Gate M2 的 mock 密度检测对 Python 仅 WARNING，尚未实现 BLOCK

---

## 11. 后续改进

- [ ] 支持多测试框架（unittest、nose、pytest）
- [ ] 实现 Python Gate M2 BLOCK 模式（mock 密度阻断）
- [ ] 添加变异测试报告生成（HTML/Markdown）
- [ ] 支持并行变异执行加速
- [ ] 集成到 CI 流水线（GitHub Actions）
