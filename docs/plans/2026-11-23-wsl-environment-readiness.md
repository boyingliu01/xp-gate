# WSL 迁移环境就绪报告

**日期**：2026-11-23
**机器**：WSL2 / Ubuntu 22.04.5 LTS / kernel 6.18.58.1-microsoft-standard-WSL2 / glibc 2.35 / 8 核 / 7 GB / 899 GB 可用
**基线**：`main @ b6249b01`，`VERSION 0.38.125.0`，xp-gate CLI 0.38.125

本文记录「环境准备好」这件事**做了什么、凭什么说它好了、以及还有哪些已知缺口**。
所有结论旁边都附了可复现命令。数字都是本次实测，不是沿用 Windows 侧记录。

---

## 0. 一句话结论

**开发环境可用。** 全量 vitest 从「Windows 上 6 分钟跑不完」变成 **约 50 秒跑完**
（9 个失败文件 / 10 个失败用例，**全部经干净 HEAD 复核为仓库既有缺陷**，见 §5）。
`xp-gate doctor` 全绿，`test-plugins.mjs` 0 失败，镜像检查 PASS，
重装验收 `FAIL=0 WARN=1 PASS=15 SKIP=0`。

---

## 1. PATH 污染 —— 本次最大的坑，已从启动链根除

> **2026-11-23 追加：已按「WSL 环境不得混入任何 Windows 路径」做彻底清理。**
> 详见本文末尾 §11。口径是：**Windows 挂载保留**（`/mnt/d/projects` 下的项目要能访问），
> 但 Windows 路径**不得进入任何环境变量、任何配置文件**。

### 症状

`/etc/wsl.conf` 里 `appendWindowsPath = false` **早就生效**，但 shell 的 `PATH`
里仍有 **62 条 `/mnt/c/...`** 条目，把 `~/.local/bin` 整个挤出了搜索范围。后果：

| 工具 | 带污染的 PATH | 干净 PATH |
|---|---|---|
| `shellcheck` | MISSING（实装于 `~/.local/bin`） | 正常 |
| `sqlite3` | MISSING（实装于 `~/.local/bin`） | 正常 |
| `semgrep` | exec 失败 | 正常 |
| `checkov` | 落到 `/mnt/c` 的 shim，`exec` 报 `No such file or directory` | 正常 |

`checkov` 那条正是 #841 的同一族：**能解析、不能执行**。探测 `--version` 通过，
真实扫描 126 失败，IaC 提交被无解阻断。这次是 shellcheck / sqlite3 先中招——
门禁会因此**静默 SKIP**，而 SKIP 与「查了没问题」在输出上无法区分。

### 真正的根因（不是 WSL 自动追加）

有人把当时的 Windows `PATH` 快照**硬编码**进了两个启动文件：

- `~/.profile:32` → `export PATH="...:/mnt/c/...:..."`（写死 62 条）
- `~/.bashrc:129` → 同上

所以改 `/etc/wsl.conf` 无效：每一层 shell 启动都会把它重新塞回来。

### 修法（三处，缺一不可）

1. **`~/.profile` / `~/.bashrc`**：把那两行硬编码替换成 `__xp_gate_strip_mnt()`
   守卫——启动时逐条剔除 `/mnt/*`，再确保 `~/.local/bin`、`~/.npm-global/bin` 在列。
   原文件备份在 `~/.dsh-env-backup/`。
2. **`~/.dsh/dsh-wsl.sh`**：在 `nohup dsh web` 之前清洗 `PATH`。这个脚本由 Windows
   的 `dsh-control.ps1` 经 `wsl.exe` 拉起，**继承 Windows 环境**，是污染的源头。
3. **`~/.npm-global/bin` 垫片**：为 `shellcheck`/`sqlite3`/`semgrep`/`jq`/`pysemgrep`
   建软链，让**当前已在运行的 DSH 会话**也能立刻用上，无需重启。

### 复现验证

```bash
bash -lc 'echo "$PATH" | tr ":" "\n" | grep -c "^/mnt/"'   # 应为 0
env -i HOME=$HOME bash -lc 'for t in shellcheck sqlite3 semgrep jq checkov lizard; do command -v $t; done'
```

> ⚠️ **仍未生效的一处**：正在运行的 `dsh web`(pid 43350) 的环境是进程启动时定死的，
> 外部改不了。它已经带上了垫片，所以**门禁工具当前可用**；但 `PATH` 里那 62 条
> `/mnt` 要等下次重启 DSH 才彻底消失。重启后无需再改任何东西。

---

## 2. semgrep —— 包装器活着、引擎活着，中间那层死了

### 症状

`semgrep --version` 报 `execvp pysemgrep: No such file or directory`；
即使绕过，也撞上 `InvalidInterface: Concrete attribute, __firstlineno__`。

### 根因（两个独立缺陷叠加）

1. **`pysemgrep` 不在 PATH**：semgrep 的 OCaml 主程序用 `execvp("pysemgrep")` 拉起
   Python 侧，而 `~/.local/bin` 被 `/mnt/c` 挤出去了。
2. **`zope` 命名空间双份冲突**，这一条才是硬的：
   - `~/.local/lib/python3.14/site-packages/zope` = **8.7**（3.14 兼容）
   - `/usr/lib/python3/dist-packages/zope` = Debian 为 **3.10** 编译的 5.4.0
   - 后者由 `zope.interface-5.4.0-nspkg.pth` 在解释器启动时
     `sys.modules.setdefault('zope', ...)` **强制注册**，优先级高于 user site；
     它的 `_wire()` 触发循环导入，在 3.13+ 上直接抛 `__firstlineno__`。
   - 因此**任何裁剪 `sys.path` 的做法都无效**——我试过 4 种，全部失败。

### 修法

- `~/.local/lib/python3.14/site-packages/usercustomize.py`：在所有 `.pth` 跑完之后，
  把 `zope` 命名空间重新指向 user site。解释器层修复，**对所有调用路径生效**。
- `~/.local/bin/pysemgrep`：恢复成原版启动器（`execvp` 需要它）。

这个修法顺带修好了 `sastd-client.test.js` 的 4 个失败——它直接
`import semgrep.run_scan`，绕过了 CLI，之前的 CLI 级补丁覆盖不到。

### 复现验证

```bash
/usr/bin/python3.14 -c 'import zope.interface as z; print(z.__file__)'   # 必须指向 ~/.local
semgrep --config <rules> <file>      # 必须真出 finding，不只看 --version
```

> **教训**：`semgrep --version` 通过不代表 semgrep 可用。本项目反复踩这个形状——
> **探针通过 ≠ 真实执行通过**。验证门禁工具一律要跑一次真实扫描。

---

## 3. 装了什么 / 验了什么

| 项 | 状态 | 证据 |
|---|---|---|
| `npm install` | ✅ up to date | `sync-version` 正常跑完 |
| `xp-gate doctor` | ✅ All checks passed | — |
| `test-plugins.mjs` | ✅ 0 失败 | 8 组结构 + 降级测试 |
| `check-hook-mirror.sh` | ✅ PASS | 耗时 **0.25 s**（Windows 31–36 s） |
| 重装验收 `verify.mjs` | ✅ FAIL=0 WARN=1 PASS=15 SKIP=0 | 唯一 WARN 见 §8 |
| DSH 插件 | ✅ **新装** 0.38.125 | 见 §4 |
| archlint | ✅ 0.16.0 可运行 | 无需 mosl 替换修补 |

门禁工具均验证过**真实执行**（不只是 `--version`）：`lizard` `semgrep` `checkov`
`hadolint` `gitleaks` `shellcheck` `sqlite3` `jq` `bats` `jscpd` `archlint`。

**缺失但非阻塞**：`dotnet` / `java` / `mvn` / `gradle` / `flutter` / `terraform`。
这些只影响对应语言门禁（Gate 9 构建、Dart、IaC 深入检查），缺了会 SKIP 不是 FAIL。
当前开发任务（TypeScript/Shell/Python）不需要。

---

## 4. DSH 插件：从「未安装」到真实生效

`verify` 原本报 `SKIP: 未检测到 DSH profile 插件`。这不是检测器坏了——**两个 profile
（`web`/`headless`）确实都没装**。而 DSH 是主要使用的 agent，缺它就意味着
`gate-check` / `gate-principles` / `gate-arch` 三个原生工具不可用。

安装过程踩到一个坑：`dsh plugin --profile web add <pkg>` 首次装出的是
**0.38.83**（npm 镜像滞后），必须显式指定版本和官方 registry：

```bash
dsh plugin --profile web add @boyingliu01/dsh-plugin-xp-gate@0.38.125 \
  --registry=https://registry.npmjs.org
cd ~/.dsh/profiles/web && pnpm approve --all     # 批准插件携带的 skills
```

验证：

```bash
dsh --profile web --dump-config | grep -A2 xp-gate   # 应有 tool-xp-gate
node ~/xp-gate/skills/xp-gate-reinstall/scripts/verify.mjs | grep 'dsh plugin'
```

**生效需要重启 DSH**（当前会话是插件安装之前启动的）。

---

## 5. 全量 vitest：迁移的核心价值验证点

待办文档 §6.3 说「WSL 上第一件事就是测全量 vitest」，因为 Windows 上 5 次尝试
最长 6 分钟仍未跑完。结果：

| | Windows（记录） | WSL（本次实测） |
|---|---|---|
| 全量墙钟 | 6 分钟未跑完 | **49.5–64.4 s** |
| 进程创建（`bash -c true` ×100） | 106 ms **每次**（≈10.6 s） | **0.12 s 总计**（1.2 ms 每次） |
| `cmp -s` ×100 | 111–160 ms 每次 | **0.09 s 总计** |
| `git config` ×20 | 179 ms 每次 | **0.02 s 总计**（1 ms 每次） |
| `check-hook-mirror.sh` 单次 | 31–36 s | **0.25 s** |

> 测量条件：8 核机器，测试期间 load average 6.9–8.5（跑满）。
> 首轮 64.4 s、终轮 49.5 s 的差异来自负载与失败数变化，**不作为优化效果引用**。
> Windows 侧的负载读数曾被发现不可靠（`LoadPercentage` 90–100% vs 实测 6–12%），
> 上面的 Windows 数字仅作量级对照。

### 对 T1/T2 的结论（待办文档明确要求这个判断）

进程创建从 **100–180 ms 降到 1–2 ms**，低一个数量级以上。按待办文档自己的判据：

- **T1「镜像检查快速路径从未对 40 个文件生效」→ 优先级应下调。**
  那 4.4 s/次的损失，在 1.2 ms 的进程创建成本下会缩到 ~0.05 s。
  而且实测整个脚本只要 **0.25 s**，已经没有值得榨的油水。
- **T2「12 次重复跑脚本」→ 也基本失效。** 12 × 0.25 s = 3 s，不是 262 s。
- **§6.3 的判据给出明确回答：进程启动税确实是 Windows 侧的主因，在 WSL 上已消失。**
  后续性能方向应转向「减少真实工作量」（gate-10 长尾、gate-12 全树扫描），
  **不要再做「减少进程数」类优化**。

---

## 6. 测试失败：修好了什么，剩下什么是仓库固有

### 修好的（我的改动直接导致或环境导致）

| 失败 | 数量 | 原因 |
|---|---|---|
| `sastd-client.test.js` | 4 用例 | §2 的 zope 冲突 |
| `plugins/*/skills/xp-gate-reinstall/tests/*` | 10 文件 | skill 被误分发进 `plugins/`，被 vitest 拾取 |
| `skills-mirror-parity` | 6 用例 | `xp-gate-reinstall` 不在发布集 |
| `generated-mirror-reproducibility` | 1 用例 | 同上 |
| `plugins/dsh/src/skills.test.ts` | 2 用例 | 同上 |

### 剩下的 9 个失败文件全部是**仓库既有缺陷**

判据：在 `b6249b01` 的**干净 worktree**（`/tmp/xp-clean`，未做任何修改）上跑同一套测试。

| 干净 HEAD | 我的工作树 |
|---|---|
| **26 个文件 / 37 个用例失败** | **9 个文件 / 10 个用例失败** |

剩余 9 个，逐个在干净 HEAD 上复现确认：

| 测试 | 干净 HEAD | 说明 |
|---|---|---|
| `ac-reference-guard` | ❌ 同样失败 | 56 处 AC 引用超出冻结基线 |
| `adapters-gate-mirror-parity` | ❌ 同样失败 | `gate-7.sh` adapters 副本 5241B vs 正本 5826B |
| `execution-surface-contract` | ❌ 同样失败 | push-only 门禁清单不完整 |
| `fixture-hygiene` | ❌ 同样失败 | 4 处 bats fixture 裸用 `git commit` |
| `hook-mirror-parity` | ❌ 同样失败 | — |
| `pre-push-resolution` | ❌ 同样失败 | 期望 12 实得 13 |
| `gate-10.test.ts` | ❌ 同样失败 | — |
| `language-capability` | ❌ 同样失败（2/2 复现） | csharp 有 2 处未接线 |
| `warnings-baseline-budgets` | ❌ 同样失败 | — |

> **不要把这些当成本次迁移的回归。** 它们在我动手之前就红着，与 `TODO-WSL-MIGRATION-HANDOVER.md`
> §8 描述的「Quality Gates 长期红灯」是同一现象。

---

## 7. `xp-gate-reinstall` 与发布链的隔离

**决策（用户）**：这个 skill 必须独立于 xp-gate 包，否则它执行重装时会把自己删掉。

它原本会让 3 个检查点报 FAIL。修法**不是**把它塞进 `CORE_SKILLS`，而是在检查侧
按名字排除，并在每处写明理由：

| 位置 | 改动 |
|---|---|
| `scripts/check-hook-mirror.sh` | `diff -rq -x 'xp-gate-reinstall'` |
| `scripts/__tests__/skills-mirror-parity.test.cjs` | `SKIP_DIRS` 增加该名 |
| `scripts/__tests__/generated-mirror-reproducibility.test.cjs` | 同上 |
| `plugins/dsh/src/skills.test.ts` | `NOT_SHIPPED` 集合 |

另在重装 skill 自身修了两个真实缺陷：

- `verify.mjs` 只读顶层 `pinned_models`，而**产品 schema 里根本没有这个键**
  （席位在 `profiles[active_profile].experts`）→ 对合法配置误报「0 席」。
- `lib/skills.mjs` 的 `copyState` 全量比较，把 `__tests__` 也算进漂移 →
  对 `sprint-flow` 误报 drift。

---

## 8. 已知缺口（不阻塞，但要知道）

1. **`hadolint` 2.14.0 → 2.15.1 未升级**。GitHub 下载约 5 KB/s，npmmirror 无此文件。
   它是**可选**工具，2.14.0 功能正常。`verify` 唯一那条 WARN 就是它。
2. **`PSScriptAnalyzer` 未装**。`doctor` 会把它显示成「✓ available — N/A」，
   但 `Invoke-ScriptAnalyzer` 实际不存在——**探针假阳性**。PowerShell 深度检查未覆盖。
3. **`~/.config/xp-gate/adapters/` 下的 23 个副本会触发 `doctor` 的
   Non-executed copy 警告，但它们是全局安装的 fallback tier，不能删。**
   解析顺序是 project 优先（`githooks/adapters/` → 全局 → script dir），
   所以本项目不会执行它们；但**没有 `githooks/adapters/` 的仓库正是靠它们工作**。
   `verify.mjs` 原先把所有 doctor WARN 一律升级成自己的 WARN，对全局安装模式误报；
   已改为以 doctor 自己的 `ok=true` 为准，同时把 WARN 名字打印出来不隐藏。
   `doctor` 本身 22/23 个副本与正本逐字节一致，唯一不同的 `gate-7.sh` 是第 4 条的注释漂移。
4. **`gate-7.sh` 正本与 adapters 副本漂移**（5826 vs 5241 行，差异在注释）。
   这是既有缺陷，`adapters-gate-mirror-parity` 因此红。修它属于开发任务，不在环境准备范围。
5. **`dotnet`/`java`/`mvn`/`gradle`/`flutter` 未装**（见 §3）。
6. **`plugins/*/skills/xp-gate-reinstall` 的传播链已从源头切断。**
   原先的链路是：`install.mjs` 把 skill 写进「xp gate」根（即**仓库 `skills/`**）→
   `test-plugins.mjs` 把仓库 `skills/` 全量镜像进 `plugins/*/skills/` →
   vitest 收集到 `plugins/*/skills/xp-gate-reinstall/tests/` → **32 个失败文件**。
   已修 `install.mjs`：`~/<project>/skills/` 若是 git 检出就跳过，并在输出里
   **明确列出被跳过**（不静默）；`.config/opencode` 这类 agent 自有配置仓库
   不算用户项目，仍然正常接收。验证：仓库 `skills/` 干净后 `test-plugins.mjs`
   不再生成副本，全量测试回到 9 个失败文件。

---

## 9. 后续开发前建议先确认的三件事

1. **重启 DSH**，让 §1 的 PATH 清理与 §4 的插件同时生效。重启后跑：
   ```bash
   xp-gate doctor && node scripts/test-plugins.mjs && bash scripts/check-hook-mirror.sh
   ```
2. **门禁工具用真实执行验证，不要只看版本号**——见 §2 的教训。
3. **提交前 `git status` 确认暂存区**。当前工作树有 5 处改动（4 个测试/脚本 +
   1 个镜像同步）和 1 个未跟踪目录 `skills/xp-gate-reinstall/`，都不是待办文档的
   开发任务内容；开工前先决定它们怎么落库。

---

## 10. 本次改动的文件清单

**环境（仓库外）**

- `~/.profile`、`~/.bashrc` — PATH 守卫（备份在 `~/.dsh-env-backup/`）
- `~/.dsh/dsh-wsl.sh` — 启动前清洗 PATH
- `~/.local/lib/python3.14/site-packages/usercustomize.py` — 新增，zope 命名空间修复
- `~/.local/bin/pysemgrep` — 恢复原版启动器
- `~/.npm-global/bin/{shellcheck,sqlite3,semgrep,pysemgrep,jq}` — 指向 `~/.local/bin` 的软链
- `~/.dsh/profiles/web/package.json` — 新增 xp-gate 插件依赖（备份已留）
- `~/.dsh/profiles/web/pnpm-workspace.yaml` — 插件 skills 审批
- `~/.config/xp-gate/hooks/*.bak` — 9 个冗余备份，已归档到
  `~/.local/share/xp-gate/residue-archive-*/` 后清除

**仓库内（5 处，均未提交）**

- `scripts/check-hook-mirror.sh`
- `scripts/__tests__/skills-mirror-parity.test.cjs`
- `scripts/__tests__/generated-mirror-reproducibility.test.cjs`
- `plugins/dsh/src/skills.test.ts`（+ 其镜像 `src/npm-package/plugins/dsh/src/skills.test.ts`）
- 新文档：`docs/plans/2026-11-23-wsl-environment-readiness.md`（本文）

> `skills/xp-gate-reinstall/` **不在**仓库里。按「独立 skill」的定位，它只存在于
> `~/.local/share/xp-gate/skills/`（canonical）与四个 agent 配置根；
> 留在仓库里会被 `test-plugins.mjs` 镜像成构建产物并污染测试收集（见 §8.6）。

**重装 skill 自身（canonical）**

- `~/.local/share/xp-gate/skills/xp-gate-reinstall/scripts/verify.mjs`
  — 席位从 `profiles[active_profile].experts` 读；doctor WARN 以 doctor 自己的 ok 为准
- `~/.local/share/xp-gate/skills/xp-gate-reinstall/scripts/lib/skills.mjs`
  — `copyState` 只比较随包发布的文件，忽略 `__tests__`
- `~/.local/share/xp-gate/skills/xp-gate-reinstall/scripts/install.mjs`
  — 跳过用户项目仓库内的 `skills/`，切断 `plugins/` 污染链

---

## 11. Windows 路径彻底清理（2026-11-23 追加）

**要求**：WSL 开发环境不混入任何 Windows 路径。
**口径**（经确认）：**保留 `/mnt/c`、`/mnt/d` 挂载**（`/mnt/d/projects` 下有在用项目），
但 Windows 路径不得进入**环境变量**与**配置文件**。
`/mnt/wsl`、`/mnt/wslg` 是 WSL 自身所需，不属于清理范围。

### 11.1 清掉了什么

| 位置 | 问题 | 处理 |
|---|---|---|
| `~/.bashrc`、`~/.profile` | 硬编码 62 条 `/mnt/c` PATH 快照 | 改为 source 共享守卫 |
| `~/.zshrc` | `path=(${path:#/mnt/*})` 只过滤一级 | 已有等价守卫，验证有效，保留 |
| `~/.gitconfig` | `safe.directory = /mnt/d/projects/SQL审计工具`（重复 2 次） | `--unset-all` 清除 |
| `~/.config/xp-gate/.delphi-config.json` | 3 处 `persona_file: C:/Users/admin/...` | 移除该字段 |
| `~/.dsh/dsh-wsl.sh` | 上一轮加的 PATH 清洗**被重装覆盖丢失** | 重新写入，改用共享守卫 |
| 全局 `eslint` | **实际走的是 Windows shim** | 装 Linux 原生 `eslint@10`（v10.15.0） |

### 11.2 共享守卫

新建 `~/.config/xp-gate/env-guard.sh`，由 `~/.bashrc`、`~/.profile`、`~/.dsh/dsh-wsl.sh`
共同 source：

- 剔除 `/mnt/[a-z]/*` 与 `[A-Za-z]:/*` 形式的 PATH 条目；
- `unset` Windows 互操作变量：`APPDATA` `LOCALAPPDATA` `USERPROFILE` `HOMEDRIVE`
  `HOMEPATH` `SYSTEMROOT` `SystemRoot` `windir` `PROGRAMFILES` `COMMONPROGRAMFILES`
  `COMPUTERNAME` `NUMBER_OF_PROCESSORS` `OS` `PATHEXT`。

**为什么抽成一份**：守卫写两遍必然漂移，而漂移掉的那份没人会重读。
`dsh-wsl.sh` 里原本有一份独立实现，被一次重装覆盖后静默失效——就是这样丢的。

### 11.3 验证（注入污染后仍为 0）

```bash
# 注入 3 条 Windows PATH + 4 个 Windows 变量
env PATH="/mnt/c/Windows:/mnt/c/Program Files/nodejs:/mnt/d/tools:$PATH" \
    APPDATA='C:\Users\admin\AppData\Roaming' USERPROFILE='C:\Users\admin' \
    SYSTEMROOT='C:\Windows' COMPUTERNAME='DESKTOP-ABC' \
    bash -ic 'echo "$PATH" | tr ":" "\n" | grep -c "^/mnt/"'     # → 0
# 各变量 → <unset>；shellcheck/semgrep 仍解析到 ~/.local/bin
```

| 检查 | 结果 |
|---|---|
| 当前会话 PATH 的 `/mnt` 条目 | 0 |
| 登录 shell（`.profile`） | 0 |
| `zsh -ic` | 0 |
| 注入污染后的 `bash -ic` / `zsh -ic` | 0 / 0 |
| `~/.gitconfig` 的 `/mnt` 引用 | 0 |
| `.delphi-config.json` 的 Windows 路径 | 0 |
| 运行中的 DSH 进程 PATH | 0 |
| **12 个门禁工具的解析路径** | **全部 Linux 原生** |

### 11.4 一个重要发现：清理前 doctor 的绿是“Windows 撑着”的

清理后 `doctor` 一度报 `eslint — N/A`。追查发现：`~/.npm-global` 与 nvm 里**都没有全局
eslint**，项目内只有 `node_modules/.bin/eslint`（v10.3.0）。而清理前 doctor 显示的是
`v10.15.0` —— 那个版本来自 **`/mnt/c` 上的 Windows eslint**。

装好 Linux 原生 `eslint@10` 后，版本恰好也是 `v10.15.0`，`doctor` 恢复全绿。

> **这条值得记住**：门禁工具的“通过”可能由另一个操作系统的实现撑着。清理 PATH 会把
> 这类隐藏依赖暴露成 N/A —— 那是清理**起作用**的证据，不是回归。
> 现在 12 个工具（`jscpd` `lizard` `checkov` `hadolint` `gitleaks` `semgrep` `jq`
> `eslint` `npx` `pwsh` `shellcheck` `sqlite3`）全部解析到 Linux 路径。

### 11.5 有意保留的 Windows 引用

以下是**产品代码**，不是环境残留，不能删：

- `~/.config/xp-gate/adapters/lib/native-path.sh`、`toolchain-path.sh`、
  `php.sh`、`powershell.sh`：跨平台路径解析逻辑（含 `pwsh.exe` 探测路径）。
- `githooks/gate-entries/gate-6-entry.sh:297`：注释里的 Git 错误信息示例。
- `~/.dsh/AGENTS.md`：说明「PATH 里不该有 `/mnt/c`」的那段纪律本身。
- `env-guard.sh`、`dsh-wsl.sh`：守卫代码与解释守卫为何存在的注释。

### 11.6 仍未覆盖的一处

`/etc/wsl.conf` 归 root，`sudo` 需密码，本次未改动（按你的选择也不关挂载）。
若将来确实要关掉 Windows 盘挂载，需要：

```ini
# /etc/wsl.conf
[automount]
enabled = false
```

然后在 Windows PowerShell 执行 `wsl --shutdown`。**代价**：`/mnt/d/projects` 下的
项目将暂时访问不到。当前不需要。

---

## 12. check-tools / install-tools 重构（2026-11-23 下午）

### 12.1 需求与结论

要求：`check-tools` 检查**完备性、有效性、唯一性**并给出列表；`install-tools` 安装/升级并
保证每个工具**只有一个最新版本**；`doctor` 改为调用 `check-tools` 不再自己检查。

**未起 sprint-flow**：这两个命令已存在，本次是能力改造而非新特性，验收标准客观
（工具能不能执行、有没有重复、是不是最新），不存在需要多专家裁决的设计分歧。

### 12.2 发现并修复的四个真实缺陷

| # | 缺陷 | 证据 | 修复 |
|---|---|---|---|
| 1 | **有效性假阳性**：`psscriptanalyzer` 探针 `Get-Module -ListAvailable` 在模块缺失时仍 exit 0、输出为空，被判 available | 实测 exit 0 无输出，`Invoke-ScriptAnalyzer` 实际 ABSENT | 探针契约改为：非零退出**或**输出为空 → 不可用，并附原因 |
| 2 | **完备性缺口**：`check-tools` 只看当前项目语言，`doctor` 只看自己的 8 个 CLI 工具，并集从未被检查 | 两者各 8 项、内容不同 | 新增 `tool-audit.js`，清单 = 跨语言 CLI ∪ 语言工具，按名去重并合并门禁标签 |
| 3 | **唯一性不可见**：同名工具多份实体无人发现 | `hadolint` 两份字节相同的 54 MB 二进制；`jq`、`npx` 并存 | 审计报告 `duplicated` / `coexistingCopies`；`install-tools` 生成删除计划 |
| 4 | **doctor 同步阻塞事件循环**：版本查询用 `execFileSync` 跑 `npm view`，实测阻塞 ~5 s，导致同轮 `checkEnv` 的 `node --version`（正常 5 ms）超时被误判 Not found | 3/3 复现；CPU profile 中 `spawnSync` 占 6663 采样 | doctor 不再做版本查询；审计改为并发异步探测（`auditAllToolsAsync`）；doctor 耗时 7.0 s → 3.6 s |

### 12.3 语义澄清：什么才算“重复”

初版把两处共存误报为重复安装，会诱导人删系统包或删运行时：

- `/usr/bin/jq`（系统 1.6）+ `~/.local/bin/jq`（用户 1.8.2）：**并存**，不是重复
- `npx`：nvm 的 node 与系统 node **各带一份**：并存
- 两份**用户自有**的 `hadolint`：这才是重复

口径（用户确认）：**只清理同一工具的重复用户实体，不动系统包**。系统路径
（`/usr/bin`、`/bin` 等）与运行时路径（`~/.nvm/versions/node/*`）一律不产生删除动作。

### 12.4 一个自相矛盾的计划

实测：`hadolint` 既重复又过期。计划先删 `~/.local/bin/hadolint`，再跑安装命令——
而那条命令恰好**写到同一个路径**，重复立刻回来，“修复”等于没做。

现在 `planToolRepairs` 会标出 `writesToRemovedPath` 并**拒绝执行自相矛盾的计划**。

### 12.5 顺带修好的 WSL 阻塞缺陷

`githooks/lib/native-path.sh` 在 WSL 上会把 POSIX 路径转成 `\\wsl.localhost\...` 再交给
Linux 的 node，导致 `ERR_INVALID_MODULE_SPECIFIER`，**Gate 9 拒绝每一次提交**。
已安装副本上有一份本地补丁（ELf 消费者不转换），但正本没有——`xp-gate update-hooks`
会把它抹掉。本次已**合入正本**，doctor 的 drift 检查因此恢复 PASS。

### 12.6 archlint：升级评估后回退

0.17.1 需要 **GLIBC 2.39**，本机 2.35。升级后 `Gate 6` 报
`❌ BLOCKED - new high+ architecture findings` —— 这是把**加载失败**报成了架构发现，
正是本项目最反复的缺陷族。已回退到项目声明的 `^0.16.0`（`package.json` 与 lockfile 均干净）。

WSL 下 gnu 二进制无法加载，需用 musl 版；`npm install/ci` 会覆盖该修补，故新增
`scripts/fix-archlint-musl.sh`（支持 `--check`，故障注入已验证）。

### 12.7 最终状态

```text
doctor        ✓ All checks passed
check-tools   16 tools — 4 missing, 0 duplicated, 1 outdated, 2 unknown
install-tools No changes needed for the required tools
Gate 6        ✅ no new high+ findings
镜像检查      PASS
全量测试      4105 passed / 9 既有失败文件（与本轮之前同一集合）
```

4 个 missing 全部是 optional（terraform / tflint / dependency-cruiser /
psscriptanalyzer），不影响现有门禁。

### 12.8 新增测试

`tool-audit`、`tool-audit-collect`、`tool-audit-latest`、`check-tools-list`、
`install-tools-repair`、`doctor-tool-delegation` 六个文件，全部按 TDD 先红后绿；
`tool-audit-fixtures.js` 承载共享夹具（复制曾使单文件重复率超 15%）。
