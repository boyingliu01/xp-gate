# Sprint Decisions（2026-10-09，#507）

## DR-001 wc-java-lint 执行语义（闭合 A-C2/B-C1/C-Crit2）
- **Phase**: 2/6 DESIGN（R1 Round 1 缺口裁决）
- **Question**: wc-java-lint 存在但执行失败（非零退出/JSON 解析失败/超时/JAVA_HOME 缺失）时门禁状态？
- **Options**: 静默 PASS（现状反模式）/ WARN 降级 / BLOCK
- **Choice**: **fail-closed BLOCK**（与 #499 Gate 8 哲学一致）：exit 0=PASS；exit 1=存在违规=FAIL；exit≥2、JSON 不可解析、超时=BLOCK 并给明确报错。逃生阀：`XP_GATE_WC_JAVA_LINT=soft` 降级为 SKIP+显式 WARN（记录 audit）。
- **Rationale**: "工具可用但坏了"恰是 S1 要消灭的静默 PASS 镜像路径；确定性门禁不能假绿。

## DR-002 wc-java-lint 契约固化（闭合 A-C3/B-C1/C-Crit2）
- **Choice**: 契约写入设计文档并由 stub fixture 测试钉住：调用形态 `wc-java-lint check --staged --format json`（pre-commit 语境=索引增量；工具不支持 --staged 时回退显式文件列表）；解析白名单字段（file/rule/severity/line）；schema 加性演进容忍，不可解析→BLOCK（见 DR-001）。exit code 语义：0=clean，1=violations，≥2=execution error。
- **Rationale**: AC 可测试性要求契约先于实现；测试用 stub JSON，不依赖真实工具。

## DR-003 S5 目标文件与实现路径（闭合 A-C6/B-M4/C-Crit1）
- **Choice**: S5 目标 = pre-commit 内联 "GATE 9: Build Integrity" 段 + `src/build-integrity/gate-10.ts`（**不是** `githooks/gate-9.sh`，那是 Semgrep SAST）。Java 分派实现 = `mvn -q -DskipTests compile`（与 G5 测试职责不重叠），超时默认 180s、可由 `.xp-gate/build-integrity-timeout` 覆盖；aux-classpath 增量方案记入 ADR 作为备选，本期不做。
- **Rationale**: `mvn verify` 与 G5 重叠且分钟级耗时；compile 兜底达成"build integrity 非 TS 永久 SKIP"的最小闭环。

## DR-004 S4 改为「先审计后裁决」（闭合 A-M3/B-M2/C-Crit3）
- **Choice**: S4 需求改写：先审计 `src/principles/adapters/java.ts` + `gate-4.sh` 对 .java 的实际规则覆盖并输出覆盖清单；默认动作为「保留 + 在 G4 输出中显式标注 Java 覆盖规则数」，**禁止**盲目 SKIP（那是回归）。仅当审计证实零覆盖才允许显式 SKIP+原因。
- **Rationale**: 三专家一致指出 java.ts 已存在、gate-4.sh:38 已含 .java，原前提失实。

## DR-005 S3 评分公式（闭合 A-C4/B-C3/C-Major1）
- **Choice**: `SCORE = PASS_COUNT / (TOTAL_GATES - SKIP_COUNT) * 10`；WARN 仍计入分母（真实信号，显式决定不豁免）；有效分母为 0 时 score=N/A、verdict=SKIP-ALL（绝不输出 10/10）；新增报告字段 `effective_pass_rate`、`skip_count`（quality-status JSON + history.jsonl，不改旧字段语义）；无 FAIL/BLOCK 且有效通过率=100% 时 verdict 升为 PASS。证据源修正：评分实际在 `githooks/pre-commit` 综合分段（非 gate-audit.ts，后者只写审计 JSONL）。回归基线：无任何 SKIP 时分数与旧口径逐字节一致。
- **Rationale**: 三专家共同缺口；向后兼容约束保留。

## DR-006 G1/G2/G3 职能重叠（闭合 A-C5/B-M1/C-Major3）
- **Choice**: wc-java-lint 命中时 G1 **替换** legacy checkstyle/pmd 直调与 p3c/whalecloud 插件链（避免双跑）；缺失时保留旧链回退，且 p3c-java、whalecloud-java 两插件目录各自缺失时分别输出 WARN（非静默）。wc-java-lint 内含的 lizard(CCN)/simian(重复度) 结果只作为 G1 发现上报；G2/G3 仍独立运行（xp-gate 自有口径），不互相去重，设计文档写明。
- **Rationale**: 双跑成本与口径打架；xp-gate 门禁主权不外让。

## DR-007 Java 项目判定与多语言（闭合 A-M1/B-M5）
- **Choice**: PROJECT_LANGS 判定沿用现有多语言机制：staged 文件含 .java 即激活 java 分支（pom.xml/build.gradle 仅作辅助信号）；polyglot 仓库下 G1 各语言适配器并行各跑各的，wc-java-lint 只吃 staged .java 文件集。
- **Rationale**: 复用 v0.15.0+ multilang 机制，不发明新分派层。

## DR-008 S2 无效输入语义（闭合 A-M2/B-m1）
- **Choice**: 非数字/负数/空 → WARN + 回退默认 5；实际生效阈值写入 gate-3 审计输出；默认值保持 5 不随官方对齐（官方阈值由项目方通过覆盖链自行选择），理由记 ADR。
- **Rationale**: 向后兼容优先；可排障性要求生效值可见。

## DR-009 DoD 附加项（闭合 A-M6/B-m4/B-m3）
- **Choice**: 各切片 DoD 统一追加：① 规范源改动后 `sync-package-content.js --fix` + 字节 parity 校验；② 受影响 .bats/.vitest 用例同步更新；③ 新增用例含 Windows Git Bash 下 `command -v wc-java-lint` 可发现性的 stub 实测（npm .cmd shim 场景）；④ 非 Java 项目（TS/Python）门禁行为不变的回归断言。
- **Rationale**: 镜像纪律与 bit-rot 防护是仓库既定纪律。

## DR-010 设计文档用户审批（HARD-GATE）
- **Phase**: 2/6 DESIGN
- **Question**: 设计文档是否批准进入 BUILD；关键取舍是否认可
- **Choice**: APPROVE，进入 BUILD；认可全部默认决策（①执行失败=BLOCK ②WARN 计入分母 ③CCN 默认 5 ④Gradle SKIP+WARN）
- **Rationale**: 用户 2026-10-09 会话内明确确认；batch-grill-me 决策点已并入本次审批一并确认
- **Timestamp**: 2026-10-09T04:50+08:00

## DR-011 PR #517 合并方式
- **Phase**: 5/6 SHIP
- **Question**: 合并执行方式与分支保护配置
- **Options**: 用户 GitHub 手工点击合并 / 授权 gh CLI 合并 / 关闭分支保护直推 main
- **Choice**: 授权 `gh pr merge 517 --merge`（CI 16/16 全绿后执行）；分支保护配置保持不变，维持标准 PR 流程
- **Rationale**: 单人开发但保留 CI 强制门禁的价值；零额外点击成本
- **Timestamp**: 2026-10-10T15:11+08:00

## DR-012 USER ACCEPTANCE 依据
- **Phase**: 6/6 CLOSE
- **Question**: 人工验收形式
- **Choice**: 用户指示"执行收尾动作"，以其显式合并授权 + main 合并后 3 workflow 全绿（Cross-Platform/Mutation/npm-publish）作为验收依据
- **Rationale**: xp-gate 是门禁工具，功能性验收由 CI 全链路承担
- **Timestamp**: 2026-10-10T17:49+08:00

## DR-013 #367 HARD-GATE skip-evidence
- **Phase**: 6/6 CLOSE
- **Question**: Phase 4 缺 test-alignment-report.json
- **Choice**: `--skip-evidence`；formal report 未生成，实质覆盖由 stub-fixture 14/14 + Delphi 3 轮共识 1.0 + CI 16/16 承担；skip 将出现在 retro
- **Timestamp**: 2026-10-10T17:55+08:00
