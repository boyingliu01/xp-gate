# 门禁输入短路：P0-A / P0-B 落地与实测

- 日期：2026-11-09
- 承接：`docs/plans/2026-11-09-handoff-from-llm-wiki-session.md` §2 P0-A / P0-B、§6 接手顺序
- 对应需求：`REQ-GATE-PROBE-SHORTCUT`（`AC-GATE-PROBE-01..05`）
- 状态：**已实现并验证**；P0-C（探测缓存）经实测判定**不需要**

---

## 0. 一句话

交接文档要求的「先做 P0-A + P0-B，实测收益，再决定是否需要 P0-C」已按顺序走完。
**P0-C 不需要**：改动后剩余耗时的大头是 tsx 进程启动（约 650 ms）与环境自检，
不是工具探测——缓存能省的那部分已经不存在了。

---

## 1. 做了什么

### 1.1 P0-A 输入短路

| 门禁 | 缺陷（交接文档判定） | 修复 | 文件 |
|---|---|---|---|
| gate-9 (SAST) | 先 `isToolAvailable('semgrep')` 探测，后 `filterSemgrepFiles` 判断 | 把过滤提到探测之前 | `src/gates/gate-9.ts` |
| python-health | 无条件探测 mypy/pytest/ruff/flake8/black，与项目有无 `.py` 无关 | 新增 `hasPythonSignal()`，无信号则不探测 | `src/gates/python-health.ts` |

**一个刻意的设计细节**：不探测时，`tools` 数组**条目照旧全部列出**，只是 `available: false`。
但 `available: false` 与「探测过、确实没装」在数据结构上无法区分，会诱导消费者
把它读成「该工具没装」。因此新增 `toolProbesRan: boolean` 显式区分这两种状态，
并在 CLI 输出里打印 `skipped` 而不是 `not installed`。

这不只是措辞问题：本项目的整套政策都建立在「工具缺失 → SKIP 而非 BLOCK」之上，
而「没探测」与「没安装」被混为一谈时，一个从未探测过的工具会被当成一个确实存在但不达标的
工具来汇报——这正是本项目反复出现的缺陷主轴（见 `REQ-GATE-INTEGRITY`）。

**关于 gate-7（IaC）：交接文档的说法不成立。**
文档称「已能检测无 IaC 文件，但在启动工具之后才判断」。实际代码
（`src/gates/gate-7.ts:22-24`）**已经是先过滤后探测**：

```ts
const iacFiles = filterIaCFiles(input.changedFiles);   // 第 22 行，先判断
if (iacFiles.length === 0) { ...PASSED...; return; }   // 第 24 行
...
const checkov = isToolAvailable('checkov', cwd);       // 第 37 行，后探测
```

**因此 gate-7 未改动。** 记录在案，避免下一个人按文档去「修」一个没坏的地方。

### 1.2 P0-B npx 探测默认关闭

`probeToolNpx` 用 `npx --yes <tool> --version` 回答「工具在不在」——`--yes` 意味着
**不问直接下载安装**。现在默认不执行，只有 `XP_GATE_NPX_PROBE=1`（也接受 `true`/`yes`）才启用。

评审要求比「默认关」更彻底：**默认路径上不产生任何 spawn**，并有测试断言
（`AC-GATE-PROBE-05`：未设置时 `spawnSync` 的 command 不得为 npx）。

### 1.3 防「短路过头」

交接文档的硬性要求——每条短路必须配「必须不被短路」的用例——已全部落地：

| 短路条件 | 必须不被短路的用例 |
|---|---|
| 无 semgrep 支持文件 | 14 种受支持扩展名逐个验证 semgrep **确实被调用**；200 个无关文件 + 1 个 `.ts` 仍必须扫描 |
| 无 Python 信号 | 仅 `pyproject.toml`（无 `.py`）时仍必须做完整工具探测；6 种标记文件逐个验证 |

---

## 2. 实测（ABBA 配对，本地盘）

### 2.1 方法学

按 `~/.dsh/AGENTS.md` 六条硬规则，以及交接文档 §3 的测量目录警告：

- **调用契约先读源码**：`src/npm-package/lib/gate-runner.js` 的 `resolveTsxInvocation()`
  实际用 `node <node_modules/tsx/dist/cli.mjs> <gate.ts> --run --cwd <dir>`。
  直接跑 `dist/gates/*.js` 会抛 `ERR_MODULE_NOT_FOUND`（package.json 是 `"type":"module"`，
  tsc 输出的 import 无扩展名）——**tsx 在这里不是优化，是真实加载器**。
- **配对而不是跨轮比较**：本机负载在 20%–80% 之间摆动，先跑的 baseline 那次负载 28%、
  后跑的 after 那次 49%，跨轮直接比会得出反向结论。改为把 HEAD 版源码复制到
  `.perf-measure/baseline-src/`，**在同一轮内 ABBA 交替**跑新旧实现。
- **记录每轮负载**，负载差 >5% 的对比判定无效（规则 6）。
- 测量目录用本地盘（`D:\projects\xp-gate\.perf-measure\fixture-no-input`），不用 `/tmp`。

复现：`node .perf-measure/paired-ab.cjs 12`

### 2.2 结果（12 轮 ABBA，负载校验通过）

| 门禁 | 改前 | 改后 | 变化 | 负载 A / B |
|---|---:|---:|---:|---|
| gate-9 | 789 ms | **624 ms** | **−21.0%** | 37.5% / 36.9% ✅ |
| python-health | 3802 ms | **1607 ms** | **−57.7%** | 39.6% / 37.8% ✅ |

两者**判定完全一致**（gate-9 均为 `SKIPPED - SAST (no supported language files changed)`），
即：变快没有改变任何结论。这正是设计的语义边界——加速「已经正确的判断」。

首次用 6 轮测时负载差 9.9% / 28.7%，按规则 6 判定**无效**，未采信；加到 12 轮后收敛。

**可重复性**：同一天在机器更繁忙的时段重跑 12 轮，得 −20.7% / −58.3%（gate-9 那次负载差
6.8%，按规则 6 判为无效，仅作方向佐证）；四次测量的效应量级一致（gate-9 约 −21%，
python-health 约 −58%），方向从未反过来。

### 2.3 剩余时间去哪了（决定 P0-C 的依据）

| 项 | 耗时 | 能否被缓存消除 |
|---|---:|---|
| tsx 进程启动（空跑 `tsx -e "0"`） | ~650 ms | 否（每次门禁调用都要付） |
| gate-9 剩余 | 624 ms | — **几乎全是启动开销** |
| python-health：`where` × 3 个候选 | ~443 ms | 否（这是「Python 装没装」本身） |
| python-health：`python --version` | 67 ms | 否 |
| python-health：`pip --version` | 502 ms | 否 |
| python-health 剩余合计 | ~1660 ms | — 与实测 1607 ms 吻合 |

**被消除的是**：5 个 linter 探测（547+550+291+807+394 = **约 2.6 s**），以及 gate-9 的探测。

### 2.4 结论：P0-C 探测缓存**不做**

评审（architecture 席位）的核心批评是：

> 缓存是新的跨进程状态存储，有自己的失效模式……用「顺序调整」和「默认关闭」就能解决。
> **Layer 1 + Layer 3 很可能独力达成目标，根本不需要引入持久化缓存。**

实测支持这个判断，且比它更强：**剩余耗时里已经没有任何「工具探测」项可以被缓存命中**。
缓存能命中的只有 `where`/`--version` 这类环境自检，而它们：

1. 占比小（每次门禁约 1–1.1 s，且分散在必须执行的环境自检里）；
2. 一旦缓存错误（工具被卸载/shim 切换），会把「诚实的环境失败」变成更难诊断的状态。

为这点收益引入一个需要处理「TTL / PATH 哈希 / 并发写 / 缓存失效后重探」的跨进程状态存储，
**收益小于它自身的失效风险**。若将来启动开销被解决、探测重新成为主要成本，再重新评估
`docs/plans/2026-11-07-tool-probe-cache-design.md`（该文档的评审意见仍然有效）。

**下一步真正的收益在别处**：tsx 启动约 650 ms/门禁调用，是现在最大的单点。

### 2.5 一个必须说清的适用范围

**python-health 的短路判据是「整个项目」，不是「本次改动」。** 这是刻意的：
python-health 报的是**环境健康**而不是扫描具体文件，「这个项目有没有 Python 工具链需要
检查」才是它该回答的问题。

后果：**本仓库自己不短路**。xp-gate 有 10 个受跟踪的 `.py`
（`tests/conftest.py`、`githooks/lib/prepush-score.py` 等），本身就是个 Python 项目，
所以仍然做完整探测。**上面的 −57.7% 是在「纯 TypeScript 消费方项目」上测得的**——
这正是交接文档描述的典型受害者场景（「项目里一个 Python 文件都没有」）。

这是正确行为而非遗漏：把判据改成「本次改动里没有 `.py`」会制造
「声称检查了实际没检查」，而那正是本项目最严重的一类缺陷。
`.delphi-work/` 这类被 gitignore 的临时目录不会误触发（遍历跳过任何点目录）。

---

## 3. 验证记录

| 检查 | 命令 | 结果 |
|---|---|---|
| 定向测试 | `vitest run src/gates/__tests__/` | **128 passed**（原 94 + 新增 34） |
| 新需求测试 | `vitest run src/gates/__tests__/gate-probe-shortcut.test.ts` | **34 passed**（先 RED：13 failed / 20 passed） |
| 端到端（真实 CLI） | `tsx src/gates/python-health.ts --run --cwd <no-python fixture>` | 5 个工具显示 `skipped`，exit 0 |
| 端到端（反方向） | 同上，fixture 仅含 `pyproject.toml` | 5 个工具**全部被探测**且报出真实版本 |
| 端到端（gate-9） | `tsx src/gates/gate-9.ts --run --cwd <no-source fixture>` | 立即 SKIP，无探测 |
| 类型检查 | `tsc --noEmit` | exit 0 |
| ESLint | `eslint <改动文件>` | exit 0 |
| AC 引用守护 | `vitest run scripts/__tests__/ac-reference-guard.test.cjs` | 3 passed |
| 规格 YAML 合法性 | `js-yaml` 解析 `specification.yaml` | 188 requirements，新 REQ 解析正确 |

**测试顺序**：先登记 `REQ-GATE-PROBE-SHORTCUT` + 5 条 AC（否则 `ac-reference-guard` 会红），
再写测试并确认 RED（13/33 失败），最后实现。符合仓库的 TDD 强制约定。

### 3.1 被改动影响的既有测试（已修正）

两处 `mockReturnValueOnce` 队列错位，**不是回归而是队列泄漏**：

1. `gate-9.test.ts` 的「SKIPs when no supported language files changed」原本预置了一个
   「semgrep found」返回值。顺序修复后探测不再发生，该返回值**永不被消费**，于是顺延
   污染后续每一个用例。改成断言「一次 spawn 都没有」——这反而是更强的断言。
2. `common.test.ts` 的「returns available=false」原本预置 **2 个**失败返回值（PATH + npx）。
   npx 默认关后只有 1 次 spawn，同样泄漏一个。改为只预置 1 个并断言 `toHaveBeenCalledTimes(1)`。

两处都先用 `git stash` 验证过「在我改动之前是绿的」，确认是改动引起、且属于预期内的契约变化。

---

## 4. 环境变量

| 变量 | 作用 | 默认 |
|---|---|---|
| `XP_GATE_NPX_PROBE` | 是否允许经 npx 回退探测工具（**会下载安装包**） | 未设置 = 关闭 |

---

## 5. 未做的事（明确记录）

- **P0-C 探测缓存**：见 §2.4，实测判定不需要。
- **gate-7**：交接文档判断有误，代码本来就是对的，未改。
- **P1 镜像治理**（903 文件 / 131,250 行）与 **P2 未验证项**：本轮未触及。
  其中一项已顺手确认（见 §6），其余值得排期。

---

## 6. 顺手确认的一个 P2 事实

交接文档 §2 P2 列了「`check-hook-mirror.sh` 是否跑在 CI — 需确认」。**已确认：跑了。**

```yaml
# .github/workflows/cross-platform-ci.yml
  mirror-parity:                                   # line 314
      - run: bash scripts/check-build-integrity-mirror.sh   # 338
      - run: bash scripts/check-delphi-runner-mirror.sh     # 339
      - run: bash scripts/check-hook-mirror.sh              # 340
```

它在 `mirror-parity` job 里，与另外两个镜像守卫并列。这条不需要再验证了。

