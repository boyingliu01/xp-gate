# Phase 8: CLEANUP（清理 + 总结）

## 目标

自动清理 worktree、更新 sprint-state.json、输出 Sprint Summary、处理 emergent issues。

---

## 输入

- Phase 7 LAND 完成后的部署状态
- 或 Phase 6 Option 1（本地 Merge）后的完成状态
- `.sprint-state/sprint-state.json`（包含 worktree 路径信息）

---

## 执行步骤

### Step 1: 检测 worktree 是否存在

```bash
# Read worktree path from sprint-state.json
WORKTREE_PATH=$(node -e "const fs=require('fs'); const state=JSON.parse(fs.readFileSync('.sprint-state/sprint-state.json','utf8')); console.log(state.isolation?.worktree_path || '')" 2>/dev/null)

if [ -z "$WORKTREE_PATH" ]; then
  echo "[CLEANUP] No worktree path found in sprint-state.json — skipping cleanup"
  exit 0
fi

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "[CLEANUP] Worktree already removed: $WORKTREE_PATH"
  HAS_WORKTREE=false
else
  HAS_WORKTREE=true
fi
```

**跳过**: `--no-isolate` 路径（无 worktree 可清理）或 worktree 已不存在

**存在**: 进入 Step 2

### Step 2: 删除 worktree（带重试机制）

```bash
MAX_RETRIES=3
RETRY_COUNT=0
REMOVED=false

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if git worktree remove "$WORKTREE_PATH" 2>/dev/null; then
    REMOVED=true
    echo "[CLEANUP] ✅ Worktree removed: $WORKTREE_PATH"
    break
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
      echo "[WARN] Worktree remove failed, retry $RETRY_COUNT/$MAX_RETRIES in 1s..."
      sleep 1
    fi
  fi
done

if [ "$REMOVED" = "false" ]; then
  echo "[WARN] Failed to remove worktree after $MAX_RETRIES attempts."
  echo "[WARN] Please manually run: git worktree remove $WORKTREE_PATH"
fi
```

**成功**: 进入 Step 3

**失败**: 输出警告 + 手动命令提示 → 进入 Step 3

### Step 3: 检测残留目录

```bash
if [ -d "$WORKTREE_PATH" ]; then
  echo "[WARN] ⚠️ Residual worktree directory detected: $WORKTREE_PATH"
  echo "[WARN] Please manually remove it if needed"
else
  echo "[CLEANUP] ✅ No residual directory detected"
fi
```

**残留**: 输出警告

**干净**: 输出成功消息 → 进入 Step 4

### Step 4: 更新 sprint-state.json

```bash
node -e "
const fs = require('fs');
const statePath = '.sprint-state/sprint-state.json';
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
state.phase = 8;
state.status = 'merged';
if (!state.metrics) state.metrics = {};
state.metrics.completed_at = new Date().toISOString();
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
console.log('[CLEANUP] sprint-state.json updated → phase: 8, status: merged');
"
```

### Step 5: 输出 Sprint Summary

根据 `.sprint-state/phase-outputs/sprint-summary-template.md` 生成总结：

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SPRINT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Sprint ID: sprint-2026-05-28-01
Status: merged
Phase: 8 (CLEANUP complete)

Timeline:
  - Phase -1 ISOLATE: ✅
  - Phase 0 THINK: ✅
  - Phase 1 PLAN: ✅
  - Phase 2 BUILD: ✅
  - Phase 3 REVIEW: ✅
  - Phase 4 ACCEPTANCE: ✅
  - Phase 5 FEEDBACK: ✅
  - Phase 6 SHIP: ✅
  - Phase 7 LAND: ✅ (deploy: success/failure/skipped)
  - Phase 8 CLEANUP: ✅ (worktree: clean/residual)

Emergent Issues: <N> found
  - IF Critical → Sprint 2 auto-triggered
  - IF Major/Minor → Ask user

Worktree cleaned: <yes/no/manual>
PR merged: <PR_URL>
```

### Step 6: 处理 Emergent Issues

```bash
# Check for emergent issues file
if [ -f ".sprint-state/phase-outputs/emergent-issues.md" ]; then
  ISSUE_COUNT=$(grep -c "^## " ".sprint-state/phase-outputs/emergent-issues.md" 2>/dev/null || echo "0")
  
  if [ "$ISSUE_COUNT" -gt 0 ]; then
    HAS_CRITICAL=$(grep -i "critical" ".sprint-state/phase-outputs/emergent-issues.md" 2>/dev/null || echo "")
    
    if [ -n "$HAS_CRITICAL" ]; then
      echo ""
      echo "⚠️ Critical emergent issues detected — auto-triggering Sprint 2"
      echo "Sprint 2 Pain Document will be generated from emergent-issues.md"
      # Auto-trigger Sprint 2
    else
      echo ""
      echo "ℹ️ $ISSUE_COUNT emergent issue(s) found — ask user about Sprint 2"
    fi
  else
    echo ""
    echo "✅ No emergent issues — sprint completed successfully"
  fi
else
  echo ""
  echo "✅ No emergent issues — sprint completed successfully"
fi
```

---

## 输出

- Cleanup Report:
  - Worktree removed: ✅ / ⚠️ residual / ❌ manual required
  - sprint-state.json: phase 8, status merged
- Sprint Summary
- IF emergent issues with Critical → Sprint 2 auto-trigger
- IF emergent issues without Critical → ask user

---

## 暂停点

- **Worktree 手动清理**: 用户确认已手动清理或保留残留
- **Sprint 2 决策**: 用户确认是否开始 Sprint 2（仅 Major/Minor issues 时）

---

## 错误处理

| 错误场景 | 处理 |
|---------|------|
| worktree 路径不存在于 sprint-state.json | 跳过清理，输出警告 |
| `git worktree remove` 失败 | 重试 3 次 → 输出手动命令提示 |
| 残留目录检测 | 输出警告，用户决策 |
| sprint-state.json 更新失败 | 输出错误，不影响最终完成状态 |
