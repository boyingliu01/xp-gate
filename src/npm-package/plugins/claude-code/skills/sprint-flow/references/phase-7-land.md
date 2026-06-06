# Phase 7: LAND（合并 + 部署）

## 目标

自动合并 PR、等待 CI、执行部署、运行 Canary Health Check、失败时自动回滚。

---

## 输入

- Phase 6 SHIP 输出的 PR URL
- 或 `--phase ship-only` 时手动提供 PR 编号

---

## 调用 Skills

- `land-and-deploy` (gstack) — 合并部署
- `canary` (gstack) — 监控告警

---

## 执行步骤

### Step 1: 合并 PR

```bash
gh pr merge <PR_NUMBER> --squash
```

**失败**: 输出 `[ERROR] PR merge failed` → 询问用户是否重试或手动处理

**成功**: 进入 Step 2

### Step 2: 等待 CI 完成

```bash
# Poll CI checks every 10s, timeout after 10min
gh pr checks <PR_NUMBER> --watch --interval 10
```

**超时 (10min)**: 输出 `[WARN] CI checks timed out after 10min` → 询问用户是否继续

**CI 失败**: 输出 `[ERROR] CI checks failed, aborting deployment` → BLOCK

**CI 成功**: 进入 Step 3

### Step 3: 等待 Deploy 完成

**条件**: 项目已配置部署平台（Fly.io/Vercel/Render/GitHub Actions 等）

```bash
# Poll deploy status every 10s, timeout after 10min
gh pr checks <PR_NUMBER> --watch --interval 10
```

**无部署配置**: 跳过 Step 3-4，直接进入 Phase 8

**部署成功**: 进入 Step 4

**部署失败**: 进入 Step 5（自动回滚）

### Step 4: Canary Health Check

**健康检查端点**: 
- 默认：项目根路径 `/`
- 自定义：`$HEALTH_CHECK_URL` 环境变量或 `.sprint-load-test.yaml` 中的 `health_endpoint`

**SLA 指标**:
| 指标 | 阈值 | 说明 |
|------|------|------|
| HTTP 响应状态 | 200 | 服务正常运行 |
| 错误率 | <1% | 5 分钟窗口内 5xx 错误占比 |
| p99 响应时间 | <2s | 99 分位响应时间 |
| 超时总时长 | 5min | health check 最长等待时间 |
| Polling 间隔 | 10s | 健康检查轮询频率 |

**实现**:
```bash
START_TIME=$(date +%s)
while [ $(( $(date +%s) - START_TIME )) -lt 300 ]; do
  RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_CHECK_URL" 2>/dev/null || echo "000")
  if [ "$RESPONSE" = "200" ]; then
    echo "✅ Canary health check passed: HTTP 200"
    break
  fi
  echo "[WARN] Canary health check returned HTTP $RESPONSE, retrying in 10s..."
  sleep 10
done

if [ "$RESPONSE" != "200" ]; then
  echo "[ERROR] Canary health check failed after 5min timeout"
  # Auto-rollback
  LAST_MERGE_COMMIT=$(git log -1 --oneline --format="%H" 2>/dev/null)
  git revert "$LAST_MERGE_COMMIT" --no-edit
  echo "[ROLLBACK] Auto-reverted merge commit: $LAST_MERGE_COMMIT"
  exit 1
fi
```

**通过**: 进入 Phase 8 CLEANUP

**失败**: 自动回滚 → 输出 `[ERROR] Deploy failed, auto-rolled back merge` → Phase 8 仍执行（清理 worktree）

### Step 5: 自动回滚（部署失败时）

```bash
# Revert the last merge commit
LAST_MERGE_COMMIT=$(git log -1 --oneline --format="%H" 2>/dev/null)
git revert "$LAST_MERGE_COMMIT" --no-edit
echo "[ERROR] Deploy failed, auto-rolled back merge commit: $LAST_MERGE_COMMIT"
```

---

## 输出

- 部署状态: success | failure | skipped
- Canary 报告: SLA 指标是否达标
- 如果自动回滚：reverted commit hash

---

## 暂停点

- **CI 超时**: 用户确认是否继续等待或跳过
- **部署失败**: 用户确认自动回滚或手动处理
- **Canary 失败**: 用户确认回滚或保留状态调查

---

## 错误处理

| 错误场景 | 处理 |
|---------|------|
| PR 合并冲突 | 输出错误 → 询问用户是否 rebase 或手动解决 |
| CI 超时 (10min) | 输出警告 → 询问是否继续或跳过部署 |
| 部署失败 | 自动 `git revert` merge commit + 输出错误 |
| Canary 失败 | 自动回滚 + 输出 `[ERROR] Canary health check failed` |
| 无部署配置 | 跳过部署/canary，仅 merge + CI checks |
