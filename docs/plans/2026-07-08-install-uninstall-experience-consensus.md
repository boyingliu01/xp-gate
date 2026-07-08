# Delphi Consensus Report: 安装卸载体验全面升级

**日期：** 2026-07-08
**Design Doc:** `docs/plans/2026-07-08-install-uninstall-experience-design.md`
**关联 Issues：** #301, #302, #303, #304

---

## 评审摘要

| 指标 | Round 1 | Round 2 |
|------|---------|---------|
| Expert A (架构) | REQUEST_CHANGES | **APPROVED** |
| Expert B (技术) | REQUEST_CHANGES | **APPROVED** |
| Expert C (可行性) | REQUEST_CHANGES | **APPROVED** |
| 共识度 | 100% (一致 REQUEST_CHANGES) | **100% (一致 APPROVED)** |
| 轮数 | 1 | 2 |

**最终裁决：APPROVED — 设计通过，可以进入实施阶段。**

---

## Round 1 反馈与修正

### Expert A (架构) — 4 Major + 5 Minor → 全部解决

| 问题 | 修正 |
|------|------|
| `install` 与 `init` 重叠 | 明确关系：install 是推荐入口，init 保留向后兼容；额外增加语言检测+报告+doctor |
| `installWithFallback` 与 bootstrap 集成 | 明确替换 `installViaScript`/`installViaInline` 函数 |
| 语言检测机制未指定 | 16 级检测链 + 多语言项目处理 + LANG_MAP |
| gate-9.sh 编号不一致 | 明确对齐 shell 脚本体系（10 门禁），README 差异为已知漂移 |

### Expert B (技术) — 4 Critical + 5 Major + 4 Minor → 全部解决

| 问题 | 修正 |
|------|------|
| GATE_TOOLS 分类不完整 | 新增 GATE0、BUILD_INTEGRITY、LANG_MAP，扩展 SPECIAL |
| --purge 数据丢失风险 | 自动备份到 `/tmp/xp-gate-backup-{timestamp}/` |
| 关键工具遗漏 | 补充 black/isort(Python)、tsx、node 等 |
| npm 不可用处理 | 检测 npm→yarn→pnpm 回退链 |
| PEP 668 处理不完整 | 三级回退：ensure_pipx() → pipx → pip --break-system-packages → 手动 |
| Windows 安装策略缺口 | 二进制下载回退 + --skip-admin |
| 边界情况未处理 | 部分安装恢复、全局/项目不匹配、未初始化检测 |

### Expert C (可行性) — 2 Critical + 5 Major + 3 Minor → 全部解决

| 问题 | 修正 |
|------|------|
| GATE_TOOLS 完整性验证 | 新增 verify-tool-map.js 交叉验证脚本 |
| 语言检测可靠性 | 16 级检测 + 边界条件测试矩阵 |
| 迁移路线不清晰 | 迁移表 + "不废弃现有命令"声明 |
| 跨平台测试不完整 | 测试矩阵分层（环境列 + 手工标注） |
| doctor 输出破坏性变更 | --format json 向后兼容模式 |
| Windows 包管理器缺失 | --skip-admin + getManualInstallHint() |
| PEP 668 测试环境 | debian:bookworm Docker 容器 |

---

## Round 2 剩余 Minor Issues（不阻塞实施）

| # | 来源 | 问题 | 建议 |
|---|------|------|------|
| 1 | A | --purge 清理表 adapters/ 和 config/ 重复 | 合并为单行或添加排序说明 |
| 2 | A | 版本号建议 PATCH→MINOR | 实际实施时选 0.14.0 |
| 3 | A | 语言检测链 package.json 过早终止 | 多生态项目继续扫描 |
| 4 | B | doctor 未验证 config 文件 | 后续迭代增加 .principlesrc/.archlint.yaml 检查 |
| 5 | B | verify-tool-map.js 维护负担 | 作为 CI 门禁运行，确保不漂移 |
| 6 | B | installWithFallback 迁移边界条件 | 在 `bootstrap.js` 实现时仔细处理新旧函数替换 |
| 7 | C | gate-9.sh 同步机制引用 | 引用 scripts/prepack.cjs 现有同步 |
| 8 | C | 备份目录 /tmp 健壮性 | /tmp 写失败回退到 $HOME/.xp-gate-backup |

---

## 最终设计验收

**五大模块全部 APPROVED：**

1. `xp-gate install` 新命令 — 一键入口，init+boostrap+doctor 集成
2. `xp-gate uninstall --purge` — 全面清理 + 自动备份
3. gate-9.sh 注释修正 — 对齐 shell 脚本体系
4. 工具分类 + doctor 重构 — GATE_TOOLS + 交叉验证 + 分组输出 + JSON 兼容
5. bootstrap 跨平台扩展 — installWithFallback + PEP 668 三级回退 + --lang 参数

**兼容性保证：** 所有现有命令不变，净新增；doctor 提供 JSON 模式向后兼容。

**版本建议：** MINOR bump (0.14.0)，因新增 `install` 命令、`--purge`/`--lang` 参数、重构 GATE_TOOLS 分类。
