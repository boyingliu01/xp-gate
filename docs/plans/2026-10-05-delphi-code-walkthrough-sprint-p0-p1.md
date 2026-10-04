# Delphi Code-Walkthrough 评审记录 — sprint/2026-10-03-p0-p1-gates

日期：2026-10-05 · 模式：`code-walkthrough` · 席位：g-glm-5.3-flash / g-qwen3.8-flash / g-deepseek-flash

## 结论

**未达 ≥90% 共识。** 最后一轮 2/3 APPROVED（architecture conf=7、technical conf=9、feasibility REQUEST_CHANGES conf=6）。

关键事实：**每一轮提出的真实缺陷都被修掉了**，共 8 个。剩余分歧集中在两类——「prompt 预算截断导致的不可审计」与「已被驳回/属既有设计属性」。

## 评审驱动的修复（按提出轮次）

| 轮 | 发现 | 处置 | commit |
|---|---|---|---|
| R5 | Gate 4 `if run_tsx; then` 把 exit 1（真实 error 违规）与 exit 2（工具故障）混为一谈，error 级违规走 SKIP 分支并打印 PASSED | 引入 0/1/2 三态退出码，四份 gate-4 全部改为 `-ge 2` 分支 | `040b796` |
| R7 | `mergeConfig` 只对 `rules` 深合并，`output`/`performance` 浅合并会丢兄弟默认值 | 新增 `mergeSection` | `ed0629c` |
| R7 | `git ls-files` 有 `maxBuffer` 无 `timeout`，卡死的 git 会挂住 pre-commit hook | 加 30s 上限；索引不可读时显式报错而非伪装成「无过期条目」 | `29554a1` |
| R9 | `isEntryStale` 有一行重复守卫（两个席位独立指出）；exit-code 新分支无任何测试守护 | 删重复行；补 5 个 BATS（对修复前代码 3/5 红，修复后 5/5 绿） | `87924a1` |
| R10 | 用法错误仍 `return 1`：空输出 + exit 1 被门禁读成「检查通过、零违规」，等于门禁空转 | 改为 exit 2；同步更新断言旧值的 `index.test.ts` | `13eb22e` |
| R10 | `$PRINCIPLES_FILES` 未加引号：含空格路径被拆成 3 个不存在的路径，Gate 4 打印 PASSED | 改用数组展开（同 `adapters/powershell.sh` 既有做法），实测 3→1 | `13eb22e` |

R5 那条是本轮评审最有价值的产出：它是上一个修复自身引入的漏洞，静态审查没看出来，交叉评审看出来了。

## 已驳回（附证据）

| 编号 | 主张 | 驳回依据 |
|---|---|---|
| FC-03 | `--apply` 会无条件清空 baseline | `boy-scout.ts:607` 的写入在显式 `--apply` 之后，默认 dry-run |
| FC-06(R7) | `isRuleEnabled` 首字母切分会误判 | 15 个 rule ID 均只含一个点，两个 group 名都存在；拼错的键实测无法禁用真实规则 |
| FC-08 | 256MiB `maxBuffer` 会 OOM | `maxBuffer` 是截断上限非预分配；实测 112KB 输出 → 堆增量 241KB |
| MC-03 | exit≥2 走 SKIP 使门禁「无告警地长期静默失效」 | 前提部分成立（126/127 确实归入 SKIP），但「无痕迹」不成立：`gate-4.sh:126` 已将 status 写入 audit 日志。且该 fail-open 是**全仓既有约定**——`gate-8.ts:73`、`gate-9.ts:65` 对任意非零退出都 SKIP，比本改动更宽松。建议的「SKIP 聚合监控」属功能请求，另案处理 |
| FC-06(R11) | `requested_model` 区分大小写而 `resolved_model` 不区分，不对称 | 这个不对称正是规范本身：AGENTS.md:203 原文为 "distinct trimmed requested model IDs" |
| FC-05 | DSH 插件 `delphi-run.ts` 作为第二个 producer 不写 `channel`，会被新校验拒绝 | 该文件全文无 `writeFile`，注释明确说只「整理成可写成证据的数据」；唯一写盘者是 `scripts/delphi-external-review.cjs`，它写 `channel` |

## Prompt 工程教训（影响结论可信度，需如实记录）

三个席位都是推理模型，在本机存在 prompt 体积上限：实测 `g-glm-5.3-flash` 40KB 成功（225s）、50KB 崩溃（305s，`0xC0000409` + libuv `UV_HANDLE_CLOSING` 断言，表现为 "Network error."）。

由此产生两类噪声，**都不是代码缺陷，而是我构造 prompt 的方式造成的**：

1. 早期把整份 240KB diff 塞进去 → 席位直接崩溃，误判为「模型不可用」。
2. 后期压缩到 25KB → 核心 hunk 被截断，席位花整轮报告「无法审计」。R10 尤其典型：架构席位预算 42KB，而按文件路径排序恰好把三份 gate-4 脚本（最重要的文件）切在了边界之外，它的抱怨是**准确的**。

修正：按重要性排序 + 每席位独立预算 + 显式列出任何因体积省略的文件。R11 三个席位全部正常完成。

## 待办

- 共识未达标，不得推送。要么继续迭代，要么由用户裁定是否以现有 2/3 + 全部真实缺陷已闭环为依据放行。
- `channel` 不变量目前仅靠约定维持（无测试防止未来 producer 漏写），值得补一条断言。
- SKIP 聚合监控（MC-03 建议）另开 issue。
