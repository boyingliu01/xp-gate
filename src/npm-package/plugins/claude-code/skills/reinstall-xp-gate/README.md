# reinstall-xp-gate

一个 **agent skill**：在任意 agent（DSH / Claude Code / OpenCode / Qoder / Trae / WorkBuddy / CodeBuddy / Codex / DWS / Pi …）
上全新重装 **xp-gate**，并验证门禁**真实生效**，而不是只看命令退出码。

## 为什么需要它

`xp-gate install` 即使 doctor 报问题也返回 0；`uninstall --purge` 会连用户配置
（`.delphi-config.json`）一起删除；旧版 `uninstall` 留下的 skill 副本、Qoder 钩子模板、
npm 全局包都不会被清掉。**只跑两条命令会得到一个「看起来装好、实际门禁失效」的环境。**

本 skill 把这些坑固化成 6 个阶段 + 逐 agent 验收。

## 六阶段

| 阶段 | 动作 | 通过标准 |
|---|---|---|
| 0 快照 | 版本三件套、`doctor --json`、hooksPath、`.delphi-config.json` 外部快照 | 快照存在且非空 |
| 1 卸载 | `uninstall --global --purge`；补清 skill 副本 / 钩子模板 / 项目钩子；`npm uninstall -g` | 残留目录均不存在 |
| 2 安装 | 恢复配置 → `npm i -g @latest` → `install --global` → `update-hooks --global` | 安装版本 = registry latest |
| 3 工具 | 解析真实 PATH，比对 jscpd/lizard/checkov/hadolint/gitleaks/semgrep 等 | 全部存在；npm/pip 系可达最新 |
| 4 skill | 发布包 `skills/*` 为唯一事实源，逐 agent 比对 | 集合与内容哈希一致 |
| 5 插件 | Qoder 钩子、OpenCode 包、DSH profile 包、Claude 插件 | 版本 = CLI 版本 |
| 6 行为 | `doctor`、临时 repo 真实提交、`delphi-review` 冒烟 | 无 FAIL；pre-commit 真被触发 |

## 用法

```bash
node scripts/install.mjs --dry-run     # 看会同步到哪些 agent
node scripts/install.mjs               # 同步到所有已识别的 agent skills 根
node scripts/preflight.mjs             # 只读基线：快照配置 + 记录版本/doctor/agent 清单
node scripts/reinstall.mjs             # 默认 dry-run，打印完整计划
node scripts/reinstall.mjs --apply     # 真正执行
node scripts/verify.mjs                # 验收，FAIL 时退出码 1
```

常用参数：

| 脚本 | 参数 | 作用 |
|---|---|---|
| install | `--dry-run` | 只打印每个 agent 的 live/new/update/ok/source，不改盘 |
| install | `--include-all` | 连判定为残留的配置目录也分发（默认跳过） |
| preflight | `--dry-run` | 不写 run 目录，只打印基线 |
| reinstall | `--apply` | 默认 dry-run；加它才执行卸载/安装 |
| reinstall | `--upgrade-tools` | 同时把 npm/pip 系门禁工具升到最新 |
| reinstall | `--clean-project-hooks` | 删除当前仓库 `.git/hooks` 里含 xp-gate 标记的钩子 |
| reinstall | `--no-verify` | 跳过最后的 verify（不推荐） |
| verify | `--quick` | 跳过网络探测与工具版本比对 |
| verify | `--json` | 输出机器可读结果 |

产物目录：`~/.local/share/xp-gate/reinstall-runs/<时间戳>/`（配置快照、`baseline.json`、卸载前备份的 `residue/`）。
该目录在 xp-gate 管理面之外，purge 不会删。

## 审计：门禁到底还拦不拦

```bash
node scripts/audit.mjs            # 三层：磁盘一致性 + 门禁真实拦截 + xp-gate 看不见的 .mjs
node scripts/audit.mjs --gates    # 只跑灰盒拦截测试
node scripts/audit.mjs --static   # 只查磁盘一致性（等同 verify --quick）
```

**为什么需要它**：`verify.mjs` 在 1.1.1 之前**一次 `spawnSync` 都没有**——每个判据都是读文件、比哈希。
所以它能在门禁已经悄悄失效的机器上报告「12 个 skill × 5 个 agent 全部一致」。文件装齐和门禁有效是两件事，
第二件读文件永远证明不了。

灰盒层的做法是**建一个临时 git 仓库、种一个门禁该拦的缺陷、要求门禁自己说出来**，并且同一条门禁
在干净树上必须不拦（对照组）。只有对照组和实验组分开，才能证明这个「拦住」有意义：

```
  Gate  Clean      Planted   Verdict
  8     passed     blocked   ok
  3     skipped    blocked   ok
  2     blocked    blocked   UNMEASURABLE
```

`detected` 与 `blocked` 分开是因为门禁严重程度不一致：Gate 8 遇密钥退出 1，Gate 2 报
`Found N clones` 但退出 0（实测有无克隆都是 0）。把它们并成一个判定，不是冤枉 Gate 2 就是高估它。

**对照组自己被拦 → `UNMEASURABLE`，不是 FAILED。** 上表 Gate 2 就是本机的真实状态：jscpd 5.4.3
明明在 PATH 上，控制组仍报 `Gate 2 FAILED: spawnSync npx ENOENT`。根因在上游
`lib/gate-runner.js`：它探 `<root>/node_modules/jscpd/bin/jscpd`，而 jscpd 5.x 把 bin 改成了
`run-jscpd.js`；三条回退在 Windows 上全部失败，且原因各不相同——`jscpd.cmd` → EINVAL（`.cmd`
必须有 shell）、`jscpd` → ENOENT（PATH 里是 shell 脚本）、`npx` → ENOENT（同理）。
实测 `node .../jscpd/run-jscpd.js --version` 立刻打印 `jscpd 5.4.3`，证明「装了但调不到」。
把它算成 FAILED 会让人以为门禁坏了，算成 PASS 是撒谎；`UNMEASURABLE` 才是它的真实身份。
Gate 2 不阻塞构建，代价只是重复代码这条信号缺失。

### 第三层：xp-gate 自己测不了的东西

上游 `gates/common.ts` 里 `LIZARD_EXTENSIONS` 和 `SEMGREP_EXTENSIONS` 都是
`/\.(ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt|cs)$/`——**两个都没有 `mjs`/`cjs`**。
实测：同一段 CCN 22 的代码，叫 `src/a.js` 时 Gate 3 输出「PASSED」，改名成 `src/a.mjs` 立刻变成
「⏭️ SKIPPED – Complexity (no source files to check)」，一个函数都没量。本项目是纯 ESM，
所以在 Gate 3 眼里整棵树不存在。

```bash
node scripts/hp-gate.mjs           # 对 .mjs/.cjs 跑 lizard，阈值同 Gate 3（CCN > 5）
node scripts/hp-gate.mjs --ccn 8   # 换阈值
node scripts/hp-gate.mjs --json    # 供 audit 使用
```

「扫到 0 个函数」按**扫描失败**处理，不按干净处理——这个脚本自己先后踩过两次：
第一版漏 `--csv`（lizard 无输出），第二版读错列（读了 `columns[0]`＝行数而不是 `columns[1]`＝CCN）。
两次都是 0 条违规、报「全部达标」，而树里有一个 CCN 22 的函数。现在源码非空而解析结果为 0
直接判 `scanBroken` 硬失败。

## 变异测试：测试真的会失败吗

```bash
node scripts/mutation.mjs           # 16 个变异，全部必须被抓
node scripts/mutation.mjs --verbose # 显示是哪个测试抓到的
```

往生产代码里注入一个已知缺陷、跑测试、要求测试失败，然后还原。全绿只证明「测试和代码看法一致」，
不证明「代码错了测试会知道」。

这不是形式主义。第一版「pruneDeadRoots 只删逐字节一致的副本」这个测试**无论哈希比对存不存在都通过**，
因为它把改过的副本命名成一个循环永远访问不到的名字。84/84 全绿，而删掉比对会误删用户改过的 skill——
这个洞是靠变异测试才发现的。

## 测试

```bash
node --test tests/*.test.mjs     # 或 npm test
```

零依赖：用 Node 内置 `node:test`，不装任何包。114 个用例覆盖：

- **破坏性路径优先**——`lib/residue.mjs` 里「备份后才删」的四个函数（备份成功、只删逐字节一致的副本、
  含 xp-gate 标记才动、路径穿越防护）。
- **判等逻辑**——`hashTree` 顺序无关、`sameTree` 内容比较、`copyTree` 覆盖残留。
- **版本比较**——`cmpVersion` 必须按数值比较（`1.10 > 1.9`，字符串比较会判反）。
- **门禁输出解析**——`verdictOf` 必须把干净树读成通过、把注入缺陷读成拦截，两者缺一不可。
- **复杂度解析**——`parseLizardCsv` 的 CCN 必须取自第 1 列而不是第 0 列（行数），
  带逗号的函数签名不能被 `split(',')` 切错，CRLF 输出不能把行号读成 NaN。
- **审计自身记账**——`summarize` 必须把「对照组被拦」算成 unmeasurable 而不是 failure，
  且已知上游缺口既不洗白成通过、也不把审计永久判红。
- **不触碰真实用户目录**——所有写操作走 `mkdtemp` 临时目录，`discoverSkillRoots()` 不做断言
  （它扫真实 HOME，断言会把本机 layout 固化进测试）。

CI（`.github/workflows/test.yml`）在 Node 18/20/22 上跑测试、变异门禁和 `hp-gate`；
灰盒门禁审计每周跑一次，因为它依赖**已安装的** xp-gate 版本——那个东西会在本仓库不变的情况下自己变。

## 安装到 agent

SKILL.md 使用的约定是 `<root>/<name>/SKILL.md`。把本仓库放到对应根下即可：

| Agent | skills 根 |
|---|---|
| DSH | `~/.dsh/skills` |
| Claude Code | `~/.claude/skills` |
| OpenCode | `~/.config/opencode/skills` |
| Qoder / Qoder CN | `~/.qoder/skills` / `~/.qoder-cn/skills` |
| Trae CN | `~/.trae-cn/skills` |
| WorkBuddy | `~/.workbuddy/skills` |
| 共享仓库 | `~/.agents/skills` |

事实源（canonical）：`~/.local/share/xp-gate/skills/reinstall-xp-gate/`。改内容只改那处，再跑 `install.mjs` 同步。

## 注意

本 skill **不删除**残留的 agent 目录——里面含用户数据（会话、token、数据库）和共享技能符号链接。
它只做三件事：不分发到残留根、清掉误写入的 skill 副本（逐字节比对后才删）、清理含 xp-gate 标记的钩子。

## License

MIT
