# Open Issues 清算计划（31 → 0）

**Date:** 2026-10-13
**Baseline:** v0.21.0（2026-10-13 发布，含 #507 S1/S5、#518、#513/#515、#528–#533）
**Open issues:** 31 个（#392–#532）
**目标:** 全部关闭，每个 sprint flow 发布一个迭代版本

---

## 1. 分诊结论（按「门禁可信度」优先排序）

xp-gate 的核心价值主张是「门禁不说谎」。因此优先级不按 issue 年龄或标签，按**缺陷对门禁可信度的破坏方式**排：

| 级别 | 定义 | Issues |
|------|------|--------|
| **P0** | 门禁静默失效（假绿/空转）或安全旁路 | #532, #523, #514, #469 |
| **P1** | 门禁行为错误（误判/错根/错值） | #527, #524, #447, #465, #507(剩余) |
| **P2** | 守卫自身不运行（6ebbd5a 事故类） | #484, #431, #483, #485, #433, #482, #521, #520 |
| **P3** | 平台适配阻塞（评审链断裂） | #443, #414, #481, #429 |
| **P4** | 效能与迁移路径（体验债） | #516, #399, #410, #511, #519, #505, #404 |
| **P5** | 清理（死代码/历史欠账） | #522(含 #420), #392 |

**分诊中发现的事实修正（影响范围判断）：**
- **#507 未完成但已部分落地**：S1（wc-java-lint 主引擎）与 S5（GATE 9 子状态聚合）已在 v0.21.0 入库；剩余 S2（CCN 阈值三级覆盖，issue 内附本机验证补丁）、S4（G4 Java 覆盖显式化）。S3（SKIP 计分母）已被 0.21.0 的 verdict 值域变更实质解决。
- **#465 核心已修**：HEAD 的 `.delphi-config.json` whalecloud profile 已是国产 flash 模型（外国模型部分早已修复）；剩余是 `active_profile` 仍为 `default`（多网关，不满足 DSH 单网关约束）——且翻转全局 active_profile 影响所有平台消费者，需设计决策，不是照单全收。
- **#420 是 #522 的子集**：clipboard-vision skill 删除后，Pester 覆盖率债务与 stash 中的 SC2034 修复一并消失。
- **#514 涉及本机**：`~/.config/xp-gate/hooks/pre-commit` 含从未入库的内联 mypy 块（#513 硬编码 scope 假 BLOCK 的机器侧现场）。修复含「恢复本机执行面」这一步。

---

## 2. Sprint 编排（5 个 sprint，5 个版本）

| Sprint | 主题 | Issues | 目标版本 | 预估规模 |
|--------|------|--------|----------|----------|
| **A** | 门禁不说谎：假绿与安全旁路 | #532 #523 #514 #469 #527 #524 #447 #465 #507-剩余 | **v0.22.0** | standard |
| **B** | 守卫必须运行（6ebbd5a 类） | #484 #431 #483 #485 #433 #482 #521 #520 | **v0.23.0** | complex |
| **C** | 评审链平台适配（Qoder/DSH） | #443 #414 #481 #429 | **v0.24.0** | complex |
| **D** | 效能与迁移路径 | #516 #399 #410 #511 #519 | **v0.25.0** | standard |
| **E** | Python 门禁提速（新增 #534） | #534 | **v0.26.0** | standard |
| **F** | 清算收尾 | #522(+#420) #505 #404 #392 | **v0.27.0** | standard |

排序理由：
- **Sprint A 打头**：#532 是刚发布的 P0 安全修复（#518）的回退副本遗漏——发布次日必须补，否则「SAST 已修复」的结论在 TS-less 部署上不成立；#523 是门禁空转的标准样板（工具可用、数据在位、执行空转），与 #532 同属「门禁说谎」家族，一起修可以共用同一套判定思路。
- **Sprint B 次之**：#484（bats 无自动执行路径）是多起事故的根因机制，且是 Sprint A/B 所有 BATS 测试的可见性保障——没有它，本计划自己产出的守卫会重蹈「守卫存在但从不运行」。
- **Sprint C 第三**：平台适配（#443/#414）阻塞的是评审链本身，不修则后续 sprint 的 Delphi 评审在 Qoder/DSH 上不可用；设计文档已落地（2026-10-12），实现条件成熟。
- **Sprint D/E 殿后**：效能与清理不阻塞可信度，且 #404（RFC）需要先有 Sprint B 的守卫数据才能做阈值决策。
- **#534（2026-10-16 插队）**：Python 门禁 CPU 占用过高（mypy 全量推断打满整机，Windows i7-1165G7 4 核实测 IDE 卡顿），属用户侧真实体验债，见效快，单列为 Sprint E（v0.26.0）。剩余清算收尾顺延为 Sprint F（v0.27.0）。

---

## 3. 执行环境备忘（本机实测，2026-10-13）

1. **本地 vitest 部分失效（沙箱伪红，非代码缺陷）**：带 `vi.mock`/顶层 `afterAll` 的测试文件在本会话 collection 失败（`No test suite found` / `Cannot read properties of undefined (reading 'on')`）；全量跑 152 文件撞 Windows 命令行长度上限（`The command line is too long.`）。**同一代码在 CI（ubuntu）全绿**（v0.21.0 的 Quality Gates run 已验证）。→ 本地验证用目标文件单跑 + CI 权威判定。
2. **Gate 5 存在误挡风险**：`lib/test-failure.sh` 的 `has_real_failure_marker` 匹配 `FAIL ` 行，沙箱产生的 suite 级错误带此前缀 → 若 sprint 中提交触及受影响测试文件，本机 Gate 5 会 BLOCK。处置：若实际发生，按 #454/#473/#498 同源模式扩展 runner-infrastructure 判定（先立 issue 再修），不得 `--no-verify`。
3. **发布链已验证可用**：bump → sync-version.cjs → commit（12 门禁全过）→ push → CI 自动发三包 + tag + GitHub Release。v0.21.0 已完整走通（含修复 release-notes 提取 bug：awk 模式不匹配 4 段版本号标题）。
4. **Delphi 通道可用**：`WHALECLOUD_API_KEY` 已在环境变量中，`delphi-external-review.cjs` 可跑外部三模型评审。
5. **提交纪律**：含 .yml 的提交需 `PATH` 前缀 PyYAML shim（托管 Python 无 PyYAML，Gate 12 会误杀）。

---

## 4. 每个 sprint 的固定动作

1. 设计文档 → `docs/plans/2026-10-13-sprint-<X>-design.md`
2. `npx xp-gate sprint-init` + delphi-review（外部三模型）→ `.sprint-state/delphi-reviewed.json`
3. TDD per issue（RED → GREEN → REFACTOR），本机钩子 12 门禁 + 目标测试单跑
4. VERIFY：`npx tsc --noEmit` + lint + CI 全绿
5. SHIP：VERSION bump + CHANGELOG → commit → push → CI 发布（npm 三包 + tag + GitHub Release）
6. CLOSE：关闭 GitHub issues → `.sprint-history/` 归档 → retro
