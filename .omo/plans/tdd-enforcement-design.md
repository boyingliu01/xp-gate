# TDD 铁律 + Mock 最小化 — 多层门禁增强设计

> **Issue**: 任何时候编码必须测试先行（TDD），减少 mock 使用，用真实环境测试替代。
> **Scope**: AGENTS.md + Skills + pre-commit Gate 5 + pre-push Gate M
> **Date**: 2026-05-25

---

## 1. 问题分析

### 1.1 现状

| 层级 | 现有机制 | 缺失 |
|------|---------|------|
| **test-driven-development skill** | ✅ RED→GREEN→REFACTOR 铁律完整，有删除策略（先码后测→删掉重来） | ⚠️ 纯 Agent 引导，无自动门禁兜底 |
| **pre-commit Gate 5** | ✅ 跑测试 + 80% 覆盖率硬阻断 | ❌ 不验证"测试先写"顺序 |
| **pre-push Gate M** | ✅ 变异测试检测测试有效性 | ✅ `detect-ai-test.ts` 已有 mock 密度检测（30% 阈值），**但未接入任何门禁** |
| **AGENTS.md** | ⚠️ Skill-Cert 写了 `Mock-first testing`（与本 issue 矛盾） | ❌ 无 TDD 铁律、无 mock 限制 |
| **CONTRIBUTING.md** | ✅ "Write tests first (TDD)" | ❌ 软性建议，无强制力 |

### 1.2 核心矛盾

AGENTS.md CONVENTIONS 中写道：
> "Skill-Cert: Mock-first testing, all eval cases use AsyncMock, zero real LLM in tests"

这传递了 "mock-first" 的错误信号，与 issue 要求的 "integration-first" 矛盾。Skill-Cert 是**外部子项目**（Python），其 mock-first 有合理性（避免真实 LLM 调用），但不应作为整个项目的通用约定。

**解决**: 将 `Mock-first testing` 限定到 Skill-Cert 子项目范围，项目级约定改为 `Integration-first testing`。

---

## 2. 方案：4 层 Enforcement 架构

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: AGENTS.md 铁律（行为纪律 — Agent 行为约束）            │
│  Layer 2: pre-commit Gate 5 增强（提交门禁 — 自动阻断）          │
│  Layer 3: pre-push Gate M 增强（推送门禁 — 质量门槛）            │
│  Layer 4: Skill 要求强化（Agent 引导 — 最佳实践）                 │
└──────────────────────────────────────────────────────────────┘
```

### Layer 1: AGENTS.md 铁律

**修改位置**: `AGENTS.md` 的 `## CONVENTIONS` 和 `## ANTI-PATTERNS` 段落

#### 新增 CONVENTIONS

```markdown
## CONVENTIONS
- **TDD Iron Rule**: Tests MUST be written before implementation code.
  Every new feature/fix: write failing test first → make it pass → refactor.
  No production code without corresponding test.
- **Integration-First Testing**: Prefer real-environment tests over mocked tests.
  Use integration tests (real DB, real collaborators, tmpdir for I/O) wherever feasible.
- **Mock Minimization**: Mock ONLY for: external services, network calls, time-dependent code,
  non-deterministic behavior. Business logic MUST use real collaborators.
  Mock density > 30% requires `@mock-justified` annotation in test file.
- **Mutation Score Gate**: Tests must survive mutation testing (Gate M pre-push).
  High coverage + low mutation score = over-mocking.
- Coverage threshold: 80%
- Boy Scout Rule: auto-baseline on first touch; modified files cannot increase warnings
```

#### 修正现有 CONVENTIONS

```markdown
# 原来:
- Skill-Cert: Mock-first testing, all eval cases use AsyncMock, zero real LLM in tests

# 改为:
- Skill-Cert (external subproject): Mock-first for LLM evals (AsyncMock, zero real LLM calls)
- Project tests (xp-gate core): Integration-first, mock only for external dependencies
```

#### 新增 ANTI-PATTERNS

```markdown
## ANTI-PATTERNS (THIS PROJECT)
- Do NOT write production code before corresponding test exists (TDD Iron Rule violation)
- Do NOT use mocks for pure business logic or in-memory operations
- Do NOT commit new source files without corresponding test files
- Do NOT exceed 30% mock density without `@mock-justified` annotation
- Do NOT bypass quality gates via `--no-verify`
... (保留现有条目)
```

### Layer 2: pre-commit Gate 5 增强

**修改位置**: `githooks/pre-commit`（Gate 5: Tests & Coverage 段落）

#### 2a. Test-Source 文件配对检查

> **[R1 Fix #1, #5, #10]** 降级为 WARNING（git 无法验证"测试先写"时间顺序）；按语言扩展配对模式；增加文件排除规则。

在 Gate 5 的测试运行之前，新增配对检查：

```bash
# For each new source file, verify a corresponding test file exists
# NOTE: This checks file COEXISTENCE, not temporal order.
# True "test-first" ordering is enforced by Agent skills (Layer 1 + Layer 4).
NEW_SOURCE_FILES=$(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|tsx|py|go|java|kt|kts|cpp|cc|cxx|c|swift|dart|rb|rs)$' | grep -v '__tests__' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__snapshots__' || true)

if [ -n "$NEW_SOURCE_FILES" ]; then
  PAIRING_WARNINGS=0
  for src_file in $NEW_SOURCE_FILES; do
    base="${src_file%.*}"
    ext="${src_file##*.}"
    filename="${base##*/}"
    dir="$(dirname "$src_file")"

    # Skip excluded files: index/barrel, types, interfaces, constants, DTOs, generated, declarations
    case "$filename" in
      index|types|interfaces|constants|__init__) continue ;;
    esac
    case "$ext" in
      d.ts|pyi) continue ;;
    esac
    # Skip files with // @no-test annotation
    if grep -q '@no-test' "$src_file" 2>/dev/null; then
      continue
    fi

    # Check common test file patterns (language-specific)
    TEST_FOUND=false
    case "$ext" in
      ts|tsx|js|jsx)
        patterns=(
          "${base}.test.${ext}"
          "${base}.spec.${ext}"
          "${dir}/__tests__/${filename}.test.${ext}"
          "${dir}/__tests__/${filename}.spec.${ext}"
          "tests/${filename}.test.${ext}"
          "tests/${filename}.spec.${ext}"
        )
        ;;
      py)
        patterns=(
          "tests/${filename}_test.py"
          "tests/test_${filename}.py"
          "${dir}/tests/test_${filename}.py"
          "${base}_test.py"
        )
        ;;
      go)
        patterns=(
          "${base}_test.go"
          "${dir}/${filename}_test.go"
        )
        ;;
      java|kt|kts)
        patterns=(
          "${base}Test.${ext}"
          "src/test/java/**/${filename}Test.${ext}"
          "src/test/kotlin/**/${filename}Test.${ext}"
        )
        ;;
      cpp|cc|cxx|c)
        patterns=(
          "${base}_test.${ext}"
          "${base}Test.${ext}"
          "${dir}/test_${filename}.${ext}"
        )
        ;;
      swift)
        patterns=(
          "${base}Tests.swift"
          "${dir}/${filename}Tests.swift"
        )
        ;;
      dart)
        patterns=(
          "${base}_test.${ext}"
        )
        ;;
      rb)
        patterns=(
          "${dir}/test_${filename}.rb"
          "${base}_test.rb"
        )
        ;;
      rs)
        patterns=(
          # Rust tests are typically inline with #[cfg(test)]
          continue
          ;;
        )
        ;;
      *) continue ;;  # Unknown extension, skip
    esac

    for pattern in "${patterns[@]}"; do
      # Handle glob patterns
      if [[ "$pattern" == *'*'* ]]; then
        found=$(find . -path "*/${pattern}" -type f 2>/dev/null | head -1)
        if [ -n "$found" ]; then TEST_FOUND=true; break; fi
      elif [ -f "$pattern" ]; then
        TEST_FOUND=true
        break
      fi
    done

    if [ "$TEST_FOUND" = false ]; then
      echo "⚠️  TEST PAIRING WARNING: New source file without corresponding test: $src_file"
      echo "   Expected patterns for .${ext}: ${patterns[0]}, ${patterns[1]:-...}"
      echo "   Or: Add '// @no-test' annotation if this file doesn't need tests"
      PAIRING_WARNINGS=$((PAIRING_WARNINGS + 1))
    fi
  done

  if [ "$PAIRING_WARNINGS" -gt 0 ]; then
    echo ""
    echo "⚠️  $PAIRING_WARNINGS new source file(s) without corresponding tests"
    echo "   This is a WARNING — commit proceeds. TDD order enforced by Agent skills."
    echo "   To suppress for specific files, add '// @no-test' at the top."
    # Do NOT exit 1 — this is advisory, not blocking
  fi
fi
```

#### 2b. Mock 密度警告

> **[R1 Fix #2, #3, #4, #6, #7, #9, #11]** 纯 bash grep 替代 npx tsx（性能）；awk 替代 bc（可移植性）；grep -o 替代 grep -oP（macOS 兼容）；修正 mock density 分母；精简关键词；统一语义为 ADVISORY。

在 Gate 5 测试通过后，对新增/修改的测试文件做 mock 密度扫描：

```bash
# Scan changed test files for mock density (pure bash — no npx tsx overhead)
# [R1 Fix] Use awk for float comparison, grep -o for portability
CHANGED_TEST_FILES=$(git diff --cached --name-only | grep -E '\.(test|spec)\.(ts|tsx|js|jsx|py|go)$' || true)

if [ -n "$CHANGED_TEST_FILES" ]; then
  echo "Checking mock density in test files..."
  for test_file in $CHANGED_TEST_FILES; do
    if [ -f "$test_file" ]; then
      # Count mock keyword references (precise patterns only, no bare 'mock' or 'fn()')
      MOCK_COUNT=0
      for kw in 'jest\.mock' 'vi\.mock' 'jest\.spyOn' 'vi\.spyOn' 'jest\.fn' 'vi\.fn' \
                'mockResolvedValue' 'mockRejectedValue' 'mockReturnValue' 'mockImplementation' \
                'createMock' 'mockReset' 'mockClear' 'mockRestore' 'MagicMock' 'unittest\.mock' \
                '\.patch(' 'gomock' 'mockgen' '.EXPECT()'; do
        c=$(grep -o -c "$kw" "$test_file" 2>/dev/null || echo "0")
        MOCK_COUNT=$((MOCK_COUNT + c))
      done

      # Count total non-empty, non-comment lines for density denominator
      TOTAL_LINES=$(grep -v '^\s*$' "$test_file" | grep -v '^\s*//' | grep -v '^\s*\*' | grep -v '^\s*#' | wc -l | awk '{print $1}')

      if [ "$TOTAL_LINES" -gt 0 ] 2>/dev/null; then
        MOCK_DENSITY=$(awk "BEGIN {printf \"%.1f\", ($MOCK_COUNT / $TOTAL_LINES) * 100}")
      else
        MOCK_DENSITY="0"
      fi

      # [R1 Fix] Unified threshold: 30% = ADVISORY, 50% = requires @mock-justified
      THRESHOLD_30=$(awk "BEGIN {print ($MOCK_DENSITY > 30) ? 1 : 0}")
      THRESHOLD_50=$(awk "BEGIN {print ($MOCK_DENSITY > 50) ? 1 : 0}")

      # Check for @mock-justified annotation with reason text (min 10 chars)
      HAS_JUSTIFIED=$(grep -qE '@mock-justified\s*:\s*.{10,}' "$test_file" 2>/dev/null && echo "true" || echo "false")

      if [ "$THRESHOLD_50" = "1" ]; then
        if [ "$HAS_JUSTIFIED" = "false" ]; then
          echo "⚠️  MOCK DENSITY: $test_file — ${MOCK_DENSITY}% (exceeds 50%)"
          echo "   Consider: integration test with real collaborators"
          echo "   Or: Add '// @mock-justified: <reason>' (min 10 char explanation)"
        else
          echo "📝 MOCK DENSITY: $test_file — ${MOCK_DENSITY}% (justified)"
        fi
      elif [ "$THRESHOLD_30" = "1" ]; then
        echo "ℹ️  MOCK DENSITY ADVISORY: $test_file — ${MOCK_DENSITY}% (consider reducing mocks)"
      fi
    fi
  done
fi
```

**注意**: mock 密度在 pre-commit 仅为 ADVISORY，不阻断提交。BLOCK 在 pre-push Gate M 执行。

### Layer 3: pre-push Gate M 增强

**修改位置**: `githooks/pre-push`（Gate M 段落）

#### 3a. 接入 detect-ai-test.ts

> **[R1 Fix #2, #4, #7, #8, #9, #11]** 修正变量引用（使用 pre-push 实际的 $TS_FILES）；awk 替代 bc；grep -q 替代 xargs grep -l；统一语义；精简关键词。

当前 `detect-ai-test.ts` 已实现但未在 Gate M 中使用。增强 Gate M 逻辑：

```bash
# After mutation testing results, also check mock density for pushed test files
# [R1 Fix] Use actual pre-push variables, not $PUSHED_FILES
CHANGED_TEST_FILES=$(echo "$TS_FILES" | grep -E '\.(test|spec)\.(ts|tsx)$' || true)

# Also check Python test files
CHANGED_PY_TEST_FILES=$(echo "$PUSHED_FILES" | grep -E '_test\.py$|test_.*\.py$' || true)
ALL_TEST_FILES="${CHANGED_TEST_FILES} ${CHANGED_PY_TEST_FILES}"

if [ -n "$ALL_TEST_FILES" ]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   GATE M: MOCK DENSITY CHECK"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  BLOCKED=false
  for test_file in $ALL_TEST_FILES; do
    if [ -f "$test_file" ]; then
      # Count mock keywords (same logic as Gate 5, pure bash)
      MOCK_COUNT=0
      for kw in 'jest\.mock' 'vi\.mock' 'jest\.spyOn' 'vi\.spyOn' 'jest\.fn' 'vi\.fn' \
                'mockResolvedValue' 'mockRejectedValue' 'mockReturnValue' 'mockImplementation' \
                'createMock' 'mockReset' 'mockClear' 'mockRestore' 'MagicMock' 'unittest\.mock' \
                '\.patch(' 'gomock' 'mockgen' '.EXPECT()'; do
        c=$(grep -o -c "$kw" "$test_file" 2>/dev/null || echo "0")
        MOCK_COUNT=$((MOCK_COUNT + c))
      done

      TOTAL_LINES=$(grep -v '^\s*$' "$test_file" | grep -v '^\s*//' | grep -v '^\s*\*' | grep -v '^\s*#' | wc -l | awk '{print $1}')
      if [ "$TOTAL_LINES" -gt 0 ] 2>/dev/null; then
        MOCK_DENSITY=$(awk "BEGIN {printf \"%.1f\", ($MOCK_COUNT / $TOTAL_LINES) * 100}")
      else
        MOCK_DENSITY="0"
      fi

      THRESHOLD_50=$(awk "BEGIN {print ($MOCK_DENSITY > 50) ? 1 : 0}")

      # [R1 Fix] @mock-justified requires reason text (min 10 chars)
      HAS_JUSTIFIED=$(grep -qE '@mock-justified\s*:\s*.{10,}' "$test_file" 2>/dev/null && echo "true" || echo "false")

      if [ "$THRESHOLD_50" = "1" ]; then
        if [ "$HAS_JUSTIFIED" = "false" ]; then
          echo "❌ BLOCKED: $test_file — Mock density ${MOCK_DENSITY}% exceeds 50% threshold"
          echo "   Must: Reduce mocks OR add '// @mock-justified: <reason>' (min 10 char explanation)"
          BLOCKED=true
        else
          echo "⚠️  WARNING: $test_file — Mock density ${MOCK_DENSITY}% (justified by annotation)"
        fi
      elif [ "$(awk "BEGIN {print ($MOCK_DENSITY > 30) ? 1 : 0}")" = "1" ]; then
        echo "ℹ️  ADVISORY: $test_file — Mock density ${MOCK_DENSITY}% (consider integration tests)"
      else
        echo "✅ $test_file — Mock density ${MOCK_DENSITY}% (acceptable)"
      fi
    fi
  done

  if [ "$BLOCKED" = true ]; then
    echo ""
    echo "❌ PUSH BLOCKED — Mock density too high without justification"
    exit 1
  fi
fi
```

#### 3b. detect-ai-test.ts 增强（支持 `@mock-justified` + Python）

> **[R1 Fix #7, #12, #13]** 增加 `@mock-justified` 注解识别 + 理由验证；扩展 Python 支持。

```typescript
// Add to detect-ai-test.ts (line 73-75):
const hasTest = /@test\s+/i.test(content);
const hasIntent = /@intent\s+/i.test(content);
const hasCovers = /@covers\s+/i.test(content);
const hasMockJustified = /@mock-justified\s*:\s*.{10,}/i.test(content);  // requires reason text
```

在 `AITestDetectionResult` 类型中增加 `hasMockJustified: boolean` 字段。

扩展支持 Python 测试文件（`_test.py` / `test_*.py`），检测 `unittest.mock`、`MagicMock`、`patch`、`mock_open` 等关键词。

### Layer 4: Skill 要求强化

> **[R1 Fix #9]** Skill 文件路径修正 — 修改 repo 内的源文件，而非用户本地路径。

#### 4a. test-driven-development Skill 增强

在 `skills/test-driven-development/SKILL.md`（npm 分发源文件）中增加 Mock 限制指南：

```markdown
## Mock Usage Guidelines (MANDATORY)

### When to use mocks (ONLY these cases):
1. External API/HTTP calls — use testcontainers or nock
2. Database I/O — use in-memory DB (sqlite, testcontainers)
3. File system I/O — use tmpdir / memfs
4. Time-dependent code — inject clock dependency
5. Non-deterministic behavior (random, UUID) — inject dependency

### When NOT to use mocks:
- Pure business logic → test with real values
- In-memory data transformations → test with real data
- Validation logic → test with real input/output
- State machines → test with real state transitions

### Mock Density Rule:
If > 30% of your test lines contain mock/spy/fn references,
you are likely over-mocking. Add `@mock-justified` comment
explaining why integration test is not feasible.
```

#### 4b. sprint-flow Phase 2 增强

在 `skills/sprint-flow/SKILL.md` Phase 2 BUILD 中增加：

```markdown
### Step 1: TDD 执行（test-driven-development）
...
**Mock Minimization**:
- Default to integration-first: use real DB (sqlite-in-memory), real collaborators
- Mock ONLY external services, network calls, I/O boundaries
- If mock density > 30%, add `@mock-justified` annotation
- Phase 3 Gate M will verify mock density on push
```

---

## 3. Mock vs Integration 分层测试策略

| 测试层级 | 适用场景 | Mock 允许度 | 工具 |
|---------|---------|------------|------|
| **集成测试** (默认) | 业务逻辑、DB 操作、状态机 | ❌ 不用 mock | sqlite-in-memory, tmpdir, real collaborators |
| **边界集成** | HTTP 调用、文件系统 | ✅ 仅边界处 | testcontainers, nock, memfs |
| **纯 Mock** (需理由) | 外部不可控服务、时间依赖 | ✅ 必须 `@mock-justified` | jest.mock, vi.fn, spy |

---

## 4. 实施影响分析

### 4.1 对现有项目的影响

| 影响 | 严重度 | 缓解 |
|------|--------|------|
| 新增源文件必须有测试 | HIGH | 仅对新文件生效，不影响已有文件 |
| Mock 密度警告 | MEDIUM | 首次 WARNING 不阻断，给迁移期 |
| Mock 密度 > 50% 阻断推送 | HIGH | 仅对新增测试文件，且可加 `@mock-justified` |
| AGENTS.md 约定变更 | LOW | 文档更新，无运行时影响 |

### 4.2 对 Skill-Cert 子项目的影响

Skill-Cert 的 `Mock-first testing` 是合理的（避免真实 LLM 调用），通过限定作用域解决：
- AGENTS.md 中明确标注 `(external subproject)` 限定
- Skill-Cert 项目自身不受影响

### 4.3 工具依赖

- Gate 5 mock 密度扫描改用**纯 bash grep**，无 `npx tsx` 启动开销
- Gate M mock 密度扫描同样纯 bash，无需 `detect-ai-test.ts`（保留 TS 版本供后续 AI 审计用）
- `bc` 依赖完全消除，统一用 `awk` 做浮点比较
- `grep -P` 消除，统一用 `grep -o` + `awk`
- Gate 5 配对检查纯 bash，无新依赖
- `@mock-justified` 注解格式：`// @mock-justified: <reason>`（行注释，最少 10 字符理由）

### 4.4 阈值设定依据

- 30% ADVISORY：沿用 `detect-ai-test.ts` 现有 AI 检测阈值，作为渐进式改进起点
- 50% BLOCK：30% 到 50% 区间为改进窗口，超过 50% 强制要求 justification
- 首次实施后应跑一次 baseline 扫描（扫描全量测试文件），根据实际分布微调阈值

---

## 5. 变更文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `AGENTS.md` | EDIT | 新增 TDD/Mock 铁律，修正 Skill-Cert 约定 |
| `githooks/pre-commit` | EDIT | Gate 5 新增配对检查(WARNING) + mock 密度 ADVISORY |
| `githooks/pre-push` | EDIT | Gate M 新增 mock 密度门禁(50% BLOCK) |
| `src/mutation/detect-ai-test.ts` | EDIT | 增加 `@mock-justified` 注解识别 + Python 支持 |
| `src/mutation/types.ts` | EDIT | `AITestDetectionResult` 增加 `hasMockJustified` |
| `skills/sprint-flow/SKILL.md` | EDIT | Phase 2 增加 mock 最小化指南 |
| `skills/test-driven-development/SKILL.md` | EDIT | 新增 Mock Usage Guidelines（npm 分发源文件） |
| `CONTRIBUTING.md` | EDIT | 更新测试规范，增加 mock 策略和 `@mock-justified` 格式 |

---

## 6. 验收标准

| # | 验收项 | 验证方式 |
|---|--------|---------|
| 1 | 新增 `.ts` 文件无对应测试 → WARNING 输出（不阻断） | 创建 `src/foo.ts` 无 `foo.test.ts`，git commit 应输出 WARNING |
| 2 | 新增 `.go` 文件有对应 `_test.go` → 无 WARNING | 创建 `src/bar.go` + `bar_test.go`，git commit 不应有配对警告 |
| 3 | 新增 `index.ts` / `types.ts` → 自动跳过 | 创建 `src/index.ts`，git commit 不应有配对警告 |
| 4 | 测试 mock density 30-50% → ADVISORY 输出 | 修改测试文件增加 mock 密度到 40%，commit 应输出 ADVISORY |
| 5 | 测试 mock density > 50% 无 `@mock-justified` → push BLOCKED | 高 mock 密度测试文件 push 应失败 |
| 6 | `@mock-justified: external API wrapper, no sandbox` → push 通过 | 高 mock 密度 + 合格注解 → push 应通过 |
| 7 | `@mock-justified` 无理由文本 → 不被识别 | `// @mock-justified` (无冒号+理由) → push 仍 BLOCK |
| 8 | AGENTS.md 中 Skill-Cert Mock-first 限定为子项目 | 文档审查 |
| 9 | macOS (BSD grep) 上 mock 密度检查正常工作 | 在 macOS 上执行含 mock 的 commit，应正确输出密度 |

---

## 7. 回退策略

如果 Gate 5 配对检查导致过多误报：
- 可通过在 `package.json` 中设置 `"tdd-pairing-check": false` 关闭
- 默认开启，零容忍

如果 mock 密度阈值不合理：
- 阈值通过环境变量 `XP_GATE_MOCK_DENSITY_WARNING=30` 和 `XP_GATE_MOCK_DENSITY_BLOCK=50` 可调
