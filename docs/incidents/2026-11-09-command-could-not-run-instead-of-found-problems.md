# "命令跑不起来"被当成"命令发现了问题" — 四层同源缺陷分析

**Date**: 2026-11-09
**触发**: dsh-aot-runner 的 pre-commit 无法提交任何含 `.js` 的改动
**相关提交**: xp-gate `21c50968`、`4864a1db`、`5d7e52cb`；dsh-aot-runner `f337d5b`

## 问题

dsh-aot-runner 是 C#/Node 混合仓库，测试用 `node --test` + `c8`，**从未依赖 vitest**。
但任何含 `.js` 的提交都被 pre-commit 拦下：

```
Source file(s) changed, finding related tests...
❌ BLOCKED - Tests FAILED in full test suite
 MISSING DEPENDENCY  Cannot find dependency '@vitest/coverage-v8'
```

一项测试都没跑过，却报"测试失败"。

## 根因总览：同一个判据错误，在四层里各存活一次

一句话概括：**一个跑不起来的命令，被当成了跑起来并发现了问题的命令。**

| 层 | 位置 | 错误判据 | 实际后果 |
|---|---|---|---|
| 1 | `githooks/adapters/csharp.sh` | `dotnet format <目录>` 的退出码 | `.sln` + `.csproj` 共存时工具崩溃退出 1，被读成"1 处需要修改"，**格式合规的代码被判质量问题** |
| 2 | `githooks/adapters/typescript.sh` | `npx vitest --version` | 本地没装时 npx **下载并执行**该包，探测恒为真 → 跑了项目不依赖的 vitest |
| 3 | `githooks/pre-commit`（内联 TS 分支） | `run_node_bin vitest ... --version`，其内部回落 `npx` | 第 2 层的缺陷在**上层又活了一遍**，因为 hook 根本不走 adapter |
| 4 | `githooks/pre-commit`（coverage 段） | adapter `return 0` 被读成"测试通过" | 无运行器 → 没有 coverage 报告 → 报 `coverage/coverage-summary.json not found`，**拿不存在的产物去怪没安装的运行器** |

第 1 层是 `dotnet` 崩溃，第 2–4 层是同一条 `npx` 线索的不同层次。

## 每一层是怎么被发现的

| 层 | 发现方式 | 若只看单元测试会怎样 |
|---|---|---|
| 1 | 在真实仓库复现 `dotnet format .` 退出码 1，再对比 `dotnet format <sln>` 退出码 0 | — |
| 2 | `npx vitest --version` 打印 `vitest/5.1.0`，紧接着 `ls node_modules/vitest` 不存在 | **9 个测试全绿，会误判为已修好** |
| 3 | 拿真实的被阻塞仓库跑 hook，报错**一字未变** | 单测仍全绿 |
| 4 | 第 3 层修好后重新跑，报错变成另一条 | 单测仍全绿 |

关键在第 2→3 步：**adapter 层 9 个测试全部通过之后，真实仓库上的报错没有任何变化。**
原因是 xp-gate 自己的 pre-commit 内联了一段 TypeScript 分支，完全不经过 adapter。

## 提炼规律

### 规律一：单元测试全绿不等于缺陷已修

一个缺陷可能同时存在于多个抽象层。测试通过只能证明"我改的那一层对了"，
不能证明"调用链上的行为变了"。

**判定标准**：修复完成 = 触发缺陷的**原始场景**复现通过，而不是"我写的测试通过"。
本轮每一层都靠"回到 dsh-aot-runner 跑一次 hook"推进，而不是靠新增测试的数量。

### 规律二：`<tool> --version` 从来回答不了"是否已安装"

```sh
# 错的
if npx vitest --version >/dev/null 2>&1; then ...
```

`npx` 的语义是"没有就装上再跑"。用它做探测，等于**为了回答问题而改变被问的环境**。

**`--no-install` 救不了它。** 这是本轮最反直觉的一条。直觉上 `--no-install`
就是"不许安装"，应该安全。实测（在完全没有 vitest 的 dsh-aot-runner 里）：

```
$ npx --no-install vitest --version
vitest/5.1.0 win32-x64 node-v24.22.1          # 退出码 0

$ npx --no-install --loglevel=verbose vitest --version | grep fetch
npm http fetch GET 200 https://registry.npmmirror.com/vitest 138ms (cache revalidated)
```

它**仍然联网取了包**，随后落到 npx 缓存
`…/.dsh-npm-cache/_npx/69c381f8ad94b576/node_modules/vitest` 执行。
`npm exec --no` 表现相同。

危险之处在于：缓存一旦由某次误用建立，**之后所有 `--no-install` 探测都会"成功"**，
而且"成功"得更快、更不显眼。基线被污染后，这个缺陷会伪装成"工具已安装"长期潜伏。
这也是为什么 `githooks/adapter-common.sh`、`githooks/lib/toolchain-path.sh` 里
已经在用的 `npx --no-install` 形式**不能算作安全**。

```sh
# 对的：只查项目自己的依赖，项目外的东西不能算
_local_bin() {
  [ -x "node_modules/.bin/$1" ] || return 1
  printf '%s\n' "node_modules/.bin/$1"
}
```

这条与 `AGENTS.md` §`XP_GATE_NPX_PROBE` 一致，但该约定此前只落实在
`src/gates/common-process.ts`（TypeScript 侧），shell adapter 与 hook 都未遵守。

### 规律三：三类状态必须分开，不能压成二值

本轮的每个缺陷都源于把三种情况压成了两种：

| 实际情况 | 错误处理 | 正确处理 |
|---|---|---|
| 工具跑起来了，发现了问题 | FAIL | FAIL |
| 工具跑起来了，没发现问题 | PASS | PASS |
| **工具跑不起来 / 没东西可查** | **PASS 或 FAIL（都错）** | **SKIP + 说明原因** |

第 1 层是"崩溃 → FAIL"，第 2–4 层是"没跑 → PASS 或 FAIL"。
`AGENTS.md` 的「Tool missing → SKIP, not BLOCK（Gate 8 例外）」正是这条，
但实现层面多处没有落地。

### 规律四：SKIP 必须携带"为什么跳过"

`TESTS_SKIPPED=true` 而不说明原因，下一个读者无法区分
"本次提交没有代码改动"与"这台机器没装运行器"。
本轮修复同时输出跳过原因（`No test runner installed locally ...`），
且 hook 靠匹配这句话来决定是否置 `TESTS_SKIPPED` —
**这条消息因此成了契约的一部分，改动它必须同步改测试。**

## 防御措施

| 措施 | 落地位置 |
|---|---|
| 探测不经过 npx，改为只查本地依赖 | `_local_bin` / `run_node_bin --probe` |
| 无运行器 → SKIP，不冒充 PASS/BLOCK | `adapters/typescript.sh`、`pre-commit` 两处调用点 |
| 运行器崩溃（缺依赖）→ 单独报告，不混同测试失败 | `run_coverage` 的 `MISSING DEPENDENCY` 分支 |
| 每条短路必须配"不得被短路"的测试 | 见下 |

| 测试 | 守住的必须是 |
|---|---|
| `adapter-typescript-npx-probe.test.bats`（9） | 探测不达网络 **且** 本地已装的运行器仍能被发现并执行 |
| `issue-784-gate5-npx-probe.test.bats`（6） | `--probe` 不达网络、`--probe` 仍跑本地入口、**不带 `--probe` 的回落行为不变**、调用点确实采用了它 |
| `issue-783-csharp-workspace-ambiguity.bats`（8） | 消歧 `dotnet` 参数 **且** 真实格式违规仍被拦下 |

最后一条尤其重要：防止"修误报"被做成"永久放行"。

## 测试自身的两个陷阱（本轮踩到）

这两个都会让测试**假绿**，比没有测试更危险。

### 陷阱 1：断言"日志为空"

```sh
# 错：harness 本身坏掉时，日志也是空的
if [ -f "$LOG" ]; then grep -E '--version' "$LOG"; [ $? -ne 0 ]; fi
```

第一次写的时候，因为漏了 `source adapter-common.sh`，adapter 所有探测静默失败，
日志始终为空 → 测试通过，但**从未触达被测代码**。

改法：断言日志内容，并**另设一条用例证明 harness 是活的**
（"本地已装的运行器能被发现并执行"就是这条活体证明）。

### 陷阱 2：`export PATH='$WORK/bin:\$PATH'`

写进 `bash -c` 的引号串里，`\$PATH` 在**内层**才展开，如果少了一层转义，
PATH 会被截断成只剩桩目录 —— `mktemp` / `tee` / `grep` 全部 command not found，
被测函数"因为环境坏了"而返回非预期值。

改法：在**外层**把完整 PATH 拼好再传入。

```sh
local stub_path="$WORK/bin:$PATH"      # 外层已展开
run bash -c "export PATH='$stub_path'; ..."
```

### 陷阱 3：按行号提取函数

```sh
# 错：加一段注释就失效
eval "$(sed -n '352,362p' "$HOOK")"

# 对：按名字定位
eval "$(awk '/^if ! declare -F run_node_bin/,/^fi$/' "$HOOK")"
```

本轮第一次运行就撞上：在函数上方补了 5 行注释，测试突然报 `command not found`，
而实现完全正确。**脆弱测试会产生与实现无关的红**，久了就会训练人忽略红。

## 如何尽早发现这类缺陷

1. **`<tool> --version` 是可疑字符串。** 见到就确认：它会不会联网、会不会装东西。
2. **看退出码语义，不看数值。** 问"非零意味着什么"，而非"是不是非零"。
3. **拿到真实失败场景复跑。** 单元测试只是必要条件。
4. **修完后启动一次完整流程**（本轮是 `sh .githooks/pre-commit`），
   报错从"致命"变成"另一个致命"也是进展 —— 说明这一层真的通了。

## 后续修复

本文最初把三处 `npx --no-install` 探测点列为"未验证，不能认为安全"。
后续在干净目录（只有一个空 `package.json`）实测，确认了危害的**准确形态**，
并已全部修掉。

### 实测：`--no-install` 拦得住安装，拦不住联网

```
$ npx --no-install --loglevel=verbose stryker --version
npm http fetch GET 200 https://registry.npmmirror.com/stryker 697ms (cache miss)
npm error npx canceled due to missing packages and no YES option
rc=1
```

与 vitest 那一例的关键区别：

| | 判定 | 联网 | 危害 |
|---|---|---|---|
| vitest（缓存已被污染） | **错**：rc=0 报"已安装" | 是 | 跑了项目不依赖的工具 |
| stryker（干净机器） | 对：rc=1 | 是，697 ms | 每次探测一次请求；离线阻塞到 npm 超时 |

所以 `--no-install` **不是安全写法**，只是**不会安装**。它依然每次都问注册中心，
而这些问题都发生在 pre-commit 里。

### 修复

三处改为只查本地产物（`node_modules/.bin/`），不再经过 npx：

| 位置 | 改法 |
|---|---|
| `adapter-common.sh` `require_tool` | 查 `node_modules/.bin/<tool>` |
| `adapter-common.sh` `detect_mutation_testable` | 查 `node_modules/.bin/stryker` |
| `lib/toolchain-path.sh` `resolve_tool_path` | 直接返回 `node_modules/.bin/<tool>` 的真实路径 |

测试 `issue-785-probe-local-only.test.bats`（5 用例）对每处同时断言
"不碰 npx"与"本地已装的仍能找到"。

**第二条断言不是凑数**：修复前它也是红的，说明原来的 npx 分支确实在承担
`node_modules/.bin` 的检测职责。这项能力只能被**替换**，不能被删掉——
只写"不碰 npx"会得到一个永远返回"未安装"的假修复。

### 连带的测试契约失效（值得记住）

改完 probe 后，`gate-5-runner-error.test.ts` 的 5 个用例报 anti-vacuity 失败：
"桩 npx 跑过，但从没被要求跑 vitest"。

这是**真的红**，不是噪声：该测试的夹具只种了桩 `npx`，靠"hook 会用 npx 探测
vitest"这一前提成立。探测改本地后 Gate 5 正确 SKIP，夹具的前置假设就失效了。

修法是让夹具种出 npm 安装后本该存在的东西——`node_modules/.bin/vitest` 与
`node_modules/vitest/vitest.mjs`——而不是把断言放宽。附带一个易错点：
桩的 `--version` 必须恒返回 0，它与"本次运行的结果码"是两个不同判定，
混用会让探测报"未安装"。

## 机械化防御（Gate 12c，已落地）

前面每一处修复靠的都是"记得不要这么写"。这一条把它变成机器守的规则。

`scripts/check-no-npx-probe.sh` 扫描 hooks 全部 51 个源文件，任何
`npx … --version` 形式的探测都会被拦下并给出改法。`npx --no-install`
一并禁止——它拦住的是**安装**，不是**注册中心查询**。

唯一白名单是 `githooks/lib/toolchain-path.sh`，因为它持有
`XP_GATE_NPX_PROBE` 这个显式 opt-in。**而且"有 opt-in"这件事本身也被断言**：
只把文件加白、把 guard 删掉，洞会原样重开，所以脚本还会检查那条 npx
是否处在 `probe_npx_enabled` 条件之内。

接入两处：CI 的 `cross-platform-ci.yml`，以及 `pre-commit` 的新 Gate 12c。
Gate 12c 只在提交触及 hook 源文件时运行——这条规则只可能被改 hook 破坏，
每次改文档都扫 51 个文件正是输入短路约定要避免的固定开销。

### 写这个检查时踩到的坑（比缺陷本身更值得记）

第一版用 `grep -vE ':[[:space:]]*#'` 过滤注释行。这个正则会**把代码行也滤掉**，
于是注入的 `if npx vitest --version; then` 被判为干净。

**一个在缺陷存在时通不过的检查，比没有检查更糟**——它给出"已验证"的假象。
后来逐行解析：只截断行尾注释，再判断同一语句里是否同时出现 `npx` 与
`--version`。

第二个坑是性能：每行调用两次子进程 `grep`，16450 行 × 2 在 Windows 上跑了
五分钟以上（直接超时）。换成 bash 内建匹配后 8 秒。

`check-no-npx-probe.test.bats`（7 用例）正反面都验——这是它区别于
"永远返回失败"的关键：

| 用例 | 断言 |
|---|---|
| 干净树 | 必须通过（否则上面几条可以被一个永远失败的检查满足） |
| adapter 里的裸 npx 探测 | 必须抓到 |
| `--no-install` 形态 | 必须抓到 |
| `pre-commit` 自身的探测 | 必须抓到 |
| 注释里的说明 | 不得误报 |
| 删掉 opt-in guard | 必须抓到 |
| 带 guard 的 opt-in | 必须放行 |

## 缓存污染（已清理）

npx 缓存 `…/_npx/69c381f8ad94b576/` 里的 vitest 5.1.0 是误用留下的，已删除。
清理只恢复本机判定的准确性——**缺陷的根因由上面的静态检查守**。

清理前后对比（在 dsh-aot-runner，该项目没有 vitest）：

```
清理前： npx --no-install vitest --version  →  vitest/5.1.0   rc=0  ← 错的
清理后： npx --no-install vitest --version  →  canceled ... missing packages   rc=1
```

注意清理后它**仍然联网查了一次**才得出 rc=1。这正是"为什么不能靠 npx 探测"的
现场证据：判定正确了，代价还在。
