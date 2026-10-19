# Phase 4/6 VERIFY — 代码走查与反馈

**Sprint**: sprint-20261018-19
**结论**: 走查跑满 16 轮；8 个真 bug 全部修复；**共识 1/3（0.33），未达 90% 门禁，如实记录。**

---

## 1. 为什么走了 16 轮

不是"改到评审满意为止"。每一轮的第一步都是把意见当**假设去证伪**——写探针、跑实测、看输出。只有这样才分得清哪些是真缺陷、哪些是模型在读不完整的切片时编出来的。

## 2. 抓到的 8 个真 bug

| # | 缺陷 | 后果 |
|---|------|------|
| 1 | `verifyRowCcn` 只在 `ccn > 10` 时校验 | **最严重**：3449 个 CCN≤10 的函数里 **521 个是低报的**。`renderGatePassRateChart` 报 4、实际 15 |
| 2 | `stripNonCode` 不跨行处理块注释 | `return 1` 得 1，加一段含 if/for/while 的注释得 **11**。本仓库 **438 处** |
| 3 | `runLizardOne` 用 `throw` 而非 `reject` | Promise 永久 pending，**挂死**（三席位独立发现） |
| 4 | lizard 对不可读路径返回 exit 0 + 无输出 | 与"零函数"无法区分 → 文件静默消失 |
| 5 | `execFile` 无 `timeout` | "被 kill 就拒绝"的守卫**永远不可能触发** |
| 6 | 二次查找找到 body 时只用于计数，不修正 CCN | 守卫报"0 unverified"而数字没校验过 |
| 7 | `_rescued`/`_spanArtefacts` 只增不报 | "0 未验证"无法与"守卫什么都没看"区分 |
| 8 | 类属性带修饰符（`public readonly x = ...`）找不到 body | 保留未校正数字 |

**其中 1、2、4 推翻了本 sprint 自己此前发布的数字**，已在 `phase-3-summary.md` 和提交信息里标注修正。

## 3. 证伪的假阳性（10 条，均已写探针）

`mapPool` 竞态（死代码，已删）· `BRANCH_RE` 数错 `a ? .5 : c`（实测正确计 2）· `findFunctionBody` 找不到箭头函数（单行/多行均能找到）· `a?.b?.c` 链式误计（实测 1）· `declaresMember` 正则语法错误（能编译、行为正确）· `findFunctionBody` 自身 CCN 超阈值（实测 9）· `docs/*` glob 不递归（10/10 正确）· `source_gate_lib` 无守卫（有 FATAL）· 短函数误 BLOCK（实测 0）· 行内 `/*` 被字符串误开（有引号处理）。

## 4. 共识为什么是 0.33

`emit-walkthrough-result.cjs` 的第一版按"最高置信度"选单个文件——等于把一处的 REQUEST_CHANGES 藏起来。**已改成"任一切片否决即整体否决"**，因为那才是走查本来的含义。改完之后诚实的比例是 0.33。

最后一轮的 critical_issues 逐条复核全部不成立：
- "`locateBodyAtRow` 从未被调用" → 第 295 行在调用
- "版本正则不匹配 `1.21`" → 实测能匹配
- "空 baseline 静默通过" → 实测正确降级为平坦阈值并 BLOCK CCN 20

## 5. 附带发现：门禁自身的三个 bug

push 阶段暴露的，**比走查发现的更严重**：

1. `githooks/AGENTS.md` 写"Code-walkthrough 在 main 分支跳过"，代码里根本没这层判断 → 每个发布提交都推不上去
2. 修完之后，跳过的门禁**同时打印"✅ VERIFIED / Verdict: APPROVED"**——一次没跑却声称通过，且是我一个提交前引入的
3. 文档专属判定只看扩展名 → `githooks/pre-push`（无扩展名）和 `.bats` 被当文档，**执行评审的 hook 把自己豁免了评审**

三个都在同一次 push 序列里发现并修复，各带回归测试。

## 6. 产出物

- `.sprint-state/phase-outputs/feedback-log.md`（命中率、逐条证伪记录）
- `.sprint-history/learnings.md`（5 条 Pattern）
- `githooks/__tests__/issue-mw-main-skip.bats`（7 个用例）
- `githooks/__tests__/issue-docs-only-non-extension.bats`（7 个用例）
- `scripts/__tests__/ccn-report.test.cjs` 扩到 25 个用例
