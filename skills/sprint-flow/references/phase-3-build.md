# Phase 3/6: BUILD（TDD + 并行执行 + 盲评 + 验证）

**完整指令**: @see SKILL.md `## Phase 3/6: BUILD` section.

**对应旧模型**: Phase 2 BUILD（功能不变）

**摘要**: TDD 执行, 多 Agent 并行加速, 盲评验证, Gate 1 验证通过。

**关键链路**: DELPHI-GATE → parallel-dispatch/ralph-loop → TDD → freeze → blind-review → unfreeze → verification → cost monitor

**输出**: MVP v1

---

## Gate 参考表（Phase 3/6 相关）

| Gate | 名称 | 行为 |
|------|------|------|
| Gate 5 | 单元测试 + 覆盖率 | 全部通过 + ≥80% 覆盖率 |
| Gate 5a-BLOCK | 新增 .ts/.tsx 文件测试强制 | 新增 .ts/.tsx 文件无对应测试文件 → BLOCK；修改文件 → WARNING |
| Gate M2 | Mock 密度检查 | 30% WARNING (Phase 1); 可配置 via `.mockpolicyrc` |

---

---

## Uncommitted Changes Gate

**Purpose**: Prevent entering BUILD with uncommitted changes that could mix with sprint work.

**Execution**: Before entering Phase 3/6 BUILD, the orchestrator MUST check for uncommitted changes in the worktree.

### Gate Logic

```bash
# Check for uncommitted changes
UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

if [ "$SKIP_UNCOMMITTED_GATE" = "1" ]; then
  echo "[UNCOMMITTED-GATE] Skipped (SKIP_UNCOMMITTED_GATE=1)"
  echo "{\"skipped\":true,\"reason\":\"SKIP_UNCOMMITTED_GATE=1\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > .sprint-state/uncommitted-gate-log.json
elif [ "$UNCOMMITTED" -gt 0 ]; then
  echo "⚠️ [UNCOMMITTED-GATE] Found ${UNCOMMITTED} uncommitted files in worktree:"
  git status --short 2>/dev/null | head -20
  echo ""
  echo "Uncommitted changes may conflict with sprint work. Recommended actions:"
  echo "  1. Commit changes: git add -A && git commit -m 'pre-sprint: save work before BUILD'"
  echo "  2. Stash changes: git stash push -m 'pre-sprint stash'"
  echo "  3. Skip gate: export SKIP_UNCOMMITTED_GATE=1 (not recommended)"
  echo ""
  echo "Logging to .sprint-state/uncommitted-gate-log.json"
  echo "{\"blocked\":true,\"uncommitted_files\":${UNCOMMITTED},\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > .sprint-state/uncommitted-gate-log.json
  echo "[BLOCK] Uncommitted changes detected. Please commit, stash, or set SKIP_UNCOMMITTED_GATE=1 to continue."
  exit 1
else
  echo "✅ [UNCOMMITTED-GATE] Worktree clean. Proceeding to BUILD."
  echo "{\"clean\":true,\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > .sprint-state/uncommitted-gate-log.json
fi
```

### Escape Valve

```bash
# Skip the uncommitted changes gate (use with caution)
SKIP_UNCOMMITTED_GATE=1
```

### Log Format (`.sprint-state/uncommitted-gate-log.json`)

```json
{
  "clean": true,
  "blocked": false,
  "skipped": false,
  "uncommitted_files": 0,
  "timestamp": "2026-07-08T10:00:00Z"
}
```

**Log location**: `.sprint-state/uncommitted-gate-log.json` — written on every gate execution for audit trail.

---

## TDD 强制执行

### Gate 5a-BLOCK: 新增文件测试强制

- **新增 `.ts/.tsx` 文件**必须有对应的测试文件（`*.test.ts`、`*.spec.ts`、`__tests__/` 目录），否则 **BLOCK** 提交
- **修改已有文件**仅触发 WARNING（不阻断）
- **Escape valve**: 非 main/master 分支可设置 `SKIP_GATE_5A_BLOCK=1` 跳过阻断（仅 WARNING）

### Gate M2: Mock 密度阈值调整

- Mock 密度阈值从 50% 降低至 **30%**
- **Phase 1**: WARNING 模式（仅告警，不阻断）
- **Phase 2**: 将在基线分析后启用 BLOCK 模式
- 可通过 `.mockpolicyrc` 配置阈值和行为

### Escape Valve

```bash
# 非 main/master 分支临时跳过 Gate 5a-BLOCK
SKIP_GATE_5A_BLOCK=1 git commit -m "message"
```

---

## Timing & Stability

### Expected Execution Times

| Step | Description | Expected Time | Timeout | On Timeout |
|------|-------------|--------------|---------|------------|
| DELPHI-GATE | Verify delphi-reviewed.json exists | 1-2s | 10s | BLOCK (critical gate) |
| ralph-loop (per REQ) | TDD + verification per requirement | 5-15 min | 30 min/REQ | Mark REQ as `timeout`, continue next REQ |
| parallel dispatch | Multi-agent parallel build | 10-30 min | 45 min | Collect partial results, continue |
| TDD cycle (per unit) | RED → GREEN → REFACTOR | 2-5 min | 10 min | Skip unit, log failure |
| freeze + blind-review | Code review in isolation | 5-10 min | 20 min | WARNING, continue |
| verification | Test suite + coverage check | 2-5 min | 15 min | Retry once, then BLOCK |
| cost monitor | Token cost accounting | <1s | 5s | Skip, log warning |
| Phase 3/6 total (lightweight) | ≤3 REQs | 15-30 min | 45 min | — |
| Phase 3/6 total (standard) | 4-10 REQs | 30-120 min | 150 min | — |
| Phase 3/6 total (complex) | >10 REQs | 60-240 min | 300 min | — |

### Stability Guidelines

1. **Timeout handling**: All sub-steps MUST have explicit timeouts. If a step times out, log the failure to `.sprint-state/phase-outputs/phase-3-errors.json` and continue to the next step (except DELPHI-GATE which is a hard BLOCK).

2. **Retry strategy**: For recoverable failures (verification, TDD cycle):
   - First failure: log warning, retry once
   - Second failure: log error, BLOCK and prompt user decision
   - Do NOT retry more than twice for any single sub-step

3. **Parallel dispatch stability**: When using `--mode parallel`, if any agent fails:
   - Collect partial results from successful agents
   - Rerun failed agent(s) individually with `--mode ralph-loop`
   - Do NOT rerun the entire parallel batch

4. **Cost monitor thresholds**: 
   - Token cost per REQ > 50,000 → WARNING (review REQ scope)
   - Token cost per REQ > 100,000 → BLOCK (REQ too large, split into smaller units)

5. **StdDev reduction**: To reduce execution timing variability:
   - Cache dependency installation results between REQs
   - Reuse TDD scaffolding across similar REQ types
   - Pre-compute code structure analysis once at Phase start
   - Batch lint/format operations at the end, not per REQ
