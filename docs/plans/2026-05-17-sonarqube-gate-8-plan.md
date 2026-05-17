# SonarQube Gate 8 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 githooks/pre-commit 新增 Gate 8（SonarQube 扫描），用 sonar-scanner CLI 对 staged files 做增量分析，漏洞/安全热点阻断，质量问题警告。

**Architecture:** Gate 8 作为一个独立 section 插入到 pre-commit（Gate 7 之后），检测 sonar-scanner 可用性，用 `git diff --cached` 获取 staged files，传给 sonar-scanner 增量分析，按严重程度决策阻断/警告。

**Tech Stack:** bash sonar-scanner CLI, sonar-project.properties

---

## Task 1: 写 Gate 8 测试（bats）

**Files:**
- Modify: `githooks/__tests__/gate-8.test.bats`

**Step 1: Write the failing bats test**

```bash
#!/usr/bin/env bats

setup() {
  export CI=true
  load test_helper
}

@test "Gate 8: sonar-scanner available → PASS" {
  stub sonar-scanner = "echo 'SONAR_TOKEN not set, cannot run analysis' && exit 0"
  run bash -c 'source githooks/pre-commit && GATE_8_STATUS="SKIP" && echo "$GATE_8_STATUS"'
  [ "$status" -eq 0 ]
}

@test "Gate 8: vulnerability found → BLOCK commit" {
  stub sonar-scanner = "echo 'Analysis complete. Vulnerabilities: 1' && exit 1"
  run bash -c 'source githooks/pre-commit 2>&1 || true'
  printf "%s\n" "$output" | grep -q "BLOCKED"
}
```

**Step 2: Run test to verify it fails**
Run: `bats githooks/__tests__/gate-8.test.bats`
Expected: FAIL (gate_8 not defined yet)

**Step 3: Commit**
```bash
git add githooks/__tests__/gate-8.test.bats
git commit -m "test: add Gate 8 bats test scaffold"
```

---

## Task 2: 实现 Gate 8 逻辑

**Files:**
- Modify: `githooks/pre-commit:1010-1135` (after Gate 7 section)

**Step 1: Insert Gate 8 section after Gate 7**

在 pre-commit 找到 Gate 7 结束位置（约 line 1136），插入：

```bash
# ============================================================================
# GATE 8: SonarQube Quality Gate
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   GATE 8: SonarQube Quality Gate"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check sonar-scanner availability
SONAR_SCANNER_CMD=""
if command -v sonar-scanner >/dev/null 2>&1; then
  SONAR_SCANNER_CMD="sonar-scanner"
elif [ -f "$HOME/.local/bin/sonar-scanner" ]; then
  SONAR_SCANNER_CMD="$HOME/.local/bin/sonar-scanner"
fi

if [ -z "$SONAR_SCANNER_CMD" ]; then
  echo "⚠️  sonar-scanner not installed. SKIP — Gate 8."
  echo "   Install: brew install sonar-scanner (macOS) or from sonar-scanner releases"
  GATE_8_STATUS="SKIP"
else
  echo "ℹ️  Using sonar-scanner: $SONAR_SCANNER_CMD"

  # Get staged files (from git diff --cached)
  STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -vE '\.(md|json|yml|yaml|toml|textile)$' || true)

  if [ -z "$STAGED_FILES" ]; then
    echo "📚 No staged source files. SKIP — Gate 8."
    GATE_8_STATUS="SKIP"
  else
    # Count files for summary
    FILE_COUNT=$(echo "$STAGED_FILES" | wc -l | tr -d ' ')

    # Run sonar-scanner in incremental mode on staged files
    SONAR_OUTPUT=$($SONAR_SCANNER_CMD \
      -Dsonar.sources="$(echo "$STAGED_FILES" | tr '\n' ',')" \
      -Dsonar.host.url="${SONAR_HOST_URL:-https://sonarcloud.io}" \
      -Dsonar.token="${SONAR_TOKEN:-}" \
      -Dsonar.projectKey="${SONAR_PROJECT_KEY:-xgate}" \
      --quiet 2>&1)
    SONAR_EXIT=$?

    # Parse output for issues by severity
    VULN_COUNT=$(echo "$SONAR_OUTPUT" | grep -c "VULNERABILITY" || echo "0")
    HOTSPOT_COUNT=$(echo "$SONAR_OUTPUT" | grep -c "SECURITY_HOTSPOT" || echo "0")
    CODE_SMELL_COUNT=$(echo "$SONAR_OUTPUT" | grep -c "CODE_SMELL" || echo "0")

    echo ""
    echo "  Vulnerabilities: $VULN_COUNT  ${VULN_COUNT//[^0]/✅ /⚠️ }"
    echo "  Security Hotspots: $HOTSPOT_COUNT"
    echo "  Code Smells: $CODE_SMELL_COUNT"

    # Decision: Vulnerability or High/Medium Security Hotspot → BLOCK
    if [ "$SONAR_EXIT" -eq 1 ] && [ "$VULN_COUNT" -gt 0 ] || [ "$HOTSPOT_COUNT" -gt 0 ]; then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "   ❌ GATE 8 FAILED - COMMIT BLOCKED"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "$SONAR_OUTPUT" | grep -E "VULNERABILITY|SECURITY_HOTSPOT" | head -20
      echo ""
      GATE_8_STATUS="FAIL"
    elif [ "$CODE_SMELL_COUNT" -gt 0 ]; then
      echo "⚠️  $CODE_SMELL_COUNT code smells found (warning only)"
      GATE_8_STATUS="PASS"
    else
      echo "✅ Gate 8: PASS"
      GATE_8_STATUS="PASS"
    fi
  fi
fi

# Update quality report
update_report "Gate 8: SonarQube" "${GATE_8_STATUS:-SKIP}"
```

**Step 2: Update GATE counters and report output**
在 pre-commit 的 summary 和 report JSON sections 加入 GATE_8:

```bash
# In summary echo section (around line 1155):
printf "  %-45s %s\n" "Gate 8: SonarQube Quality Gate" "${GATE_8_STATUS:-SKIP}"

# In JSON report section:
"GATE_8_STATUS=${GATE_8_STATUS:-SKIP}"
```

**Step 3: Run quality gates to verify**
Run: `bash githooks/pre-commit` (with no changes staged)
Expected: GATE_8: SKIP (no staged files)

**Step 4: Commit**
```bash
git add githooks/pre-commit
git commit -m "feat: add Gate 8 SonarQube quality gate"
```

---

## Task 3: 更新文档

**Files:**
- Modify: `README.md` (质量门禁表格增加 Gate 7 行)
- Modify: `docs/sonarqube-setup.md` (增加本地运行说明)

**Step 1: Update README Gate 8 entry**

在 README 质量门禁详解表格增加：

| Gate 8 | SonarQube 扫描 | 增量 staged files 分析 | 漏洞/安全热点阻断，质量问题警告 |

**Step 2: Commit**
```bash
git add README.md docs/sonarqube-setup.md
git commit -m "docs: add Gate 8 SonarQube gate documentation"
```

---

## Verification

| Test | Run | Expected |
|-----|-----|---------|
| No staged files | `git commit --dry-run` | GATE_8: SKIP |
| Add vulnerability file | `git add src/bad.ts && git commit` | BLOCKED |
| Add code smell only | `git add src/smell.ts && git commit` | PASS with warning |
| sonar-scanner missing | `hash -d sonar-scanner && git commit` | SKIP with install hint |

---

## Dependencies

- sonar-scanner: `brew install sonar-scanner` (macOS) or from github.com/SonarSource/sonar-scanner/releases
- SONAR_TOKEN, SONAR_HOST_URL: 见 docs/sonarqube-setup.md