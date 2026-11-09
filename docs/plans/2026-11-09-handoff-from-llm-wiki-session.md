# 交接：XP-Gate 遗留问题（来自 LLM-wiki 会话）

- 日期：2026-11-09
- 来源：LLM-wiki 知识库会话（该会话在 LLM-wiki 项目中运行，不在本仓库）
- 目标仓库版本：`origin/main` @ `b39f7171`，VERSION `0.37.2.0`
- 前置阅读：`docs/plans/2026-11-07-gate-6-layer-enforcement-design.md`、
  `docs/plans/2026-11-07-tool-probe-cache-design.md`、
  `docs/plans/2026-11-07-remaining-65s-bottleneck-analysis.md`

---

## 0. 一句话

上一会话完成了 Gate 6 分层校验并合入 main，也定位了剩余性能瓶颈；
**已交付的都在 main 上且验证通过**，剩下的是性能优化与结构治理，尚未开工。

---

## 1. 已经完成并合入 main 的部分（不要重做）

| 内容 | 状态 | 验证方式 |
|---|---|---|
| Gate 6 分层边界校验器 `githooks/gate-6-layers.sh` | ✅ 在 main | `bash githooks/gate-6-layers.sh` |
| Ratchet 基线 `githooks/lib/layer-baseline.cjs` | ✅ 在 main | 18 个 bats 用例覆盖 |
| CLI tsx 冷启动优化 | ✅ 在 main（上游 `236903df`，非本会话版本） | `gate-runner-tsx-invocation.test.js` 8/8 |
| 镜像守卫补 `build-integrity` / `skills` 两棵树 | ✅ 在 main | `check-hook-mirror.sh` PASS |
| `.xp-gate/bypass-audit.jsonl` 取消跟踪 | ✅ 在 main | `.gitignore:100` |

**Gate 6 的 4 处关键修复**（评审要求，已全部落地）：

```bash
# 1. githooks/pre-commit — 校验器崩溃不再 fail-open
*)  GATE_6_LAYER_STATUS="BLOCK"; GATE_6_STATUS="FAIL"
    GATE_6_LAYER_REASON="layer_checker_crashed_rc_${LAYER_RC}" ;;

# 2. githooks/gate-6-layers.sh — 空洞配置不再报 PASS
if [ "$LAYER_CLASSIFIED" -eq 0 ]; then
  _layers_verdict 3 "⚠️ 0 of N scanned file(s) match any declared layer..." \
    "layer_config_matches_no_files"
fi

# 3. githooks/gate-6-layers.sh — patterns: 复数数组
else if (body ~ /^patterns?:/) { pattern = clean(...) }

# 4. bats 测试名移除 em dash（此前 2 个用例静默跳过）
```

**核对命令**：
```bash
git show origin/main:githooks/gate-6-layers.sh | grep -c 'layer_config_matches_no_files\|patterns?:'   # 应为 2
git show origin/main:githooks/pre-commit      | grep -c 'layer_checker_crashed_rc'                     # 应为 1
git show origin/main:githooks/__tests__/gate-6-layers.test.bats | grep -c '^@test'                     # 应为 18
```

---

## 2. 遗留问题清单（按优先级）

### P0 — 工具探测的成本与语义

**这是最大的剩余开销来源。** 详见 `docs/plans/2026-11-07-tool-probe-cache-design.md`。

#### P0-A 输入短路（收益最大，风险最低）

**问题**：门禁在没有任何相关文件的项目上仍启动昂贵工具。

**`gate-9.ts` 的具体缺陷**（顺序错误，2026-11-09 复核仍然存在）：

```ts
// src/gates/gate-9.ts:47  — 先探测，11-13 秒
const tool = isToolAvailable('semgrep', input.cwd);
if (!tool.available) { ...WARN... }

// src/gates/gate-9.ts:61  — 后判断，已经晚了
const semgrepFiles = filterSemgrepFiles(input.changedFiles);
if (semgrepFiles.length === 0) { ...SKIP...; return; }
```

把 `filterSemgrepFiles` 提到第 47 行之前，单这一处省 ~12 秒。

**注意**：`00c578ce`（`feat/iteration-speed-gate10` 分支）已经让 semgrep 路径可切换，
**动手前先看那个分支**，确认顺序修复是否已被覆盖或冲突。

**同类问题**：
- `python-health` 无条件探测 `mypy/pytest/ruff/flake8/black`，与项目有无 `.py` 无关
- `gate-7`（IaC）已经能检测「无 IaC 文件」，但**在启动工具之后**才判断

**硬性要求**：每条短路必须配「**必须不被短路**」的用例。否则就是 #615/#728 那一类。

#### P0-B `probeToolNpx` 默认关闭（用户已拍板）

```ts
spawnSync('npx', ['--yes', tool, '--version'], { timeout: 15000 })
```

`--yes` 意味着「不用问，直接下载安装」。为了回答「工具在不在」，会访问 registry、下载包、运行它。

**用户决定：默认关闭**（`XP_GATE_NPX_PROBE=0`）。

**注意**：评审建议比「默认关」更彻底——**从默认路径彻底移除**，保留在显式 opt-in 下并文档标注「会安装包」，且加测试断言**开关未设时不发生任何 spawn**。

#### P0-C 探测缓存（评审要求先证明必要性）

**评审的核心批评**（architecture 席位）：

> 缓存是一个新的跨进程状态存储，有它自己的失效模式，但设计把它当作低风险，
> 而实际测到的成本驱动（semgrep 11-13s、npx 探测）用「顺序调整」和「默认关闭」就能解决。
> **Layer 1 + Layer 3 很可能独力达成目标，根本不需要引入持久化缓存。**

**因此：先做 P0-A + P0-B，实测收益，再决定是否需要缓存。**

若确需缓存，评审指出的必须解决的问题：

| # | 问题 | 要求 |
|---|---|---|
| 1 | 失效规格不足 | `envHash = sha256(PATH+PATHEXT)` 漏了**工具版本变化**、**shim 切换**（nvm/pyenv/asdf）、**MSYS2 vs 原生 PATH 分歧** |
| 2 | 「自动重探」语义未定义 | 缓存说可用但门禁走 WARN 分支时要否失效？必须写清 |
| 3 | 无并发写保护 | pre-commit / pre-push 可能并行；需要写临时文件+原子 rename、读时 try/catch、单写者约定 |
| 4 | 缓存错了怎么办 | 建议：调用失败 → 清缓存 → 重探一次。**缓存再错也不能假绿** |

**语义边界（不可违背）**：缓存的是「工具在哪」，**绝不是「门禁结论」**。

---

### P1 — 结构治理：镜像副本

**实测（2026-11-09 复测）**：

| 指标 | 2026-11-07 | 2026-11-09 |
|---|---:|---:|
| 仓库总行数 | 228,997 | **412,981** |
| `src/npm-package/` 镜像占比 | 49.8% | **45.3%** |
| 纯复制镜像文件 | 809 / 126,794 行 | **903 / 131,250 行** |

**占比略降，绝对量增加了约 4,500 行——问题没解决，还在扩大。**

**关键事实**：仓库里**已并存两套方案**：

| 路径 | git 跟踪 | 方案 |
|---|---:|---|
| `src/npm-package/gates/` | 0 | **构建产物**（gitignore，`prepack` 生成） |
| `src/npm-package/adapters/` | 293 | git 跟踪镜像 |
| `src/npm-package/hooks/` | 37 | git 跟踪镜像 |
| `src/npm-package/principles/` | 107 | git 跟踪镜像 |

`.gitignore:15-18` 记录了 `gates/` 为什么改成构建产物：

> tracked byte-identical copies of the same test files **trip archlint CodeClone + Gate 5a**

**有人踩过这个坑，修了 `gates/`，但没有推广。**

**注意风险**：把镜像改成构建产物有 **8 个直接依赖方**：
4 个 `scripts/check-*mirror*.sh` + 4 个引用 `npm-package` 的 GitHub workflow。
另有 6 个测试文件涉及镜像断言。**不是小改动。**

---

### P2 — 未验证的项

| 项 | 说明 |
|---|---|
| `git ls-files --others` 性能 | 10k+ 未跟踪文件仓库上的表现未基准测试（当前本仓库 727 文件下约 2 秒） |
| `check-hook-mirror.sh` 是否跑在 CI | 需确认 `cross-platform-ci.yml` 里有这一步 |
| YAML block-list 形式的 `patterns:` | `- item` 每行一项的写法未解析，会退化为空洞 WARN（fail-closed，安全） |
| rc=4 契约文档化 | 已在 `layer-baseline.cjs` 文件头说明，用户文档未覆盖 |

---

## 3. 测量方法学（重要，避免重蹈覆辙）

### ⚠️ 测量目录必须用本地盘，不能用 `/tmp`

**本次交接时踩到的坑**：用 `/tmp/xpath`（即 `C:\Users\think\AppData\Local\Temp`）测
`check --all`，**240 秒仍未完成**，看起来像严重退化。

换到本地盘同样内容：

| 测量 | `/tmp`（Temp 目录） | 本地盘 |
|---|---:|---:|
| `archlint scan`（1 个文件） | **>120s** | **1s** |
| `check --all`（1 个文件） | **>240s 未完成** | **44s，17 道门禁全部完成** |

**结论：`/tmp` 在 Windows 上会导致 archlint 极慢（约 120 倍）。**

此前的测量若基于 `/tmp` 需重做。`docs/plans/2026-11-07-remaining-65s-bottleneck-analysis.md`
里的逐门禁数字需确认测量目录。

### 2026-11-09 实测基线（本地盘，单 .ts 文件 fixture）

```
check --all 全流程                              44s   rc=0   17 道门禁
├─ gate-8                                        4.8s  rc=0
├─ gate-9                                        2.1s  rc=0   ← 已被 #779 优化，原 25.9s
├─ gate-10                                       1.5s  rc=1
├─ python-health                                10.2s  rc=0   ← 零 .py 文件仍探测 5 个工具
└─ test-layers                                   0.8s  rc=0
```

**`python-health` 的 10.2 秒是当前最大单点开销**，且项目里一个 Python 文件都没有。
这正是 P0-A「输入短路」要解决的。

### 其他测量规则（沿用 `~/.dsh/AGENTS.md`）

1. **测用户真实路径**：入口有 `git hook` / `xp-gate check` / `skill` 三条，只测一条等于没测
2. **小项目找启动开销，真项目找算法开销**
3. **「处处都慢」时换空项目重测**：空项目也慢 → 问题在启动路径
4. **ABBA 交替采样**，记录每轮负载，负载差 >5% 的对比无效

---

## 4. 上游已在进行的工作（不要重复）

| 内容 | 提交 | 状态 |
|---|---|---|
| tsx 通过 node 直调（#779 的正确实现） | `236903df` | 已合入 main，本会话版本已放弃 |
| semgrep 路径可切换（sastd 常驻进程的地基） | `00c578ce` | 分支 `feat/iteration-speed-gate10` |

**`00c578ce` 的关键测量**（与本文档 P0-A 相关）：

> `semgrep --version` 单独就 4.3-5.3 秒，因为 CLI 急切导入
> commands.ci → app.auth → telemetry → opentelemetry → requests → urllib3，
> 而进程内第二次 `import semgrep.commands.scan` 是 0ms。

**这意味着**：如果你在做 semgrep 相关优化，**先看 `feat/iteration-speed-gate10` 分支**，
可能已有重叠工作。

---

## 5. 已验证的接口与事实

### Gate 6 退出码契约

```
0 = PASS   无违规
1 = FAIL   有新增违规
2 = BLOCK  配置存在但不可用（fail-closed）
3 = WARN   无配置 / 违规全在基线内 / **配置匹配不到任何文件**
4 = EXIT_BASELINE_UNREADABLE （layer-baseline.cjs 独立约定，调用方映射为 BLOCK）
其他（126/127/137/bash 错误）= BLOCK，reason `layer_checker_crashed_rc_<code>`
```

### 环境变量

| 变量 | 作用 |
|---|---|
| `XP_GATE_LAYER_CONFIG` | 覆盖 `architecture.yaml` 路径 |
| `XP_GATE_LAYER_BASELINE` | 覆盖基线 ledger 路径 |
| `XP_GATE_LAYER_SCAN_ROOT` | 覆盖扫描根 |
| `XP_GATE_NPX_PROBE` | **待实现**，npx 探测开关 |

### `architecture.yaml` 的语义

本仓库的 `architecture.yaml` 声明的
`src/domain|application|infrastructure|presentation|shared`
**在 xp-gate 自己仓库里一个都不存在**——它是发给用户项目的 Clean Architecture 模板。

因此在本仓库上跑 Gate 6 会得到 `WARN / layer_config_matches_no_files`（rc=3），
**这是正确行为**：诚实地说明「声明了但没东西可查」，而不是报 PASS。

---

## 6. 建议的接手顺序

| 顺序 | 事项 | 预期收益 | 风险 |
|---|---|---|---|
| 1 | **P0-A 输入短路**（gate-9 顺序修复优先） | 单文件项目省 ~12s | 低（需配「不被短路」用例） |
| 2 | **P0-B npx 探测移除** | 省 ~4-6s/工具 | 中（改变环境不可用工具的判定） |
| 3 | 实测 1+2 的收益 | 决定是否需要 P0-C | — |
| 4 | P0-C 缓存（**仅当 3 证明必要**） | 视情况 | 需先解决失效规格/并发/语义边界 |
| 5 | P1 镜像治理 | 结构性 | **高**（11 个依赖方） |

**不要跳过第 3 步。** 评审最尖锐的批评就是「用顺序调整和默认关闭就能解决」，
而上一会话**没有验证过这句话**——先测，再决定。

---

## 7. 本会话产出的文档（可直接读）

**已在 main 上**：

| 文件 | 内容 |
|---|---|
| `docs/plans/2026-11-07-gate-6-layer-enforcement-design.md` | Gate 6 设计 |
| `docs/plans/2026-11-07-self-architecture-governance.md` | 自身架构治理（含 §9） |
| `docs/plans/2026-11-07-mirror-reevaluation.md` | 镜像重新评估（含 §8 盲区审计） |
| `docs/plans/2026-11-07-remaining-65s-bottleneck-analysis.md` | 剩余耗时逐门禁实测（**注意：见 §3 测量目录警告**） |
| `docs/plans/2026-11-07-tool-probe-cache-design.md` | 探测缓存设计 + Delphi 评审结论 |

**仅在分支 `merge/gate-6-and-cli-perf` 上（提交 `6872f109`，未合入 main）**：

| 文件 | 内容 |
|---|---|
| `docs/plans/2026-11-08-delphi-walkthrough-evidence.md` | Delphi code-walkthrough 评审材料 |

若该分支已被清理，可用 `git show 6872f109:docs/plans/2026-11-08-delphi-walkthrough-evidence.md` 取回。

---

## 8. 一个工具缺陷（与 xp-gate 无关，但会影响你的工作流）

**Delphi 插件把 `.code-walkthrough-result.json` 写到「会话工作目录」，而不是传入的 `cwd`。**

后果：在不同项目的工作空间里跑 Delphi，会拿到**绑定另一个仓库 HEAD 的证据**。
Gate MW 会正确拒绝（或更糟：在别处误通过）。

**本次交接就是因为这个**：评审在 LLM-wiki 项目里执行，证据写到了 LLM-wiki，
`commit` 字段指向的不是 xp-gate 的分支 HEAD。

**规避**：在**要推送的那个仓库目录**里执行 Delphi 评审。
