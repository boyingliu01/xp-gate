---
name: reinstall-xp-gate
version: 2.0.2
description: >
  跨 agent 全新重装 xp-gate：快照用户配置 → 用 xp-gate 命令卸载并清理历史残留 →
  安装 npm 最新版 → 依赖工具升级到可达最新 → 逐 agent 校验 skill、插件、钩子真实生效。
  当用户说「重装 xp-gate」「升级 xp-gate」「全新安装」「清理 xp-gate 旧版残留」
  「确保门禁真实有效」，或换了 agent/机器要重新部署 xp-gate 时使用。
---

# XP-Gate Reinstall

本 skill 是 xp-gate 自身的**生命周期维护**，不随 xp-gate 发布包分发，因为它要在
`uninstall --purge` 之后仍然存在。事实源（canonical）：

```
~/.local/share/xp-gate/skills/reinstall-xp-gate/
```

其他 agent 的 skills 目录里是**独立副本**，由 `scripts/install.mjs` 同步；每个副本
自带脚本，可单独运行。

## 三条硬规则

1. **只用 xp-gate 自己的命令完成卸载/安装/分发**。不 `git clone`，不手改安装目录里的文件，
   不凭记忆写死子命令——每阶段先跑 `xp-gate --help` / `xp-gate doctor --json` 发现当前版本，
   结构变了按当前版本执行并在报告里写明差异。
2. **先快照，再卸载**。`--purge` 会整目录删除 `~/.config/xp-gate/`，连普通卸载标记为
   「用户数据」的 `.delphi-config.json` 一起删。没有外部快照就没有回滚，而且会重新打开
   native Delphi 通道。
3. **失败即停**。不带着失败继续下一步；禁止为了让检查变绿去改证据或改配置。

## 为什么不能只跑两条命令

以下行为按当前 0.37.2 的实现核对过，每次执行仍要复核（上游可能已修）：

| 陷阱 | 实际行为 | 补偿动作 |
|---|---|---|
| `xp-gate install` 退出码 | 即使 doctor 报问题也返回 0 | 用 `scripts/verify.mjs` 验收，不看退出码 |
| `--purge` 与用户配置 | `rmSync(~/.config/xp-gate)`，`.delphi-config.json` 一起消失 | preflight 外部快照，安装前恢复 |
| `uninstall` 与 skill | 0.37.2 里 `planSkillRemovals` 只有定义、无调用点，所有 agent 的 skill 副本都留下 | 对比旧发布包逐字节清理；改动过的副本保留并备份 |
| `uninstall` 与 Qoder 模板 | 只硬编码清理 opencode 的 `git-hooks-template` | 清理其他 agent 的同名目录（先验证含 xp-gate 标记） |
| `uninstall` 与 npm 包 | 只反向执行 init，不删全局包 | 显式 `npm uninstall -g` |
| `bootstrap` / `install-tools` | 只补缺失，不升级 | 单独查最新版并升级 |
| `update-skill --all` | 只更新「已部署过」的 skill，补不了缺失项 | 缺失/漂移项逐个 `install-skill <name> --force` |
| 非官方 agent | CLI 只认 qoder/claude/opencode/dsh | Trae/WorkBuddy/CodeBuddy/Codex/Cline/DWS/Pi 等直接按目录复制 |
| PATH 陈旧 | 工具已安装但当前进程 PATH 看不到，doctor 报 Not found | 脚本从注册表合并 PATH 后再探测；必要时 `xp-gate doctor --refresh-env` |
| DSH 擦除凭据环境变量 | 名字含 `KEY`/`PASSWORD`/`SECRET`/`TOKEN` 的变量在 bash 工具里恒为空，`delphi-review` 报「引用了未导出的环境变量」 | 见下方「凭据环境变量在 DSH 里读不到」——不是配置错误，不要去改注册表或 `.bashrc` |

### 凭据环境变量在 DSH 里读不到

2026-11-17 查明的**误诊陷阱**，值得单独写：因为它看起来像配置错误，实际是安全设计，方向错了会白折腾很久。

**现象**：`delphi-external-review` 报
`provider "whalecloud" 的 api_key 引用了未导出的环境变量：WHALECLOUD_API_KEY`，
而注册表里这个变量有值、`[Environment]::GetEnvironmentVariable(...,'User')` 也读得到。

**真因**：`@deepseek-ai/dsh-subprocess/lib/index.js` 里

```js
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i;
```

DSH 在 spawn 子进程时**主动擦除**所有「凭据形状」的环境变量，防止它们隐式泄漏进子进程。
这是有意设计，不是 bug。判别方法很直接——同一个注册表键下：

| 变量 | 含敏感词 | 能否在 bash 工具里读到 |
|---|---|---|
| `JAVA_HOME`、`NODE_COMPILE_CACHE`、`UV_HTTP_TIMEOUT` | 否 | 能 |
| `WHALECLOUD_API_KEY`、`XIAOMI_API_KEY`、`WEREAD_API_KEY` | 是 | **不能（整个键不存在）** |

**已经排除、不要重试的方向**（都实测过）：

- 改 `.bashrc` / `.bash_profile` —— 工具调用是非交互 shell，**根本不读**；实测追加标记后当前会话和新起的 `bash -c` 都读不到
- 设 `BASH_ENV` —— 机制本身有效（非交互 bash 确实会读它），但它自己也得先存在于 DSH 进程环境，同样被擦掉
- 重启 DSH —— **试过，无效**。这个方向最容易误判成「进程启动早于设变量」，但重启后照样读不到
- 强制广播 `WM_SETTINGCHANGE` —— 广播返回成功，子进程仍读不到

**能用的补偿**：该模块注释自己写了正规出口——「显式提供的 env 层在擦除之后合并」，
所以在 spawn 时自己带 `env` 就能穿过。本机已按此修好 `delphi-review`：

```
~/.local/share/xp-gate/bin/delphi-review.mjs   # hydrateCredentials()：入口处从 Windows 用户级注册表补回缺失凭据
~/.local/bin/delphi-review                     # shim，顺带修了 /c/... 直接传给 node 的 MSYS 路径 bug（pwd -W）
```

要点：**注入必须放在程序入口**。`delphi-review` 有配置校验、席位解析、子进程 spawn 三处都读
`process.env`，只在 spawn 处补会漏——这是第一版修法失败的原因。

换了机器或重装后要复验：清掉环境变量跑 `delphi-review --subject <文件>`，
三席能返回真实 `model_used` 即正常。注意参数是 `--subject` 不是 `--input-file`。


## 运行方式

在任意 agent 里（命令里的 `<skill>` 指本 skill 目录）：

```bash
node "<skill>/scripts/install.mjs" --dry-run   # 看会同步到哪些 agent
node "<skill>/scripts/install.mjs"             # 同步到所有已识别的 agent skills 根
node "<skill>/scripts/preflight.mjs"           # 只读基线：快照配置 + 记录版本/doctor/agent 清单
node "<skill>/scripts/reinstall.mjs"           # 默认 dry-run，打印完整计划
node "<skill>/scripts/reinstall.mjs" --apply   # 真正执行
node "<skill>/scripts/verify.mjs"              # 验收，FAIL 时退出码 1
```

常用参数：

| 脚本 | 参数 | 作用 |
|---|---|---|
| install | `--dry-run` | 只打印每个 agent 的 live/new/update/ok/source，不改盘 |
| install | `--include-all` | 连判定为残留的配置目录也分发（默认跳过） |
| preflight | `--dry-run` | 不写 run 目录，只打印基线 |
| reinstall | `--apply` | 默认 dry-run；加它才执行卸载/安装 |
| reinstall | `--upgrade-tools` | 同时把 npm/pip 系门禁工具升到最新（二进制工具只提示） |
| reinstall | `--clean-project-hooks` | 删除当前仓库 `.git/hooks` 里含 xp-gate 标记的钩子（默认保留） |
| reinstall | `--no-verify` | 跳过最后的 verify（不推荐） |
| verify | `--quick` | 跳过网络探测（npm latest / PyPI / GitHub）与工具版本比对 |
| verify | `--json` | 输出机器可读结果 |

退出码：`reinstall` 只有在中止或 verify FAIL 时非 0；`verify` 有任一 FAIL 即返回 1。

Windows 下若 `node` 不在 PATH，用 `"/c/Program Files/nodejs/node.exe"` 加 Windows 形式
绝对路径调用（Git Bash 的 `/d/...` 会被 MSYS 转换）。

产物目录：`~/.local/share/xp-gate/reinstall-runs/<时间戳>/`
（`.delphi-config.json` 快照、`baseline.json`、`residue/` 里卸载前备份的 skill/模板/钩子）。
该目录在 xp-gate 管理面之外，purge 不会删。

## 六个阶段与验收

| 阶段 | 动作 | 通过标准 |
|---|---|---|
| 0 快照 | 版本三件套、`doctor --json`、hooksPath、`.delphi-config.json` 外部快照 | 快照文件存在且非空 |
| 1 卸载 | `uninstall --global --purge`；补清 skill 副本 / `git-hooks-template` / 项目钩子；`npm uninstall -g` | 配置目录、`.uninstall-backup`、旧 skill 副本均不存在 |
| 2 安装 | 恢复 `.delphi-config.json` → `npm i -g @latest` → `install --global` → `update-hooks --global` | 安装版本 = registry latest；`mode=global` |
| 3 工具 | 解析真实 PATH，比对 jscpd/lizard/checkov/hadolint/gitleaks/semgrep/npx/jq | 全部存在；npm/pip 系可达最新；二进制无法判定时标 UNVERIFIED |
| 4 skill | 发布包 `skills/*` 为唯一事实源，逐个 agent 比对 | 每个 agent 根下集合 = 发布包集合，内容哈希一致 |
| 5 插件 | Qoder 钩子、OpenCode 包、DSH profile 包、Claude 插件（如启用） | 版本 = CLI 版本；Qoder 原生 `delphi-*.md` 数量为 0 |
| 6 行为 | `doctor`、`doctor delphi`、**灰盒注入测试**、`delphi-review` 冒烟 | 无 FAIL；SKIP 有解释；门禁真拦住注入的缺陷 |

`verify.mjs` 覆盖 0–5 与 6 的静态部分。**真实提交**和 **delphi 冒烟**必须人工做一次，
因为它们会产生副作用（提交、外部模型调用），脚本不代劳。

### 「装齐」和「有效」是两件事

`verify.mjs` 的每个判据都是读文件、比哈希——它一次 `spawnSync` 都没有。所以它能在门禁
已经悄悄失效的机器上报告「12 个 skill × 5 个 agent 全部一致」。这不是假设：
上游 `xp-gate#732` 让 Gate 3/4 对 `.mjs` 报 PASS/SKIP 却一个文件都没检查。

`audit.mjs` 补的是这一层：**建临时 git 仓库、种一个门禁该拦的缺陷、要求门禁自己说出来**，
并且同一条门禁在干净树上必须不拦（对照组）。只有对照组与实验组分开，才能证明这个「拦住」有意义。

十几行、三层分开报告：

| 层 | 查什么 | 靠什么 |
|---|---|---|
| 1 静态 | 磁盘一致性（版本、hooks、skill 副本、插件） | `verify.mjs --quick --json` |
| 2 灰盒 | 门禁是否真的拦住注入的缺陷 | `xp-gate check <id>`，实验组 + 对照组 |
| 3 盲区 | xp-gate 扩展名列表看不见的 `.mjs`/`.cjs` | `hp-gate.mjs`（见下） |

```bash
node scripts/audit.mjs          # 三层一起
node scripts/audit.mjs --gates  # 只跑灰盒
node scripts/audit.mjs --static # 只查磁盘一致性（等同 verify --quick）
```

判定里 `detected` 与 `blocked` 分开：Gate 8 遇密钥退出 1，Gate 2 报 `Found N clones`
但退出 0（实测有无克隆都是 0）。并成一个判定，不是冤枉 Gate 2 就是高估它。

**对照组自己被拦时判 `UNMEASURABLE`，不是 FAILED。** 实测环境：Gate 2 在本机控制组报
`Gate 2 FAILED: spawnSync npx ENOENT`——而 jscpd 5.4.3 明明在 PATH 上。根因在上游：
`lib/gate-runner.js` 探的是 `<root>/node_modules/jscpd/bin/jscpd`，但 jscpd 5.x 把 bin 改成了
`run-jscpd.js`；三条回退路径在 Windows 上全部失败，且失败原因各不相同——
`jscpd.cmd` → EINVAL（`.cmd` 必须有 shell）、`jscpd` → ENOENT（PATH 里是 shell 脚本）、
`npx` → ENOENT（同理）。也就是说 jscpd ≥ 5 + Windows 下 Gate 2 **永远**是这句话，
与代码好坏无关。把它当 FAILED 会让人以为「门禁坏了」，当 PASS 则是撒谎。
Gate 2 不阻塞构建，代价只是重复代码这条信号缺失。

### `hp-gate.mjs`：xp-gate 自己测不了的那一层

根因是 xp-gate 的两个正则（`gates/common.ts`）：

```ts
const LIZARD_EXTENSIONS  = /\.(ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt|cs)$/;
const SEMGREP_EXTENSIONS = /* 同上形状 */
```

**两个都没有 `mjs`/`cjs`。** 实测对照：同一段 CCN 22 的代码，叫 `src/a.js` 时 Gate 3
输出「Checking complexity for source files… PASSED」；改名成 `src/a.mjs` 后立刻变成
「⏭️ SKIPPED – Complexity (no source files to check)」——没有任何函数被量过。
本项目是纯 ESM，所以在 Gate 3 眼里整棵树不存在。

`hp-gate.mjs` 用同一个阈值（CCN > 5，与 `gates/gate-3.ts` 的 `CCN_THRESHOLD` 一致）
对 `.mjs`/`.cjs` 跑 lizard，并额外 `node --check` 每个文件（Gate 1 同样漏 `.mjs`）：

```bash
node scripts/hp-gate.mjs           # 生产脚本 + 测试一起量
node scripts/hp-gate.mjs --ccn 8   # 换阈值
node scripts/hp-gate.mjs --json    # 给 audit 用
```

**「扫到 0 个函数」按扫描失败处理，不是按干净处理。** 这是踩过的坑：第一版漏了 `--csv`，
lizard 什么都不输出，脚本对一棵含 CCN 22 函数的树报了 PASS；第二版加了 `--csv` 但读错列
（读第 0 列 NLOC 而不是第 1 列 CCN），又是 0 行、又报干净。现在源码非空而 `ccn.length === 0`
直接判 `scanBroken` 硬失败。

### 字段序：`columns[0]` 是行数，`columns[1]` 才是 CCN

lizard CSV 的字段序是 `nloc, cyclomatic_complexity, token_count, param, length, …`，
直接读 lizard 1.26.1 的 `lizard_ext/csvoutput.py` 确认（它按字面顺序写这三个字段）。
所以 `columns[0]` 是「行数」，`columns[1]` 才是 CCN。本项目第一版 hp-gate 读的是
`columns[0]`，把行数当复杂度，于是 0 条违规、报干净——这是同一个功能第二次假通过
（第一次是漏 `--csv`）。

token 数（`columns[2]`）同样不能替代 CCN，实测行可以说明这个陷阱：

```
function simple(n){ const a=n+1; ...; return d; }   -> 7,1,54,...    CCN 1，token 54
function branchy(n){ if.. if.. return -1 }          -> 5,3,25,...    CCN 3，token 25
```

分支最多的函数 token 反而最少。任何拿 token 数跟复杂度阈值比的检查，排序都是反的。

`tests/ccn.test.mjs` 对三个数值列各钉了一条测试，这样这个错法不会再悄悄回来。

改这个 skill 的代码后跑 `node scripts/mutation.mjs`：往生产代码注入 16 个已知缺陷，
全部必须被测试抓到。全绿只证明「测试和代码看法一致」，不证明「代码错了测试会知道」——
第一版 `pruneDeadRoots` 的测试就是这么假通过的。`error` 单独作为一种结果，避免
「测试跑不起来」被误报成「变异存活」；`SKIPPED`（锚点过期）同样单独报告，
因为锚点失配的变异什么也没验证，静默跳过会让门禁看起来还是绿的。

## 多 agent 矩阵

**只扫描「目录存在」会把已卸载的 agent 算进来**——配置目录和 `skills/` 在卸载后
通常原样保留（实测本机 15 个目录里 4 个是 79–271 天没动过的残留）。因此每个根都做
活性判定，三级证据依次为：

1. **桌面/IDE 安装目录存在**（Qoder CN、Trae CN、WorkBuddy、CodeBuddy、Doubao Work 等）；
2. **CLI 能从合并后的 PATH 解析到**（`opencode`、`dws`、`claude`、`codex`、`pi`、`dsh` 等）；
3. **agent 配置目录近 30 天有写入**（DSH 这类二进制不在 PATH 上的情况靠它兜底）。

`.agents/skills` 是多个 agent 共用的技能仓库（`skill-lock.json` 由技能安装器维护），
单独标记为 shared，不算 agent。判定为残留的根默认不分发；`verify` 只把它们列为 WARN，
不计入 skills 一致性。`--include-all` 可强制分发。

已知 agent 与集成方式：

| Agent | skills 根 | xp-gate 集成 |
|---|---|---|
| Qoder / Qoder CN | `~/.qoder/skills`、`~/.qoder-cn/skills` | 全局 hooks + skills；external-only 下不部署 agents |
| OpenCode | `~/.config/opencode/skills` | skills + `@boyingliu01/opencode-plugin` |
| DSH | `~/.dsh/skills` | skills + profile 里的 `@boyingliu01/dsh-plugin-xp-gate` |
| DWS | `~/.dws/skills` | skills |
| Trae CN | `~/.trae-cn/skills` | skills（CLI 不认，脚本直接分发） |
| WorkBuddy | `~/.workbuddy/skills` | skills（同上） |
| CodeBuddy / Doubao Work / Pi | 各自 `skills` 根 | skills（同上） |
| 共享仓库 | `~/.agents/skills` | shared，多 agent 的符号链接指向这里 |

新 agent 只要遵守 `<root>/<name>/SKILL.md` 约定，把根目录放进扫描范围即可，脚本无需改。

**本 skill 不删除残留的 agent 目录**：这些目录里有用户数据（`.dsh/sessions`、
`.dws/token.json`、`.codex/*.sqlite`、Cline 的 `secrets.json`）和共享技能符号链接，
批量删除属于另一个工具的职责。`reinstall` 只做两件事：不分发、以及清掉
`install-skill` 因「目录存在」而误写入残留目录的副本（逐字节比对后才删）。

## 维护

- 改内容只改 canonical 一处，再跑 `install.mjs` 同步；不要在某个 agent 副本里单独改。
- 上游修掉某个陷阱后，删掉 SKILL.md 表格与脚本里对应的补偿分支，并在提交信息里注明。
- 本 skill 不属于 xp-gate 发布包；`xp-gate uninstall` 和 `update-skill --all` 都不会碰它。
