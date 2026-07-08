# 安装卸载体验全面升级 - 设计文档

**日期：** 2026-07-08
**关联 Issues：** #301, #302, #303, #304
**Delphi 状态：** PENDING

---

## 问题总览

4 个 open issues 共同指向 xp-gate 的安装卸载体验问题：

| Issue | 类型 | 问题 |
|-------|------|------|
| #301 | bug | `npm install -g` 只装 JS 包，不触发 hooks 部署和工具安装；`uninstall` 残留大量文件 |
| #302 | question | 用户对 Gate 2 工具定位有疑问 — doctor 未按 Gate 分组展示工具，用户不清楚每个 Gate 依赖哪些工具 |
| #303 | bug | `gate-9.sh` 文件头标注 "GATE 10" 但实际作为 Gate 9 执行；审计日志记录错误 gate ID |
| #304 | enhancement | doctor/bootstrap 只检查 7 个平台工具，遗漏语言特定工具和 pre-push 工具 |

**根因：** `detect-deps.js` 中的 `GATE_CLI_TOOLS` 列表仅包含 7 个平台级工具（jscpd, lizard, checkov, hadolint, gitleaks, semgrep, npx），而实际 14 道门禁（Gate 0-9 + M/M2/M3/MW/MS）通过 13 个语言适配器引用 50+ 个工具。doctor/bootstrap/install/uninstall 全部基于这个不完整的列表构建，导致系统性遗漏。

---

## 设计目标

1. **一键安装**：用户 `npm install -g` 后只需 `xp-gate install` 即可完整部署
2. **完整卸载**：`xp-gate uninstall --purge` 彻底清理所有残留
3. **真实诊断**：`xp-gate doctor` 报告所有 Gate 实际依赖的工具状态
4. **跨平台**：Linux (含 Debian PEP 668)、macOS、Windows (winget/choco/scoop) 全部支持
5. **按需安装**：bootstrap 根据项目语言只装需要的工具

---

## 模块设计

### 模块 1: `xp-gate install` 新命令 (#301)

**当前状态：** `npm install -g @boyingliu01/xp-gate` → 只有 `xp-gate` 二进制可用，用户还需手动 `xp-gate init` + `xp-gate bootstrap`。

**新增命令：**

```
xp-gate install              → 项目级安装 = init + bootstrap + doctor
xp-gate install --global     → 全局安装 = setup-global + bootstrap + doctor
```

**执行流程：**
```
xp-gate install [--global]
  ├── Step 1: 目录创建（~/.xp-gate/, ~/.config/xp-gate/）
  ├── Step 2: hooks/adapters 部署（init 或 setup-global 逻辑）
  ├── Step 3: 平台工具安装（bootstrap 现有 7 个工具）
  ├── Step 4: 项目语言检测 + 语言工具状态报告
  ├── Step 5: 完整性检查（调用 doctor）
  └── Step 6: 打印安装报告（已装/未装清单 + 下一步操作）
```

**实现位置：** 新增 `src/npm-package/lib/install-cmd.js`，在 `src/npm-package/bin/xp-gate.js` 注册 `install` 子命令。

**package.json postinstall 提示：** 新增 `postinstall` 脚本：
```json
{
  "scripts": {
    "postinstall": "node scripts/postinstall-hint.js"
  }
}
```

`scripts/postinstall-hint.js` 仅打印引导信息，不做任何安装操作：
```
🎉 xp-gate 安装成功！

下一步：
  xp-gate install              → 在项目目录中一键安装 hooks + 工具
  xp-gate install --global     → 全局安装 adapters + 工具
  xp-gate doctor               → 检查安装状态

📖 文档：https://github.com/boyingliu01/xp-gate#readme
```

**设计决策：** postinstall 不做实际安装操作，原因：
- postinstall 在 `npm install -g` 时运行，此时用户可能在任意目录
- 自动修改 `core.hooksPath` 全局配置有风险
- 让用户显式执行 `xp-gate install` 保持可控


### 模块 2: `xp-gate uninstall --purge` (#301)

**当前状态：** `xp-gate uninstall` 仅移除项目级 hooks/adapters/config，残留：
- `~/.xp-gate/`（日志、报告、状态）
- `~/.config/xp-gate/`（全局 adapter、配置）
- git `core.hooksPath` 全局设置

**新增清理级别：**

```
xp-gate uninstall              → 项目级清理（现有行为，保持不变）
xp-gate uninstall --purge      → 全面清理
xp-gate uninstall --purge --dry-run → 预览模式
```

**--purge 清理清单：**

| 清理项 | 说明 |
|--------|------|
| 项目 `.git/hooks/pre-commit` | 移除 xp-gate 创建的符号链接 |
| 项目 `.git/hooks/pre-push` | 移除 xp-gate 创建的符号链接 |
| 项目 `.xp-gate/` | 删除项目级缓存 |
| `~/.xp-gate/` | 删除全局数据目录 |
| `~/.config/xp-gate/adapters/` | 删除全局 adapter |
| `~/.config/xp-gate/` | 删除全局配置目录 |
| `git config --global core.hooksPath` | 如果指向 xp-gate 目录则取消设置 |
| CLI 工具 | **仅提示**，不自动卸载（用户通过 npm/pip 手动卸载） |

**安全设计：**
- `--purge` 操作前打印完整清理清单，要求用户输入 `yes` 二次确认
- `--dry-run` 仅预览，不执行
- 不自动卸载全局 CLI 工具，避免影响其他项目

**实现位置：** 修改 `src/npm-package/lib/uninstall.js`。


### 模块 3: gate-9.sh 注释修正 (#303)

**问题：** 三处不一致：
1. 文件头 `# GATE 10: Semgrep SAST Security Scan`
2. 审计日志 `record_gate_audit "gate-10"`
3. 实际上 pre-commit 在 Gate 9 位置 source 此脚本

**修正方案：**
- `githooks/gate-9.sh` 文件头改为 `# GATE 9: Semgrep SAST Security Scan`
- 审计日志改为 `record_gate_audit "gate-9"`
- 同步修正 `src/npm-package/hooks/gate-9.sh` 副本

**同时检查：** 扫描所有 gate 脚本的文件头注释是否与 pre-commit/pre-push 中的 source 顺序一致。

**实现位置：** `githooks/gate-9.sh` + `src/npm-package/hooks/gate-9.sh`。


### 模块 4: 工具分类与 doctor 重构 (#304 + #302)

**当前状态：** `detect-deps.js` 中只有一个 `GATE_CLI_TOOLS` 列表（7 个工具）。doctor 和 bootstrap 都基于此列表，导致：
- doctor 报告假阳性 "All checks passed"
- bootstrap 不安装语言工具
- 用户提交时才发现工具缺失

**新增工具分类：**

```javascript
const GATE_TOOLS = {
  // 平台级 — 所有项目都需要（Gate 2/3/8/9）
  PLATFORM: ['jscpd', 'lizard', 'semgrep', 'gitleaks'],

  // IaC 安全 — Gate 7，按需检测
  IAC: ['checkov', 'hadolint', 'kube-score', 'tflint'],

  // 语言 Lint — Gate 1
  LINT: {
    typescript: ['biome', 'eslint', 'tsc'],
    python:     ['ruff', 'flake8', 'mypy'],
    go:         ['golangci-lint', 'go'],
    java:       ['checkstyle', 'pmd'],
    kotlin:     ['ktlint', 'detekt'],
    cpp:        ['clang-tidy', 'cppcheck', 'cmake'],
    swift:      ['swiftlint', 'swift'],
    dart:       ['dart'],
    flutter:    ['flutter'],
    shell:      ['shellcheck'],
    powershell: ['pwsh'],
    objectivec: ['oclint'],
  },

  // 语言测试 — Gate 5
  TEST: {
    typescript: ['vitest', 'jest'],
    python:     ['pytest'],
    go:         ['go'],
    java:       ['mvn', 'gradle'],
    kotlin:     ['mvn', 'gradle'],
    swift:      ['swift'],
    cpp:        ['ctest', 'gcovr'],
    dart:       ['dart'],
    flutter:    ['flutter'],
  },

  // 变异测试 — Gate M (pre-push)
  MUTATION: {
    typescript: ['stryker'],
    python:     ['mutmut'],
    go:         ['gomutants'],
    java:       ['pitest'],
  },

  // 特殊依赖
  SPECIAL: {
    jq: 'Gate MW (code-walkthrough) 强制依赖',
    npx: 'Gate 4/6 principles checker',
    tsx: 'Gate M/M3 TypeScript runner',
  },
};
```

**doctor 输出格式改造：**

按分组展示，只显示相关工具：

```
=== xp-gate Doctor ===

平台工具 (Gate 2/3/8/9)：
  ✅ jscpd v0.3.5       ✅ lizard v1.17.10
  ❌ semgrep            ❌ gitleaks

IaC 工具 (Gate 7)：
  ✅ checkov v3.2       ⏭️ kube-score (跳过：非 K8s 项目)

语言工具 (检测到 TypeScript)：
  Lint:  ✅ biome v1.9  ✅ tsc v5.7
  Test:  ✅ vitest v2.1 ❌ jest

Pre-push 工具 (Gate M)：
  Mutation: ❌ stryker

特殊依赖：
  ✅ jq v1.7            ✅ npx v10

---
诊断：5 项缺失，运行 xp-gate doctor --fix 自动修复。
```

**关键原则：**
- 不相关语言工具不检查、不报错（根据项目文件检测）
- 缺失工具不阻断，明确报告为 "缺失"
- `--fix` 自动安装缺失的平台工具，语言工具只给出安装命令

**实现位置：** `src/npm-package/lib/detect-deps.js`（新增工具分类），`src/npm-package/lib/doctor.js`（重构检查逻辑和输出格式）。


### 模块 5: bootstrap 跨平台扩展 (#304)

**当前状态：** bootstrap 只装 7 个平台工具，使用纯 `npm install -g` / `pip install` / `go install`，Debian PEP 668 下失败。

**平台适配策略：**

| 工具 | Linux | macOS | Windows |
|------|-------|-------|---------|
| jscpd | npm -g | npm -g | npm -g |
| lizard | pip → pipx (PEP668) | brew → pip | pip |
| semgrep | pip → pipx (PEP668) | brew | pip |
| gitleaks | go install → binary | brew | winget → choco → scoop |
| checkov | pipx (优先) → pip | brew | pip |
| hadolint | 下载 binary | brew | winget → choco → binary |
| kube-score | 下载 binary | brew | 下载 binary |
| tflint | 下载 binary | brew | winget → choco → binary |
| biome | npm -g | npm -g | npm -g |
| stryker | npm -g | npm -g | npm -g |

**PEP 668 处理（Debian/Ubuntu）：**
```bash
# pipx 优先（隔离环境），失败回退 pip --break-system-packages
pipx install checkov 2>/dev/null || pip install --break-system-packages checkov 2>/dev/null
pipx install semgrep 2>/dev/null || pip install --break-system-packages semgrep 2>/dev/null
pipx install lizard 2>/dev/null || pip install --break-system-packages lizard 2>/dev/null
# pipx 不可用时，降级提示手动安装
```

**Windows 处理：**
- 包管理器优先级：`winget`（Win11 内置）→ `choco` → `scoop`
- Python 工具：检测 Git Bash 中 `python` 是否可访问
- Go 工具：检测 `go` 是否在 PATH

**通用安装器：** `installWithFallback(toolName, strategies)` 函数：
```javascript
function installWithFallback(toolName, strategies) {
  // strategies = [
  //   { cmd: 'brew install X', detectCmd: 'brew', platform: 'darwin' },
  //   { cmd: 'npm install -g X', platform: 'all' },
  // ]
  for (const s of strategies) {
    if (!platformMatches(s.platform)) continue;
    if (s.detectCmd && !commandExists(s.detectCmd)) continue;
    const result = runCommand(s.cmd);
    if (result.ok) return { tool: toolName, status: 'installed', method: s.cmd };
  }
  return { tool: toolName, status: 'failed', hint: '请手动安装' };
}
```

**bootstrap 新增 `--lang` 参数：**

```
xp-gate bootstrap                  → 平台工具 + IaC 工具（现有行为）
xp-gate bootstrap --lang ts        → + TypeScript 工具（biome, vitest, stryker）
xp-gate bootstrap --lang py        → + Python 工具（ruff, pytest, mutmut）
xp-gate bootstrap --lang ts,py     → + TypeScript + Python
xp-gate bootstrap --lang all       → 尝试安装所有支持语言工具
```

**实现位置：** `src/npm-package/lib/bootstrap.js`（新增 installWithFallback + 平台适配 + --lang 参数），`src/npm-package/lib/detect-deps.js`（新增 GATE_TOOLS 分类）。


## 文件变更清单

| 文件 | 操作 | 模块 |
|------|------|------|
| `src/npm-package/lib/install-cmd.js` | **新增** | 模块 1 |
| `src/npm-package/bin/xp-gate.js` | 修改（注册 install 子命令） | 模块 1 |
| `src/npm-package/scripts/postinstall-hint.js` | **新增** | 模块 1 |
| `src/npm-package/package.json` | 修改（新增 postinstall） | 模块 1 |
| `src/npm-package/lib/uninstall.js` | 修改（新增 --purge） | 模块 2 |
| `githooks/gate-9.sh` | 修改（修正文件头 + 审计日志） | 模块 3 |
| `src/npm-package/hooks/gate-9.sh` | 修改（同步副本） | 模块 3 |
| `src/npm-package/lib/detect-deps.js` | 修改（新增 GATE_TOOLS 分类） | 模块 4 |
| `src/npm-package/lib/doctor.js` | 修改（重构检查逻辑和输出） | 模块 4 |
| `src/npm-package/lib/bootstrap.js` | 修改（installWithFallback + 平台适配 + --lang） | 模块 5 |

## 测试清单

| 测试项 | 说明 |
|--------|------|
| `xp-gate install` 端到端 | 在干净环境（无 ~/.xp-gate/）执行，验证所有步骤完成 |
| `xp-gate install --global` | 验证 hooks + adapters + doctor 完整执行 |
| `xp-gate uninstall --purge` | 验证所有残留目录/配置被清理 |
| `xp-gate uninstall --purge --dry-run` | 验证预览输出完整但不执行清理 |
| postinstall 提示输出 | 验证 `npm install -g` 后打印正确引导信息 |
| gate-9.sh 文件头 + 审计日志 | 验证 Gate 编号一致 |
| doctor 分组输出 | 验证 TypeScript 项目医生报告展示正确工具 |
| doctor 非相关语言不检查 | 验证 Python 工具不在 TypeScript 项目中报错 |
| bootstrap --lang ts | 验证只安装 TypeScript 工具 |
| Debian PEP 668 | 验证 pipx 回退正常工作 |
| Windows winget | 验证 winget → choco → scoop 降级链 |
| macOS brew | 验证 brew 安装路径正常 |

## 兼容性

- 所有现有命令（`init`, `uninstall`, `doctor`, `bootstrap`）保持不变
- `uninstall` 不加 `--purge` 时行为完全不变
- `doctor` 输出格式变化但信息量只增不减
- `bootstrap` 不加 `--lang` 时行为不变
- 新增的 `install` 命令是净新增，不影响现有工作流
