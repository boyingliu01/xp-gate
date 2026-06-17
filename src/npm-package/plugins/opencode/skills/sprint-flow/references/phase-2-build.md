# Phase 2: BUILD（TDD + 并行执行 + 盲评 + 验证）

**完整指令**: @see SKILL.md `## Phase 2: BUILD` section.

**摘要**: TDD 执行, 多 Agent 并行加速, 盲评验证, Gate 1 验证通过。

**关键链路**: DELPHI-GATE → parallel-dispatch/ralph-loop → TDD → freeze → blind-review → unfreeze → verification → cost monitor

**输出**: MVP v1

---

## Gate 参考表（Phase 2 相关）

| Gate | 名称 | 行为 |
|------|------|------|
| Gate 5 | 单元测试 + 覆盖率 | 全部通过 + ≥80% 覆盖率 |
| Gate 5a-BLOCK | 新增 .ts/.tsx 文件测试强制 | 新增 .ts/.tsx 文件无对应测试文件 → BLOCK；修改文件 → WARNING |
| Gate M2 | Mock 密度检查 | 30% WARNING (Phase 1); 可配置 via `.mockpolicyrc` |

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
