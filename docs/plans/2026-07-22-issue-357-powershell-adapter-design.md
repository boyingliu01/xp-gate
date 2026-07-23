# #357: TypeScript Gate Rewrite — 跨平台运行 + PowerShell 项目支持

## 问题（修订版 — 两个正交维度）

xp-gate 的 gate 脚本（gate-3/4/7/8/9.sh）是纯 bash 脚本，存在两个独立问题：

**维度 1 — 跨平台运行环境**：Node.js CLI 通过 `spawnSync('bash', [scriptPath])` 调用 gate 脚本，Windows 原生 PowerShell 环境下路径翻译失败。不使用 Git Bash 的用户完全无法运行质量门禁。

**维度 2 — PowerShell 项目语言支持空白**：当被分析的项目是 PowerShell 项目时，多个 gate 存在覆盖缺失：
- Gate 3（复杂度）：lizard 不支持 .ps1 → 直接 SKIP
- Gate 7（IaC）：不覆盖 PowerShell DSC（Desired State Configuration）文件
- Gate 8（Secret）：gitleaks 支持任意文本但 .ps1 未显式包含
- Gate 9（SAST）：semgrep 不支持 .ps1，无替代方案

现有 `powershell.sh` 已处理 Gate 1（PSScriptAnalyzer）和 Gate 5（Pester），但 Gate 3/7/8/9 的 PowerShell 项目支持仍为空白。

## 设计方案

### 策略：TypeScript 重写 gate 逻辑，同时增强 PowerShell 项目覆盖

**核心洞察**：gate 脚本的核心逻辑是调用外部 CLI 工具并解析输出。用 TypeScript 实现天然跨平台（解决维度 1），且在 TypeScript 中可统一处理 PowerShell 项目的特殊路由（解决维度 2）。

### 架构

```
┌─────────────────────────────────────────────┐
│  pre-commit (bash)                          │
│  ├── source gate-3.sh (Git Bash 环境)       │ ← 保持不变，标记 legacy
│  ├── source gate-4.sh                       │
│  └── source gate-7/8/9.sh                   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Node.js CLI (xp-gate check)                │
│  ├── gate-runner.js GATE_REGISTRY run()     │
│  ├── gate-3 → require('../gates/gate-3.js') │ ← 新增 TypeScript 模块
│  ├── gate-4 → require('./principles.js')    │ ← 已有（跨平台）
│  ├── gate-7 → require('../gates/gate-7.js') │ ← 新增
│  ├── gate-8 → require('../gates/gate-8.js') │ ← 新增
│  └── gate-9 → require('../gates/gate-9.js') │ ← 新增
└─────────────────────────────────────────────┘
```

### 实施步骤

#### Step 1: 共享基础设施 `src/gates/common.ts`

提供所有 gate 模块的公共能力：

```typescript
// 工具检测（替代 bash 的 require_tool / command -v）
// 3 层回退：PATH 查找 → npx → 自定义路径
export function isToolAvailable(tool: string): { available: boolean; path: string; via: 'path' | 'npx' | 'custom' | 'none' }

// 跨平台 spawnSync 封装（解决 Expert B 指出的 execSync 问题）
export function runTool(cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string,string>; timeoutMs?: number }): { stdout: string; stderr: string; exitCode: number; timedOut: boolean }

// 审计记录（与 bash 路径写入相同的 .xp-gate/audit.jsonl，锁定 JSONL schema）
export function recordAudit(gateId: string, gateName: string, status: string, details: object, startMs: number): void

// 获取变更文件列表（Node.js 侧实现，等效 adapter-common.sh 的 git diff --cached --name-only）
export function getChangedFiles(cwd?: string): string[]

// 检测项目语言（Node.js 侧实现，等效 adapter-common.sh 的 detect_project_lang()）
// 增加 .psd1/.psm1/.ps1 检测 → 'powershell'
export function detectProjectLang(cwd?: string): string

// PowerShell 项目支持函数（整合 powershell.sh 的 _detect_pwsh() 模式）
export function detectPowerShell(): { available: boolean; exe: string; version: string }  // 先检测 pwsh 7+，回退 powershell.exe 5.1
export function isPowerShellProject(projectLang: string): boolean
export function runPowerShellTool(scriptPath: string, args: string[], opts?: object): ReturnType<typeof runTool>

// 跨平台临时目录（解决 Expert B 的 /tmp 问题）
export function getTempDir(): string  // os.tmpdir() — 跨平台
```

**关键设计决策**：
- 使用 `spawnSync`（非 `execSync`），避免 shell 注入和命令字符串拼接问题
- 临时文件使用 `os.tmpdir()`（Windows: `%TEMP%`, Linux: `/tmp`）
- 环境变量通过 `spawnSync` 的 `env` 选项显式传递
- 路径统一使用 `path.join()` / `path.resolve()`，传入外部工具前不做格式转换（Node.js 已处理）

#### Step 2: TypeScript gate 模块（4 个，渐进式交付）

按复杂度从低到高排序，每完成一个即可独立验证：

| 优先级 | 文件 | 功能 | 外部工具 | PowerShell 项目策略 |
|--------|------|------|----------|-------------------|
| 1 | `src/gates/gate-8.ts` | Secret 扫描 | gitleaks | gitleaks 支持任意文本正则扫描，.ps1 显式包含在扫描范围 |
| 2 | `src/gates/gate-3.ts` | 复杂度检查 | lizard | 当 projectLang === 'powershell' 时，路由到 PSScriptAnalyzer 的 PSAvoid* 规则作为替代 |
| 3 | `src/gates/gate-7.ts` | IaC 安全 | checkov/hadolint | 增加 PowerShell DSC 文件模式检测（*.configuration.ps1, *.mof） |
| 4 | `src/gates/gate-9.ts` | SAST 扫描 | semgrep | 当 projectLang === 'powershell' 时，使用 PSScriptAnalyzer 安全规则（PSAvoidUsingInvokeExpression 等）替代 semgrep |

每个模块接口：
```typescript
interface GateInput {
  changedFiles: string[];   // getChangedFiles() 提供
  projectLang: string;       // detectProjectLang() 提供
  cwd?: string;
}
interface GateOutput {
  status: 'PASS' | 'FAIL' | 'SKIP';
  messages: string[];
  exitCode: number;
}
export function runGateN(input: GateInput): GateOutput
```

#### Step 3: 更新 gate-runner.js 路由

将 gate 3/7/8/9 的 `run()` 从 `runBashScript()` 改为 TypeScript 模块委托：

```javascript
'3': {
  name: 'Cyclomatic Complexity',
  run: async (targetPath) => {
    const { runGate3 } = require('../gates/gate-3.js');
    return runGate3({
      changedFiles: getChangedFiles(targetPath),
      projectLang: detectProjectLang(targetPath),
      cwd: targetPath
    });
  },
},
// gate 7/8/9 同理
```

**编译/运行策略**：TypeScript gate 模块通过 `npx tsx` 运行（与现有 gate-m.ts、principles/index.ts 一致），gate-runner.js 中通过 `require` 加载编译后的 `.js` 产物。构建时 `tsc` 编译 `src/gates/*.ts` → `dist/gates/*.js`。

#### Step 4: 测试

- 每个 TypeScript gate 模块配套 vitest 单元测试（mock `child_process.spawnSync`）
- **Golden test cases**：从 bash 版本提取输入/输出/退出码三元组，作为 TypeScript 版本的验收基准
- **项目语言矩阵测试**：为 TypeScript、Python、Go、PowerShell 等每种项目语言准备 fixture，验证每个 gate 的行为
- PowerShell 工具调用测试：mock `detectPowerShell()` 返回值，验证路由逻辑

### 不做的事

1. **不创建 PowerShell gate 脚本（.ps1）**：避免 bash/ps1/ts 三轨维护。TypeScript 模块已覆盖跨平台需求
2. **不修改 pre-commit hook**：Git Bash 环境下的 bash 脚本继续正常工作
3. **不要求额外运行时**：Node.js + 外部 CLI 工具，无新依赖

### 渐进式迁移与共存策略

- bash gate 脚本标记为 **legacy**，在 TypeScript 路径经过 3 个版本验证后逐步废弃
- 保留环境变量 `XP_GATE_ENGINE=ts|bash`（默认 `ts`）允许回退到 bash 路径
- 回滚策略：如果 TypeScript gate 行为异常，设置 `XP_GATE_ENGINE=bash` 即可回退（需 Git Bash 可用）

### 风险

| 风险 | 缓解措施 |
|------|----------|
| TypeScript 重写与 bash 逻辑不一致 | Golden test cases（bash 版本 I/O/exit code 三元组）作为验收基准 |
| 外部工具 Windows 可用性 | common.ts 的 isToolAvailable() 检测工具不可用时 SKIP（与 bash 版本行为一致） |
| PowerShell 工具（PSScriptAnalyzer/Pester）未安装 | detectPowerShell() 返回 available:false 时 SKIP PowerShell 特定检查 |
| pre-commit bash 路径与 Node.js 路径行为差异 | 共享 gate 语义 + 测试契约保证一致性；XP_GATE_ENGINE 环境变量允许回退 |
| PS 5.1 语法限制 | 不涉及 .ps1 脚本编写，TypeScript 模块通过 spawnSync 调用 pwsh/powershell.exe |
