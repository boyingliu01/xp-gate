# XP-Gate × DeepSeek Harness — 环境准备脚本
#
# 作用：把 XP-Gate 的 skill 与插件接入 DeepSeek Harness（DSH）。
# 幂等：可重复运行。
#
# 用法：
#   pwsh -File plugins/dsh/setup-dsh.ps1              # 全部
#   pwsh -File plugins/dsh/setup-dsh.ps1 -SkillsOnly  # 只装 skill
#   pwsh -File plugins/dsh/setup-dsh.ps1 -WhatIf      # 只预览

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$SkillsOnly,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$DshHome    = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$DshSkills  = Join-Path $DshHome 'skills'
$RepSkills  = Join-Path $RepoRoot 'skills'
$PluginDir  = Join-Path $RepoRoot 'plugins\dsh'
$ProfileDir = Join-Path $DshHome 'profiles\web'

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [ok] $msg"   -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [warn] $msg" -ForegroundColor Yellow }
function Write-Info($msg) { Write-Host "  $msg" }

# ── 1. Skill 根：把仓库 skills/ 暴露给 DSH ────────────────────────────────
# DSH 从 ~/.dsh/skills (rank 400) 发现 skill。当前 ~/.agents/skills 是指向
# ~/.qoder/skills 的 junction，即 DSH 实际加载的是 Qoder 版 skill。
# 这里用 junction 让 DSH 直接看到仓库版本，与 xp-gate 仓库保持单一真源。
Write-Step "1. Skill 根 -> $DshSkills"

if (-not (Test-Path $DshSkills)) {
  if ($PSCmdlet.ShouldProcess($DshSkills, 'create directory')) {
    New-Item -ItemType Directory -Force -Path $DshSkills | Out-Null
    Write-Ok "创建 $DshSkills"
  }
} else {
  Write-Ok "已存在 $DshSkills"
}

# 逐个 skill 建 junction（用 junction 而非复制，避免出现第二份真源）
$skillNames = Get-ChildItem $RepSkills -Directory | Select-Object -ExpandProperty Name
$linked = 0
foreach ($s in $skillNames) {
  $src  = Join-Path $RepSkills $s
  $dest = Join-Path $DshSkills $s
  if (-not (Test-Path (Join-Path $src 'SKILL.md'))) { continue }

  $existing = Get-Item $dest -Force -ErrorAction SilentlyContinue
  if ($existing) {
    if ($existing.LinkType -eq 'Junction') {
      $target = ($existing.Target | Select-Object -First 1)
      if ($target -and (Resolve-Path $target -ErrorAction SilentlyContinue).Path -eq $src) {
        Write-Info "$s (已链接)"
        continue
      }
      Write-Warn "${s}: junction 指向别处 -> $target（保持不变，如需切换请手动删除）"
      continue
    }
    Write-Warn "${s}: 已存在真实目录/文件（保持不变）"
    continue
  }

  if ($PSCmdlet.ShouldProcess($dest, "junction -> $src")) {
    New-Item -ItemType Junction -Path $dest -Target $src | Out-Null
    Write-Ok "$s -> $src"
    $linked++
  }
}
Write-Host "  共链接 $linked 个 skill（仓库共 $($skillNames.Count) 个）"

if ($SkillsOnly) {
  Write-Step "完成（-SkillsOnly）"
  exit 0
}

# ── 2. 编译 DSH 插件 ─────────────────────────────────────────────────────
Write-Step "2. 编译 plugins/dsh"

if ($SkipBuild) {
  Write-Info "已跳过（-SkipBuild）"
} else {
  # 依赖：--ignore-scripts 绕过 esbuild 的 postinstall（在受限环境下会 EBUSY）
  if (-not (Test-Path (Join-Path $PluginDir 'node_modules'))) {
    if ($PSCmdlet.ShouldProcess($PluginDir, 'npm install --ignore-scripts')) {
      Push-Location $PluginDir
      try { npm install --ignore-scripts 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Info $_ } }
      finally { Pop-Location }
      Write-Ok "依赖已安装"
    }
  } else {
    Write-Ok "依赖已存在"
  }

  if ($PSCmdlet.ShouldProcess($PluginDir, 'tsc build + skills prepack')) {
    Push-Location $PluginDir
    try {
      npm run build 2>&1 | Select-Object -Last 2 | ForEach-Object { Write-Info $_ }
      node scripts/prepack.cjs 2>&1 | Select-Object -Last 1 | ForEach-Object { Write-Info $_ }
    } finally { Pop-Location }
    if (Test-Path (Join-Path $PluginDir 'lib\index.js')) {
      Write-Ok "lib/index.js 已生成"
    } else {
      Write-Warn "lib/index.js 缺失 —— 构建失败"
    }
    Write-Ok "skills/ 已就位"
  }
}

# ── 3. 挂载插件到 profile（说明 + 可选自动执行） ──────────────────────────
Write-Step "3. 挂载插件到 DSH profile"

$dshBin = Join-Path $RepoRoot 'node_modules\.bin\dsh.cmd'
$patch  = Join-Path $ProfileDir 'cordis.patch.yml'
$already = (Test-Path $patch) -and ((Get-Content $patch -Raw) -match 'dsh-plugin-xp-gate')

if ($already) {
  Write-Ok "profile 已包含 dsh-plugin-xp-gate"
} else {
  Write-Info "尚未挂载。DSH 的 dsh CLI 位于 DSH 安装目录（本机不在 PATH 上）："
  Write-Info "  C:\Users\think\.workbuddy\binaries\node\workspace\node_modules\.bin\dsh.cmd"
  Write-Info ""
  Write-Info "挂载方式（推荐用 GUI 的 Plugins 页面，或命令行）："
  Write-Info "  & '<dsh.cmd>' plugin --profile web add <本仓库路径>\plugins\dsh"
  Write-Info ""
  Write-Info "注意：DSH 的 patch 是「整段替换 config」，插件通过 package.json 的"
  Write-Info "      dsh.bundle.patch 声明自己，安装后会自动进入 bundle 层栈。"
}

# ── 4. Delphi 模型选择提醒 ───────────────────────────────────────────────
Write-Step "4. Delphi 交叉评审前置条件"

Write-Info "delphi-review 硬性要求：3 个专家使用 3 个 distinct trimmed model IDs。"
Write-Info "DSH 的 subagent 默认【不支持】指定模型，必须先在 GUI 的 Plugins 页面启用："
Write-Info ""
Write-Info "  subagent model selection -> enabled = true"
Write-Info "  allowedModels = ["
Write-Info "    { provider: 'whalecloud', model: 'g-deepseek-v4-pro' },"
Write-Info "    { provider: 'whalecloud', model: 'g-qwen3.8-max'  },"
Write-Info "    { provider: 'whalecloud', model: 'g-glm-5.3'       }"
Write-Info "  ]"
Write-Info ""
Write-Info "验证：启用后 subagent 工具会出现 provider/model 参数，"
Write-Info "      并注册 list_subagent_models 工具。"
Write-Info ""
Write-Info "备选路线（无需改 DSH）：scripts/delphi-external-review.cjs 直连 OpenAI 兼容 API。"
Write-Info "  但 .delphi-config.json 的 3 个 key 目前均未设置"
Write-Info "  (DASHSCOPE_API_KEY / ZHIPU_API_KEY / DEEPSEEK_API_KEY)。"

Write-Step "完成"
Write-Host ""
Write-Host "后续：" -ForegroundColor Cyan
Write-Host "  - 确定性门禁（12 pre-commit + 8 pre-push）已全局生效，无需 DSH 配置"
Write-Host "  - DSH 插件在 Windows 上需先修 POSIX/PowerShell 方言问题（见评估文档 §B2）"
Write-Host "  - 评估报告: docs/plans/2026-09-30-dsh-integration-assessment.md"
