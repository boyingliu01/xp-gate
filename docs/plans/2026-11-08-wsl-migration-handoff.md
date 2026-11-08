# WSL 迁移交接文档

**日期**: 2026-11-08
**分支**: `main` @ `ab912b80`
**版本**: `0.37.0.0`（npm 已发布 0.37.0）
**用途**: 把 Windows + DSH 环境下的工作完整移交到 WSL。本文记录**当前状态、遗留决策、以及接手前必须知道的坑**，不重复 CHANGELOG 已有的内容。

---

## 1. 当前状态（全部为实测，非推断）

| 项 | 值 | 验证方式 |
|---|---|---|
| `main` HEAD | `ab912b80` | `git log --oneline -1` |
| 与远端 | 完全同步，0 落后 0 领先 | `git status -sb` |
| 工作区 | 干净，无未提交/未跟踪 | `git status --short` 为空 |
| stash | 0 条 | `git stash list` |
| 本地分支 | **仅 `main`** | `git branch -vv` |
| worktree | **仅 `D:/projects/xp-gate`** | `git worktree list` |
| 开放 PR | 0 | `gh pr list --state open` |
| 开放 issue | 58（全部无 milestone） | `gh issue list --state open` |
| npm `latest` | `0.37.0` | registry `dist-tags` 直查 |
| GitHub Release | `v0.37.0` | `gh release view v0.37.0` |
| CI（`ab912b80`） | Quality Gates / Cross-Platform CI / npm-publish 三绿 | `gh run list` |

**这是本仓库最干净的状态**：单分支、单 worktree、零 stash、零 PR。

---

## 2. 本次整理做了什么

自 `7871c969`（0.37.0 发布提交）以来共 **42 个提交**。按性质分四类。

### 2.1 发布 0.37.0

走的是自动化流程：`VERSION` 改为 `0.37.0.0` 推到 main，`npm-publish.yml` 读 `VERSION` 派生 npm 版本与 tag，发布三个包并建 GitHub Release。

**注意**：npm 的 dist-tag 传播有延迟。本机上 `npm view` 会显示 `0.36.1` 长达数分钟，那是本地元数据缓存，`--prefer-online` 或直接查 `https://registry.npmjs.org/-/package/@boyingliu01%2Fxp-gate/dist-tags` 才是真实值。

### 2.2 合并分散的工作

| 来源 | 内容 |
|---|---|
| `merge/gate-6-and-cli-perf` | Gate 6 分层强制（#686/#691/#728）、CLI tsx 加速（#779）、镜像评估文档 |
| `feat/gate-6-layer-enforcement` | 独有的一条 mirror 守卫（其余 5 个提交内容已在上一分支） |
| `feat/iteration-speed-gate10` | `detect-deps` 门禁编号修复、Gate 10 sastd 降级路径（E1） |
| Gate 13 C# 严格度（PR #781） | C# 路径此前跑裸 `dotnet build`，严格度全inherit自被检查项目，`XP_GATE_COMPILER_STRICTNESS=strict` 对 C# 完全无效 |

合并后这些分支和 worktree 已全部删除。

### 2.3 修掉的真实缺陷

这些不是"顺手优化"，而是整理过程中暴露的、会让门禁给出错误结论的问题：

| 缺陷 | 后果 |
|---|---|
| `gate-6-layers.sh` 未登记进 `package.json` 的 `files` | **发布时该文件会丢失**，门禁在用户机器上不存在 |
| Gate 6 的 catch-all 把崩溃的检查器记成 WARN | fail-open：没跑完也算"未检查"，提交照常通过 |
| 配置分类 0 个文件却报 PASS | 真空通过：XP-Gate 自己的仓库就是例子（layer 名一个都不存在） |
| `patterns:` 数组解析为空 | 一个层声明两个目录时静默匹配不到任何文件 |
| bats 无法解析含长破折号的 `@test` 名 | 2 个用例被静默跳过且退出 0，其中一个正是"未跟踪文件被扫描" |
| `detect-deps` 说 semgrep 属 Gate 9 | Gate 9 是 Build Integrity，SAST 是 Gate 10。与 #717 同类漂移 |
| `npx-cli.js` 只认一种 Node 布局 | Linux CI 上退化成裸 `npx`，Windows 上 spawn 不出来 |
| `ccn-report` 不记录 lizard 版本 | 跨版本比较，1.21.3 与 1.25.0 对同一函数给出 18 vs 9 |

### 2.4 Gate 3 复杂度重构

Gate 3 棘轮报警的 8 个函数被真正降了复杂度（**没有刷新基线**）。

> **核心发现**：`ccn-report.cjs` 不直接用 lizard 的 CCN，而是自己数分支——正则 `/\b(if|else|for|while|case|catch)\b|\?\?|&&|\|\||\belif\b|\?[^.]/g` 扫函数体文本。**正则字面量里全是 `|` 和 `?`，会被当作分支计数。**
>
> `csharp.extractFunctions` 的 CCN 18 描述的是正则源码，不是代码。把常量正则移到模块作用域后降到 1。
>
> 这意味着 **Gate 3 的红灯有时报的不是复杂度，是正则写得密度高**。接手时看到 CCN 异常高，先看函数体里有没有内联正则。

重构等价性用**字节级 diff** 验证：重构前后对固定输入 dump 全部可观测输出（方法名/类型/参数数/import 的 used 标记/魔法数字行号），两份 dump 完全一致。

---

## 3. 遗留决策与未完成项

### 3.1 58 个开放 issue —— 用户决定保留

全部无 milestone，其中 56 个带 `migrating-to-wsl` 标签。**抽查确认为真实未修复的 bug**，不是"做完忘关"：

- `#770` uninstall 在共享 hooks 目录里把任何 `.sh` 都当自家文件删掉
- `#764` Gate 4 输出 0 errors 却报 FAIL，退出码 0 与 FAIL 矛盾
- `#772` Gate 12 用空格分隔字符串累加错误，一条语法错误被拆成一串假文件名
- `#777` doctor 超时报告的 pending 名单硬编码，与实际 check 名全部不匹配
- `#771` uninstall 报 "Some items could not be removed" 却不点名、退出码仍 0

**迁移时原样带走，不要批量关闭。**

### 3.2 `origin/bench-benchmark` 远端分支 —— 保留但不应合并

6 个提交，内容是往 `gate-4.sh` 里写注释形式的 `# bench marker 1794056574 1` 时间戳（三个镜像各一份）。

这是 hook 迭代耗时的测量脚手架。**合并会污染生产文件**。如果迁移后不再需要这套测量，可以删分支；需要重新测量就还在。

### 3.3 刻意没有刷新 `.ccn-baseline.json`

基线 1348 条，**没有 `analyzer` 块**（不记录是哪个 lizard 生成的）。

用 pinned 1.21.3 重新测量时，测出了旧基线预测但今天测不出来的差异（273 条、346 个函数）——说明这份基线出自一个仓库无从确认的分析器。**给它盖一个版本号等于把没人验证过的数字固化下来。**

所以只加了版本校验机制，没有给现有基线打版本。CI 日志现在是：

```
WARN — .ccn-baseline.json does not record which lizard wrote it; comparing against lizard 1.21.3. Run --write-baseline to record it.
```

**这是诚实的待办，不是遗漏。** 迁移后如果环境里的 lizard 版本对得上，可以考虑刷新；对不上就先保持现状。

### 3.4 `.architecture-baseline.json` 只手工追加了 1 条

Gate 6 的三份 `layer-baseline.cjs` 触发 archlint 的 HIGH CodeClone。三份副本是**必需的**：每个 `gate-6-layers.sh` 按 `dirname/lib/layer-baseline.cjs` 解析，`githooks/`、`src/npm-package/`、`src/npm-package/hooks/` 各需一份。这与 gate-3/4/7/13 的三树结构一致。

**只登记了这 1 条，没有跑 `archlint snapshot`** —— 那会一次吞掉 191 条已有条目（含大量 Medium LargeFile）。接受一个已知后果 ≠ 接受 191 个未审查的。

---

## 4. 接手前必须知道的坑

### 4.1 门禁编号是标签，不是身份

`githooks/gate-registry.sh` 是唯一真相源，把**门禁名**绑定到**执行文件**。编号只是位置。

这不是洁癖：本仓库的表曾把 Gate 9 写成 Semgrep SAST，而 hook 实际跑的是 Build Integrity。于是 #717 里一个 C# SAST 修复被写进 `gate-9.sh`——**那个文件从不被 hook 引用**，修复改了等于没改，但看起来已经落地。本次又发现 `detect-deps.js` 重复了同一个错误映射。

**看到门禁编号，先去 registry 核对名字。**

### 4.2 `.xp-gate/bypass-audit.jsonl` 是机器状态，不是源码

`.gitignore:100` 声明忽略它，但 **gitignore 对已跟踪文件不生效**。本次曾误提交（已撤销跟踪）。

判断方法：`git check-ignore -v <path>`。规则存在 ≠ 规则生效。

### 4.3 本机 lizard 与 CI 不是同一个安装

本机是 user-level 安装（`C:\Users\think\AppData\Roaming\Python\Python312\site-packages`），CI 是系统安装。**同一文件在本机的 per-file CSV 会吞掉部分函数**（例如 `base.ts` 本机 6 行，CI 更多）。

**以 CI 为准。** 本地跑 Gate 3 的结论与实际门禁可能有出入。

### 4.4 镜像树有两份，改错地方会被静默回滚

- `githooks/adapters/` ↔ `src/npm-package/adapters/`
- `githooks/lib/` ↔ `src/npm-package/hooks/lib/`
- `plugins/*/src/` ↔ `src/npm-package/plugins/*/src/`
- `skills/` ↔ `src/npm-package/skills/`
- `src/build-integrity/`、`src/principles/`

**永远改 canonical 侧**（左侧），然后 `node src/npm-package/scripts/sync-package-content.js`。镜像侧的手改会在下一次 prepack 被覆盖——v0.27.3 正是这样漏的发。

`bash scripts/check-hook-mirror.sh` 可以验证（本次为 build-integrity 和 skills 新加了守卫）。

### 4.5 Windows 特有的坑（迁到 WSL 后自动消失，但要知道曾经怎么绕的）

- `npx lizard` 报 `could not determine executable to run`，必须用 `python -m lizard`
- `Edit` / `npx tsx` 偶发 `spawn EPERM`（esbuild 沙箱），**编辑仍然生效**，用 grep/tsc 验证而不是重试
- `find / -name` 和 `python -m venv` 会挂起超过 600s，避免使用
- Git Bash 的 `/d/...` 路径在 Node 的 `writeFileSync` 里会解析成 `D:\d\...` 而失败，用 `D:/projects/...` 形式
- `sed -n`/`head`/`tail` 读取中文文件名时会有八进制转义，导致 `git cat-file -e` 误判"文件不存在"。**用文件清单 diff 而不是逐文件探测**

### 4.6 bats 全量运行在 Windows 会失败

`npx bats *.bats` 报 "The command line is too long"，是 Windows 命令行长度限制，与代码无关。CI 分批执行，以 CI 为准。

---

## 5. 接手后的建议起手式

```bash
# 1. 确认状态与本地一致
git log --oneline -1          # 应为 ab912b80 或更新
git status -sb                # 应无落后/领先
git worktree list             # 应只有主 worktree

# 2. 跑一遍门禁体检
xp-gate doctor
bash scripts/check-hook-mirror.sh
node src/npm-package/bin/xp-gate.js arch

# 3. 确认工具链
python -m lizard --version    # 应以 .lizard-version 为准
node --version && npm --version

# 4. 全量测试基线（耗时较长，先确认基线再动代码）
npx vitest run
```

### 起手时优先看的三个 issue

按"影响面 × 修复成本"排序，这三条最值得先做：

| issue | 为什么优先 |
|---|---|
| `#770` | uninstall 会删掉别人家的 `.sh` —— 数据破坏，用户机器上的 |
| `#764` / `#772` | 门禁自己报错时报出误导性信息，比不报更糟 |
| `#715` | Gate 6 双执行面结论分叉：pre-commit 与 CLI 对同一份配置给出相反判定 |

---

## 6. 一句话总结

**仓库已收敛到单分支、单 worktree、零 stash、零 PR、CI 全绿、0.37.0 已发布的状态，可以直接 clone 到 WSL 继续。**

58 个 issue 是真实待办，不是清理噪音，原样带走。
