# 设计文档：Java 质量门禁支持强化（#507）

- 日期：2026-10-09
- Sprint 分支：`sprint/2026-10-09-1`（worktree `.worktrees/sprint-20261009-122629`）
- 来源：issue #507（whaleAudit 实战反馈）
- R1 需求评审：3 专家 3 轮 APPROVED（deepseek-v4.1-flash / glm-5.3-flash / hy3，consensus 1.0）
- 决策记录：`.sprint-state/decisions.md` DR-001~009

## 1. 需求摘要

XP-Gate 对 Java 项目的门禁存在五个实战短板：G1 静态分析静默空转（最关键）、G3 CCN 阈值写死、SKIP 拉低评分分母、G4 Java 覆盖不明、G9 Build Integrity 仅 TS。引入浩鲸官方 wc-java-lint（五件套）作为 G1 引擎，同时修正评分口径与覆盖显式化。

## 2. 门禁编号映射表（实现者必读，防改错门）

| 逻辑名 | 实现位置 | 说明 |
|---|---|---|
| G1 静态分析 | `githooks/adapters/java.sh` | 本次改造主战场 |
| G2 重复度 | `githooks/gate-2.sh`（jscpd） | 零变化（AC-507-01-08） |
| G3 复杂度 | `githooks/gate-3.sh`（lizard） | S2 只改阈值解析 |
| G4 principles | `githooks/gate-4.sh` + `src/principles/adapters/java.ts` | S4 显式化 |
| Build Integrity | **pre-commit 内联 "GATE 9" 段** + `src/build-integrity/gate-10.ts` | S5 目标；审计 id 记 `gate-9/build-integrity` |
| Semgrep SAST | `githooks/gate-9.sh`（= `gate-10.sh` 的 SAST 副本） | **零改动**（AC-507-05-04） |
| 评分 | `githooks/pre-commit` 综合分段（~L2968-2985） | S3 目标；**不是** gate-audit.ts（只写审计 JSONL） |

## 3. 候选方案与 trade-offs

### 方案 A（推荐）：wc-java-lint 为 G1 引擎 + 阈值/评分/显式化分切片落地
- G1 检测到 wc-java-lint（兼容 .exe/.cmd 形态）→ 以其五件套为静态分析引擎；缺失→旧链回退；执行失败→fail-closed BLOCK（soft 逃生阀）。
- 优点：复用官方规则集与增量能力，xp-gate 零维护成本；fail-closed 语义与 G8 一致；切片独立可交付。
- 缺点：引入外部工具契约（以 stub fixture 钉住缓解）。

### 方案 B：xp-gate 自行捆绑 checkstyle/pmd 并自己解析
- 优点：无外部契约依赖。
- 缺点：规则集维护成本高、与规范组脱节、与 #507 分工边界相悖。放弃。

### 方案 C：仅修 WARN 提示不动引擎
- 优点：改动最小。
- 缺点：G1 对 Java 依旧空转，不解决根本问题。放弃。

## 4. 推荐方案设计

### S1：G1 接入 wc-java-lint（`java.sh`）
1. 发现：`command -v wc-java-lint || command -v wc-java-lint.exe || command -v wc-java-lint.cmd`。
2. 命中且 staged 含 .java：调用 `wc-java-lint check --staged --format json`（若 usage error exit≥2 → 回退显式 staged .java 文件列表调用）。
3. 判定（fail-closed）：exit 0→PASS；exit 1→FAIL（输出违规数/文件）；exit≥2 / JSON 不可解析 / 超时→BLOCK+明确报错；超时默认 180s（`.xp-gate/wc-java-lint-timeout` 覆盖）。
4. JSON 解析：白名单字段 file/rule/severity/line；未知字段容忍；必需字段缺失→视为不可解析→BLOCK。
5. 逃生阀：`XP_GATE_WC_JAVA_LINT=soft` 仅把 BLOCK 类降级为 WARN（exit 3，非阻断、入评分分母、audit 记录原因）；exit 1 违规 FAIL 绝不降级；soft 下进程退出码非阻断。
6. 缺失回退：legacy checkstyle/pmd；两者皆缺→显式 WARN（verdict 不得为 PASS）；p3c-java、whalecloud-java 目录各自缺失分别 WARN。命中 wc-java-lint 时不再跑 p3c/whalecloud 链（避免双跑）。
7. polyglot：multilang 机制下各适配器并行，wc-java-lint 只收 staged .java。

### S2：CCN 阈值覆盖（`gate-3.sh`）
解析顺序 `.xp-gate/ccn-threshold`（正整数）> `XP_GATE_CCN_THRESHOLD` > 默认 5；非法值 WARN+回退 5；生效阈值写入 gate-3 审计输出。

### S3：SKIP-aware 评分（pre-commit 综合分段）
- `SCORE = PASS / (TOTAL - SKIP) * 10`，单 awk 路径（%.1f 舍入）。Delphi round-1
  修复：废弃 bc 分支——bc `scale=1` 先截断除法再乘 10（8/9→8.0），与 awk（8.9）
  实质分叉，同一提交在不同机器上历史分数不同。
- WARN/BLOCK 计入分母，不计入分子；BLOCK 等价 FAIL。
- 有效分母 0 → score=null（JSON）/N/A（控制台）、verdict=SKIP-ALL（绝不 10/10）。
- verdict=PASS 当且仅当有效分母内全部 PASS（存在 WARN 即不得 PASS；score 可为
  10.0 而 verdict≠PASS 只发生在 SKIP-ALL 之外的合法 SKIP 场景，如 TS-only 仓库
  的 GATE9——SKIP 出分母是 DR-008 的中立语义）。**Delphi round-2 A-MAJOR-1 收口**：
  Java 适配器 exit 3（soft 降级 / report 灰度 / legacy 工具缺失 / 适配器缺失 /
  意外 verdict）一律映射 `GATE_1_STATUS=WARN` 而非 SKIP——WARN 入分母且禁 PASS，
  未验证的 Java 不允许经 SKIP 通道产出假绿 PASS/10.0。
- quality-status JSON 与 history.jsonl 新增 `effective_pass_rate`、`skip_count`。
- **破坏性变更（Delphi round-1 A-MAJOR-3 收口）**：`overall.verdict` 值域由
  `PASS|PARTIAL` 变为 `PASS|WARN|FAIL|SKIP-ALL`，`score` 分母口径变为有效分母、
  SKIP-ALL 时为 `null`。仓内消费者 dashboard.js 已同步（null 分数渲染 N/A/
  skip 色而非 fail，平均分只对数值分数计算，Gates 卡片展示 effectiveTotal）。
  外部消费者的适配点：`h.score===null` 分支、`effectiveTotal` 替代 `total` 作
  展示分母、verdict 新值域。
- 评分默认值与 JSON 渲染默认值同源（gates 1-11 缺省 PASS、gate 12 缺省
  WARN）——先前的评分缺省 FAIL 与 JSON 缺省 PASS 曾产出"显示 PASS 计分
  FAIL"的自相矛盾报告（Delphi round-1 A-MAJOR-2）。
- 回归：无任何 SKIP 时分数与旧口径逐字节一致（快照测试）。

### S4：G4 Java 覆盖显式化
先审计 `src/principles/adapters/java.ts` 对每条 principles 规则的适用性，产出 `docs/java-principles-coverage.md`；G4 输出 Java 实际执行规则数；禁止盲目 SKIP（仅零覆盖才允许 SKIP+原因）。

### S5：Build Integrity Java 分派（pre-commit 内联段 + gate-10.ts）
- staged 含 .java 且 `pom.xml` 或 `./mvnw`/`mvn` 存在 → `mvn -q -DskipTests compile`（wrapper 优先）。
- mvn 缺失 → SKIP+WARN；编译失败 → FAIL；超时默认 180s（`.xp-gate/build-integrity-timeout` 覆盖）。
- Gradle-only（build.gradle 存在、pom.xml 缺失）→ SKIP+WARN（gradle 支持记 backlog）。
- `githooks/gate-9.sh`（SAST）零改动。

## 5. 假设清单（联调前置）

1. **wc-java-lint `--staged` 规格确认**：仓库内无真实二进制，stub 只能钉契约形态；真实工具支持度需 whaleAudit 侧联调确认（若仅支持 `--changed`，走 AC-507-01-06 回退路径，无需改代码）。
2. wc-java-lint 运行 JVM 版本要求（checkstyle 10.21/pmd 7.7）与 whaleAudit Java 8 target 的关系由部署方确认。
3. MSYS2 `command -v` 对 .cmd/.exe 的发现行为由 AC-507-01-05 的 stub 实测承担。

## 6. 成功标准

- 全部 AC（AC-507-01-01 ~ AC-507-05-05，见 `.sprint-state/phase-outputs/requirements-reviewed.json` 需求陈述）通过对应测试。
- 横切 DoD：镜像同步+字节 parity；受影响 .bats/.vitest 更新；Windows Git Bash 实测项；非 Java（TS/Python）门禁行为回归断言。
- 非阻塞观察 R1（SKIP 与 verdict 口径）/R2（soft 退出码）在设计实现中落实。

## 7. 切片交付顺序（依赖）

1. S2（独立，最小）→ 2. S4（独立，先审计）→ 3. S1（核心，含 stub fixture 基建）→ 4. S3（评分口径，依赖 S1 产生 SKIP 语义稳定）→ 5. S5（独立）。
