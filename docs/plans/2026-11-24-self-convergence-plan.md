# XP-Gate 自身收敛方案（2026-11-24 起执行）

**分支**：`wsl-migration-2026-11-23`
**基线**：`main @ b6249b01` + 本轮修复
**目标**：尽快收敛 XP-Gate 自身问题

---

## 0. 为什么"修 issue"不是收敛

你的判断是对的：**门禁曾失效，导致自身代码质量没被拦截，问题随之扩散。**

但 issue 列表不是病因，是症状。当前 98 个 open issue 里，真正危险的不是"某个门禁有 bug"，
而是**三个门禁从来没有真正运行过**：

| 门禁 | 记录数 | PASS | WARN | SKIP | 真实执行率 |
|---|---:|---:|---:|---:|---:|
| gate-1 代码质量 | 24 | **0** | 18 | 6 | 75% |
| gate-5 测试+覆盖率 | 21 | **0** | 0 | 21 | **0%** |
| gate-6 架构+BoyScout | 14 | **0** | 0 | 14 | **0%** |

在一个有数千个 TypeScript 测试的仓库里，**测试门禁从未执行过一次**。

所以收敛的顺序必须是：**先让门禁可信，再用它去找问题**。
反过来做（先修 issue）会一边修一边继续产生新的未拦截问题。

---

## 1. 根因：多语言 verdict 被覆盖（已修复）

三个门禁共享同一个缺陷机制：

```
for PROJECT_LANG in typescript shell powershell iac; do
    ... 每个分支直接写 GATE_N_STATUS / GATE_N_DETAIL ...
done
```

- **最后写入者获胜**：没有东西可测的语言排在后面，覆盖了测出结果的那个
- **只能降级**：分支可以把"查了且干净"改成"没查"

实测（343 条审计记录）：

```
gate-5  0 PASS / 21 SKIP   全是 "powershell: no Pester tests"
gate-6  0 PASS / 14 SKIP   全是 "not configured for iac"
gate-1  0 PASS / 19 WARN   全是 "PSSA module not installed"
```

这三条都是**结构性不可能 PASS**，不是偶发。

### 修复

新增 `githooks/lib/gate-status.sh`，把规则收在一处：

```
BLOCK > WARN > SKIP > PASS
```

- `PASS` 是"查了且干净"，任何其他状态都高于它——**未完成的检查不得呈现为干净**
- `WARN` 高于 `SKIP`，因为"查了但不完美"比"什么都没发生"信息量大
- `xp_gate_status_escalate` 只升不降；未知状态直接报错，不会被静默当作最弱
- `xp_gate_detail_append` 追加而非替换，多种语言可在同一行各自说明

已应用到 gate-1（8 处状态、16 处详情）、gate-5（powershell 臂）、gate-6（iac 臂）。

---

## 2. 执行顺序（按"减少扩散"排序）

### P0｜让门禁可信（**主体完成**）

| 项 | 状态 | 提交 |
|---|---|---|
| gate-5 状态不被降级 | ✅ | `eb1372fc` |
| 统一 verdict 规则（gate-1/6） | ✅ | `c08b1c00` |
| SKIP 原因可汇总（`audit --stats`） | ✅ | `2b105fa2` |
| detail 追加而非覆盖（gate-5 全部 18 处） | ✅ | `571ed4c4` |
| detail 按片段去重 | ✅ | `f44388c8` |
| 停止自拼接导致的四倍重复 | ✅ | `1c30b823` |
| 工具解析统一（#843 三条验收全部达成） | ✅ | `91e8318d`、`ccd22efb` |
| #841 Windows shim 防护 | ✅ | `ccd22efb` |
| Gate 2 镜像假阳性（28s→秒级） | ⏳ 待做 | — |

#### #843 / #841 的验收证据（2026-11-24）

```
PATH 无 ~/.local/bin:
  ✓ checkov  3.4.6 [found at ~/.local/bin/checkov (not on PATH)]
  ✓ gitleaks 8.30.1
  ✓ lizard   1.26.1

PATH 含 /mnt/c Windows shim:
  checkov → 不可用（正确拒绝，--version 通过但 exec 失败）

正常 PATH:
  checkov / gitleaks / semgrep / jscpd 全部可用
```

Gate 7 在 shim 优先的 PATH 下对含公开 ACL 的 `.tf` 正确 **BLOCKED**，
说明它选中的是可执行的 checkov，不是坏掉的 shim。

> **一个关键教训**：`resolve_tool_path` 和 `tool_is_available` 曾有
> **不同的搜索顺序**。前者找到 `~/.local/bin/gitleaks`，后者却在同一路径上判"不可用"。
> 两个函数回答同一个问题时，必须对**答案空间**达成一致——否则平台会自相矛盾：
> 一个说"我找到了"，另一个说"它不能用"。


### P1｜清理已扩散的质量债

门禁可信之后，用它们跑一遍，看有多少东西浮出来。**这一步的产出应该是一份清单，不是立即修**。

### P2｜剩余 issue 按簇处理

98 个 issue 里，与"门禁失效"直接相关的约 20 个（fail-open 簇）。
其余是 enhancement / 设计单，不应与收敛混在一起。

---

## 3. 迁移 TODO 的直接结论

| 原结论 | 迁移后实测 | 处置 |
|---|---|---|
| T1 镜像检查快速路径（省 4.4s） | 进程创建 1–2ms，整个脚本 **0.25s** | ❌ **作废** |
| T2 用例合并（262s → 60s） | 12 × 0.25s ≈ 3s | ❌ **作废** |
| §6.3 先测全量 vitest | **49.5–64.4s**（Windows 6 分钟未跑完） | ✅ 已完成 |
| §6b 覆盖率 78 → 90 | 本机实测 lines **79.98%** | ⏳ 保留，需先清失败测试 |
| §3.2 `/mnt/c` 污染 | 已根除三层 | ✅ 已完成 |

**T1/T2 作废的原因值得记住**：它们的收益全部来自"减少进程创建次数"，
前提是每次 100–180ms。迁移后实测 1–2ms，收益缩水两个数量级。
**一条优化建议绑定在它的测量前提上，前提变了建议就失效。**

---

## 4. 工作纪律（每步都要守）

1. **验证要跑真实执行**，不看版本号。本轮 `semgrep --version` 通过而扫描全挂、
   `npx tsc --version` 是占位程序，都是这个形状。
2. **改了正本必须 resync 镜像**，否则 Gate 12b 拦截。
3. **声称"已修复"之前，先确认基线本来是什么样**——用 stash 对比，而不是假定。
   本轮两次靠这个区分了"我弄坏的"和"本来就坏的"。
4. **不关没有验证过的 issue**。

---

## 5. 已知失败（5 个，均为既有）

| 测试 | 状态 |
|---|---|
| `language-capability` | csharp 2 处未接线（本轮已定位为检查器问题并修复） |
| `gate-10.test.ts` | 已修（npx 占位程序假阳性） |
| `warnings-baseline-budgets` | 已修（基线 7 条过期） |
| `execution-surface-contract` | push-only 门禁清单不完整 |
| `pre-push-resolution` | 期望 12 实得 13 |

后两个涉及门禁清单语义，需要确认预期才能改。
