# Ralph Loop Workflow Details

## Mandatory Execution Order

每个 REQ 必须按以下顺序执行，不得跳过或重排：

### 1. Load next READY REQ
- 从 specification.yaml 读取下一个依赖已满足的 REQ
- 检查 priority 和 status (pending 状态)
- 构建依赖图，确认无循环依赖

### 2. Create isolated context
- 清空前一个 REQ 的对话历史
- 注入：当前 REQ + AC + permanent learnings + contextual learnings (最近 3 条)
- 注入：AGENTS.md + git log --oneline -5 + 测试基础设施摘要

### 3. Pre-REQ snapshot（Issue #137）
在 dispatch subagent 前记录当前 git HEAD，用于 TDD 合规的基线对比：
```bash
PRE_REQ_HASH=$(git rev-parse HEAD)
echo "$PRE_REQ_HASH" > .sprint-state/last-req-baseline.txt
```

### 4. Dispatch build subagent
- 使用 `task(category="unspecified-high", load_skills=["test-driven-development"], timeout=300)`
- 强制 TDD 流程：RED → GREEN → REFACTOR
- 强制执行 Mock 边界策略

### 5. Run full regression tests
- **L1**: typecheck + lint on changed files
- **L1b**: 使用 git diff 验证新增测试行数占总新增行数比例 ≥ 40%
- **L1b-alt**: 当 diff 为空时，降级检查测试文件是否在 changeset 中
- **L2**: 全量测试运行（不只是 @test 当前 REQ 的测试）
- **L3**: 检查整体覆盖率 ≥ 80%

### 6. Fix until green or block
- 失败 → retry (max 3 次，每次注入失败摘要)
- 第 3 次仍失败 → BLOCK → 等待用户决策 (skip/manual/stop/rollback)
- 通过 → git commit + 标记 done

### 7. Persist learnings
- 分类为 permanent（架构级）或 contextual（临时性）
- 自动升级条件：被≥2 个 REQ 引用 或 涉及接口/数据结构
- 调用 `gstack/learn` 总结经验教训

### 8. Update sprint state
- orchestrator 统一更新 AGENTS.md（append `## ralph-loop: [REQ-XXX title]`）
- 原子写 checkpoint (progress.log)
- 继续下一个 READY REQ

### 禁止行为
- ❌ 跳过测试基础设施检查
- ❌ 只运行部分测试（必须全量回归）
- ❌ 验证失败仍 commit
- ❌ 多个 subagent 同时写 AGENTS.md
- ❌ 修改前一个 REQ 的代码（除非修复回归）

## Output Contract (Mandatory Checklist)

每个 REQ 完成时必须输出以下结构化检查清单：

```markdown
## REQ-XXX: [Title] - Execution Summary

**Status**: ✅ PASS / ❌ FAIL (retry n/3) / 🚫 BLOCKED

**Context Isolation**:
- [ ] Previous REQ context cleared
- [ ] Permanent learnings injected (N items)
- [ ] Contextual learnings injected (≤3 items)
- [ ] Test infrastructure confirmed ready

**TDD Compliance**:
- [ ] Tests written BEFORE implementation
- [ ] Test/implementation ratio ≥ 40% (L1b)
- [ ] Mock usage justified (if >30% mock density)
- [ ] Test files present in changeset (L1b-alt)
- [ ] TDD 合规检查 (test-first or @no-test-required)

**Verification Layers**:
- [ ] L1: typecheck + lint pass
- [ ] L1b: Test-first ratio check pass
- [ ] L2: FULL regression tests (all tests)
- [ ] L3: coverage ≥ 80%

**Learnings Persisted**:
- [ ] Permanent: [N items]
- [ ] Contextual: [N items, sliding window]
- [ ] `gstack/learn` called

**State Updated**:
- [ ] AGENTS.md updated (orchestrator)
- [ ] progress.log atomically written
- [ ] Git commit created (if PASS)

**Next Step**: [REQ-YYY title / COMPLETE / BLOCKED]
```

**Eval Criteria**: Structured execution plan visible, all 7 workflow steps followed, full regression tests run.
