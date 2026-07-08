# 安装卸载体验全面升级 - 设计文档

**日期：** 2026-07-08
**关联 Issues：** #301, #302, #303, #304
**Delphi 状态：** APPROVED (Round 2, 3/3 consensus, 100%)
**Delphi Round 1 反馈：** Expert A(架构)/B(技术)/C(可行性) 一致 REQUEST_CHANGES，已根据反馈修正
**Delphi Round 2 结果：** Expert A(架构)/B(技术)/C(可行性) 一致 APPROVED，共识度 100%
**共识报告：** `docs/plans/2026-07-08-install-uninstall-experience-consensus.md`
**specification.yaml：** `.sprint-state/phase-outputs/specification.yaml`

---

## 问题总览

4 个 open issues 共同指向 xp-gate 的安装卸载体验问题：

| Issue | 类型 | 问题 |
|-------|------|------|
| #301 | bug | `npm install -g` 只装 JS 包，不触发 hooks 部署和工具安装；`uninstall` 残留大量文件 |
| #302 | question | 用户对 Gate 2 工具定位有疑问 — doctor 未按 Gate 分组展示工具，用户不清楚每个 Gate 依赖哪些工具 |
| #303 | bug | `gate-9.sh` 文件头标注 "GATE 10" 但与 shell 脚本命名体系不一致（按 shell 脚本编号应为 Gate 9，README 中已演进为 12 道门禁编号） |
|      |     | **注：** README 使用 12-Gate 编号（Gate 9=构建完整性, Gate 10=SAST），shell 脚本使用 10-Gate 编号（Gate 9=SAST, gate-9.sh）。本设计对齐 shell 脚本体系，README 编号差异为已知文档漂移问题，不在本次修复范围。 |
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
- npm 可能不可用（用户通过 yarn/pnpm 安装）— postinstall 仅依赖 Node.js
- postinstall 在 `npm install -g` 时运行，此时用户可能在任意目录
- 自动修改 `core.hooksPath` 全局配置有风险
- 让用户显式执行 `xp-gate install` 保持可控

**与 `xp-gate init` 的关系：**
- `xp-gate install` 是推荐的**新入口命令**，`xp-gate init` 保留为向后兼容
- `init` 内部已包含 `promptBootstrap()` 调用（init.js L452），`install` 在此基础上增加：
  - 语言检测 + 工具推荐（而非仅检查平台工具）
  - 结构化安装报告（清晰展示已装/未装/下一步）
  - doctor 完整性验证作为最后步骤
- 现有用户继续使用 `init` 不受影响；新用户引导到 `install`


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
- `--purge` 操作前**自动备份**到 `/tmp/xp-gate-backup-{timestamp}/`：
  - 备份 `.git/hooks/pre-commit` 和 `pre-push`（如果是 xp-gate 创建）
  - 备份 `~/.xp-gate/` 审计日志和报告（用于合规审计）
  - 备份 `.sprint-state/` 和 `.code-walkthrough-result.json`
  - 备份 `.quality-history.jsonl` 和 `.warnings-baseline.json`
- 备份完成后打印完整清理清单，要求用户输入 `yes` 二次确认
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
  // 平台级 — 所有项目都需要
  PLATFORM: ['jscpd', 'lizard', 'semgrep', 'gitleaks', 'npx'],
  // Gate 2: jscpd (重复代码)
  // Gate 3: lizard (圈复杂度)
  // Gate 8: gitleaks (密钥扫描)
  // Gate 9 shell: semgrep (SAST)
  // Gate 4/6: npx tsx (principles + boy-scout)

  // IaC 安全 — Gate 7，按检测到的 IaC 文件按需检测
  IAC: ['checkov', 'hadolint', 'kube-score', 'tflint'],

  // 版本一致性 — Gate 0
  GATE0: ['node'],  // version-parser.ts 需要 Node.js

  // 构建完整性 — Gate 9 (README: Gate 9; shell: Gate 9 = SAST)
  BUILD_INTEGRITY: ['tsc', 'npm'],  // tsc --noEmit + npm pack

  // 语言检测映射 (--lang 简写 → 全名)
  LANG_MAP: { ts: 'typescript', py: 'python', go: 'go', java: 'java',
              kt: 'kotlin', cpp: 'cpp', swift: 'swift', dart: 'dart',
              flutter: 'flutter', sh: 'shell', ps: 'powershell', objc: 'objectivec' },

  // 语言 Lint — Gate 1
  LINT: {
    typescript: ['biome', 'eslint', 'tsc'],
    python:     ['ruff', 'flake8', 'mypy', 'black', 'isort'],
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

  // 关键依赖（无语言关联）
  SPECIAL: {
    jq:  { gate: 'MW', desc: 'code-walkthrough JSON 解析 (强制依赖)' },
    tsx: { gate: 'M/M3/4/6', desc: 'TypeScript 执行器 (通过 npx 调用)' },
    node: { gate: '0/4/6/M/M3', desc: '所有 TypeScript 门禁运行时' },
  },
};
```

**GATE_TOOLS 完整性验证机制：** 实现时必须运行交叉验证脚本，从所有 adapter 脚本 (`githooks/adapters/*.sh`) 和 gate 脚本中提取实际工具调用，与 `GATE_TOOLS` 对比。任何遗漏必须报错。

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

**语言检测算法：** 复用现有 `detect-deps.js` 中的 `detectProjectLang()` 逻辑，按优先级检查：

```
1. package.json + next.config.js          → web-nextjs / typescript
2. package.json + vite.config.ts + react  → web-react / typescript
3. package.json + vue 依赖                → web-vue / typescript
4. package.json + "typescript" in devDeps → typescript (通用)
5. package.json (Node.js 项目)            → typescript (默认假设)
6. pubspec.yaml + flutter:                → flutter
7. go.mod                                 → go
8. pom.xml                                → java
9. build.gradle / build.gradle.kts        → java / kotlin
10. manage.py / pyproject.toml            → python
11. *.swift 文件存在                       → swift
12. *.m / *.mm 文件存在                    → objectivec
13. *.dart 文件存在 (非 flutter)           → dart
14. *.cpp / *.hpp / CMakeLists.txt         → cpp
15. *.sh / *.bash 文件存在                  → shell
16. *.ps1 / *.psm1 文件存在                → powershell
```

**多语言项目处理：** 检测到多个语言时，doctor 报告所有检测到的语言工具，默认只标记**主要语言**（文件数最多的语言）的缺失为 WARNING，其他语言为 INFO。

**`--lang` 参数映射：** 使用 `GATE_TOOLS.LANG_MAP` 进行简写→全名转换：
- `ts` → `typescript`, `py` → `python`, `go` → `go`, `java` → `java`
- `kt` → `kotlin`, `cpp` → `cpp`, `swift` → `swift`, `dart` → `dart`
- `flutter` → `flutter`, `sh` → `shell`, `ps` → `powershell`, `objc` → `objectivec`

**doctor --format json 兼容模式：**
- 新增 `xp-gate doctor --format json` 参数，输出结构化 JSON 给脚本消费
- 默认 `--format grouped`（分组展示，人类可读）
- `--format json` 按现有 `doctor` 的 JSON schema 扩展，新增 `missing_tools` 和 `warnings` 字段
- JSON 模式保持向后兼容：现有字段不变，新增字段不影响旧脚本解析


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

**PEP 668 处理（Debian/Ubuntu）— 三级回退：**
```bash
# 确保 pipx 可用
ensure_pipx() {
  if ! command -v pipx &>/dev/null; then
    if command -v apt &>/dev/null; then
      sudo apt install -y pipx 2>/dev/null || true
    elif command -v brew &>/dev/null; then
      brew install pipx 2>/dev/null || true
    fi
    pipx ensurepath 2>/dev/null || true
  fi
}

# 安装策略：pipx 优先 (隔离环境) → pip --break-system-packages → 手动提示
install_python_tool() {
  local tool=$1
  if command -v pipx &>/dev/null; then
    pipx install "$tool" 2>/dev/null && return 0
  fi
  if python3 -c "import pip" 2>/dev/null; then
    pip install --break-system-packages "$tool" 2>/dev/null && return 0
  fi
  echo "⚠️  无法自动安装 $tool。请手动安装: pipx install $tool"
  return 1
}
```

**Windows 处理：**
- 包管理器优先级：`winget`（Win11 内置）→ `choco` → `scoop` → 下载 binary
- Python 工具：检测 Git Bash 中 `python` 是否可访问
- Go 工具：检测 `go` 是否在 PATH
- **npm 不可用处理**：bootstrap 优先检测 `npm`，不可用时检测 `yarn`/`pnpm`，全部不可用时提示安装 Node.js
- **Administrator 权限**：部分安装（winget）可能需要管理员权限，提供 `--skip-admin` 跳过需要提权的安装

**通用安装器：** `installWithFallback(toolName, strategies)` 函数 — 替换 bootstrap.js 中现有 `installViaScript`/`installViaInline` 逻辑：

```javascript
function installWithFallback(toolName, strategies) {
  // strategies = [
  //   { cmd: 'brew install X', detectCmd: 'brew', platform: 'darwin' },
  //   { cmd: 'npm install -g X', platform: 'all' },
  //   { cmd: 'pip install X', detectCmd: 'python3', platform: 'all', skipIfPEP668: true },
  // ]
  for (const s of strategies) {
    if (!platformMatches(s.platform)) continue;
    if (s.detectCmd && !commandExists(s.detectCmd)) continue;
    const result = runCommand(s.cmd);
    if (result.ok) return { tool: toolName, status: 'installed', method: s.cmd };
  }
  // 所有策略失败时，返回手动安装提示
  return { tool: toolName, status: 'failed', hint: getManualInstallHint(toolName) };
}
```

> **迁移说明：** `installWithFallback` 替换 bootstrap.js 现有 `installViaScript()` (L63) 和 `installViaInline()` (L69) 函数。旧函数仅支持简单的 `which → install` 流程，新函数支持多策略、多平台、三级回退。

**bootstrap 新增 `--lang` 参数：**

```
xp-gate bootstrap                  → 平台工具 + IaC 工具（现有行为）
xp-gate bootstrap --lang ts        → + TypeScript 工具（biome, vitest, stryker）
xp-gate bootstrap --lang py        → + Python 工具（ruff, pytest, mutmut）
xp-gate bootstrap --lang ts,py     → + TypeScript + Python
xp-gate bootstrap --lang all       → 尝试安装所有支持语言工具
```

**实现位置：** `src/npm-package/lib/bootstrap.js`（新增 installWithFallback + 平台适配 + --lang 参数），`src/npm-package/lib/detect-deps.js`（新增 GATE_TOOLS 分类）。


## 迁移路线（现有用户）

| 现有用法 | 新推荐用法 | 说明 |
|---------|-----------|------|
| `npm install -g @boyingliu01/xp-gate` → `xp-gate init` → `xp-gate bootstrap` | `npm install -g @boyingliu01/xp-gate` → `xp-gate install` | 一键替代三步骤 |
| `xp-gate setup-global` | `xp-gate install --global` | 新命令涵盖全局安装 |
| `xp-gate uninstall` | `xp-gate uninstall` (不变) | 仅 `--purge` 是新增的 |
| `xp-gate doctor` | `xp-gate doctor` (不变) | 输出格式变化但信息量增加 |
| `xp-gate bootstrap` | `xp-gate bootstrap` (不变) | `--lang` 是可选新增 |

**不废弃现有命令：** `init`、`setup-global`、`bootstrap` 保持可用。README 快速开始部分更新为新 `install` 命令，但保留 `init` 文档作为备选路径。

**doctor 输出格式变更提醒：** `doctor` 的 grouped 输出格式为新增默认。脚本集成使用 `--format json` 保持稳定。CHANGELOG 中标注格式变化。


## 文件变更清单

| 文件 | 操作 | 模块 |
|------|------|------|
| `src/npm-package/lib/install-cmd.js` | **新增** | 模块 1 |
| `src/npm-package/bin/xp-gate.js` | 修改（注册 install 子命令） | 模块 1 |
| `src/npm-package/scripts/postinstall-hint.js` | **新增** | 模块 1 |
| `src/npm-package/package.json` | 修改（新增 postinstall + 更新 scripts） | 模块 1 |
| `src/npm-package/lib/uninstall.js` | 修改（新增 --purge + 备份机制） | 模块 2 |
| `githooks/gate-9.sh` | 修改（修正文件头 + 审计日志） | 模块 3 |
| `src/npm-package/hooks/gate-9.sh` | 修改（同步副本） | 模块 3 |
| `src/npm-package/lib/detect-deps.js` | 修改（新增 GATE_TOOLS 分类 + 语言检测 + LANG_MAP） | 模块 4 |
| `src/npm-package/lib/doctor.js` | 修改（重构检查逻辑 + JSON 输出 + 分组格式） | 模块 4 |
| `src/npm-package/lib/bootstrap.js` | 修改（installWithFallback 替换 + 平台适配 + --lang + PEP668） | 模块 5 |
| `src/npm-package/lib/__tests__/detect-deps.test.js` | 修改（新增 GATE_TOOLS 测试） | 模块 4 |
| `src/npm-package/lib/__tests__/doctor.test.js` | 修改（新增分组输出 + JSON 格式测试） | 模块 4 |
| `src/npm-package/scripts/verify-tool-map.js` | **新增**（GATE_TOOLS × adapter 交叉验证脚本） | 模块 4 |
| `README.md` | 修改（快速开始改用 install 命令） | 文档 |
| `CHANGELOG.md` | 修改（记录 install/--purge/doctor 格式变化） | 文档 |

## 测试清单

### 单元测试

| 测试项 | 说明 |
|--------|------|
| `GATE_TOOLS` 分类与 adapter 脚本交叉验证 | `verify-tool-map.js` 自动比对，遗漏工具报错 |
| `installWithFallback` 策略回退 | 模拟 npm/brew/pipx 不可用场景，验证回退链 |
| doctor JSON 输出格式 | 验证 `--format json` 输出符合 schema，向后兼容 |
| doctor 分组输出格式 | 验证 `--format grouped` 按分组正确展示 |
| uninstall --purge 备份机制 | 验证备份目录创建、文件完整性 |
| gate-9.sh 修正 | 验证文件头 + 审计日志编号一致 |
| language detection 边界情况 | 多语言项目、空项目、ambiguous 扩展名 |

### 集成测试

| 测试项 | 环境 | 说明 |
|--------|------|------|
| `xp-gate install` 端到端 | ubuntu-latest | 干净环境，验证所有步骤完成 |
| `xp-gate install --global` | ubuntu-latest | 验证 hooks + adapters + doctor |
| `xp-gate uninstall --purge` | ubuntu-latest | 验证所有残留清理 + 备份 |
| `xp-gate uninstall --purge --dry-run` | ubuntu-latest | 验证预览不执行 |
| postinstall 提示输出 | ubuntu-latest | 模拟 `npm install -g` |
| doctor 分组输出 (TS项目) | ubuntu-latest | 验证展示正确工具 |
| doctor 非相关语言不检查 | ubuntu-latest | Python 工具不在 TS 项目中报错 |
| bootstrap --lang ts | ubuntu-latest | 验证只装 TypeScript 工具 |
| Debian PEP 668 三级回退 | `debian:bookworm` Docker | pipx→pip→manual 全部覆盖 |
| macOS brew 安装 | macos-latest | CI matrix 覆盖 |
| Windows winget 安装 | windows-latest | CI matrix 覆盖 |
| Windows 包管理器降级链 | windows-latest (手工) | winget→choco→scoop (CI 仅 winget) |
| npm/yarn/pnpm 回退 | ubuntu-latest | npm 不可用时检测备选 |

## 兼容性

- 所有现有命令（`init`, `uninstall`, `doctor`, `bootstrap`）保持不变
- `uninstall` 不加 `--purge` 时行为完全不变
- `doctor` 输出格式变化但信息量只增不减；`--format json` 提供脚本兼容
- `bootstrap` 不加 `--lang` 时行为不变
- 新增的 `install` 命令是净新增，不影响现有工作流

### 版本号

**推荐 PATCH bump (0.13.3 → 0.13.4)**，原因：
- 所有变更向后兼容（新增命令、新增参数、新增输出格式）
- doctor 格式变更为 `--format grouped` 默认，但 `--format json` 向后兼容
- 无 API 破坏、无文件格式破坏
- 如认为 `install` 命令是显著新功能，可选 MINOR bump (0.14.0)
