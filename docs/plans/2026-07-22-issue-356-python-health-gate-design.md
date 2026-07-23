# #356: Python 环境健康检查 Gate

## 问题

当 xp-gate 检测到项目是 Python 项目时，pre-commit hook 的 Python 适配器需要调用 mypy/ruff/pytest 等工具。但如果 Python 环境本身不健康（未安装、版本过低、虚拟环境损坏、工具缺失），gate 会以不可预测的方式失败，用户看到的是晦涩的错误信息而非清晰的诊断。

## 根因分析

1. **Python 适配器缺少前置健康检查**：现有 `python.sh` 适配器直接调用工具，不验证 Python 环境是否就绪
2. **language-tools.js 已有工具注册表**：但仅在 `xp-gate doctor` 和 `xp-gate install-tools` 时使用，未在 pre-commit 路径中集成
3. **跨平台差异**：Windows 上 Python 可能是 `python`/`python3`/`py`，pip 可能是 `pip`/`pip3`，虚拟环境激活方式不同

## 设计方案（修订版 — Delphi Round 1 通过）

### 策略：双层方案

**Layer 1（pre-commit 热路径）**：`python.sh` 中添加纯 bash `python_env_preflight()` 函数（~25 行），零额外延迟，仅验证 python 可执行 + pip 可用。

**Layer 2（CLI/doctor 按需运行）**：`src/gates/python-health.ts` 提供完整诊断，通过 `xp-gate doctor` 或 `xp-gate check python-health` 暴露。

#### Step 1: bash preflight（`githooks/adapters/python.sh`）

```bash
python_env_preflight() {
  local py_exe=""
  for cmd in python3 python py; do
    if command -v "$cmd" >/dev/null 2>&1; then
      if "$cmd" --version 2>&1 | grep -q 'Python 3'; then
        py_exe="$cmd"; break
      fi
    fi
  done
  if [ -z "$py_exe" ]; then
    echo "❌ Python 3 not found. Install: python.org/downloads"
    return 1
  fi
  if ! "$py_exe" -m pip --version >/dev/null 2>&1; then
    echo "⚠️  pip not available. Install: $py_exe -m ensurepip"
    return 1
  fi
  return 0
}
```

#### Step 2: TypeScript 完整诊断 `src/gates/python-health.ts`

复用 common.ts 的 isToolAvailable() 和 runTool()。

```typescript
interface PythonHealthResult {
  healthy: boolean;
  python: { available: boolean; version: string; exe: string };
  pip: { available: boolean; version: string };
  environment: { type: 'system' | 'venv' | 'conda' | 'pyenv' | 'uv'; path: string | null };
  tools: Array<{ name: string; available: boolean; version: string; required: boolean }>;
  issues: string[];
}
```

检测项：
1. Python 可执行文件（python3 → python → py），过滤 Windows Store 存根
2. Python 版本 ≥3.8（读取 pyproject.toml requires-python 或默认 3.8）
3. pip（通过 `<python-exe> -m pip`，确保与检测到的解释器一致）
4. 环境类型（VIRTUAL_ENV / CONDA_PREFIX / .python-version / .venv 目录）
5. 必需工具（mypy/pytest）和可选工具（ruff/flake8/black）

#### Step 3: CLI 集成

在 gate-runner.js 中添加 python-health 别名路由，通过 tsx 运行 python-health.ts。

#### Step 4: 测试

- 单元测试：mock spawnSync 验证各种健康状态
- 覆盖：Python 未安装、Windows Store 存根、版本过低、venv/conda/pyenv 检测、工具缺失

### 不做的事

1. **不自动安装工具**：健康检查只诊断，不自动修复（修复通过 `xp-gate install-tools`）
2. **不修改 language-tools.js**：复用现有注册表，不改变其接口
3. **不强制虚拟环境**：venv 状态作为 WARNING 而非 BLOCK

### 风险

| 风险 | 缓解措施 |
|------|----------|
| 健康检查增加 pre-commit 延迟 | 仅在 projectLang === 'python' 时执行，缓存检查结果 |
| Windows Python 路径复杂 | 多候选检测（python3/python/py），与 language-tools.js 保持一致 |
| 误报导致用户困扰 | 工具缺失默认 WARN 不 BLOCK（除非是必需工具且项目配置要求） |
