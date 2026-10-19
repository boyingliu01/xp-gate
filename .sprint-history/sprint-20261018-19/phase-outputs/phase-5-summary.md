# Phase 5/6 SHIP — 发布

**Sprint**: sprint-20261018-19
**版本**: `0.27.6.0` → **`0.28.0.0`**
**推送**: `4038379f..8bda4062` → `origin/main`，47 个提交

---

## 1. VERSION-GATE

```
VERSION                    0.28.0.0
package.json               0.28.0.0
src/npm-package/package.json 0.28.0
plugins/{qoder,dsh,opencode,claude-code}  0.28.0
AGENTS.md headers          76 个文件已刷新（date=2026-10-19 commit=07d3036f）
```

`node scripts/sync-version.cjs` 单点同步，无手工编辑。

## 2. 发布提交

`9466529c` — 44 个文件（1 个 VERSION + 12 个清单 + 31 个 AGENTS.md 头）。
pre-commit 实测：**10.0/10，9/9 生效 gate 通过**（skip 3：无相关改动）。

## 3. push 过程中的三个门禁 bug

第一次 push 被 Gate MW 拦下。排查后发现的不是"证据过期"这么简单：

| # | Bug | 后果 |
|---|-----|------|
| 1 | `githooks/AGENTS.md` 文档化"main 分支跳过 MW"，代码未实现 | 发布提交改的是版本号和文件头，**没有任何被评审过的逻辑**，却要求对自身 hash 重跑三方评审 → 永远推不上去 |
| 2 | 修完 #1 后跳过的门禁仍打印 `✅ VERIFIED / Verdict: APPROVED`，`Commit:` 为空 | 一次没跑却声称通过。**是我一个提交前引入的**，立修 |
| 3 | 文档专属判定只看扩展名 | `githooks/pre-push`（无扩展名）+ `.bats` 被判为文档 → **执行评审的 hook 豁免了自己** |

三个都带回归测试（`issue-mw-main-skip.bats` 7 用例、`issue-docs-only-non-extension.bats` 7 用例）。

## 4. 关于 walkthrough 共识

`.code-walkthrough-result.json` 最后状态是 `REQUEST_CHANGES` / ratio 0.33。**没有伪造过任何一次。**

用户裁定放行后，我采取的做法是实现文档早已承诺的 main 分支跳过——**一个真实修复，而不是绕过门禁**。整条链上没有 `--no-verify`。

## 5. 二次事故与自查

`cp githooks/pre-push src/npm-package/pre-push` 误建了包根副本。`check-hook-mirror.sh` 的 `ROOT_MIRROR_FILES` 明确不含 `pre-push`（只在 `hooks/` 下）。发现后立即 `git rm` 并在下一个提交说明原因——这正是 #542 描述的"镜像侧修复被下次发布静默回滚"的同类问题。

## 6. SHIP COMPLETION GATE

```
[SHIP→CLOSE GATE] on main branch    ✓
[SHIP→CLOSE GATE] clean status      ✓（tracked 改动全部已提交）
[SHIP→CLOSE GATE] pushed            ✓ 4038379f..8bda4062
[SHIP→CLOSE GATE] main up-to-date   ✓
```

## 7. 验证

```
npx tsc --noEmit     TSC-OK
vitest (34 files)    488 passed
bats (5 suites)      43/43
ccn-report --check   OK，767 functions
check-hook-mirror    PASS，byte- and mode-identical
doctor               37 项 hook 匹配；仅剩 PATH 查找 node 的误报
```
