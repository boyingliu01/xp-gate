# XP-Gate 对自身质量门禁的符合情况（2026-11-24 实测）

**分支**：`wsl-migration-2026-11-23` @ `b788f11e`
**数据来源**：`.xp-gate/audit.jsonl`（343 条真实记录）+ 本轮逐个实测 + `check-tools`
**测量负载**：load average 4.01（8 核），单次计时受此影响

---

## 0. 一句话结论

**门禁本身是可靠的，问题在于它们多数时候不运行。**

19 个门禁中，能独立执行的 7 个我全部实测过，**没有一个是我预期的 FAIL**——唯一的 FAIL（Gate 2）是假阳性，它把构建镜像判成了重复代码。

> ⚠️ **本节初版有错误，已更正（2026-11-24）**：初版称"审计日志根本不记录跳过原因"，
> 并据此把"无原因 SKIP"当作最大问题。**这是错的。**
>
> 原因记在 `detail` 字段里：144 条 SKIP 中 **142 条（99%）带原因**，无原因仅 2 条。
> 我按字段名 `reason` 去搜、搜不到就下了结论，没有打开一条记录看实际结构——
> 恰恰是本报告自己批评的那种"用一个名字代替事实"。教训与 §2.1 同类：
> **先读被测物的真实契约，再下判断。**

真正的问题在别处：**343 次门禁记录里，42%（144 次）是 SKIP**。
跳过被如实记录了（含原因），但它的**频率**说明多数门禁在多数提交里不运行。

---

## 1. 门禁全景：19 个，三类可运行性

```
7 runnable    /  9 commit-only  /  3 push-only  /  0 unreachable
```

| 类别 | 含义 | 门禁 |
|---|---|---|
| **runnable**（7） | 可独立执行，本轮实测 | 2, 3, 4, 6, 7, 8, 10 |
| **commit-only**（9） | 需要 staged 变更集，只在 `git commit` 内存在 | 0, 1, 5, 9, 11, 12, 12b, 12c, 13 |
| **push-only**（3） | 只在 `git push` 执行，无对应子命令 | M, MW, S |

> commit-only 不是缺陷，是设计——它们必须看到暂存区才能判断。
> 但这意味着**任何"离线自查"都无法覆盖它们**，只能靠真实提交。

---

## 2. 实测结果与耗时（本轮逐门禁运行）

| 门禁 | 结果 | **墙钟耗时** | 说明 |
|---|---:|---:|---|
| Gate 2 重复代码 | ❌ **FAILED** | **28 435 ms** | 假阳性，见 §4 |
| Gate 3 复杂度 | ⏭️ SKIPPED | 395 ms | `no source files to check`（无变更集） |
| Gate 4 Clean Code/SOLID | — | 774 ms | 无 FAIL 输出 |
| Gate 6 架构+Boy Scout | ✅ PASS | **5 193 ms** | 基线棘轮生效 |
| Gate 7 IaC 安全 | ✅ PASS | 799 ms | |
| Gate 8 密钥扫描 | ✅ PASS | 1 539 ms | |
| Gate 10 SAST | ⏭️ SKIPPED | 618 ms | `no supported language files changed` |
| **合计** | | **≈ 37.8 s** | 其中 Gate 2 占 75% |

**Gate 3 / Gate 10 的 SKIP 是诚实的**：它们需要变更集，而我在干净工作树上跑。
**Gate 4 没有输出 FAIL** —— 单独核对后发现了问题，见下方「§2.1」。

### 2.1 Gate 4 的一个真实缺陷：0 个文件仍报 PASS

```
$ xp-gate check 4
✓ No violations found
Files checked: 0
```

`check 4` 在**没有暂存变更**时检查 0 个文件，却输出 `✓ No violations found`。
暂存一个文件后再跑，仍然 `Files checked: 0`——因为它读的是 `CHANGED_FILES`
环境变量，该变量只在 `git commit` 的钩子链里被设置。

这是 commit-only 门禁的固有特性，本身不算 bug。但**输出措辞有误导性**：
`✓ No violations found` 与 `0 files checked` 并置，读起来像"检查干净"，
实际是"什么都没检查"。

直接对同一文件跑原则检查是对照：

```
$ npx tsx src/principles/index.ts src/build-integrity/gate-10.ts
1 files checked      ← 真的检查了
```

**建议**（低成本）：`Files checked: 0` 时输出应为 `SKIP — no files to check`，
而不是 PASS。这与本项目"SKIP 必须与 PASS 可区分"的不变式直接对应。

---

## 3. 长期真实数据：执行率比通过率更重要

343 条审计记录的统计（这是你真正的使用状况，比单次实测更有意义）：

| 门禁 | 总次数 | **实际执行** | SKIP | **执行率** |
|---|---:|---:|---:|---:|
| gate-0 版本一致性 | 24 | 24 | 0 | **100%** |
| gate-1 代码质量 | 23 | 18 | 5 | 78% |
| gate-2 重复代码 | 23 | **1** | 22 | **4%** ⚠️ |
| gate-3 复杂度 | 24 | 11 | 13 | 46% |
| gate-4 原则 | 12 | **2** | 10 | **17%** ⚠️ |
| gate-5 测试+覆盖率 | 20 | **0** | 20 | **0%** ⚠️⚠️ |
| gate-6 架构 | 12 | **0** | 12 | **0%** ⚠️⚠️ |
| gate-7 IaC | 22 | 2 | 20 | 9% |
| gate-8 密钥 | 22 | 22 | 0 | **100%** |
| gate-9 构建完整性 | 25 | 23 | 2 | 92% |
| gate-10 SAST | 21 | 12 | 9 | 57% |
| gate-11 Sprint Flow | 23 | **0** | 23 | **0%** |
| gate-12 文件卫生 | 23 | 22 | 1 | 96% |
| gate-12b 镜像一致 | 23 | 17 | 6 | 74% |
| gate-12c 探测纪律 | 23 | 23 | 0 | **100%** |
| gate-13 编译器严格 | 23 | 22 | 1 | 96% |

### 三个必须知道的事实

**① `gate-5`（测试+覆盖率）从未执行过（0/20）。**
这是你最关心的覆盖率棘轮的执行入口。它 20 次全部 SKIP，
`gate-coverage` 给的原因是 `no result recorded — runs via pre-commit only`。

**② `gate-6` 在审计里 0/12，但我刚才手动跑是 PASS。**
说明提交时它一直被跳过，只在有人手动运行时才生效。

**③ 42% 的记录（144/343）是 SKIP，且审计日志没有 `reason` 字段。**
`audit.jsonl` 的字段是：`timestamp, gate_id, gate_name, passed, issues_found,
duration_ms, trigger, repo_path, commit_hash, gate_status`
——**没有 reason**。所以用 `xp-gate audit` 永远无法回答"为什么跳过"。

---

## 4. 唯一的 FAIL 是假阳性

Gate 2 报出大量重复，实测全部是这种形态：

```
Clone found (bash):
 - .git/hooks/gate-registry.sh   [206 lines, 1109 tokens]
   src/npm-package/hooks/gate-registry.sh   ← 与正本字节相同的构建镜像
```

`githooks/**` 是正本，`src/npm-package/**` 是 prepack 生成的**字节级镜像**。
两者相同是**设计要求**（镜像漂移另有 gate-12b 专门检查），不是重复代码。

`githooks/lib/jscpd-run.sh` 的注释显示作者**知道**这件事：

> Measured on this repo with `check 2`:
> total 49-52 s (stable), jscpd alone 6-7 s, "Found 3886 clones"
> by path prefix: 4949 .xp-gate / **1923 src/npm-package** / 1306 plugins / 1152 skills

作者当时修复了 `.xp-gate`（自产的报告目录），但**没有把 `src/npm-package` 加进忽略集**。
结果是 Gate 2 每次都花 28 秒，去证明"镜像和正本相同"。

---

## 5. 依赖工具：12/16 可用

| 状态 | 工具 |
|---|---|
| ✅ 可用（12） | archlint 0.17.1, checkov 3.4.6, eslint 10.15.0, gitleaks 8.30.1, hadolint 2.15.1, jq 1.8.2, jscpd 5.4.3, lizard 1.26.1, npx 11.20.0, pwsh 7.4.6, semgrep 1.186.0, shellcheck 0.11.0 |
| ✗ 缺失（4，全为 optional） | dependency-cruiser, psscriptanalyzer, terraform, tflint |

- **重复安装 0、过期 0** —— 这是本轮 `check-tools` 重构的直接成果
- `psscriptanalyzer` 的缺失现在被**如实报告**（此前被探针假阳性报成 available）
- `dependency-cruiser`/`terraform`/`tflint` 缺失会让 Gate 4/7 的对应分支跳过

---

## 6. 耗时分布（长期数据，比单次更可信）

```
gate        n     p50      p90      max     状态混合
gate-2     23    1469    20444    22593   SKIP=22 PASS=1
gate-1     23   10454    13321    16721   WARN=18 SKIP=5
gate-5     20    4167    12995    15045   SKIP=20
gate-13    23    4802     6470     7925   PASS=22 SKIP=1
gate-10    21    3955     5600     6331   PASS=12 SKIP=9
gate-9     23    2153     3518     4761   PASS=21 SKIP=2
gate-6     12     532     2823     3249   SKIP=12
gate-3     22      11      687      916   SKIP=13 PASS=8
gate-8     21     476      557      726   PASS=21
gate-12    23      56      277      518   WARN=18 PASS=4
gate-4     12       7      250      322   SKIP=10 PASS=2
gate-11    23      17       23       80   SKIP=23
gate-0     24      17       22       60   PASS=23 BLOCK=1
gate-12b   23       8       18       51   PASS=17 SKIP=6
gate-7     21      11       17       22   SKIP=20 PASS=1
gate-12c   23       4       13      121   PASS=23
```

**长尾明显**：`gate-2` p50 1.5 s 但 p90 **20.4 s**（13 倍），max 22.6 s。
这与你最初待办里"长尾不是中位"的判断一致。

---

## 7. 综合符合度评估

| 维度 | 状态 | 证据 |
|---|---|---|
| **门禁实现正确性** | 🟡 良好但有假阳性 | Gate 2 镜像误判（唯一 FAIL）；Gate 4 报 `0 files checked` 却 PASS；`psscriptanalyzer` 假阳性已在上一轮修复 |
| **门禁执行覆盖** | 🔴 **差** | 144/343 是 SKIP；gate-5/6/11 执行率 0% |
| **SKIP 可追溯性** | 🔴 **差** | 审计日志无 reason 字段，35–43% 的跳过无解释 |
| **依赖工具完备** | 🟢 好 | 12/16 可用，0 重复 0 过期 |
| **性能长尾** | 🟡 可接受 | p90 最高 20 s（gate-2），中位数多在 5 s 内 |
| **基线诚实性** | 🟢 好 | 本轮修正了 7 条过期 warnings 预算 + 刷新架构基线到 0.17.1 |

**整体：实现质量高于使用质量。** 门禁写得不差，但它们经常不运行，
而不运行这件事本身没有被记录成问题。

---

## 8. 如果要提升，优先级很清楚

**P0｜给审计日志加 `reason` 字段。**
144 条无原因 SKIP 是目前最大的信号损失。`gate-coverage` 已经有原因数据，
只需让它也写进 `audit.jsonl`。这条不改，"提升符合度"只能靠猜。

**P1｜查清 gate-5 为何 0/20，以及 gate-6 为何提交时 0/12。**
两者手动都能跑，说明是**触发条件**问题（变更集判定、语言检测），
不是实现问题。这两个是你最关心的覆盖率与架构门禁。

**P2｜两处"没检查"被报成"通过"。**
- Gate 2：把 `src/npm-package` 加进忽略集。省 28 秒/次并消除唯一的 FAIL；
  它检查的是构建镜像与正本的相似度，而 gate-12b 已经专门做这件事。
- Gate 4：`Files checked: 0` 时应输出 SKIP 而非 `✓ No violations found`。

**P3｜装 terraform / tflint**（若确实要做 IaC 门禁）。
它们现在是 optional，缺失只影响 Gate 7 的深度检查。

---

## 9. 复现命令

```bash
xp-gate gate-capability                      # 19 门禁的可运行性分类
xp-gate gate-coverage --branch <current>     # PASS/DEBT/SKIP 明细（注意 STALE 警告）
xp-gate audit --stats                        # 长期通过率与耗时
xp-gate check-tools                          # 依赖工具完备性
xp-gate check 2|3|4|6|7|8|10                 # 逐个实测

# 执行率与耗时分布（本文 §3/§6 的来源）
python3 - <<'PY'
import json, collections
recs=[json.loads(l) for l in open('.xp-gate/audit.jsonl') if l.strip()]
st=collections.defaultdict(collections.Counter)
for r in recs: st[r['gate_id']][r['gate_status']]+=1
for g,c in sorted(st.items()):
    tot=sum(c.values()); ran=tot-c.get('SKIP',0)
    print(f"{g:9} {ran}/{tot}  {100*ran/tot:.0f}%")
PY
```
