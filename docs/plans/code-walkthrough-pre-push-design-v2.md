# Code Walkthrough Pre-push Hook 设计 (v2 - Delphi Review 修复版)

**日期**: 2026-04-14
**状态**: Delphi Review APPROVED (Round 3)
**Issue**: #7 - Bug: CLI invocation error

---

## Delphi Review 共识修复摘要

### Round 1-2 共识 Critical Issues (已修复)

| Issue | 原方案 | 修复方案 |
|-------|--------|---------|
| CLI调用错误 | `opencode code-walkthrough --diff --output` | 移除，改为文件验证 |
| Skill/Hook边界 | 职责不清 | 明确：Hook=验证者，Skill=执行者 |
| Terminal State | Hook无法验证评审状态 | `.code-walkthrough-result.json` 文件契约 |
| 安全漏洞 | 用户确认可绕过 | 文件验证+时间戳过期 |

---

## 修复方案：Alternative D+ (文件契约)

### 核心决策

**决策**: code-walkthrough 是 **强制但手动触发** 的质量门禁

- **强制**: push 必须有有效的 code-walkthrough 结果文件
- **手动**: Skill 执行由用户在 Agent session 内触发
- **理由**: 避免 CLI 调用架构问题，保持 OpenCode 正常工作模式

---

## 技术方案：文件契约

### Skill 输出

执行 `/code-walkthrough` 后，Skill 写入结果文件：

```json
// .code-walkthrough-result.json
{
  "commit": "abc123def456",
  "branch": "feature/xp-rewrite",
  "timestamp": "2026-04-14T10:30:00Z",
  "expires": "2026-04-14T11:30:00Z",  // 1小时有效期
  "verdict": "APPROVED",
  "confidence": 9,
  "experts": [
    { "id": "Expert A", "verdict": "APPROVED", "confidence": 9 },
    { "id": "Expert B", "verdict": "APPROVED", "confidence": 8 }
  ],
  "issues": [],
  "consensus_ratio": 1.0
}
```

### Hook 验证逻辑

```bash
# pre-push hook 核心验证
RESULT_FILE=".code-walkthrough-result.json"

if [ ! -f "$RESULT_FILE" ]; then
  echo "❌ BLOCKED: No code walkthrough result found"
  echo "Run: /code-walkthrough in your Agent session"
  exit 1
fi

# Parse JSON and validate
CURRENT_COMMIT=$(git rev-parse HEAD)
RESULT_COMMIT=$(jq -r '.commit' "$RESULT_FILE")
RESULT_VERDICT=$(jq -r '.verdict' "$RESULT_FILE")
RESULT_EXPIRES=$(jq -r '.expires' "$RESULT_FILE")
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Validation checks
if [ "$RESULT_COMMIT" != "$CURRENT_COMMIT" ]; then
  echo "❌ BLOCKED: Result file is for old commit"
  echo "Expected: $CURRENT_COMMIT"
  echo "Found: $RESULT_COMMIT"
  echo "Re-run: /code-walkthrough"
  exit 1
fi

if [ "$RESULT_VERDICT" != "APPROVED" ]; then
  echo "❌ BLOCKED: Code walkthrough not approved"
  echo "Verdict: $RESULT_VERDICT"
  exit 1
fi

if [[ "$CURRENT_TIME" > "$RESULT_EXPIRES" ]]; then
  echo "❌ BLOCKED: Code walkthrough result expired"
  echo "Expired: $RESULT_EXPIRES"
  echo "Re-run: /code-walkthrough"
  exit 1
fi

# All checks passed
echo "✅ Code walkthrough verified"
echo "Commit: $RESULT_COMMIT"
echo "Verdict: APPROVED"
echo "Expires: $RESULT_EXPIRES"
exit 0
```

---

## Skill 与 Hook 职责边界 (已固化)

### Hook 职责

| 职责 | 说明 |
|------|------|
| 环境检查 | OpenCode CLI 可用，skill 文件存在 |
| 阈值检查 | ≤20 files, ≤500 lines |
| 文件验证 | `.code-walkthrough-result.json` 存在且有效 |
| 提示用户 | 无有效文件时提示执行 `/code-walkthrough` |

**Hook 不做的事**:
- ❌ 不调用 Skill
- ❌ 不执行评审
- ❌ 不判断 Delphi 共识

### Skill 职责

| 职责 | 说明 |
|------|------|
| Delphi 评审 | Expert A/B 匿名评审，Expert C 仲裁 |
| Principles 集成 | Clean Code + SOLID 检查 |
| 共识判断 | ≥91% 问题共识，最终裁决 |
| 结果输出 | 写入 `.code-walkthrough-result.json` |

**Skill 不做的事**:
- ❌ 不阻塞 git push (由 Hook 负责)
- ❌ 不检查文件阈值 (由 Hook 负责)

---

## Terminal State Checklist (分离)

### Hook 可验证项

- [ ] OpenCode CLI 已安装
- [ ] code-walkthrough skill 存在
- [ ] 变更大小在阈值内
- [ ] `.code-walkthrough-result.json` 存在
- [ ] commit hash 匹配当前 HEAD
- [ ] verdict = APPROVED
- [ ] 未过期 (< 1小时)

### Skill 内验证项

- [ ] Expert A 完成匿名评审
- [ ] Expert B 完成匿名评审
- [ ] 共识检查完成 (≥91%)
- [ ] 无 Critical Issues 未解决
- [ ] 最终裁决 APPROVED

---

## SKILL.md 修改建议

### 修改 1: 移除错误的集成描述

**原内容 (Line 282-286)**:
```
| 集成点 | 说明 |
|--------|------|
| `pre-push` hook | 自动触发代码走查 |
```

**修改为**:
```
| 集成点 | 说明 |
|--------|------|
| `pre-push` hook | 验证 `.code-walkthrough-result.json` 文件 |
```

### 修改 2: 添加文件输出描述

在 SKILL.md Terminal State 后添加：

```markdown
## 结果输出

完成评审后，Skill 必须写入结果文件：

```bash
# 在 Terminal State APPROVED 后
cat > .code-walkthrough-result.json << 'EOF'
{
  "commit": "$(git rev-parse HEAD)",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "expires": "$(date -u -d '+1 hour' +"%Y-%m-%dT%H:%M:%SZ")",
  "verdict": "APPROVED",
  ...
}
EOF
```

**有效期**: 1小时。过期后 Hook 将提示重新执行评审。
```

### 修改 3: 明确调用方式

在触发条件部分添加：

```markdown
**⚠️ 重要**: 此 Skill 应在 Agent session 内通过 `/code-walkthrough` 调用。

- ✅ 正确: 在 Agent session 中执行 `/code-walkthrough`
- ❌ 错误: Shell 脚本调用 `opencode code-walkthrough` (不支持)
- ❌ 错误: CLI 子命令 `opencode run --skill code-walkthrough --diff` (不支持)
```

---

## Pre-push Hook 完整修复版

```bash
#!/bin/bash
# Pre-push Hook - Code Walkthrough Result Validator
#
# DESIGN: Hook validates result file, Skill executes review
# No CLI skill invocation - avoids OpenCode architecture mismatch
#
# Install: cp this-file .git/hooks/pre-push && chmod +x .git/hooks/pre-push

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   CODE WALKTHROUGH - PRE-PUSH CHECK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
REMOTE="$1"
URL="$2"

# Skip for main/master
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  echo "⚠️ Pushing to main/master. Proceeding..."
  exit 0
fi

# Documentation-only project check
CODE_FILES=$(find . -type f \( -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.java" -o -name "*.go" -o -name "*.rs" -o -name "*.cpp" -o -name "*.c" -o -name "*.swift" -o -name "*.kt" \) -not -path "./.git/*" 2>/dev/null | wc -l)

if [ "$CODE_FILES" -eq 0 ]; then
  echo "📚 Documentation-only project. Skipping..."
  exit 0
fi

# Size limits check
DIFF_STATS=$(git diff origin/main...HEAD --stat 2>/dev/null || git diff origin/master...HEAD --stat 2>/dev/null)
FILES_CHANGED=$(echo "$DIFF_STATS" | tail -1 | grep -oE '[0-9]+ file' | grep -oE '[0-9]+' || echo "0")
LINES_ADDED=$(git diff origin/main...HEAD --shortstat 2>/dev/null | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
LINES_DELETED=$(git diff origin/main...HEAD --shortstat 2>/dev/null | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")

MAX_FILES=20
MAX_LINES=500

if [ "$FILES_CHANGED" -gt "$MAX_FILES" ] || [ "$((LINES_ADDED + LINES_DELETED))" -gt "$MAX_LINES" ]; then
  echo "❌ BLOCKED: Change exceeds limits"
  echo "Files: $FILES_CHANGED > $MAX_FILES or Lines: +$LINES_ADDED -$LINES_DELETED > $MAX_LINES"
  exit 1
fi

# ============================================================================
# VALIDATE CODE WALKTHROUGH RESULT FILE
# ============================================================================
RESULT_FILE=".code-walkthrough-result.json"

if [ ! -f "$RESULT_FILE" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   ❌ CODE WALKTHROUGH REQUIRED - PUSH BLOCKED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "No code walkthrough result found."
  echo ""
  echo "Before pushing, run code walkthrough in your Agent session:"
  echo ""
  echo "  /code-walkthrough"
  echo ""
  echo "After APPROVED verdict, retry this push."
  echo ""
  exit 1
fi

# Validate result file content
CURRENT_COMMIT=$(git rev-parse HEAD)

# Check JSON validity
if ! jq empty "$RESULT_FILE" 2>/dev/null; then
  echo "❌ BLOCKED: Result file is not valid JSON"
  exit 1
fi

RESULT_COMMIT=$(jq -r '.commit' "$RESULT_FILE")
RESULT_VERDICT=$(jq -r '.verdict' "$RESULT_FILE")
RESULT_EXPIRES=$(jq -r '.expires' "$RESULT_FILE")
CURRENT_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Commit match check
if [ "$RESULT_COMMIT" != "$CURRENT_COMMIT" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   ❌ RESULT FILE OUTDATED - PUSH BLOCKED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Result file is for a different commit:"
  echo "  Expected: $CURRENT_COMMIT"
  echo "  Found: $RESULT_COMMIT"
  echo ""
  echo "Re-run: /code-walkthrough"
  echo ""
  exit 1
fi

# Verdict check
if [ "$RESULT_VERDICT" != "APPROVED" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   ❌ CODE WALKTHROUGH NOT APPROVED - PUSH BLOCKED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Verdict: $RESULT_VERDICT"
  echo ""
  echo "Fix issues and re-run: /code-walkthrough"
  echo ""
  exit 1
fi

# Expiration check
if [[ "$CURRENT_TIME" > "$RESULT_EXPIRES" ]]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   ❌ RESULT FILE EXPIRED - PUSH BLOCKED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Code walkthrough result has expired:"
  echo "  Expired: $RESULT_EXPIRES"
  echo "  Current: $CURRENT_TIME"
  echo ""
  echo "Re-run: /code-walkthrough"
  echo ""
  exit 1
fi

# ============================================================================
# ALL CHECKS PASSED
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   ✅ CODE WALKTHROUGH VERIFIED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Branch: $CURRENT_BRANCH"
echo "Files changed: $FILES_CHANGED"
echo "Lines: +$LINES_ADDED -$LINES_DELETED"
echo ""
echo "Code walkthrough result:"
echo "  Commit: $RESULT_COMMIT"
echo "  Verdict: APPROVED"
echo "  Expires: $RESULT_EXPIRES"
echo ""
echo "Proceeding with push..."
exit 0
```

---

## 验证步骤 (新增)

### 必须测试的场景

```bash
# 1. 无结果文件 → BLOCK
rm -f .code-walkthrough-result.json
git push  # Expected: BLOCKED

# 2. 结果文件过期 → BLOCK
cat > .code-walkthrough-result.json << 'EOF'
{"commit":"...","expires":"2020-01-01T00:00:00Z","verdict":"APPROVED"}
EOF
git push  # Expected: BLOCKED

# 3. Verdict 非 APPROVED → BLOCK
cat > .code-walkthrough-result.json << 'EOF'
{"commit":"$(git rev-parse HEAD)","verdict":"REQUEST_CHANGES",...}
EOF
git push  # Expected: BLOCKED

# 4. 正常流程 → PASS
# User runs /code-walkthrough → APPROVED → file created
git push  # Expected: PASS
```

---

## 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| code-walkthrough 性质 | 强制但手动触发 | 避免 CLI 架构问题 |
| 状态传递 | 文件契约 | Hook 可客观验证 |
| 有效期 | 1小时 | 平衡安全与便利 |
| Hook 聃责 | 验证者 | 不执行评审逻辑 |

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| V1.0 | 2026-04-14 | 初始问题分析 |
| V2.0 | 2026-04-14 | Delphi Review Round 2 修复 |

---

## 待 Re-review 确认

请专家确认修复是否解决了所有 Critical Issues：

1. ✅ CLI调用移除，改为文件验证
2. ✅ Skill/Hook 职责边界已固化
3. ✅ Terminal State 通过文件契约传递
4. ✅ 安全漏洞：文件验证替代用户确认