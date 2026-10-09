# CONTEXT.md — 项目特性上下文

## 项目背景

XP-Gate 是确定性 git 质量门禁 + AI 多专家评审（Delphi）+ Sprint Flow 流水线的工具集，核心是 `xp-gate` CLI + 12 道确定性门禁（纯 shell/CLI，零 AI 耦合）。

- 门禁链：G0 版本一致性 → G1 语言适配器（lint/静态分析）→ G2 jscpd → G3 复杂度(CCN) → G4 principles → G5 测试+覆盖率 → G6 架构 → G7 → G8 密钥扫描(fail-closed) → G9 build integrity → G10 → G11 sprint 报告 → G12 环境
- 语言适配器在 `githooks/adapters/*.sh`（java.sh / typescript.sh / python.sh / powershell.sh …），评分与审计在 `src/npm-package/lib/gate-audit.ts`
- 镜像纪律：`src/npm-package/**` 是 `githooks/**` 等规范源的字节级镜像，改规范源后必须 `sync-package-content.js --fix`

## 本次特性（#507：Java 质量门禁支持强化）

来源：whaleAudit（Java 8 / Maven 多模块 / Druid Filter SQL 审计组件）实战使用 xp-gate v0.20.0 的反馈。浩鲸 Java 规范组官方静态检查工具 **wc-java-lint**（捆绑 checkstyle 10.21 / pmd 7.7 / spotbugs 4.8.4+findsecbugs+自研 / simian / lizard，规则集带 manifest 验签）已可用，支持 `check --changed --format json` 增量。

五个短板 → 五个切片：
1. **S1（最关键）**：G1 java.sh 的 checkstyle/pmd 依赖 `command -v`，不在 PATH 时静默跳过；插件目录缺失也无提示 → Java 项目 G1 实际只剩 `mvn compile` 兜底却报 PASS。改为：检测到 `wc-java-lint` 在 PATH 时优先 `wc-java-lint check --changed --format json`；插件目录缺失输出明确 WARN 而非静默 PASS。
2. **S2**：G3 `CCN_THRESHOLD=5` 写死，对 AST 解析类 Java 代码过于激进且与官方阈值(CCN>10)不一致 → 三级覆盖：`.xp-gate/ccn-threshold` 项目文件 > `XP_GATE_CCN_THRESHOLD` 环境变量 > 默认 5。
3. **S3**：文档/配置类提交导致 G3/G4/G9 SKIP 时，SKIP 计入分母把综合分拉到 6.0-6.7（PARTIAL）尽管 0 失败 → 评分口径区分 SKIP（不适用）与 FAIL，报告标注「有效门禁通过率」。
4. **S4**：G4 principles checker（TS 实现）对 Java 文件的实际规则覆盖不明 → 显式化：不支持 Java 就明确 SKIP 并说明原因，不含糊。
5. **S5**：G9 build integrity 仅适用 TypeScript，Java 项目永久 SKIP → 按 PROJECT_LANG 分派（Java 用 `mvn verify` 或 wc-java-lint aux-classpath 增量）。

## 分工边界

- wc-java-lint：Java 五件套静态检查 + 官方规则集 + 工具/规则自动同步（`--changed`/`--staged` 原生增量）
- xp-gate：流程编排（12 门禁）、sprint 强制、覆盖率（G5 jacoco）、架构分层（G6）、密钥/SAST（G8/G10）

## 关键环境

- whaleAudit 侧：Windows 11 + Git Bash，hooks via core.hooksPath；Java 8 target / Maven 多模块
- wc-java-lint 契约（已知）：`wc-java-lint check --changed --format json` 一次跑齐五件套；不在 PATH 时 xp-gate 不得假装检查过

## 领域术语

- **SKIP**：门禁不适用（无变更/语言不符），与 FAIL 语义必须区分
- **有效门禁通过率（effective_pass_rate）**：分母剔除 SKIP 后的通过率 = PASS / (TOTAL - SKIP)
- **CCN**：圈复杂度（cyclomatic complexity number）
- **wc-java-lint**：浩鲸官方 Java 静态检查 CLI（五件套 + 官方规则集 + manifest 验签），`check --staged --format json` 增量契约见 DR-002
- **aux-classpath**：spotbugs 分析字节码所需的类路径参数（本期不采用，记 ADR 备选）
- **fail-closed**：无法得出确定结论时必须 BLOCK 而非放行（同 Gate 8 #499 哲学）

## 关键决策（详见 .sprint-state/decisions.md 与设计文档 / ADR）

1. wc-java-lint 走「可用则优先，缺失则显式 WARN/降级」，不内置、不自动下载（DR-006：命中时替换 legacy checkstyle/pmd 直调与 p3c/whalecloud 插件链；缺失时旧链回退+插件目录缺失各自 WARN）
2. wc-java-lint 执行失败=BLOCK（fail-closed），逃生阀 `XP_GATE_WC_JAVA_LINT=soft`（DR-001）；调用契约与 exit code 语义由 stub fixture 测试钉住（DR-002）
3. 评分口径向后兼容：`SCORE = PASS / (TOTAL - SKIP) * 10`，WARN 计入分母，有效分母 0 → score=N/A/verdict=SKIP-ALL，新增 effective_pass_rate/skip_count 字段（DR-005）；无 SKIP 时与旧口径逐字节一致
4. S4 先审计 java.ts 实际覆盖再裁决，禁止盲目 SKIP（DR-004）；S5 目标=pre-commit 内联 Build Integrity 段 + src/build-integrity/gate-10.ts（gate-9.sh 是 SAST，勿改错），Java 走 `mvn -q -DskipTests compile`（DR-003）
5. CCN 阈值覆盖链：项目文件 > 环境变量 > 默认 5；非法值 WARN+回退，生效阈值写入审计输出（DR-008）
6. Java 项目判定沿用 multilang 机制（staged 含 .java 即激活），polyglot 各适配器并行（DR-007）
7. DoD 统一含镜像同步 + 用例更新 + Windows Git Bash 实测项 + 非 Java 回归断言（DR-009）

## 关键证据源

- Issue #507 原文（含 whaleAudit 实测数据：340 core 测试、SKIP 拉分实例）
- `githooks/adapters/java.sh`、`githooks/gate-3.sh`、`src/npm-package/lib/gate-audit.ts`
- 已有设计文档命名规范：`docs/plans/YYYY-MM-DD-<topic>-design.md`
