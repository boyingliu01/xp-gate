# REQ-F 实测报告

**日期:** 2026-10-19
**数据源:** `.xp-gate/audit.jsonl`（5025 条门禁记录，357 个提交）
**测量方式:** `node .delphi-work/reqf-*.cjs`（脚本随仓库外置，逻辑即下方复述）

## 结论先行

| 指标 | 结果 | 是否达标 |
|------|------|---------|
| 典型提交（单次干净 hook 运行）p50 | **89.0s → 69.6s（−21.8%）** | ✅ 下降 |
| docs-only 提交的重门禁 | `tests-coverage` 7559ms → **329ms**；`duplicate-code` 5781ms → **360ms** | ✅ 短路生效 |
| 手测 docs-only 提交墙钟 | 55.3s | ✅ |
| 手测 3 文件提交墙钟 | 80.0s（**反而更慢**，见"诚实披露"） | ⚠️ |

## 测量方法（可复跑）

按 `commit_hash` 把审计行归组为"一次 hook 运行"，只保留**单次干净运行**（10–13 个门禁、无异常时长），再取每次运行的总和：

```js
// 只保留干净运行，避免把多次 hook 尝试的重试叠加算一次
rs.length >= 10 && rs.length <= 13 && max(duration_ms) <= 120000
```

**为什么必须这样筛：** 不筛的时候，同一个 `commit_hash` 下会出现 30、123、21 个门禁行的记录——那是提交被门禁拒绝后重试的叠加，其"总和"是 792s、241s 这类无意义数字。把它们算进去会让"改前"和"改后"的比较完全失真。

## 数据

### 单次干净运行的每提交总计

| 时期 | 样本 | p50 |
|------|------|-----|
| sprint 前 | 38 | **89.0s** |
| sprint 后 | 10 | **69.6s** |

降幅 **−19.4s（−21.8%）**。

### docs-only 短路的直接证据

同一台机器、相邻两次提交，门禁耗时对照：

| 门禁 | 代码提交（3 个源文件） | docs 提交（1 个 .md） | 变化 |
|------|----------------------|---------------------|------|
| `duplicate-code` | 5781ms | **360ms** | **−94%** |
| `tests-coverage` | 7559ms | **329ms** | **−96%** |
| `build-integrity` | 11199ms | 11343ms | 持平（未短路，见下） |
| `secret-scanning` | 4872ms | 4575ms | 持平（**故意**不短路） |
| `code-quality` | null（见下） | 813ms + `no_matching_files` | 修复后正常 |

`duplicate-code` 与 `tests-coverage` 跳过了；`secret-scanning`、`version-consistency`、`principles` 照常跑——README 里的密钥仍然是密钥。这正是设计意图。

### 各门禁 p50 前后对比

| 门禁 | 前 | 后 | 变化 |
|------|-----|-----|------|
| architecture-boy-scout | 12010 | 8486 | −29% |
| sprint-flow | 6908 | 2333 | −66% |
| file-hygiene | 4909 | 3311 | −33% |
| secret-scanning | 2310 | 1661 | −28% |
| principles | 2227 | 1675 | −25% |
| build-integrity | 5606 | 4459 | −20% |
| duplicate-code | 3333 | 2570 | −23% |
| version-consistency | 595 | 424 | −29% |
| complexity | 1266 | 1159 | −8% |
| code-quality | 15781 | 13007 | −18% |
| sast-security | 9950 | 10879 | +9%（噪声，样本 11） |
| tests-coverage | 15485 | 19899 | +28%（噪声，见下） |
| iac-security | 1216 | 58739 | **无效**（样本 1） |

## 诚实披露（这一节是重点）

### 1. `tests-coverage` 的 p50 上升不是性能退化

它的真实耗时分布是 **329ms ~ 27s**，取决于这次改动选中了哪些测试。这是增量测试选择在正常工作：

```
18:46  19899   18:56  19964   19:57  20321   04:39  13580
05:38   3679   07:15  26392   07:21  26878   07:34  10020
07:57  23065   08:33  26732   08:52   7559   08:57    329  <- docs-only
```

p50 上升只是因为 sprint 后的 36 个样本里全量跑的提交占比更高。**这个指标在样本量 36 时不可用于判断提速。**

### 2. `iac-security` 的 "58739ms" 是单个样本，不是回归

sprint 后只有 1 条 `iac-security` 记录。任何基于单点的"变化"都是噪声，不应引用。

### 3. `build-integrity` 没有跳过 docs 提交

commit 注释写的是"heavy gates (2/5/9/12)"，但实际实现里 Gate 9（build-integrity）**没有**读取 `DOCS_ONLY_COMMIT`。`tsc --noEmit` 在纯 markdown 提交上仍然是 11s 的固定开销。这是**未完成的优化**，不是 bug——把它写进"已完成"是不诚实的。

### 4. 手测的 3 文件提交（80.0s）比 p50 慢

80.0s > 69.6s。原因可查：那次提交动了 `src/npm-package/` 下的 3 个文件，`architecture-boy-scout` 单这一项就跑了 24s（该门禁对跨目录改动最敏感）。**单次样本不能用来证明或否定提速**，所以本节以 p50 为准，同时把这个数字原样列出。

### 5. 早期 15 个提交跑的是旧 hook

`core.hooksPath` 指向 `~/.config/xp-gate/hooks/`。`audit-sanitize.sh`、`ccn-ratchet.sh`、`docs-only.sh` 三个新库在已安装副本里**根本不存在**，直到本轮手动执行 `xp-gate doctor --sync-hooks` 才同步。所以：

- `a30af53b`（REQ-B sanitizer）落地后，`270f8bdf` 等提交仍在写 `duration_ms: 1792337852793` 这类投毒值；
- docs-only 短路在提交侧从未生效，直到同步之后。

**这不是 REQ-F 的失败，但它是"为什么日志里长期是脏数据"的直接原因**，必须记录。

## 复跑方式

```bash
node scripts/ccn-report.cjs          # gate timing 段即为按门禁的 p50/p95
node .delphi-work/reqf-runs.cjs      # 按提交归组的总计
node .delphi-work/reqf-since.cjs     # 短路生效之后的逐次明细
```

## 结论

REQ-F 的**实现**（F1 audit 复用、F2 docs-only 短路、F3 gate-12 增量）全部落地且有测试覆盖。**验收**只在 F2 上得到干净的因果证据（重门禁 −94%/−96%）；提交级 p50 下降 21.8% 但样本量只有 10，**不足以声称统计显著**。

按诚实原则，REQ-F 应记为 **"实现完成，F2 有因果证据，整体提速幅度证据不足"**，而不是"已验证提速 21.8%"。
sample 1
