# 复盘：增量检查为什么"设计了却还要付全量成本"

**日期**: 2026-11-07
**触发**: 用户质疑「pre-commit 明明专门设计过增量检查，为什么现在还是全量？」
**结论**: 用户的记忆是**对的**。增量设计确实存在且**仍然生效**。我上一轮的诊断把一个"不可达的全量调用点"误当成了实际发生的成本。真正的全量成本在**别处**，而且原因完全不同。

---

## 1. 先纠正我上一轮的错误

| 我说的 | 实际 | 证据 |
|---|---|---|
| "Gate 1 跑 `npx eslint .` 全树 24.3 s" | **错的**。pre-commit 的 TS 分支本就只 lint 改动文件 | `githooks/pre-commit:1792` `ESLINT_FILES=$(echo "$CHANGED_FILES" \| grep -E '\.(ts\|tsx\|js\|jsx)$')` |

我测的 24.3 s / 53 s 是**我直接手敲 `npx eslint .`** 的结果，不是 hook 里发生的事。这是我的测量方法错误：**我测了工具，没测 hook 的调用路径。**

`eslint .`（全树）确实存在于 `githooks/adapters/typescript.sh:64` 的 `run_lint()` 里，但：

- `run_lint()` 在 pre-commit 里**只有一处调用点**：第 2373 行，通用 adapter 兜底分支 `*)`。
- TypeScript 走自己的 `typescript)` 分支（第 1737 行），**根本不经过 `run_lint`**。
- 且 `route_to_adapter()`（adapter 的另一个入口）已在 **#688** 被整个删除，注释明写"zero production callers"（`githooks/adapter-common.sh:160`）。

**所以 `typescript.sh:64` 的 `eslint .` 对 TS 项目是死代码。** 它不是成本来源。

---

## 2. 增量设计其实是一份明确的清单（2026-10-16）

`docs/plans/2026-10-16-sprint-e-design.md` §1.2.2 记录了你当时的裁定：

> **老牛裁定**："符合原始需求即可，原始需求是在 **pre-commit 环节使用增量检查**，减少 CPU 占用，避免系统被拖慢" + **"不要只处理 MYPY 这一个程序，所有的这些文件检查，因为在 pre-commit 的时候都应该是做成增量的"**

同一份文档给出了逐项盘点，**"已是增量"的清单**：

| 项 | 增量方式 | 今天还成立吗 |
|---|---|---|
| Python 全分支（Ruff lint/format/debug/增量 mypy） | `CHANGED_FILES` | ✅ 成立 |
| **TS ESLint** | `ESLINT_FILES` | ✅ 成立（已验证 L1792） |
| Biome | `--staged .` | ✅ |
| Shell shellcheck | `SHELL_FILES` | ✅ 成立 |
| jscpd | 传 `CHANGED_FILES` | ✅ |
| pylint duplicate-code | grep `.py` | ✅ |
| **测试运行** | `#286 smart selection + related-test + full fallback` | ✅ 成立 |
| Gate 3 lizard | `CC_FILES` | ✅ 成立（已验证 gate-3.sh:366） |

**"明确全量点（需补齐）"只有两条**：
1. Go 分支 `golangci-lint run` 无参扫全仓库（本仓库无 Go 源文件 → **不影响我们**）
2. **TS typecheck 全项目扫描** → 当时就判定"**难以增量**（tsc 单文件类型检查不可行，跨文件依赖硬性）"

### 结论：增量设计基本上都落地了

你记忆中的"专门设计了增量检查"是真的，**而且大部分还在生效**。所以问题不是"增量设计丢了"。

---

## 3. 那真正的全量成本在哪？—— 三类，原因各不相同

### 3.1 【设计时就被排除】TS typecheck 全量

`sprint-e-design.md` §1.2.2 第 2 条已经判定 tsc 不能增量，理由是硬的：tsc 要解析整个模块图才能给出正确的类型诊断，单文件检查不可行。

**这是已知且合理的取舍，不是缺陷。** 实测 `tsc --noEmit` 17.9 s，但 hook 里走 `--incremental`，实测 Gate 9 约 5 s。

### 3.2 【从没纳入增量范围】覆盖率

这是**你第二个问题的核心**，也是真正的大头。

**现状（实测）**：

| 调用 | 实测 |
|---|---:|
| `vitest run <1 test file>` | **11.5 s** |
| `vitest run <1 test file> --coverage` | **47.1 s** |

测试**选择**是增量的（#286 smart selection 只挑相关测试），但**覆盖率统计不是**——因为
`vitest.config.ts` 的 `coverage.include` 是 `['src/**/*.{ts,js}', 'plugins/**/*.ts']`，
实测 **632 个源文件**全部插桩，而这次只执行了其中 1 个。

**为什么当年没被纳入增量清单？** 看 §1.2.2 的口径就清楚了——那份盘点列的全是"**文件检查**"（lint / 静态分析 / 格式），覆盖率不在这个概念里。覆盖率不是"检查哪些文件"，它是"跑测试时的副产物"，所以被漏掉了。

**而且它是自相矛盾的**：子集运行算出的覆盖率必然极低，于是 hook 用 `PARTIAL_TEST_RUN=true` 把它降级成 WARN（`pre-commit:3728`），再靠匹配 vitest 的 `ERROR: Coverage for lines ... does not meet` 文案把它吞掉（#473）。日志自己写着：

```
⚠️  Partial coverage 0.12% (subset test run, not full suite).
```

**即：花了 35 s 算出一个 0.12% 的错数字，再把它跳过。** 这是纯浪费，而且是当年 #286 smart selection 的**直接副作用**——没有 smart selection 时跑全量，覆盖率是有意义的；有了 smart selection 之后，覆盖率就变成无意义的了。**两个特性各自都对，组合起来互相抵消。**

### 3.3 【本次新发现，与增量无关】Gate 10 联网卡死

`--config=p/security-audit` 每次去 `semgrep.dev` 拉规则，本机 read timeout，重试到 180 s 上限。
这是**仓库外部的网络依赖**，和增量/全量无关。修法是把规则 vendor 进仓库。

---

## 4. 复盘：这个错误是怎么产生的

### 4.1 根因一：把"工具的能力"当成"hook 的行为"

我直接跑 `npx eslint .` 得到 24.3 s，就断言"Gate 1 慢 24 s"。**但 hook 从来不这么调用。**
正确做法是**读调用路径**（`pre-commit` 的 `typescript)` 分支），或者**看 hook 真实运行时做了什么**（审计日志里 Gate 1 的 `duration_ms` 在 shell 场景只有 452 ms，在 TS 场景却是 66–94 s——这个差异我当时看到了却没深究）。

**教训**：`duration_ms` 才是 hook 的真实行为，工具基准只说明"这项操作如果发生要多久"。两者不可混用。

### 4.2 根因二：没区分"设计上排除"与"设计上遗漏"

`sprint-e-design.md` 白纸黑字写着"TS typecheck 难以增量"。如果我读了这份文档，就**不会**把 typecheck 当成"该增量却没增量"的缺陷——它是**论证过的取舍**。

反过来，覆盖率**不在**那份清单里，既不是"已增量"也不是"明确全量点"，它是**纯粹的遗漏**。这个区别决定了两者要对症下药的方式完全不同：
- typecheck：不要动（动的代价是正确性）
- 覆盖率：要动（动的代价为零，因为现在算出来的数字本来就被丢弃）

### 4.3 根因三：缺一份"门禁 × 作用域"的单一事实源

增量清单活在 2026-10-16 的一份 sprint 设计文档里，**没有任何机制保证它与代码同步**。新增的 Gate（10/11/12/13）不在那份清单上，覆盖率也不在。AGENTS.md 有 `gate-registry.sh` 记"哪个门禁由哪个文件实现"，但**没有"每个门禁的扫描作用域"这个维度**。

**这是可以补的结构性缺口**（见 §5）。

---

## 5. 建议：给门禁加"作用域"这一维

`githooks/gate-registry.sh` 现在记录 `name / number / impl / blocks`。建议增加一列 `scope`：

```
#   scope   what population this gate examines:
#             changed      only files in this commit/push (incremental)
#             changed+graph changed files plus what their correctness depends on
#                          (tsc/archlint: cannot be narrowed without losing detection)
#             full         whole tree by necessity (coverage, mutation)
#             none         no matching inputs in this commit -> must not start a tool
```

有了这一列，今天的三类问题各自都有归属，而且**新加门禁时必须填**，不会再出现"某个门禁偷偷扫全树而没人知道"。

> 注意：加列本身是文档/契约改动，要同步 `gate-registry.test.bats`（该测试已存在，
> 校验 registry 与代码一致）。这是**独立于提速**的改进，建议单独立项。

---

## 6. 一句话总结

**增量检查没有被弄丢——它大部分还在，而且 TS ESLint / shellcheck / jscpd / lizard / 测试选择都是增量的。**

真正的全量成本只有三处，且三处性质完全不同：
1. **tsc typecheck** — 设计时就论证过不能增量，**保持现状**
2. **覆盖率** — 增量化之后遗留的纯浪费，**要修**（见配套设计）
3. **semgrep 联网** — 与增量无关的网络缺陷，**要修**

我上一轮把 1 和死代码当成了主要瓶颈，这是**测量方法错误 + 没读已有设计文档**。正确的数字来自 `duration_ms`，不是工具基准。
