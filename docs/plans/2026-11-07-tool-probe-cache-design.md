# 工具探测缓存设计：保留「不能假绿」，去掉「每次都跑」

- 日期：2026-11-07
- 状态：设计方案，待评审
- 前置：`2026-11-07-remaining-65s-bottleneck-analysis.md`
- 决策方：用户已同意「npx 探测默认关」，待定的是**缓存的失效策略**

---

## 0. 先回答「这些成本是不是原始的」

**部分是，但被你记错了一部分。**

原始设计意图确实是对的——`common-process.ts` 的注释写着三层回退是为了「不把
'not on this PATH' 当成 'not installed'」。`toolchain-path.sh` 更明确：

> Every gate that needs one of those probed only `command -v` / `npx --no-install` /
> `~/.local/bin`, so "not on this shell's PATH" was reported as "not installed".
> **Four gates did that for tools that were installed, and two of the reports were
> false GREENS** (a gate that never ran, reported as a WARN that reads like an
> optional tool missing).

但这**不能推出「每次都得重新探测」**。事实上：

### 事实 1：工具缺失时，大多数门禁判 WARN/SKIP，不是 FAIL

| 门禁 | 工具缺失时 |
|---|---|
| gate-3 (lizard) | `⚠️ WARN - lizard not installed` |
| gate-8 (gitleaks) | `⏭️ SKIPPED` |
| gate-9 (semgrep) | `⚠️ WARN - semgrep not installed` |
| gate-7 (checkov) | 类似 |

**所以「必须每次探测以免假绿」这个理由不成立**——探测失败本来就不产生绿，
它产生的是 WARN，而 WARN 在 #575 的修复后已经被正确计入 `effectivePassRate`。

### 事实 2：真正的假绿风险在别处

`AGENTS.md` 的政策是 **「Tool missing → SKIP, not BLOCK — except Gate 8」**。
造成假绿的不是「探测不够频繁」，而是**「SKIP 被当成通过」**——那是 #575、已经被修了。

### 事实 3：成本与项目内容无关

在 0 个 Python 文件的项目上探测 5 个 Python 工具，在 0 个 IaC 文件的项目上
花 5.2 秒——**这些成本不产生任何关于代码的信息**。

**结论：原始意图（不能假绿）必须保留；「每次运行都重新付一遍冷启动」是实现方式问题，不是设计原则。**

---

## 1. 方案总览

三层，按「先便宜后昂贵」排序：

```
① 输入短路（零成本）      项目里没有相关文件 → 根本不探测
       ↓ 有输入
② 探测缓存（几毫秒）      本机探测过 → 直接读缓存
       ↓ 缓存未命中
③ 真实探测（几秒）        走原有三层回退
```

**关键原则：缓存只能加速「已经正确的判断」，不能改变判断结果。**
缓存未命中时行为与今天完全一致。

---

## 2. 第一层：输入短路（收益最大，零风险）

### 2.1 原则

**先判断「有没有可检的东西」，再决定要不要启动工具。**

### 2.2 各门禁的短路条件

| 门禁 | 工具 | 短路条件（无匹配输入） |
|---|---|---|
| gate-9 SAST | semgrep | 无 semgrep 支持语言的源文件 |
| gate-7 IaC | checkov | 无 `.tf` / `.yaml(k8s)` / `Dockerfile` |
| python-health | mypy/pytest/... | 无 `.py` / `pyproject.toml` / `requirements.txt` / `.python-version` |

### 2.3 gate-9 的具体修复

**现状的问题**（`gate-9.ts:47`）：

```ts
const tool = isToolAvailable('semgrep', input.cwd);   // ← 先探测，12 秒
if (!tool.available) { ...WARN...; return; }

const semgrepFiles = filterSemgrepFiles(input.changedFiles);
if (semgrepFiles.length === 0) {                      // ← 后判断，已经晚了
  ...
}
```

**修复**：把 `filterSemgrepFiles` 提到探测之前。**这一处改动就能省掉单文件项目上 12 秒。**

### 2.4 防「短路过头」的测试要求

每条短路都必须配一个**「必须不被短路」**的 fixture，否则就是 #615/#728 那一类：

| 短路条件 | 必须验证的用例 |
|---|---|
| 无 `.py` 文件 | 有 `pyproject.toml` 但无 `.py` 时**仍需**报告 Python 环境问题 |
| 无 semgrep 文件 | 有 `.py` 文件时 semgrep **必须**被启动 |
| 无 IaC 文件 | 有一个 `Dockerfile` 时 checkov **必须**被调用 |

**这是硬性要求**：短路条件写错会造成「声称检查了实际没检查」，
而这是本项目最严重的一类缺陷。

---

## 3. 第二层：探测缓存

### 3.1 两种缓存，用途不同

| 类型 | 存储 | 生命周期 | 用途 |
|---|---|---|---|
| **进程内缓存** | `Map` 内存 | 单次 `xp-gate check` 运行 | 同一进程内多个门禁重复探测同一工具 |
| **跨进程缓存** | `.xp-gate/tool-cache.json` | 按 TTL | 多次运行之间（用户一天跑好几次） |

**两者都要**：进程内缓存零成本但只解决一次运行内的重复；
跨进程缓存才是你说的「一天探测一次」。

### 3.2 进程内缓存（先做，极简）

```ts
const PROBE_CACHE = new Map<string, ToolAvailability>();

export function isToolAvailable(tool: string, cwd?: string): ToolAvailability {
  const key = `${tool}\u0000${cwd ?? ''}`;
  const cached = PROBE_CACHE.get(key);
  if (cached) return cached;

  const result = probeInOrder(tool, cwd);   // 原有三层逻辑，原样保留
  PROBE_CACHE.set(key, result);
  return result;
}
```

**风险：零。** 纯函数结果缓存，同一进程内环境不会变。

### 3.3 跨进程缓存：需要设计失效

这是真正需要讨论的部分。

#### 记录什么

```json
{
  "version": 1,
  "entries": {
    "semgrep": {
      "available": true,
      "path": "C:\\...\\semgrep.exe",
      "via": "path",
      "probedAt": "2026-11-07T15:30:00Z",
      "hostKey": "win32-x64-node24"
    }
  }
}
```

#### 失效条件（三个都要）

| 条件 | 理由 |
|---|---|
| **TTL 过期**（建议 24 小时） | 用户可能中途装了新工具 |
| **PATH 变化** | PATH 变了，工具可用性可能变 |
| **hostKey 变化**（platform + arch + node 大版本） | 换了机器/环境，缓存无意义 |

**PATH 怎么快速判断变化**：存 PATH 字符串的哈希，不用存全量 PATH。

```json
"envHash": "a3f2..."   // sha256(PATH + PATHEXT)
```

### 3.4 你提的关键问题：缓存不可靠怎么办

**答：缓存不可靠的代价要远小于「每次都探测」的代价，而且可以被兜住。**

具体来说，用缓存的**唯一风险**是：缓存说「工具可用」，但实际上已经被卸载了。

这时会发生什么？

```
缓存命中 → 认为 semgrep 可用 → 真的去调 semgrep → 调用失败
         → 门禁报错（不是假绿）
```

**这是一个安全的失败模式**：它不会产生假绿，只会产生一次失败，而那次失败会
提示用户「工具在缓存里但实际不可用」。

**关键设计**：**缓存命中后如果真实调用失败，必须自动失效该缓存条目并重试一次探测。**

```ts
// 伪代码
const tool = isToolAvailable('semgrep', cwd);   // 可能来自缓存
const result = runTool(tool.path, args);
if (result.exitCode !== 0 && tool.via !== 'none' && fromCache) {
  invalidateCache('semgrep');                    // 缓存错了，清掉
  const retry = probeToolDirect('semgrep');      // 重新探测一次
  if (retry.available) { /* 用新路径重跑 */ }
  else { /* 报「工具不可用」，这是真实结论 */ }
}
```

**这保证了：缓存再错，也不会让门禁假绿。**

### 3.5 一个必须明确的语义

**缓存的是「探测结果」，不是「门禁结论」。**

| 缓存 | 是否缓存 |
|---|---|
| 工具在不在、路径是什么 | ✅ 缓存 |
| 门禁跑出来的 PASS/FAIL | ❌ **绝不缓存** |

**门禁结论每次都重新计算。** 只有「工具在哪」这件环境事实才缓存。

这回应了你最初的问题——「想避免门禁说检查了但没检查」这个目标**完全不受影响**，
因为门禁该跑还是跑，只是不用每次都重新找工具。

---

## 4. 第三层：npx 探测默认关（你已同意）

### 4.1 为什么它应该关

`probeToolNpx` 的实现：

```ts
spawnSync('npx', ['--yes', tool, '--version'], { timeout: 15000, ... })
```

**`--yes` 意味着「不用问我，直接下载安装」。**

也就是说，为了回答「这个工具在不在」，XP-Gate 会：
1. 访问 npm registry
2. 下载整个包
3. 运行它

**这在语义上是错的**，而且有三个实际后果：
- 每次 4-6 秒
- 离线环境下卡到 15 秒超时
- 在别人的机器上悄悄装包

### 4.2 建议的开关设计

```bash
# 默认：不做 npx 探测
XP_GATE_NPX_PROBE=0        # 默认值

# 需要时显式开启
XP_GATE_NPX_PROBE=1
```

**默认关，但保留能力。** 需要在 CI 里用 npx 工具的项目显式打开。

### 4.3 关闭后会影响什么（诚实评估）

**受影响**：访问 PATH 里没有、但可以通过 `npx` 临时获取的工具。

**具体到本仓库**：
- `semgrep` 在 PATH 里（Python Scripts），不受影响
- `lizard` 通常 `pip install` 后就在 PATH
- `mypy`/`ruff` 同理

**真正会用 npx 的**：只有那些「故意不想全局安装」的场景。

**建议同时改一处文档**：`AGENTS.md` 的「Tool missing → SKIP」政策里，
加一句「npx 探测默认关闭，需要时设 `XP_GATE_NPX_PROBE=1`」。

---

## 5. 预期收益（单文件项目，基于实测）

| 项 | 现状 | 改动后 | 依据 |
|---|---:|---:|---|
| gate-9 | 25.9s | **~2s** | 输入短路跳过 semgrep 启动 |
| python-health | 15.6s | **~0s** | 无 `.py`，短路 |
| gate-7 | 5.2s | **~0.3s** | 无 IaC 文件，短路 |
| test-layers | 6.9s | 6.9s | 无外部工具，纯 tsx |
| pbt | 7.1s | 7.1s | 同上 |
| 其余 | ~17s | ~17s | |
| **总计** | **~78s** | **~33s** | |

**再叠加 tsx 相关优化**（O11）后约 25 秒。

---

## 6. 需要你确认的三个点

**① TTL 选多久？**
我建议 **24 小时**。你说的「一天探测一次」正好匹配。
更短（如 1 小时）意义不大——用户装工具后通常不会马上重跑门禁。

**② 缓存放哪？**
`.xp-gate/tool-cache.json`（和现有 `audit`、`reports` 同目录，已被 gitignore）。
备选：`os.tmpdir()` 下的全局缓存（跨项目共享，但需要处理并发写）。
**我建议前者**——作用域清晰，不会污染其他项目。

**③ 缓存错了要不要「安静修复」？**
我上面写的是「调用失败 → 清缓存 → 重探一次」。
另一种选择是「直接失败，提示用户删缓存」。
**我建议自动重探**——因为缓存错不是用户的错，不该让他手工处理。

---

## 7. 不做什么

- **不缓存门禁结论。** 只有「工具在哪」可缓存
- **不改变「工具缺失时报什么」。** 仍然是 WARN/SKIP，行为完全不变
- **不在缓存命中时跳过镜像/字节检查。** 那些是代码相关问题，必须每次算
