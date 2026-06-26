---
phase: 0
phase_name: THINK
status: revised_r3
delphi_rounds:
  - round: 1
    verdict: ALL_REQUEST_CHANGES
    key_feedback: "Merge security gates destroys audit trail; schema break; missing migration plan"
  - round: 2
    verdict: ALL_REQUEST_CHANGES
    key_feedback: "Close to approved — need dual-copy sync spec, schema version field clarity, Gate 9 fate clarity"
outputs:
  - .sprint-state/phase-outputs/phase-0-summary.md
decisions:
  - "R3: Gate 9 新增 Build Integrity，原 Gate 9 (SAST) 不移除 — pre-commit 变为 11 gate"
  - "R3: reportVersion 从 '1.1' bump 到 '2.0'（不引入新的 schema_version 字段）"
  - "R3: 双副本维护：githooks/pre-commit 为 source-of-truth，src/npm-package/hooks/ 通过 manual sync 保持一致"
  - "R3: pre-push M-prefix 方案：MD/ML/MW/MS"
  - "R3: pre-push 保留 gate-10.ts 调用（defense-in-depth）"
  - "R3: gate-10.ts --timeout 在 bash 调用处显式传入（115s < bash 120s）"
next_phase_context: "提交 R3 修订设计给 delphi-review Round 3 —— 期望 APPROVED"
---

# Phase 0 (R3): THINK — Gate 10 Build Integrity 接入 pre-commit

## 任务摘要

将 `src/build-integrity/gate-10.ts`（build/compile integrity check）接入 pre-commit 作为 Gate 9，同时统一 pre-push gate 命名规范。

## R1→R2→R3 修订历史

- **R1**: 提出合并 Gate 7/8/9 → 三位专家一致否决（audit trail 丢失）
- **R2**: 放弃合并，插入 Build Integrity 为 Gate 9，M-prefix 命名 → 三位专家认为方向正确但文档不够精确
- **R3**: 澄清 Gate 9 (SAST) 不移除、reportVersion bump、双副本 sync、超时参数 — **期望 APPROVED**

## Gate 编号方案（最终）

**原 Gate 9 (Semgrep SAST) 不移除**，pre-commit 变为 11 gate：

| Gate | 名称 | 状态 |
|------|------|------|
| 0 | Version Consistency | 不变 |
| 1 | Code Quality | 不变 |
| 2 | Duplicate Code | 不变 |
| 3 | Cyclomatic Complexity | 不变 |
| 4 | Principles | 不变 |
| 5 | Tests + Coverage | 不变 |
| 6 | Architecture + Boy Scout | 不变 |
| 7 | IaC Security | 不变 |
| 8 | Secret Scanning | 不变 |
| **9** | **Build Integrity** | **新增**: tsc + npm pack + import check |
| **10** | **SAST Security** | **原 Gate 9 → Gate 10** |
| 11 | Sprint Flow | 原 Gate 10 → Gate 11 |

## pre-push 变更（M-prefix 方案）

| 旧名 | 新名 | 含义 |
|------|------|------|
| Gate M | Gate M | Mutation Testing |
| Gate M2 | Gate MD | Mock Density Check |
| Gate M3 | Gate ML | Mock Layering Policy |
| Delphi | Gate MW | Code Walkthrough |
| Gate S | Gate MS | Sprint Flow Enforcement |

**保留 gate-10.ts 调用**：defense-in-depth，覆盖 `--no-verify` amend 场景。

## 版本字段

**Bump `reportVersion` 从 `"1.1"` 到 `"2.0"`**。不引入 `schema_version`（避免双字段混淆）。dashboard.js 通过 `reportVersion` 区分 V1/V2。

## 双副本同步

`githooks/pre-commit` = source of truth；`src/npm-package/hooks/pre-commit` = manual-sync copy。先解决当前 TOTAL_GATES 分歧，再新增 Gate 9。

## bash 超时调用

```bash
timeout 120s npx tsx src/build-integrity/gate-10.ts \
  --changed-files "$CHANGED_FILES" \
  --project-root "$PROJECT_ROOT" \
  --timeout 115000  # 115s < 120s bash timeout
```

## gate-10.ts 文件名

保留，顶部添加注释解释历史原因。`// This file (gate-10.ts) implements pre-commit Gate 9 (Build Integrity). Named for historical reasons...`

## quality-report.json V2 schema

```json
{
  "reportVersion": "2.0",
  "overall": { "gatesPassed": 10, "gatesTotal": 11, "score": 9.1, "verdict": "PARTIAL" },
  "gates": {
    "gate1_static_analysis": {...},
    "gate2_dup_code": {...},
    "gate3_complexity": {...},
    "gate4_principles": {...},
    "gate5_tests": {...},
    "gate6_arch_boyscout": {...},
    "gate7_iac_security": {...},
    "gate8_secret_scanning": {...},
    "gate9_build_integrity": { "name": "Build Integrity", "status": "PASS", "tool": "tsc + npm pack + import check" },
    "gate10_sast": { "name": "SAST Security Scan", "status": "PASS", "tool": "semgrep" },
    "gate11_sprint_flow": { "name": "Sprint Flow Enforcement", "status": "PASS", "tool": "sprint-gate.sh" }
  }
}
```

## 影响面（R3 完整清单）

| # | 文件 | 变更 |
|---|------|------|
| 1 | `VERSION` | Bump MINOR → `0.11.0.0` |
| 2 | `CHANGELOG.md` | breaking change + 迁移说明 |
| 3 | `githooks/pre-commit` | Gate 9 新增；Gate 10→SAST；Gate 11→Sprint Flow；TOTAL_GATES→11；reportVersion→"2.0" |
| 4 | `githooks/pre-push` | MD/ML/MW/MS 重命名；保留 gate-10.ts |
| 5 | `src/npm-package/hooks/pre-commit` | Manual sync from githooks/ |
| 6 | `src/npm-package/hooks/pre-push` | Manual sync from githooks/ |
| 7 | `githooks/__tests__/gate-9-build-integrity.bats` | 新增 |
| 8 | `githooks/__tests__/sprint-gate.test.bats` | Gate 11 引用更新 |
| 9 | `dashboard/dashboard.js` | gateNames 数组更新 |
| 10 | `src/npm-package/lib/gate-audit.ts` | aggregateByGate 兼容 |
| 11 | `src/npm-package/lib/doctor.ts` | 检测旧 hook 编号 |
| 12 | `CAPABILITIES.md` / `README.md` / `AGENTS.md` / `ARCHITECTURE.md` | gate 表格更新 |
| 13 | `verify.sh` / `.github/workflows/quality-gates.yml` | 审计确认 |
| 14 | `plugins/*/` + `src/build-integrity/gate-10.ts` | gate 名称审计 + 历史注释 |

## 不做的事

- 不重命名 `gate-10.ts` / 不修改 gate-7/8/9.sh / 不修改 .principlesrc / 不迁移历史 jsonl
