# 剩余 65 秒的瓶颈定位：不是 tsx，是工具探测与冷启动

- 日期：2026-11-07
- 状态：已定位，待决策
- 前置：`1084cdd9`（CLI tsx 优化，117s → 44-85s）
- 测量环境：Windows 11 + MSYS2，fixture 为**仅 1 个 `.ts` 文件**的项目

---

## 0. 结论先行

npx→node 修完之后，剩下的时间**和 tsx 无关**。插桩实测显示所有 TS 门禁都已经走 `node`，
但每道仍要 5–26 秒。

真正的剩余瓶颈是三类，全部是**在没有任何相应代码的项目上，仍然启动昂贵工具**：

| 类别 | 单次开销 | 影响门禁 |
|---|---|---|
| **semgrep 冷启动** | **11–13 秒** | Gate 9 |
| **npx 工具探测**（PATH 找不到时） | 4–6 秒/工具 | python-health、Gate 9 |
| **tsx 启动基线** | ~2 秒/门禁 | 全部 TS 门禁 |

---

## 1. 实测数据

### 1.1 逐门禁耗时（插桩 `runTsGate`，单文件项目）

| 门禁 | 耗时 | 运行方式 |
|---|---:|---|
| gate-3 | 5,129 ms | node |
| gate-7 | 5,214 ms | node |
| gate-8 | 8,179 ms | node |
| **gate-9** | **25,949 ms** | node |
| **python-health** | **15,618 ms** | node |
| **test-layers** | **6,876 ms** | node |
| **pbt-detect** | **7,127 ms** | node |

**三个 TS 门禁（gate-9 / python-health / test-layers + pbt）合计约 55 秒。**

注意：`gate-7`（IaC 扫描）在没有任何 Terraform/K8s/Docker 文件的项目上花了 5.2 秒。

### 1.2 基线对照

| 项 | 实测 |
|---|---:|
| tsx 空跑（`-e "process.exit(0)"`） | 2,299 ms |
| tsx 加载后 `-e "console.log(1)"` | 1,850 ms |
| **`semgrep --version`（shell:true）** | **13,670 ms** |
| **`semgrep.exe --version`（绝对路径，无 shell）** | **11,691 ms** |
| `where semgrep`（无 shell） | 1,327 ms |
| `npx -y mypy --version` | 4,277 ms |
| `npx -y ruff --version` | 5,904 ms |
| `npx -y semgrep --version` | 5,284 ms |

**结论：`shell:true` 不是主因**（11.7s vs 13.7s，差 2 秒）。`semgrep` 在 Windows 上
单次启动就要 11 秒以上，这是 Python 脚本包装器的固有开销。

---

## 2. 三类瓶颈的机制

### 2.1 Gate 9：semgrep 无论如何都要启动

`src/gates/gate-9.ts:47`：

```ts
const tool = isToolAvailable('semgrep', input.cwd);
```

`isToolAvailable` 是三层探测（`common-process.ts:66`）：

```
Tier 1: probeToolPath  → spawnSync('where', [tool])      约 0.4-1.3 s
Tier 2: probeToolNpx   → spawnSync('npx', ['--yes', tool, '--version'])  约 4-6 s
Tier 3: ~/.local/bin   → 仅非 Windows
```

**即使 Tier 1 成功找到 semgrep（本项目实测确实找到了），后续调用 semgrep 本身仍要 11 秒。**

这是一个「有工具就慢，没工具也慢」的结构：探测失败走 npx（5 秒），探测成功走真工具（12 秒）。

### 2.2 python-health：在零 Python 文件的项目上探测 5 个工具

`src/gates/python-health.ts` 探测 `PYTHON_REQUIRED_TOOLS = ['mypy','pytest']` +
`PYTHON_OPTIONAL_TOOLS = ['ruff','flake8','black']`。

**这 5 个工具无论如何都会探测，项目里有没有 `.py` 文件不影响。**

在 PATH 里找不到的每个工具都触发一次 `npx --yes <tool> --version`（4–6 秒）。
实测 `python-health` 总耗时 15.6 秒，与「5 个工具中约 3 个走 npx」吻合。

### 2.3 pbt-detect / test-layers：纯 tsx 启动

这两个没有外部进程调用（`grep` 确认），6.8–7.1 秒 ≈ 2 秒 tsx 启动 + 目录扫描。

`test-layers` 在有 4 个文件的项目上花 6.9 秒，说明目录扫描本身很轻，
**剩下的是 tsx 启动 + 模块加载图**。

---

## 3. 为什么这属于「结构问题」而非「性能优化」

关键观察：**这些成本与项目内容完全无关。**

| 项目里有 | 仍然付出的成本 |
|---|---|
| 0 个 Python 文件 | python-health 探测 5 个 Python 工具 |
| 0 个 semgrep 规则目标 | Gate 9 启动 semgrep 12 秒 |
| 0 个 IaC 文件 | Gate 7 扫描 5.2 秒 |
| 1 个 TS 文件 | 每道 TS 门禁 2 秒 tsx 启动 |

这正是复盘文档 §5 提出的 `scope` 维度要解决的问题：

> `none` — no matching inputs in this commit -> **must not start a tool**

**今天没有任何一道门禁实现这个短路。**

---

## 4. 优化方案（按收益/风险排序）

### O8 — 工具探测加缓存（收益最大，风险最低）

**问题**：同一进程内，`isToolAvailable('semgrep')` 可能被多个门禁反复调用；
`npx --yes <tool>` 失败的结果没有缓存，下次再问还要再等 4-6 秒。

**改法**：在 `common-process.ts` 加一个进程内 Map：

```ts
const PROBE_CACHE = new Map<string, ToolAvailability>();
export function isToolAvailable(tool: string, cwd?: string): ToolAvailability {
  const key = `${tool}::${cwd ?? ''}`;
  const cached = PROBE_CACHE.get(key);
  if (cached) return cached;
  // ...existing three tiers...
  PROBE_CACHE.set(key, result);
  return result;
}
```

**收益**：跨门禁的重复探测归零。**风险**：极低（纯缓存，行为不变）。

### O9 — npx 探测默认关闭（收益大，有争议）

**问题**：`probeToolNpx` 用 `npx --yes <tool> --version`——**`--yes` 意味着它会真的下载并
安装这个包**，只为回答「这个工具在不在」。

**这在语义上是错的**：一个工具能不能通过 npx 拿到，和它当前是否可用，是两件事。
而且它把「环境探测」变成了「网络 I/O + 包安装」。

**改法（建议）**：默认**不**做 npx 探测，改为显式开关 `XP_GATE_ALLOW_NPX_PROBE=1`。

**收益**：python-health 从 15.6 秒降到可能 2-3 秒。**风险**：中——某些环境下工具确实只能通过
npx 获得，关闭后会被判「不可用」。**这是需要你拍板的产品决策**，不是纯技术选择。

### O10 — 按输入短路（收益最大，工作量最大）

**模式**：

| 门禁 | 短路条件 |
|---|---|
| python-health | 无 `.py` / `pyproject.toml` / `requirements.txt` |
| Gate 9 (semgrep) | 无可扫描语言的源文件 |
| Gate 7 (IaC) | 无 `.tf` / `k8s` / `Dockerfile` |
| pbt-detect | 无测试文件 |

**Gate 7 已经有类似逻辑**（输出 "No IaC files detected in changes."），但**仍然花了 5.2 秒**
——说明它先启动了工具才判断。这个短路应该在**启动前**。

**收益**：单文件项目上可能从 55 秒降到 5 秒以内。**风险**：低（判断是纯文件存在性检查），
但要小心「短路条件写错导致真该查的时候没查」——**这正是 #615/#728 那一类**。
每条短路都需要一个「必须不被短路」的 fixture。

### O11 — tsx 换 node 原生 type stripping（中等，取决于 Node 版本）

Node 22.6+ 支持 `--experimental-strip-types`，Node 23+ 默认支持。
`engines` 声明 `>=18`，所以**不能无条件依赖**，但可以探测。

**收益**：省掉每道门禁 ~2 秒 tsx 启动。**风险**：中（Node 18/20 用户仍要走 tsx）。

---

## 5. 建议的执行顺序

| 顺序 | 项 | 预期收益 | 风险 | 是否需要你决策 |
|---|---|---|---:|---|
| 1 | **O8 探测缓存** | 中等 | 极低 | 否 |
| 2 | **O10 输入短路** | **大** | 低 | 否（但要配 fixture） |
| 3 | O11 node 原生 TS | 中 | 中 | 否 |
| 4 | **O9 npx 探测默认关** | 大 | 中 | **是** |

**O9 需要你拍板**：关掉 npx 探测会让「只能通过 npx 获得的工具」被判不可用。
这改变了 XP-Gate 在纯净环境下的行为，不只是性能问题。

---

## 6. 一个顺带发现

`probeToolPath` 用 `spawnSync(whichCmd, [tool])` 而 `runTool` 用 `shell: process.platform === 'win32'`。
**两个函数的 shell 策略不一致**，但本次测量表明这在本例中不是瓶颈（11.7s vs 13.7s）。

不过它仍然是 `#595`/`#648` 那类 Windows 平台事故的土壤——同一个文件里两种调用约定。
建议统一，并附注释说明为什么。
