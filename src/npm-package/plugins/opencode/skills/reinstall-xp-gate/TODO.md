# TODO — WSL 迁移后状态

最近更新：2026-11-23（WSL2 + Ubuntu 22.04 环境首次全量验证）
上一版：2026-11-22（Windows 11 环境遗留事项）

读完这份文档就能接着干活。每条都标了「是否已验证」——**没验证的不要当成结论**。

---

## 迁移后基线（2026-11-23 实测，WSL2 + Node 26.13.1 + xp-gate 0.38.125）

| 指标 | 迁移前（Windows） | 迁移后（WSL 首次） | 本次修复后 | 门槛 |
|---|---|---|---|---|
| 测试数 | 196 | 196 | **215** | — |
| 项目行覆盖 | 90.66% | 89.91% | **92.60%** | 80% |
| `gatecheck.mjs` | 70.34% | 70.34% | **94.14%** | — |
| `proc.mjs` | 75.23% | **64.68%** ↓ | **78.57%** | — |
| 最差文件 | `coverage.mjs` 67.86% | 同 | 同 | 80% |
| 函数复杂度 | 707 个全部 ≤ CCN 5 | 686 全合规 | **735 全合规** | 5 |
| 变异测试 | 19/19 | 19/19 | 19/19 | 全捕获 |
| 重复代码 | 0 clones | 0 clones | 0 clones | — |
| `xp-gate check . --all` | — | 10 passed / 9 skipped | 10 passed / 9 skipped | — |
| Gate 4 违规 | 78 条（58 INFO + 14 WARNING 等） | 21 WARNING | 21 WARNING（无新增） | — |

**注意 `proc.mjs` 那行**：迁移后覆盖率从 75.23% **掉到** 64.68%，这不是环境波动，是确定的回归——
Windows 分支在 Linux 上根本走不到。这正是 TODO-3 要解决的问题，见下文。

---

## 本次已完成

### ✅ 环境搭建（WSL2）

- Node 26.13.1（nvm，`~/.npm-global/bin/node` 软链）、npm 11.20.0。
- xp-gate 0.38.125，Linux native 路径 `/home/bull/.npm-global/bin/xp-gate`。
- 所有门禁工具均在 Linux 侧解析（逐一 `which -a` 确认首条不是 `/mnt/c`）：
  `jscpd` `lizard` `checkov` `hadolint` `gitleaks` `semgrep` `jq`。
- 仓库在 Linux 原生路径，`git config core.autocrlf input`，无 CRLF 文件。

**修复了两个真实的 Windows→WSL 残留问题：**

1. `~/.zshrc:107` 硬编码了约 62 条 `/mnt/c` 的 Windows PATH 快照。`.bashrc` / `.profile`
   已有 `__xp_gate_strip_mnt` 守卫，`.zshrc` 漏了。已替换为同样的守卫逻辑
   （`path=(${path:#/mnt/*})`）。现新开 zsh 的 `PATH` 中 `/mnt` 条目为 0。
   *症状本该是*：Windows shim 能被解析但执行失败（rc=126），门禁 probe 假通过。

2. **semgrep 完全不可用**（不是慢，是坏的），两个独立故障叠加：
   - ocaml 主程序 `execvp pysemgrep` 找不到 —— `pysemgrep` 在 `~/.local/bin`，
     而 ocaml 靠 PATH 查找。
   - `pysemgrep` 加载到系统旧版 `zope.interface` 崩溃：
     `InvalidInterface: Concrete attribute, __firstlineno__`。
     根因是 `/usr/lib/python3/dist-packages/zope.interface-5.4.0-nspkg.pth` 在
     `site` 启动时把 3.10 时代的 `zope` 命名空间抢先注册进 `sys.modules`，
     用户 site 里的新版永远抢不过来。
   - 修法：`~/.local/bin/pysemgrep` 改成 `#!/usr/bin/python3.14 -S`，跳过该 `.pth`，
     再显式把 `zope` 命名空间指向用户 site（系统 dist-packages 保留作后备，
     因为 `idna` 等只在系统侧有）。**未改动任何系统文件。**
   - 现 `semgrep --version` → `1.186.0`。

### ✅ TODO-1 `proc.mjs` 的 shim 版本探测 —— 自然修复，已关闭

WSL 下 `which jscpd` 返回真实可执行文件：

```
{"path":"/home/bull/.npm-global/bin/jscpd","version":"jscpd 5.4.3"}
```

`version` 非空，符合迁移前的预期（Linux 没有 `.cmd` shim）。无需改代码。

### 🔴 TODO-4 Gate 12 EOF 换行误报 —— **已定位根因，是上游缺陷，未关闭**

迁移前记录的误报在 0.38.125 上**只修了一半**。旧实现（`$(...)` 捕获内容、命令替换吃掉
结尾换行）确实修了，但还剩一个独立的缺陷：**只在含非 ASCII 字符的文件上发作**。

#### 根因（已实测到具体机制）

`~/.config/xp-gate/hooks/lib/gate-12-blob-scan.awk` 用 `git cat-file --batch` 报告的
**字节数** 来切分 blob，却用 `length($0)` 计算每行长度：

```awk
n = length(body) + 1     # 在 UTF-8 locale 下这是「字符数」，不是字节数
```

当 `LANG=C.UTF-8`（本机默认）时，`length()` 返回字符数；含中文的行字符数 < 字节数，
于是 `remaining` 永远减不到 0，`ends_nl` 被置 0 → 误报 `NOEOF`。

实测同一文件：

```
LC_ALL=C awk '{...}'  -> 长度 14 / 9 / 12   （正确，字节）
     awk '{...}'      -> 长度  6 / 3 /  4   （字符）
```

#### 最小复现（已建，隔离环境）

```
ascii.md   结尾 0a  -> 默认 locale 下 不报 ✅
chinese.md 结尾 0a  -> 默认 locale 下 报 NOEOF ❌（误报）
两者在 LC_ALL=C 下都不报 ✅
```

**对照组仍有效**：把中文文件真的改成不带结尾换行，`LC_ALL=C` 下依然正确报 `NOEOF`。
所以这是误报的修复空间，不是检测能力问题。

#### 这也解释了迁移前「偶发」的观感

`tests/tools-leaf.test.mjs` / `scripts/lib/tools.mjs` 是纯 ASCII，当时没稳定复现；
一旦提交带中文的文档（如本文件）就必然中招。

#### 影响与现状

- Gate 12 是 WARN 不阻塞，代价是**每个含中文的提交都有一条噪声告警**。
- 本项目 `TODO.md` / `README.md` 都是中文，所以这条会持续出现。
- 规避：`LC_ALL=C git commit ...`（不改任何文件，已验证可消除误报）。

#### 待办

- [ ] 给 xp-gate 提 issue（**用户自己提，不提 PR**）：awk 扫描器需 `LC_ALL=C`
      或在 `BEGIN` 里设置字节语义。
- [ ] 决定是否长期用 `LC_ALL=C git commit` 规避。这是**使用决策**，未擅自更改全局配置。

### ✅ TODO-5 Gate 2 / jscpd —— WSL 下可测

`xp-gate check . --all` 的 Gate 2 输出 `Found 0 clones`，不再 `UNMEASURABLE`。
Linux 上不存在 `.cmd` shim / `npx ENOENT` 问题。（上游 `lib/gate-runner.js` 的
Windows 缺陷仍在，但只在 Windows 上发作。）

### ✅ TODO-6 Node 版本策略 —— 成立

- Node **26.13.1**（非奇数版），符合「只用一个 Node 26，不上版本管理器」的既有决定。
- `npm test` 在 Linux 上 **215/215 通过**（迁移时 196/196 已通过）。
- 无 CRLF 文件；`parseLizardCsv handles CRLF output` 仍有效（它测的是解析器对 CRLF
  的容忍，与平台无关）。
- pre-commit hook 在 WSL 下正常执行（上表 Gate 12 即为实证）。

### ✅ TODO-3 平台判断抽成可注入参数（用户选定方案）

`proc.mjs` 新增 `withPlatform(platform, fn)`：在调用期间临时遮蔽
`process.platform`，`finally` 中还原原 descriptor（回调抛异常也不会泄漏）。

顺带把两处硬编码抽成可测函数：

- `firstExisting` / `isWindowsShim` 改为导出。
- `parseWhichOutput(stdout, exists)` —— `where` 输出解析，含 CRLF 容忍与
  「跳过不可执行的首行」逻辑（正是迁移前 jscpd 那条 bug 的机制）。
- `probe` 的 comspec 与 `spawnOpts` 现在尊重 `opts.env`（此前被强制覆盖，
  导致 comspec 分支无法注入测试）。

覆盖率：`proc.mjs` 64.68% → **78.57%**。**Windows 分支现在在 Linux 上也能测。**

### ✅ TODO-2 补 `gatecheck.mjs` 覆盖率

70.34% → **94.14%**（函数覆盖 40% → 85.71%）。

新增的是执行路径测试（`runCase` / `measure` / `erroredCase` / `evaluateCase` /
`auditGates`）：用不存在的 gate id 驱动，spawn 路径真实、断言只针对本模块的记账逻辑。
其中一条专门守住临时仓库清理——`runCase` 抛异常时若 `finally` 失效，`/tmp` 会被
`xgr-gate-*` 塞满。

> 记账部分（`summarize`）**原本就有测试**，见 `tests/gatecheck-audit.test.mjs`。
> 第一轮我重复写了一组，已回滚——测试通过即说明在测已有行为。

---

## 仍未完成 / 需要决策

### ✅ TODO-7 CI 三线矩阵 —— 已验证全绿

`a04cf45` 推送后 CI run `45140237662` 全绿：

```
tests (node 22)   success
tests (node 24)   success
tests (node 26)   success
complexity of .mjs sources   success
mutation gate                success
```

### `proc.mjs` 剩余 21.43% —— 可接受

剩余未覆盖是 `readRegPath` / `expandRegistryPath` / `registry PATH 合并`：
这些要读真实 Windows 注册表，`withPlatform` 也只能骗过 `platform` 判断，
骗不过「`C:\Windows\System32\reg.exe` 在 Linux 上不存在」。要覆盖它们得再抽一层
可注入的 `spawnSync`，收益低于成本，**建议接受现状**。

### 外部 issue 状态（2026-11-23 复核）

| # | 标题 | 状态 | 依据 |
|---|---|---|---|
| 5 | jscpd 版本恒为 `?` | **CLOSED** | WSL 下 `toolVersion` 返回 `jscpd 5.4.3`；根因是 Windows 专属的无扩展名 shim，Linux 用符号链接 |
| 4 | OpenCode 被自激判活 | **OPEN（有意保留）** | 本机不复现（CLI 证据命中），但 `idleDays` 读目录 mtime 的机制未改；实测 `idleDays` 仅 5 天，CLI 一消失就会误判 |
| 1 2 3 | — | CLOSED | — |

**#4 为何不关**：按"不复现就关闭"处理等于掩盖。已在 issue 内附实测证据与收口建议。
顺带修正了 issue 表述：`probeLiveness` 是短路求值，"自激"只在第二级（CLI）为假时成立。

### 本轮已清理的技术债

- **3 条未使用导入**已删（`hp-gate.mjs: fs`、`preflight.mjs: gitConfig`、`verify.mjs: item`），
  逐条人工确认仅出现在 import 语句本身。
- **10 处 GitHub Actions 可变 tag → 钉 SHA**（`checkout@v4` / `setup-node@v4` /
  `setup-python@v5`）。注意 `checkout@v4` 与 `setup-node@v4` 当时解析到的是
  release 分支的 tip，即"tag 指向的内容"与"实际运行的内容"并不绑定。钉后
  `semgrep --config=auto` 从 10 findings 降到 **0**。

### TODO-4 上游归档

**不要**按「已修复」留言——它在 0.38.125 上仍可复现（见上文根因与最小复现）。
这是一条**新的、可提交的缺陷报告**：`gate-12-blob-scan.awk` 混用字节数与字符数。
按既有规则：用户自己提 issue，不提 PR。

### 用户已明确不做的事

- **不向 xp-gate 提 PR**：用户自己在 XPGATE 仓库里修。只提 issue / 加评论 / 重开 issue。
- Gate 4 的魔数 INFO 违规：**判定为噪声，不修**。

---

## 环境速查（WSL2）

```bash
# 依赖：零第三方依赖，不需要 npm install
node --version    # v26.13.1

# 门禁工具
which -a jscpd lizard checkov hadolint gitleaks semgrep jq   # 首条必须是 Linux 路径

# xp-gate 本体
xp-gate --version # 0.38.125

# 全量检查
npm test && npm run coverage && npm run hp-gate && npm run mutation
npx --no-install jscpd --min-lines 5 --min-tokens 50 tests/*.mjs scripts/lib/*.mjs
xp-gate check . --all
```

已知限制（实测，非推测）：

- `semgrep` 依赖 `~/.local/bin/pysemgrep` 这个定制 wrapper **必须在 PATH 上**，
  因为 ocaml 主程序靠 `execvp` 找它。若把 `~/.local/bin` 移出 PATH，semgrep 立刻
  回到 `execvp pysemgrep` 报错。
- `xp-gate check . --all` 里 Gate 0/1/5/9/11/12/12b/12c/13 无法从 CLI 调用
  （`git commit` 时才跑）。**别把「CLI 显示 skipped」当成「门禁通过了」。**
- Gate 3 / Gate 10 的扩展名正则不含 `mjs`/`cjs`（上游缺陷），本项目纯 ESM，
  所以 Gate 3 在 xp-gate 眼里整棵树不存在 —— 复杂度由 `npm run hp-gate` 独立兜底。

已知的项目约定：

- **`coverage/` 必须跟踪**，不要加进 `.gitignore`。Gate 5 从 **commit** 读
  `coverage/coverage-summary.json`，忽略它会让地板线无法测量、每个 commit 都被
  `not found` 拦住。跑完 `npm run coverage` 后要连同代码一起提交。
- 项目零依赖，**不要引入测试框架**（`node:test` 够用）。
- `git config core.autocrlf input` 已设置，保持。
