# Semgrep Gate 8 — Pre-commit Security Scan

**Date:** 2026-05-17
**Issue:** #44
**Status:** Phase 1 APPROVED → Phase 2 Implementation
**Author:** Sisyphus

---

## 1. 概述

在 pre-commit hook 新增 **Gate 8（Semgrep 安全扫描）**，用 `semgrep` CLI 对 staged files 做增量 SAST 分析。

**核心约束**：代码完全留在本地，不发到任何外部服务。

---

## 2. 工具选型决策

### 为什么是 Semgrep（不是 sonar-scanner）

| 维度 | Semgrep | sonar-scanner → SaaS | sonar-scanner → CE |
|------|--------|---------------------|-------------------|
| 代码是否外发 | **❌ 本地** | ✅ 外发到 Sonar 云 | ❌ 本地（需 Docker） |
| 安全扫描（漏洞） | ✅ GA | ✅ | ❌ Community Build 无 SAST |
| TypeScript | ✅ GA | ✅ | ✅ |
| Python | ✅ GA | ✅ | ✅ |
| Go | ✅ GA | ✅ | ✅ |
| pre-commit gate 适配 | ✅ 原生 | ⚠️ SaaS 不适合 | ⚠️ Docker 依赖 |
| 部署复杂度 | **免部署**（pip/brew） | 免 | Docker + DB |
| 成本 | 免费 | $32/月（私有项目） | 免费 |

**结论**：Semgrep 是唯一同时满足"本地 + 安全扫描 + 免部署 + 免费"的方案。

---

## 3. Gate 8 逻辑

**位置**: `githooks/pre-commit`（Gate 7 之后，约 line 1137+）
**触发**: pre-commit 时自动执行，与 Gate 7 gitleaks 并行执行（OR 逻辑：任一阻断则整体阻断）

### 流程

```
1. 检测 semgrep CLI 可用性
   → 缺失 → SKIP（显示安装提示）

2. 获取 staged files（过滤支持语言）
   git diff --cached --name-only --diff-filter=ACM
   → 空 → SKIP
   仅对 Semgrep 支持语言运行：.ts .tsx .py .go .java .js .jsx .c .cpp .cs .rb .php .scala .swift

3. 运行 semgrep（本地规则）
   semgrep --config=auto --json <files>
   说明：--config=auto 首次运行需联网拉取规则缓存，后续离线可用。
   为确保完全本地，建议预先运行一次 semgrep --config=p/security-audit 预缓存规则。

4. 解析 JSON 结果
   SECURITY SEVERITY:
   - CRITICAL/HIGH → 阻断提交
   - MEDIUM/LOW → 警告，不阻断
   RULES VIOLATION（非 security）：
   - 规则违反（code smell 类） → 警告，不阻断，单独分类

5. 错误处理
   - semgrep 运行错误（返回码 3+） → SKIP（不阻断）
   - 无 semgrep → SKIP
   - 有漏洞 → 阻断

6. 更新质量报告
```

### 阻断策略

| 类型 | 等级 | Gate 行为 |
|------|------|-----------|
| 安全漏洞 | CRITICAL / HIGH | **阻断提交** |
| 安全漏洞 | MEDIUM / LOW | ⚠️ 警告，不阻断 |
| 规则违反（code smell） | 任意 | ⚠️ 警告，不阻断（单独分类） |
| semgrep 缺失/运行错误 | — | SKIP（不阻断） |

---

## 4. 输出格式

**阻断输出**：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GATE 8: Semgrep Security Gate
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CRITICAL/HIGH: 2  ❌ BLOCKED
  MEDIUM/LOW:    1  ⚠️  warning
  Code Smells:   3  ⚠️  warning
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌ BLOCKED — Critical/High vulnerability found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [SEMGREP] Insecure SQL construction
  src/db/query.ts:12 → severity:HIGH

  Run 'npx semgrep' to review all findings.
```

**警告输出**：
```
  Gate 8: Semgrep — PASS (0 critical/high)
  ⚠️  1 MEDIUM, 3 code smells — see below
```

**通过输出**：
```
  Gate 8: Semgrep — PASS (0 critical/high issues)
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   GATE 8: Semgrep Security Gate
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Critical/High: 2  ❌ BLOCKED
  Medium: 1        ⚠️  warning
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌ BLOCKED — Critical vulnerability found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [SEMGREP] Insecure SQL construction
  src/db/query.ts:12 → severity:HIGH
```

**通过输出**：
```
  Gate 8: Semgrep — PASS (0 critical/high issues)
```

---

## 5. 安装与规则预缓存

```bash
# macOS
brew install semgrep

# Linux
curl -L https://semgrep.s3.amazonaws.com/latest/semgrep > /tmp/semgrep && chmod +x /tmp/semgrep && sudo mv /tmp/semgrep /usr/local/bin/

# pip
pip install semgrep

# 验证
semgrep --version

# 首次预缓存安全规则（确保后续完全离线可用）
semgrep --config=p/security-audit

# 可选：预缓存完整 auto 规则
semgrep --config=auto
```

---

## 6. 冲突说明

| 原 issue | 变更 |
|---------|------|
| #44 SonarQube for IDE | 改 Semgrep（数据主权原因） |
| #46 SonarQube MCP Server | 取消（Semgrep 替代） |

---

## 7. Phase B 可选

- **Skill `/semgrep`** — on-demand 调用 Semgrep 获取安全问题摘要
- **Web Dashboard** — 展示扫描历史、问题趋势（数据来自本地 JSON 输出）