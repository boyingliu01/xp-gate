# Phase 3/6: BUILD（TDD + 并行执行 + 盲评 + 验证）

**完整指令**: @see SKILL.md `## Phase 3/6: BUILD` section.

**对应旧模型**: Phase 2 BUILD（功能不变）

**摘要**: TDD 执行, 多 Agent 并行加速, 盲评验证, Gate 1 验证通过。

**关键链路**: BUILD-ENTRY-CONTRACT → DELPHI-GATE → parallel-dispatch/ralph-loop → TDD → blind-review (read-only subagent) → verification → cost monitor

**输出**: MVP v1

---

## Gate 参考表（Phase 3/6 相关）

| Gate | 名称 | 行为 |
|------|------|------|
| Gate 5 | 单元测试 + 覆盖率 | 全部通过 + ≥80% 覆盖率 |
| Gate 5a-BLOCK | 新增 .ts/.tsx 文件测试强制 | 新增 .ts/.tsx 文件无对应测试文件 → BLOCK；修改文件 → WARNING |
| Gate M2 | Mock 密度检查 | 30% WARNING (Phase 1); 可配置 via `.mockpolicyrc` |

---

## 提交前自检清单（P1 红线前移 — 2026-10-30，直接解 #652）

> 背景：47.6% 的提交是 fix/revert（323/679）。多数返工是"提交时才被门禁打回"——
> 红线原本只活在 `githooks/` 里，AI 在 BUILD 期间看不到。这一页把会**阻断提交**的
> 阈值提前到编码时自检，目标是"第一次提交就过"，而不是"提交→被打回→改→再提交"。

**每次准备 `git commit` 前，逐条自检（按被拦频率排序）：**

| # | 门禁 | 红线（会被 BLOCK/WARN 的硬阈值） | 自查方法 |
|---|------|------------------------------|----------|
| 1 | **Gate 3 CCN** | 单函数圈复杂度 **>10 BLOCK**、**>5 WARN** | 拆函数 / 早返回 / 抽策略表；`xp-gate check 3 <file>` |
| 2 | **Gate 6 Boy Scout** | **新文件 0 warning**；修改文件 warning 数不得高于 `.warnings-baseline.json`；**单函数 ≤50 行**；**嵌套 ≤4 层** | 新文件当"零容忍"写；改动前 `xp-gate check 6` 看基线 |
| 3 | **Gate 2 重复代码** | jscpd 相似度 **>5% BLOCK** | 抽公共函数，别复制粘贴；`xp-gate check 2 <dir>` |
| 4 | **Gate 4 Principles** | 14 条 Clean Code/SOLID 规则，任一 error/warning 即拦（按 `.principlesrc`） | `xp-gate check 4 <file>`；避免超长参数表、空 catch、`as any` |
| 5 | **Gate 1 Lint** | 适配器 lint 任一 error | 提交前跑一次项目 lint；不要留未用变量/导入 |
| 6 | **Gate 5 测试** | 测试全绿 + 覆盖率 ≥80%（新 .ts/.tsx 无测试直接 BLOCK） | 新代码先写测试（TDD）；`npx vitest run <file>` |
| 7 | **mirror/sync 纪律** | 改 `githooks/` 或 `skills/` 后必须 `node src/npm-package/scripts/sync-package-content.js --fix` 且 `bash scripts/check-hook-mirror.sh` 报 PASS | 忘了同步会在 pre-push 的 mirror 校验被打回 |

**一条命令抢先看**：`xp-gate check . --changed --brief` 只跑"本次 diff 会触发的门禁"，
一屏出 PASS/SKIP/BLOCK，目标 <5 s。把它放在 ralph-loop 每个 REQ 的 step 0，先看红不红，
再决定是否继续写——而不是写到一半才被 `git commit` 拦下。

**根因提醒**：Gate 3/6 是"返工双雄"。写完一个函数先扫一眼长度和嵌套，比提交后返工快得多。

---

## BUILD Entry Contract Check (MANDATORY — v0.18.0+, 程序化)

**Purpose**: Validate `slices-manifest.json` schema and slice↔REQ cross-artifact consistency before entering BUILD.

**Execution**: `phase-transition 3 in_progress` 时程序化校验：

```
1. slices-manifest.json 存在且 schema 合法
2. manifest 每个 slice 引用的 REQ 必须存在于 specification.yaml
3. 不合法 → BLOCK
```

**GATE CHECK**:
```
[BUILD-ENTRY] slices-manifest.json exists ✓
[BUILD-ENTRY] manifest schema valid ✓
[BUILD-ENTRY] slice↔REQ consistency ✓    # 每个 slice 的 REQ 引用在 specification.yaml 中存在
```

**IF GATE FAILS**: BLOCK — 返回 Phase 2/6 修复 manifest 或 specification.yaml。

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

## TDD-GATE: Pre-Implementation TDD Check (MANDATORY — v0.14.0+)

**Purpose**: Enforce RED → GREEN → REFACTOR discipline at BUILD entry before any delegation.

**Execution**: Before dispatching to ralph-loop or parallel agents, the orchestrator MUST verify for each REQ:

### Gate Logic

```
FOR each REQ in slices-manifest.json:
  IF test file exists for this REQ:
    IF test passes (GREEN state) AND no implementation exists:
      → BLOCK: TDD bypass detected. Test is passing before implementation.
    ELSE IF test fails (RED state):
      → ALLOW: Proceed to implementation (GREEN phase).
  ELSE (no test file exists):
    → ALLOW: Mark REQ as [TDD-RED]. ralph-loop creates the test as step 0.
```

### Todo Prefix Convention

Each todo item MUST carry a TDD phase prefix in the content field:
- `[TDD-RED]`: Write failing test first. No implementation yet.
- `[TDD-GREEN]`: Write minimal implementation to make test pass.
- `[TDD-REFACTOR]`: Refactor while keeping tests green.

The priority field (high/medium/low) is separate and unchanged.

Example:
```
"[TDD-RED] src/lib/auth.ts: Add validateToken() test for expired tokens - expect test to fail"
"[TDD-GREEN] src/lib/auth.ts: Implement validateToken() to pass test - expect test passes"
"[TDD-REFACTOR] src/lib/auth.ts: Extract token parsing into parseToken() helper - expect tests stay green"
```

### Deadlock Prevention

The TDD-GATE is a PRE-RALPH-LOOP check, NOT a replacement for ralph-loop's internal TDD:
- If no test exists → ralph-loop IS allowed to proceed (creates test as step 0)
- If test exists and is GREEN without implementation → BLOCK (TDD bypass)
- The gate verifies TDD DISCIPLINE was followed, not that TDD was skipped

### Limitation

This enforcement is instructional (LLM follows SKILL.md instructions), not programmatic. For stronger enforcement, consider a future automated pre-commit hook that checks git staging order (test file must be staged before source file).

### Log Format (`.sprint-state/tdd-gate-log.json`)

```json
{
  "checked": true,
  "blocked": false,
  "skipped": false,
  "reqs_checked": 4,
  "reqs_blocked": 0,
  "timestamp": "2026-07-09T00:00:00Z"
}
```

**Log location**: `.sprint-state/tdd-gate-log.json` — written on every gate execution for audit trail.

---

## In-Session Verification (MANDATORY — v0.14.31+)

**Purpose**: Ensure every implementation change is immediately verified and recorded, enabling Better Loop Harness (and other observability tools) to capture normalized change→validation event pairs.

**Problem it solves**: Without explicit in-session verification, Agents may edit files and move on without running tests or linters. This creates unverified changes that are invisible to post-hoc review tools, breaking the traceability chain between "what changed" and "was it validated".

### Mandatory Verification Protocol

After **every** implementation change (file edit, refactor, new feature, bug fix), the Agent MUST execute the following sequence BEFORE claiming the change is complete:

1. **Run tests**: `npm test` or `npx vitest run` (or project-specific test command)
2. **Run linter**: `npm run lint` or `npx eslint .` (or project-specific lint command)
3. **Type-check** (TypeScript projects): `npx tsc --noEmit`
4. **Record the result**: Append a structured verification event (see format below)

### Verification Event Format

Each verification event MUST be recorded as a structured JSON object. Agents should output this to stdout or append to `.sprint-state/phase-outputs/verification-events.jsonl`:

```json
{
  "timestamp": "2026-07-22T10:30:00Z",
  "change": {
    "type": "edit|refactor|feature|bugfix",
    "files": ["src/lib/auth.ts", "src/lib/auth.test.ts"],
    "description": "Implement validateToken() for expired token handling"
  },
  "verification": {
    "tests": { "command": "npx vitest run src/lib/auth.test.ts", "status": "pass|fail", "summary": "4 passed, 0 failed" },
    "lint": { "command": "npm run lint", "status": "pass|fail|warn", "summary": "0 errors, 2 warnings" },
    "typecheck": { "command": "npx tsc --noEmit", "status": "pass|fail|skip", "summary": "No type errors" }
  },
  "outcome": "verified|failed|partial",
  "req": "REQ-003"
}
```

### Integration with ralph-loop

When using ralph-loop mode (default BUILD strategy), each REQ iteration MUST include verification as the final step before marking the REQ complete:

```
ralph-loop iteration:
  1. [TDD-RED] Write failing test
  2. [TDD-GREEN] Implement minimal code to pass
  3. [TDD-REFACTOR] Clean up while keeping tests green
  4. [VERIFY] Run tests + lint + typecheck ← MANDATORY
  5. [RECORD] Append verification event ← MANDATORY
  6. Mark REQ complete and continue to next
```

### Anti-Patterns

| ❌ Error | ✅ Correct |
|----------|----------|
| Edit file → claim done → move to next task | Edit file → run tests + lint → record result → claim done |
| "Tests should pass" (assertion without evidence) | "Tests passed: 4 passed, 0 failed (npx vitest run)" |
| Run tests only at end of entire BUILD phase | Run tests after every individual change/REQ |
| Skip type-check because "I didn't touch types" | Always run `tsc --noEmit` on TypeScript projects |

### Harness Integration

Better Loop Harness captures change and verification events by inspecting session history. The structured verification events above serve as the canonical signal that:
- A change occurred (the `change` field)
- The change was validated (the `verification` field)
- The outcome is attributable (the `outcome` field ties result to specific change)

Without these events, the Harness can only infer changes from file diffs and has no verification signal, resulting in lower "改动验证" (Change Verification) dimension scores.

---

## 工具调用效率自检（P2 硬性 — 2026-10-30 诊断）

> BUILD 阶段是工具调用最密集的阶段，也是"等待时间长"的主要来源。依据
> `docs/plans/2026-10-30-dev-speed-diagnosis.md`：工具延迟占总耗时 58%，其中 32.7% 的
> shell 调用是纯读取/搜索、calls/step 仅 1.03、`job_output` 阻塞 66.5 h。以下四条在 BUILD
> 期间是硬性自检项，不满足不得宣称 REQ 完成。

| ❌ 低效做法 | ✅ 正确做法 |
|------------|------------|
| `cat` / `Get-Content` / `sed -n` / `head` 读文件 | 用 `read` 原生工具（毫秒级，可并发） |
| `grep` / `rg` / `Select-String` / `findstr` 搜内容 | 用 `grep` 原生工具 |
| `find` / `ls` / `Get-ChildItem` 找文件 | 用 `glob` 原生工具 |
| 一个一个发独立调用（改完再想下一个） | 多个互不依赖的调用放进**同一步**并发发出 |
| 用 `job_output wait:true` / `sleep` 反复阻塞等长任务 | `run_in_background` + 完成通知，需要时短超时取一次 |
| 打包/发布/插件改动只靠 CI 发现契约破坏 | 先写契约测试（`plugins/dsh/src/contract.test.ts` 范式），本地先红 |

**验收目标**：纯读取 shell 占比 <5%（现 32.7%）；calls/step ≥2.0（现 1.03）；`job_output`
调用数下降 ≥50%。这三项在 `xp-gate retro` 的 activity 统计里可复查。

---

## Blind Review — Read-Only Subagent Convention (v0.18.0+, 证据型标准步骤)

**Purpose**: Code review by an isolated subagent with read-only tool access. Replaces the former `freeze/unfreeze` mechanism.

**Convention**: The blind-review reviewer runs as a Task subagent with restricted tools:

```
tools: [Read, Grep, Glob]    # 只读 — 禁止 Write/Edit/Bash 写操作
```

**Execution**:
1. Orchestrator dispatches a Task subagent with `tools: [Read, Grep, Glob]`
2. Subagent reviews all changed files (from `git diff` or slices-manifest scope)
3. Subagent outputs review findings (issues, suggestions, risks)
4. Orchestrator records findings to `.sprint-state/phase-outputs/blind-review-report.md`

**Classification**: 证据型标准步骤（非 HARD-GATE）— 执行并留存评审记录，不设程序化阻断。Worktree 本身已是隔离边界。

**Anti-Pattern**: Reviewer subagent MUST NOT have Write, Edit, or Bash permissions. This ensures the review is truly read-only and cannot accidentally modify code under review.

---

## Learnings Capture (v0.18.0+, 原生)

**Purpose**: Record patterns and lessons learned during BUILD for future sprints.

**Execution**: ralph-loop 迭代中或 BUILD 完成后，将有价值的模式/教训写入：

```
.sprint-history/learnings.md
```

**Format**:
```markdown
## [YYYY-MM-DD] Sprint <id> — BUILD Learnings

### Pattern: <title>
- **Context**: <when this applies>
- **Insight**: <what was learned>
- **Action**: <how to apply in future>
```

**Note**: 替代原 `gstack/learn` 调用，纯原生文件写入，零外部依赖。

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
| blind-review (read-only subagent) | Code review via read-only subagent | 5-10 min | 20 min | WARNING, continue |
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
