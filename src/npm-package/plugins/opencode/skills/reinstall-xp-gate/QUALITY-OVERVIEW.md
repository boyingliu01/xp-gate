# reinstall-xp-gate 质量全视图

实测时间：2026-11-24 00:05　版本：v2.0.1
工作区：干净　CI：node 22/24/26 + complexity + mutation 全绿

---

## 一、门禁总览（19 个）

| # | 门禁 | 结果 | 实测依据 | 备注 |
|---|---|---|---|---|
| 0 | 版本一致性 | ✅ PASS | VERSION=package.json=2.0.0 | pre-commit 路径实测 |
| 1 | 代码质量 | ✅ PASS | adapter lint 通过 | pre-commit 路径 |
| 2 | 重复代码 | ✅ **0 clones** | jscpd 29→41 文件 | CLI 实测可跑 |
| 3 | 圈复杂度 | ✅ PASS | 暂存 `.mjs` 后实测 PASSED | 干净树上的 SKIPPED 是「无变更」，见 §四 |
| 4 | 整洁代码+SOLID | ✅ **0 ERROR** | 49 INFO / 21 WARNING | 明细见 §三 |
| 5 | 测试+覆盖率 | ✅ **92.59%** | floor 80% | pre-commit 路径 |
| 6 | 架构+Boy Scout | ⏭️ SKIP | `.architecture-skip` | 已声明豁免，见 §四 |
| 7 | IaC 安全 | ✅ PASS | 无 IaC 文件 | — |
| 8 | 密钥扫描 | ✅ PASS | gitleaks：no leaks | 427KB 扫完 |
| 9 | 构建完整性 | ⏭️ SKIP | 无构建产物 | 纯脚本项目，合理 |
| 10 | SAST | ✅ **0 findings** | semgrep --config=auto | 修掉 1 条，见 §五 |
| 11 | Sprint Flow | ⏭️ SKIP | 无 `.sprint-state/` | 未用 sprint 流程 |
| 12 | 文件卫生 | ✅ PASS | 真实 hook 实测 | 需 `LC_ALL=C`，见 §四 |
| 12b | 镜像一致性 | ⏭️ SKIP | 无 staged 对 | — |
| 12c | 探针纪律 | ⏭️ SKIP | 无 staged 对 | — |
| 13 | 编译器严格度 | ⏭️ SKIP | 无 tsconfig/eslint | 无声明检查器 |
| M | 变异测试 | ✅ **19/19** | 全部被捕获 | `npm run mutation` |
| MW | Code Walkthrough | ✅ PASS | pre-push 实测 | — |
| S | prepush-sprint | ⏭️ SKIP | 无 sprint | — |

**判定：0 FAIL。** 5 个硬核门禁（2/4/8/10/M）全部满足。

---

## 二、核心指标

| 指标 | 实测 | 阈值 | 余量 |
|---|---|---|---|
| 测试 | **242 / 242 通过** | 全通过 | — |
| 行覆盖 | **93.80%** | 80% | +13.80 |
| 函数复杂度 | **792 个全 ≤ CCN 5** | 5 | 0 超标 |
| 变异测试 | **19 / 19 捕获** | 全捕获 | 0 遗漏 |
| 重复代码 | **0 clones**（3940 行 / 24954 token） | — | — |
| SAST | **0 findings** | 0 | — |
| 密钥 | **0 leaks** | 0 | — |
| 语法错误 | **0**（41 文件） | 0 | — |
| CRLF 文件 | **0** | — | autocrlf=input |
| 跟踪的运行时产物 | **0** | — | `.xp-gate/` 已忽略 |

---

## 三、技术债全貌（17 WARNING / 49 INFO）

### 3.1 模块导出过多（**0 条 · 已清零**）

上一版是 4 条（`proc` 20 / `tools` 18 / `util` 13 / `agents` 11）。本轮按**职责**拆分，
不是按数字凑数：

| 原模块 | 拆出 | 剩余职责 |
|---|---|---|
| `proc.mjs` | `platform.mjs`（平台事实）、`spawn.mjs`（子进程）、`xp-cli.mjs`（定位并调用 xp-gate） | 统一导入面 |
| `util.mjs` | `fs-tree.mjs`（树遍历）、`json-file.mjs`（JSON/时间戳）、`backups.mjs`（保留策略） | 统一导入面 |
| `tools.mjs` | `version.mjs`（纯版本运算）、`probes.mjs`（各生态查询） | 报告编排 |
| `agents.mjs` | `agent-paths.mjs`（标签、根、相对 HOME 的路径） | 活性探测与发现 |

四个原模块**仍是导入面**（re-export），所以没有任何一处 import 语句被改动。
`tests/proc-contract.test.mjs` 钉住 `proc.mjs` 的 20 个导出名 ——
重构会移动实现，若某个调用方悄悄丢了一个符号，否则只会在运行时才发现。

### 3.2 缺错误处理（17 条 · **判定为误报**）

`run`/`probe`/`copyTree`/`writeJson` 等全部被点名。**逐条核实过调用方**：

- `run()` 是 `spawnSync` 薄封装，**所有调用方都用 `r.status !== 0` 判断**
  （`proc.mjs:49/169/207/242/246`、`tools.mjs:37/260`、`gatecheck.mjs:125`）；
- 加 try/catch 反而会把"命令失败"伪装成"命令成功"。

Gate 4 只做模式匹配，看不懂这个契约。**不建议改**。

### 3.3 魔数（49 条 · 混合）

- **已命名 10 处**（`PROBE_TIMEOUT_MS` / `XP_GATE_SLOW_OP_TIMEOUT_MS` /
  `PACKAGE_INSTALL_TIMEOUT_MS` / `VERIFY_TIMEOUT_MS`），从 58 降到 49；
- 剩余大多是 `timeout:` 旁的毫秒值，字段名已表达语义；
- **刻意没合并** 4 处 `30000`：语义各异（node --check / npm root / npm view / pip show），
  合并会制造假 DRY。

---

## 四、门禁无法覆盖的部分（诚实声明）

**Gate 3 的 `SKIPPED` 是「改动集为空」，不是「看不见 .mjs」——此处更正我先前的错误结论。**

我此前声称「上游 `LIZARD_EXTENSIONS` 不含 `mjs`，Gate 3 对本项目整棵树视而不见」。**这是错的**，
本轮做了对照实验证伪：

| 实验 | 结果 |
|---|---|
| 工作区干净时 `xp-gate check 3` | `SKIPPED - no source files to check`（因为没有变更文件） |
| 暂存一个 `.mjs` 后 `xp-gate check 3` | ✅ `PASSED - All functions within complexity threshold (5)` |
| 独立 fixture，只放一个超标 `.mjs` | ❌ `BLOCKED - 1 functions with CCN > 5` |

结论：Gate 3 **确实检查 `.mjs`**。干净树上的 `SKIPPED` 是正确的「无变更可查」语义，
不是缺陷，也不该据此给上游提 issue（已确认未提）。

不过本项目仍然保留 `npm run hp-gate` 作为独立兜底：它不依赖变更集，
是全量扫描（53 文件，792 函数，同 CCN 5 阈值），比按变更集抽查更严格。
两者分工是「Gate 3 防增量回归，hp-gate 防存量」，不是「Gate 3 坏了」。

**Gate 6 的跳过是已声明的**，不是悄悄放过。`.architecture-skip` 写明理由：
本项目是可移植 skill，`scripts/lib/` 是平铺辅助模块，无分层可约束。

**Gate 12 需 `LC_ALL=C`。** 上游 `gate-12-blob-scan.awk` 混用字节数与字符数
（`length($0)` 在 UTF-8 下返回字符数），**任何含中文的文件都会被误报缺 EOF 换行**。
已隔离复现、已记录待提 issue。当前用 `LC_ALL=C git commit` 规避。

---

## 四点五、本轮修复中最重要的一条：门禁曾自己吃掉 8 个变异体

重构 `util.mjs` 拆成 `fs-tree.mjs`、`cmpVersion` 移到 `version.mjs` 之后，
变异测试报出：

```
11/19 mutations killed
8 skipped (stale anchor -- update the mutation)
每一条被变异的缺陷都被捕获          ← 同时打印这句，且退出码 0
```

**8 个属性检查静默消失了，而门禁看起来比之前更健康。** 这与本项目存在的理由直接冲突：
它的职责就是发现「门禁通过了但其实什么都没测」。

两处一起修：

1. **数据**：变异表抽到 `scripts/lib/mutations.mjs`，**可被 import**（原脚本有顶层副作用，
   无法测试）。新增 `tests/mutation-anchors.test.mjs`：锚点或目标文件消失即失败。
2. **门禁**：`skipped` 现在退出 1，且不再打印「every mutated defect was caught」。

验证方式是**故意植入一个假锚点**，确认退出码变成 1、输出明确指明「skipped 不等于通过」。
恢复后 19/19 全捕获、0 skip。

---

## 五、本次发版做的事

**发版**：`v2.0.0` 已打 tag + GitHub Release。
破坏性变更：skill 与仓库改名 `xp-gate-reinstall` → `reinstall-xp-gate`。

**清理**：
- 删除 Gate 12 复现用的 4 个临时仓库；
- 删除 184 个 `/tmp/gate7-*` 门禁运行残留；
- 删除临时脚本与备份；确认无已合并分支残留。

**检查中发现并修掉 1 个自己引入的问题**：
SAST 报 `residue.mjs:174` 用变量构造 `RegExp`。无注入风险（名字是内部常量），
但改为按字段精确比较，更快且避免每轮都需压制告警。行为由新测试锁定
（`name: reinstall-xp-gate-fork` 不会被误删）。

---

## 六、外部质量

| 项 | 状态 |
|---|---|
| Open issues | **1**（#4，有意保留） |
| Closed | #1 #2 #3 #5 |
| CI | 全绿 |
| Release | v2.0.1 已发布 |

**#4 为何仍开**：本机不复现（OpenCode 靠 CLI 证据判活，判定正确），但 `idleDays()`
读目录 mtime 的缺陷机制**未改**，实测仅 5 天——CLI 一消失就会误判。
按"不复现就关闭"处理等于掩盖问题，已在 issue 内附实测证据与收口建议。
