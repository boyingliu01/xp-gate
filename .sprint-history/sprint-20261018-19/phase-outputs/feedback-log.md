# Phase 4/6 VERIFY — 反馈日志

**Sprint:** sprint-20261018-19（门禁诚实性与提速）
**日期:** 2026-10-19
**HEAD 基线:** 见 `.code-walkthrough-result.json`

## Part A: 验证结果

### 1. Delphi code-walkthrough（三位专家 × 五个代码切片）

由于全量 diff 51KB 超过单次请求 40KB 预算，按职责切成 5 个切片分别走查：

| 切片 | 范围 |
|------|------|
| 1a | `scripts/ccn-report.cjs`（CCN 引擎核心） |
| 1b | `githooks/gate-3.sh` + `githooks/lib/ccn-ratchet.sh` |
| 2 | `githooks/pre-commit` + `githooks/lib/audit-sanitize.sh`（诚实性） |
| 3 | `githooks/lib/docs-only.sh` + bats（提速） |
| 4 | `.github/workflows/quality-gates.yml`（CI 阻断化） |

**逐条核实结果（这是本阶段最重要的产出）：**

第一轮（5 个切片 × 3 席位）共 9 条主要反对意见，逐条核实：

| # | 意见 | 判定 | 处理 |
|---|------|------|------|
| 1 | `unverified++` 的 `!(span) > 250` 运算符优先级错误，条件恒假 | **真 bug** | 改为 `!searched && span <= 250`，`0522fae8` |
| 2 | hook 缺验证器时静默降级，与 CI 硬失败不一致 | **真缺陷** | hook 改为 fail closed + `verifier=MISSING`，`86c16ef1` |
| 3 | `GATE_2_REASON`/`GATE_5_REASON` 未定义 | **半真** | 已定义但从不被读（无 `set -u` 所以不报错）——是无用代码伪装成"原因已记录"。改为 `*_DETAIL` 并接进 `record_gate_audit`，`0522fae8` |
| 4 | shell 与 CJS 两处 `baselineKey` 可能漂移且无测试 | **真风险** | 导出 `baselineKey`，加跨实现一致性 bats（CJS 生成键喂给 shell 读），`c951a331` |
| 5 | `csvRows` 把临时 CSV 当源文件读 | 假阳性 | `srcPath` 是 CSV 来源，`rowPath`（CSV 第 7 列）才是源码。设计正确 |
| 6 | `docs/*` glob 不递归，嵌套文档被误判 | 假阳性 | 实测 `docs/subdir/file.md`→true、`docs/deep/nested/thing.md`→true。`.md` 扩展名检查先命中，glob 是冗余保护 |
| 7 | `source_gate_lib` 无守卫，缺库会阻断所有提交 | 假阳性 | `source_gate_lib` 缺文件即 `FATAL ... exit 1`，这是**刻意**的 fail-closed |
| 8 | 短函数会被误判 unlocatable 导致 CI 频繁误报 | 假阳性 | 实测 `unverified_rows` = 0 |
| 9 | 匿名函数从 `lines[0]` 找起会绑错块 | 假阳性 | 已按声明优先 + 行号定位，且有 bats 覆盖 |
| 10 | `sanitize_start` 拒绝 10 位值会误伤 2001 年前的合法时间戳 | 设计如此 | 本仓库与 CI 均运行于 2026 年，10 位值必然是秒级单位错误 |
| 11 | `avg gate duration` 被 null 污染（我在验证时发现） | **真 bug** | `retro.js` 的 `duration_ms \|\| 0` 把 null 折成 0；改为只统计 `[0, 2h]` 内的有限值并同时输出 p50，`afbbbad8` |

第二轮（2 个切片 × 3 席位）：

| # | 意见 | 判定 | 处理 |
|---|------|------|------|
| 12 | `runLizardOne` 吞掉 execFile 错误，崩溃被当成"该文件零函数" | **真 bug** | 空输出 + 错误 → reject，`d67b3999` |
| 13 | ratchet 模式下 `CC_WARNINGS` 存的是 BLOCK 数却当 `issues_found` 记录 | **真 bug** | 重命名 `CC_VIOLATIONS` 并按模式取值，`481512e6` |
| 14 | 空 / 畸形基线会静默退化为"无保护"，无法与"全部在基线内"区分 | **真缺陷** | 基线为空时 stderr 告警，`d0e40543` |
| 15 | `throw` 写在 Promise executor 的异步回调里不会 reject，Promise 永久 pending | **真 bug**（三席位独立发现） | 改用 `reject(...)`，`eccb1e0a` |
| 16 | `reportedSpan > 0` 让 span=0 的未定位行逃过 fail-closed | **真 bug** | 去掉 `> 0` 条件，`eccb1e0a` |
| 17 | `run()` 顺序执行 lizard，大仓会慢 | 设计如此 | 已注释说明：并发池在 Windows 上会把报告清零（实测 779→0），逐文件隔离是这个工具的全部意义 |
| 18 | `csvRows` 里的 `process.exit(1)` 让函数不可单测 | 假阳性 | `csvRows` 只在 CLI 路径调用，不对外导出 |
| 19 | `findSourceFiles` 的 git 失败回退会遍历大目录 | 已知取舍 | 回退是刻意设计（非 git 环境也能用）；大仓场景由 `git ls-files` 正常路径覆盖 |

**命中率：8 条真 bug / 2 半真 / 5 假阳性 / 2 设计如此。** 8 个真问题里有 6 个属于"代码看起来在检查、实际没检查"，正是最值得被发现的类型。

### 2. test-specification-alignment（#367 程序化 HARD-GATE）

`.sprint-state/phase-outputs/test-alignment-report.json`：`alignment_status: PASS`，绑定当前 HEAD 与 `specification.yaml` 的 SHA-256。REQ-A..REQ-F 全部映射到新增测试文件，每个文件都带 `@test REQ-*` / `@intent` / `@covers AC-*` 三件套（脚本化校验，缺任何一项即 FAIL）。

### 3. 质量门禁全量

见下方"验证命令与结果"。

### 1b. 追加 13 轮复审（R2–R15）的真实结果 —— 必须如实记录

第一轮之后又跑了 13 轮。这不是"改到评审满意为止"，而是**每一轮都先把意见当假设去证伪**。结果分三类：

**又抓到 8 个真 bug（都是第一轮没看见的）：**

| 真 bug | 影响 |
|--------|------|
| `verifyRowCcn` 只在 `ccn > 10` 时校验 | **最严重**：3449 个 CCN≤10 的函数里 **521 个是低报的**。`renderGatePassRateChart` 报 4、实际 15。ratchet 一直在比未校正的数字 |
| `stripNonCode` 不跨行处理块注释 | 注释里的 `if/for/while` 被当成分支。实测 `return 1` 得 1，同样代码加一段含关键字的注释得 **11**。本仓库有 **438 处**多行块注释 |
| `runLizardOne` 用 `throw` 而非 `reject` | Promise 永久 pending（挂死），三席位独立发现 |
| lizard 对**不可读路径**返回 exit 0 + 无输出 | 与"该文件零函数"无法区分 → 文件从基线和 ratchet 中静默消失 |
| `execFile` 没有 `timeout` | "被 kill 就拒绝"的守卫**永远不可能触发**——读起来像保护，实际不是 |
| 二次查找找到 body 时只用来决定计数，不修正 CCN | 守卫报"0 unverified"而数字其实没校验过 |
| 计划中 `_rescued`/`_spanArtefacts` 只增不报 | "0 未验证"无法与"守卫什么都没看"区分 |
| 类属性带修饰符（`public readonly x = ...`）时 body 找不到 | 该行保留原始未校正数字 |

**其中 3 个（`ccn > 10` 短路、块注释、不可读路径）直接推翻了本 sprint 自己此前发布过的数字**，已在 `phase-3-summary.md` 和提交信息里明确标注修正。

**证伪的假阳性（10 条，均写了探针）：** `mapPool` 竞态（该函数是死代码，已删）、`BRANCH_RE` 数错 `a ? .5 : c`（实测正确计 2）、`findFunctionBody` 找不到箭头函数（单行/多行均能找到）、`a?.b?.c` 链式误计（实测 1）、`declaresMember` 正则语法错误（能编译、行为正确）、`findFunctionBody` 自身 CCN 超阈值（实测 9）、`docs/*` glob 不递归（实测 10/10 正确）、`source_gate_lib` 无守卫（有 FATAL）、短函数误 BLOCK（实测 0）、行内 `/*` 被字符串误开（有引号处理）。

**最后一轮（R15）的共识：** feasibility 3/3 通过；architecture 与 technical 在切片的另一半给出 REQUEST_CHANGES，但其 critical_issues 逐条复核后**全部落在上述假阳性或"设计如此"**，没有新的真 bug。

**这就是诚实的收尾状态：** `consensus_ratio` 如实记录为 **0.33**（1/3 APPROVED），因为熔断规则要求"全部通过"，而剩余反对意见经核实不成立。**不为了让数字好看而挑选胜出的切片**——`emit-walkthrough-result.cjs` 的第一版就是按"最高置信度"选单个文件，等于把一处的 REQUEST_CHANGES 藏起来，已改成"任一切片否决即整体否决"。

## Part B: 反馈与教训

### 关键教训（详见 `.sprint-history/learnings.md`）

1. **改完 `githooks/` 必须立刻 `xp-gate doctor --sync-hooks`** — 本 sprint 前 15 个提交跑的是旧 hook，导致"修了但没生效"，还误导了对 REQ-F 的判断。
2. **数字不对时先怀疑测量方式** — 需求说"调宽阈值"，真实问题是读错列。三层错误叠加。
3. **统计前先验证分组方式** — 我第一次算 REQ-F 的 p50 用了错误的运行归组，得到假结论。
4. **切片走查假阳性率高但值得付** — 命中率 4/11，但每个真命中都是恶性 bug。
5. **遗留债务要列清单** — "有意为之"这句话让三位评审连打两轮。

### 本 sprint 引入的机制性保障

| 保障 | 作用 |
|------|------|
| `.ccn-baseline.json` ratchet | 13 个遗留热点只可能变好，不可能变差 |
| `check-hook-mirror.sh` | 规范源与镜像字节一致（本轮实际拦下一次真实漂移） |
| `ccn-report.cjs --check` 的 fail-closed | 缺基线 / 基线不可解析 → exit 1 |
| bats 跨实现键一致性 | shell 与 CJS 的 `baselineKey` 漂移 → 测试红 |
| Gate 3 缺验证器 fail closed | 本地与 CI 对同一条件给出同一结论 |

## 验证命令与结果

```
npx tsc --noEmit                                       → TSC-OK
npx vitest run（受影响 34 个文件）                      → 488 passed / 34 files
npx bats .../issue-ccn-ratchet.bats                    → 13/13
npx bats .../issue-docs-only-skip.bats                 → 10/10
npx bats .../issue-audit-poisoned-start.bats           →  6/6
node scripts/ccn-report.cjs --check                    → OK, 767 functions within ratchet
bash scripts/check-hook-mirror.sh                      → PASS, byte- and mode-identical
npx tsx .../xp-gate.js doctor                          → 15/15 lib modules match
```

bats 合计 **29/29**；vitest 合计 **488 passed / 34 files**；`.ccn-baseline.json` 758 条。以上均为最后一次提交后的实测值。

## 未处理项（如实记录）

1. **`.quality-history.jsonl` 的历史分数**可能仍受旧的脏 duration 数据影响，未验证。
2. **`xp-gate retro` 报 "Sprint transitions recorded: 0"**，实际转了 3 次。原因未查（疑似读取目录与 `.sprint-state/` 不一致）。
3. **生产热点共 37 个 CCN > 10**（Phase 4 修正，原先报的 13 是未校正路径得出的）。全部钉进 ratchet，只会变好不会变差；逐条理由见 `phase-3-summary.md`。
4. **lizard 1.21.3 的边界缺陷**未修（非本仓库代码），靠 `verifyRowCcn` + `stripBlockComments` 兜底。已加版本号守卫：换了 major 会直接报错而不是静默出错。
5. **`src/npm-package/**` 镜像侧 58 个 >10**：随规范源自动下降，不单独治理。
6. **lizard 把 `private _x: T = ...` 这类字段命名为 `=`** 而非字段名，导致这类行无法按名定位。属 lizard 解析器局限，已在代码注释和测试中记录。
7. **代码走查共识为 1/3（0.33），未达 90% 门禁**。剩余 2 席的反对意见经逐条探针复核均不成立或不属本仓库可控范围，详见 1b 节。这是如实记录，不是通过。
