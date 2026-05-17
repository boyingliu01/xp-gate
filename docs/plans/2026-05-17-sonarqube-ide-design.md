# SonarQube IDE 集成方案

**Date:** 2026-05-17
**Issue:** #44
**Status:** APPROVED
**Author:** Sisyphus

---

## 1. 概述

在 pre-commit hook 新增 Gate 8（SonarQube 扫描），用 `sonar-scanner` CLI 对 staged files 做增量分析，质量门禁失败时补充 SonarQube 结果作为开发者反馈。

Phase B 可选增加 Skill 封装的 SonarQube MCP 调用 + Web Dashboard 历史趋势查看。

---

## 2. 核心设计

### Gate 8（SonarQube Pre-commit Gate）

**位置:** `githooks/pre-commit`
**触发:** pre-commit 时自动执行（独立 gate，不依赖其他 gates）
**工具:** `sonar-scanner` CLI
**分析范围:** Staged files only（增量）

### Quality Gate 阈值

| 严重程度 | Gate 失败行为 |
|---------|-------------|
| VULNERABILITY | 阻断提交（零容忍） |
| SECURITY_HOTSPOT (High/Medium) | 阻断提交 |
| CODE_SMELL (Blocker/Major) | 警告，不阻断 |
| COVERAGE | 警告（<80% 警告，<50% 阻断）|

### 集成方式

- 调用 `sonar-scanner`（需安装：`brew install sonar-scanner`）
- 使用已有 `sonar-project.properties` 配置
- 分析 staged files：`sonar-scanner -Dsonar.sources=$(git diff --cached --name-only)`
- 结果解析：stdout + JSON report

### Phase B（可选）

1. **Skill `/sonarqube`** — on-demand 查询 SonarQube 历史结果（通过 SonarCloud API）
2. **Web Dashboard** — 展示扫描历史、问题趋势、修复状态

---

## 3. 架构

```
githooks/pre-commit
└── Gate 8: SonarQube Scan
    ├── 检查 sonar-scanner 可用性
    ├── git diff --cached --name-only (staged files)
    ├── sonar-scanner -Dsonar.sources=<files>
    ├── 解析 exit code + output
    ├── 按严重程度决策：阻断/警告
    └── 输出摘要到 stderr

skills/sonarqube/SKILL.md         # Phase B: on-demand skill
skills/sonarqube/references/       # Phase B: API 调用逻辑
```

---

## 4. 关键决策

| 决策 | 方案 | 理由 |
|------|------|------|
| Gate 形式 vs Native MCP | Gate 形式 | `sonar-scanner` CLI 可独立运行，skill MCP 按需封装 Phase B |
| 分析范围 | 增量（staged files） | 全量扫描慢，增量适合 pre-commit |
| 阻断策略 | 漏洞/安全热点阻断 | 质量问题警告，保持 Gate 1-6 一致风格 |
| Phase B 触发 | skill on-demand | 开发者手动调用，不浪费 token |

---

## 5. 输出格式

**Gate 8 阻断输出：**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GATE 8: SonarQube Quality Gate
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Vulnerabilities: 0  ✅
  Security Hotspots: 1  ⚠️  (Medium — REVIEW)
  Code Smells: 3   ⚠️  (Major × 2, Minor × 1)
  Coverage: 75%    ⚠️  (< 80% threshold)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌ BLOCKED — 1 Security Hotspot requires review
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Gate 8 通过输出：**
```
  Gate 8: SonarQube — PASS (0 issues)
```

---

## 6. 测试验证

| 验证 | 方法 |
|------|------|
| sonar-scanner 安装检测 | `command -v sonar-scanner` |
| Staged files 分析 | `git diff --cached` 结果正确传入 |
| 阻断逻辑 | 添加 vulnerability file，验证阻断 |
| 警告逻辑 | 添加 code smell，验证警告不阻断 |
| 无 sonar-scanner | 验证 SKIP 行为 |

---

## 7. 安装依赖

```bash
# macOS
brew install sonar-scanner

# Linux
brew install sonar-scanner  # 或从 sonar-scanner github releases 下载

# 验证
sonar-scanner --version
```