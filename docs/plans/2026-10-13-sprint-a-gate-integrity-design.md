# Sprint A 设计：门禁可信度缺陷批次（v0.22.0）— v2（R1 评审修订）

**Date:** 2026-10-13
**Sprint ID:** sprint-20261013-81
**Issues:** #532, #523, #514, #469, #527, #524, #447, #465, #507(剩余)
**主题:** 门禁不说谎——消灭假绿、空转、误判

---

## 0. R1 Delphi 评审响应（2026-10-13，whalecloud profile）

R1 结论：architecture APPROVED（conf 8）/ technical REQUEST_CHANGES（conf 9）/ feasibility REQUEST_CHANGES（conf 7）。逐条响应：

| # | 来源 | 处置 |
|---|------|------|
| MC-01 / FC-01 | #514 机器侧替换高危 | 改为**原子五步操作 + 一键回滚**（见 §2.3），回滚触发条件与验证步骤显式定义 |
| MC-02 / FC-07 | #523 「抽取表达式执行」测试法脆弱 | 放弃该方法。改为 **mock-PATH coverage 存根**（BATS 既有手法）+ 解析逻辑抽为可单测函数（见 §2.2） |
| FC-02 / MC-03 | #447 去掉 --config 恐成假绿 | 保留 `--config` 能力但改为 **opt-in `--use-config`**；默认内置规则扫描须通过「植入已知违规 → 非零发现」的反空转验证；help 明示与 Gate 6 的规则源分叉（见 §2.7） |
| FC-03 | #465 影响面 | 列出全部调用点（见 §2.8）；`--profile` 覆盖机制保留；配置内注释标注 key 依赖 |
| FC-04 | 批次规模 | 执行顺序与检查点见 §3；任一 issue 阻塞即Parking（记录原因），其余继续，不拖垮整批 |
| FC-05 / MIN-02 | #524 审计范围 | 收敛为：全仓 `date +%s`/`gate_start_ms` 混用 grep 审计 + 审计结论清单落 `docs/`；确立「计时一律走 #370 helper」约定 |
| FC-06 | #532 parity 触发时机 | 接入 **pre-push**（与 #521 提案一致：推送是离开本机的动作）+ CI Mirror Parity；漂移即 BLOCK |
| FC-08 | #527 迁移影响 | CHANGELOG 显式行为变更条目 + 设计文档注明旧短路行为依赖者的迁移路径（设置 marker 或 override） |
| MC-04 / FC-10 | #469 注册表读取机制 | `reg query`（Windows 全版本可用）+ 不可读时 **fail-closed WARN**（防假绿方向），非 Windows 分支显式 SKIP 并在测试标注 |
| MC-05 | #527 性能 | 复用既有 marker 遍历（不新增全树扫描）；monorepo 深树设目录深度上限 |
| MC-07 | #507 S2 优先级 | 维持 issue 验证过的顺序：项目文件 > 环境变量 > 默认 5（项目级优先于环境级是团队惯例） |
| FC-09 | 沙箱伪红清单外联 | 内联至 §4 |
| FC-13 | 发布回滚 | tag/包发布失败处置见 §5 |
| 其余 MIN | — 文档/CHANGELOG 条目要求，执行时落实 |

---

## 1. 背景

v0.21.0 发布了 #518（Gate 10 SAST P0 修复）。走查发现同类缺陷的回退副本仍在（#532）；全仓测量又暴露出三个「门禁空转/误判」实例（#523/#527/#524）与两个「探测环境 ≠ 执行环境」实例（#514/#469）。本 sprint 一次性清算这一家族。

**家族共性**：工具可用、数据在位、代码跑过——但判定环节与真实产出错位，门禁输出绿色而实际零防护。

## 2. 逐 issue 处置

### 2.1 #532 — gate-9.sh 回退副本携带 #518 缺陷（P0 安全）

将 `gate-10.sh` 已验证的判定语义迁移到**全部三份存活副本**（响应 MAJ-02：parity guard 与契约测试覆盖三份，不只 npm 镜像对）：

- `githooks/gate-9.sh`（= `src/npm-package/gate-9.sh` 字节镜像）
- `githooks/gates/gate-9-sast-security.sh`
- `githooks/adapters/gate-9.sh`

迁移语义：JSON severity 解析（词汇并集 CRITICAL/HIGH/ERROR，warnings-only = WARNING/INFO/MEDIUM/LOW，**词表外未知/缺失 severity fail-closed 计 BLOCK**）；退出码降级为「工具是否跑成」；stdout/stderr 分离捕获；node 硬依赖前置守卫；errors[] 记账；不可解析 → SKIP+诊断，绝不 PASS。

**测试**：BATS 仿 `gate-10-verdict.test.bats`（13 用例同构）；三份副本逐一纳入字节 parity 断言；parity 守卫接入 pre-push + CI Mirror Parity（响应 FC-06）。

### 2.2 #523 — Gate 5 Python coverage 解析永不着（P1 门禁空转）

- 根因：`coverage report --format=total` 输出裸数字，`grep -o '[0-9]*%'` 永零匹配 → 阈值分支永不进入。
- 修复：解析兼容两种形态（裸数字优先、`%` 兜底）；**解析逻辑抽为独立函数**（hook 内 `parse_coverage_total()`，或 lib/ 小模块），阈值分支修复后真实执行。
- 测试（响应 MC-02）：**放弃「从生产文件抽取表达式执行」**。改为 (a) 解析函数单测（表驱动：裸数字/百分比/空/垃圾输入）；(b) BATS mock-PATH——放一个输出已知内容的 `coverage` 存根到 PATH 前部，跑真实 Gate 5 python 分支，断言阈值判定（低于阈值 BLOCK、高于 PASS、无数据 SKIP）。端到端走真实控制流，不复刻表达式。

### 2.3 #514 — 机器侧执行面漂移（P0）

**仓库侧**：doctor 漂移检查扩展为「安装副本 vs 仓库源」整文件字节 parity（pre-commit 主文件被整体替换时当前漏检）。**策略声明**（响应 MAJ-04）：canonical-only——任何本地改动判漂移，doctor 输出含恢复指引（`xp-gate doctor --sync-hooks`）；合法定制走显式豁免清单登记，不允许静默。

**机器侧**（本机现场，响应 MC-01/FC-01 原子操作）：

```
1. 生成新副本到临时文件：cp ~/.config/xp-gate/hooks/pre-commit /tmp/pre-commit.new
   （内容 = 仓库 githooks/pre-commit，字节一致）
2. 语法校验：bash -n /tmp/pre-commit.new（失败即中止，不碰原文件）
3. 备份：cp ~/.config/xp-gate/hooks/pre-commit ~/.config/xp-gate/hooks/pre-commit.bak-sprintA-<日期>
4. 原子替换：mv /tmp/pre-commit.new ~/.config/xp-gate/hooks/pre-commit（保持 0o755）
5. 验证：xp-gate doctor 执行面漂移归零 + 一次真实提交全门禁通过
回滚：cp pre-commit.bak-sprintA-<日期> pre-commit && chmod 755
回滚触发条件：步骤 5 任一验证失败，或替换后出现新的假 BLOCK。
```

### 2.4 #469 — doctor 探测环境 ≠ hook 执行环境（P1 假绿）

- 层 1：doctor/check-tools 的工具探测改在 hook 真实执行环境（非交互 `bash -c 'command -v X'`）中进行。
- 层 2（响应 MC-04）：Windows 进程 PATH vs 注册表 PATH 陈旧检测——`reg query "HKCU\Environment" /v PATH` + 系统侧合并读取（reg 查询失败 → fail-closed WARN「无法读取注册表，PATH 判断可能假绿」）；非 Windows 显式 SKIP（known limitation 记录，测试标注平台条件）。

### 2.5 #527 — PROJECT_SUBDIR 根短路判别（P1 误判）

- Gradle：`settings.gradle(.kts)` 含 `include` → 不短路，恢复嵌套 marker 推导。
- CMake：存在嵌套 `*/CMakeLists.txt` → 不短路。
- 性能（响应 MC-05）：复用既有 marker 遍历，不新增扫描；目录深度上限（如 6 层）防 monorepo 深树。
- 迁移（响应 FC-08）：CHANGELOG 行为变更条目；依赖旧短路行为的仓库可通过删除根 marker 或设置 override 恢复。
- BATS 先钉新语义，再改 pre-commit 短路注释与既有 pinned known-limitation 用例。

### 2.6 #524 — Gate 11 时长单位混减（P1 错值）

- 修复：`GATE_11_END` 改 `gate_end_ms`（#370 helper），显示除 1000。
- 审计（响应 FC-05/MIN-02）：`grep -rn 'date +%s' githooks/ src/` 全仓清单，结论与「计时一律走 now_ms/gate_end_ms」约定落 `docs/`；无第二处混用即关闭审计项。

### 2.7 #447 — `xp-gate arch` 子命令恒失败（P1 功能死）

- 决策（响应 FC-02/MC-03）：默认路径去掉 `-y` 与 `--config`，用本地 pinned `@archlinter/cli` 内置规则扫描；**保留 opt-in `--use-config <file>`**（传 architecture.yaml 时按旧 schema 的用户自行承担版本责任，help 明示）。
- 反空转验证：BATS/vitest 植入一个已知违规（如 Domain 层 import Infrastructure）→ 断言非零发现；对干净树断言 0。**「返回 0」必须证明是真实扫描而非空转**。
- 文档：help 与 README 明示 `arch`（内置规则）与 Gate 6（architecture.yaml baseline diff）的规则源分叉。

### 2.8 #465 — DSH active_profile（P1 成本/约束）

- 决策：`.delphi-config.json` 的 `active_profile` 改 `whalecloud`；default profile 定义保留。
- 影响面清单（响应 FC-03）：(a) `scripts/delphi-external-review.cjs` 无 `--profile` 的调用（CI: `.github/workflows/` 中 delphi 相关 job；skills: delphi-review SKILL.md 的外部评审指令；dsh/opencode 插件的 gate-arch 类工具）——全部显式传 `--profile whalecloud` 或依赖新默认；(b) 配置内注释标注 `WHALECLOUD_API_KEY` 依赖（响应 MIN-05）。
- 回退：改回 `default` 一行即可；本仓 CI 不依赖 default profile（无对应 key）。

### 2.9 #507 — Java 门禁剩余项（P1 收尾）

- S2：CCN 阈值三级覆盖（`.xp-gate/ccn-threshold` > `XP_GATE_CCN_THRESHOLD` > 默认 5），BATS 锁优先级与边界（非法值回退默认并 WARN）。
- S4：principles checker 对 Java 无规则覆盖时显式 `SKIP (reason: no Java rules configured)`。
- S3 已由 v0.21.0 verdict 变更实质解决。完成后关闭 #507。

## 3. 执行顺序与检查点（响应 FC-04）

1. #524（一行修复 + 审计，最快建立信任）→ 2. #532（P0 安全）→ 3. #523 → 4. #507 S2/S4 → 5. #527 → 6. #447 → 7. #465 → 8. #469 → 9. #514（机器侧，放最后：需要前面对话产生的 hooks canonical 稳定后再替换）。
- 每个 issue 一个 commit；本机钩子 12 门禁 + 目标测试单跑为该 issue 的 DoD。
- 任一 issue 阻塞超 2 个修复循环 → Parking（sprint-state 记录），其余继续。

## 4. 本机沙箱伪红清单（内联，响应 FC-09）

以下失败**仅本会话出现**，同一代码在 CI（ubuntu）为绿，判据以 CI 为准：

| 签名 | 位置 | 判定 |
|------|------|------|
| `No test suite found in file` | 带 `vi.mock`/顶层 `afterAll` 的 vitest 文件 collection | 沙箱伪红 |
| `Cannot read properties of undefined (reading 'on')` | 顶层 `afterAll` 注册点 | 沙箱伪红 |
| `The command line is too long.` | 全量 vitest（152 文件）worker argv 超 Windows 上限 | 沙箱伪红 |
| `expected null to be +0` / `must exit 0: expected false to be true` | `spawnSync` 拉子进程的测试（sync-package-content 等） | 沙箱伪红（#525 同源） |
| `git not found` / `repository not found` | detect-deps 的 git clone 子进程 | 沙箱伪红 |

若本机 Gate 5 因上述签名误挡：按 #454/#473/#498 同源模式扩展 runner 判定（先立 issue），**不得 --no-verify**。

## 5. 发布与回滚（响应 FC-13）

- VERSION → 0.22.0.0，CHANGELOG 封版（含全部行为变更显式条目），push main → npm-publish.yml 自动三包 + tag + GitHub Release。
- 回滚：npm 已发布版本不可撤（0.x 允许发 0.22.1 修正版）；tag 已推但包失败 → 删远端 tag + 修 workflow 后重推（pre-push 文档类快速通道）；GitHub Release 可用 `gh release edit` 改 notes。

## 6. 验收

- [ ] 9 个 issue 的 AC 逐条满足
- [ ] `npx tsc --noEmit` + `npm run lint` 绿
- [ ] 目标测试本机单跑绿；CI Quality Gates 全绿（§4 伪红除外）
- [ ] #514 机器侧五步操作 + 回滚验证通过，doctor 执行面归零
- [ ] #447 反空转验证通过（植入违规 → 非零发现）
- [ ] v0.22.0.0 发布（npm 三包 + tag + GitHub Release），9 个 issue 全部 close
