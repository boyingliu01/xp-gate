# Issue 清单：ArchUnit 33 条架构规则落地（XP-Gate）

- 日期：2026-10-30
- 基线版本：`v0.32.1.0`，`@archlinter/cli@0.16.0`
- 配套分析：`docs/plans/2026-10-30-archunit-33-rules-gap-analysis.md`
- 用途：供后续开发逐个领取处理。每个 issue 自带验收标准（AC），可直接转成测试用例。

## 依赖关系总览

```
ARCH-01 (P0 止血)
 ├─ ARCH-02 (P0 文档更正)
 └─ ARCH-03 (P1 分层契约抽象)
      └─ ARCH-04 (P1 分层规则实现 R01/R04/R19)
ARCH-05 (P1 ArchUnit 规则模板库)
 └─ ARCH-06 (P1 Gate 6 规则覆盖矩阵)
ARCH-07 (P2 Java 命名规则 R10/R11/R12)
ARCH-08 (P2 Java 可见性规则 R13/R22)
ARCH-09 (P2 Java 注解规则 R09/R18)
ARCH-10 (P2 Java 设计质量规则 W06/W07/W08/W09/W02-W05)
ARCH-11 (P2 DDD 战术规则 R21/B-ADP/B-EVT)
ARCH-12 (P2 DTO/Util/Event 依赖规则 R08/R15/W01)
```

---

## ARCH-01 【P0】Gate 6 必须暴露 `architecture.yaml` 死配置，禁止静默通过

**问题**

`githooks/pre-commit` 的 Gate 6 只在 L3509 做 `[ -f "$PROJECT_ROOT/architecture.yaml" ]` 存在性检查，随后 L3541/L3543 调用 archlint 时**从不传 `--config`**。而 `architecture.yaml` 的 `layers:` 定义在 archlint 0.16 中根本不存在对应 schema 键（顶层无 `layers`，`RuleFullConfig` 仅接受 `severity`/`enabled`/`exclude`）。

净效果：项目写了完整的层边界配置，Gate 6 却完全不校验分层，且报告全绿。这是当前最大的假阳性来源——门禁在为一个从未测量的维度背书。

**现状证据**

```bash
grep -n "run_archlint " githooks/pre-commit
# 3541: ARCHLINT_OUTPUT=$(run_archlint diff .architecture-baseline.json --fail-on high 2>&1)
# 3543: ARCHLINT_OUTPUT=$(run_archlint scan . -f table --quiet 2>&1)
# → 两条命令都没有 --config
```

**要做的事**

1. 在 Gate 6 中区分三种状态，不能再合并为「架构已配置」：
   - `architecture.yaml` 存在但 archlint 拒绝解析 → 显式 WARN + Gate 6 状态降级（不得为 PASS）
   - `architecture.yaml` 存在但无法被当前后端执行（分层语义无对应检测器）→ 显式 WARN「分层规则未生效」
   - 仅 `.archlint.yaml`（archlint 原生配置）→ 视为「通用架构坏味道已配置」，但**明确不等于**分层已校验
2. 输出一句可操作提示，告诉用户分层校验实际走哪条路（见 ARCH-03/ARCH-05）。
3. `GATE_6_REASON` 新增 reason 值：`layers_config_not_enforced`，并纳入 `classify_coverage_reason()` 的 fail-closed 映射。

**验收标准**

- [ ] AC-1：构造「`architecture.yaml` 存在且含非法 `rules:` 块」的 fixture 项目，Gate 6 必须输出明确 WARN 且 status ≠ PASS
- [ ] AC-2：构造「仅有 `.archlint.yaml`」的项目，Gate 6 输出提示「分层规则未校验」且 status ≠ PASS
- [ ] AC-3：新增 reason `layers_config_not_enforced` 出现在 quality report 的 per-language 明细中
- [ ] AC-4：`classify_coverage_reason('layers_config_not_enforced')` 返回非 `covered`（fail-closed）
- [ ] AC-5：既有 Gate 6 测试全绿，无回归

**写作用域**：`githooks/pre-commit`、`githooks/adapters/`、`githooks/__tests__/`

---

## ARCH-02 【P0】更正 `docs/ARCHITECTURE.md` 中 ARCH-001..014「已启用」的误导性表述

**问题**

`docs/ARCHITECTURE.md` L296-309 的表格给 `ARCH-001`~`ARCH-005`、`ARCH-008`~`ARCH-010` 标「已启用=是」。实测这 9 条全部不生效（见 ARCH-01）。同时 `githooks/TOOL-INSTALLATION-GUIDE.md` L280-360 整节在教用户如何配置一个无效的 `layers:` 块。

**要做的事**

1. `docs/ARCHITECTURE.md` L296-309 表格增加「实际生效」列，真实标注：架构域检测由 archlint built-in 检测器提供，`ARCH-001..014` 为规划编号、当前无实现。
2. `githooks/TOOL-INSTALLATION-GUIDE.md` 的「architecture.yaml 配置指南」章节整体加警示框，并指向本分析与 ARCH-03/ARCH-05 的规划路径。
3. `architecture.yaml` 顶部的注释块（L48-62）标注 `# NOT ENFORCED by archlint 0.16 — see docs/plans/2026-10-30-*`。
4. 检查 `docs/CAPABILITIES.md`、`README.md` 是否有同类表述，一并更正。

**验收标准**

- [ ] AC-1：`docs/ARCHITECTURE.md` 不再出现无保留的「ARCH-00x 已启用=是」
- [ ] AC-2：`architecture.yaml` 注释明确说明该 `rules:` 块在 0.16 下不被执行
- [ ] AC-3：全仓 `grep -rn "ARCH-00[1-9]"` 的每一处均有「未生效/规划中」限定语或指向新文档

**写作用域**：`docs/`、`githooks/TOOL-INSTALLATION-GUIDE.md`、`architecture.yaml`、`README.md`、`docs/CAPABILITIES.md`

---

## ARCH-03 【P1】抽象语言无关的 `layer-contract`，用一份配置驱动多语言后端

**背景**

33 条规则中，R01（严格四层方向）、R04（Infra 不暴露给 Application）、R19（App Service 只依赖 Domain）、R07（Service 不依赖 Controller）、R14/R15/R17（领域隔离）同属「层间依赖方向」语义，**与语言无关**。当前无法表达，是因为唯一载体 archlint 只懂 TS/JS。

**要做的事**

1. 设计 `layer-contract` 配置格式（新文件，如 `.layer-contract.yaml`），至少表达：
   - `layers`: 名称 → 路径 glob 列表
   - `order` 或 `allowed_dependencies`: 允许的依赖方向（支持白名单与黑名单两种表达）
   - `severity`: `error` | `warning`
   - `languages`: 适用语言
2. 定义后端接口（一个函数签名级别的小接口即可）：
   - `typescript`：基于现有 archlint 依赖图，或复用 Gate 6 已解析的 import 边
   - `java`：复用 `src/principles/adapters/java.ts` 的 `imports` getter（已能解析 `import` 全限定名）
   - `python`：生成 import-linter 契约（可选，后续 issue）
3. 在 Gate 6 中作为 `layer_violation` 的替代实现接入，输出与 archlint 兼容的 severity。
4. 保持 ratchet 语义：复用 `.architecture-baseline.json` 的「只拦新增」模式。

**验收标准**

- [ ] AC-1：一份 `.layer-contract.yaml` 可同时声明 TS 与 Java 的层定义
- [ ] AC-2：TS fixture（domain → infrastructure 反向依赖）被拦截，输出 `severity=error`
- [ ] AC-3：Java fixture（`interfaces/rest` → `infrastructure/repository` 反向依赖）被拦截
- [ ] AC-4：违反配置 `allowed_dependencies` 白名单的依赖被拦截；黑名单模式同样生效
- [ ] AC-5：`severity: warning` 时不阻塞提交但出现在报告中
- [ ] AC-6：baseline 中已存的违规不阻塞，新增违规阻塞（ratchet 生效）
- [ ] AC-7：无 `.layer-contract.yaml` 时行为退回当前逻辑，无回归

**写作用域**：`src/architecture/`（新建 `layer-contract/`）、`githooks/pre-commit`、`src/npm-package/lib/arch.js`

---

## ARCH-04 【P1】实现分层方向三规则：R01 / R04 / R19

**依赖**：ARCH-03

**要做的事**

在 `layer-contract` 之上注册三条规则，默认 severity 按源文档（均 ERROR）：

| 规则 | 语义 | 用 layer-contract 表达 |
|---|---|---|
| R01 | `Interface → Application → Domain ← Infrastructure` 单向 | 四层 + 允许边集合 |
| R04 | Application 不得直接 import Infrastructure 定义的类 | App 的 allowed 不含 Infra |
| R19 | `application/service` 只能依赖 Domain / `java.*` / `org.slf4j` / Spring `transaction`/`stereotype` | App service 层 + import 白名单 |

**关键注意**

R01 的箭头方向是 `Infrastructure → Domain`（Infra 依赖 Domain 的接口），**不是** `Domain → Infrastructure`。这条与直觉相反，实现时务必以源文档 3.1 节图示为准，不要照抄 `architecture.yaml` 现有的 `allowedImports`（其 `infrastructure.allowedImports` 写的是 `["src/application/**", "src/domain/**", "src/shared/**"]`，与 R01 一致，但 `application.forbiddenImports` 又禁 Infra，需确认二者不冲突）。

**验收标准**

- [ ] AC-1：R01 — Interface→Application→Domain 合法，Infrastructure→Domain 合法，Domain→Infrastructure 违规，Infrastructure→Application 违规
- [ ] AC-2：R04 — Application import Infrastructure 具体类 → 违规；导入 Domain 定义的 Repository 接口 → 合法
- [ ] AC-3：R19 — `application/service` import `org.springframework.transaction.annotation.Transactional` → 合法；import `org.springframework.jdbc.core.JdbcTemplate` → 违规
- [ ] AC-4：三条规则均可独立启停并各自出具报告
- [ ] AC-5：每条规则有 VT（variant testing）覆盖的正反用例

**写作用域**：`src/architecture/layer-contract/`

---

## ARCH-05 【P1】提供 33 条规则的 ArchUnit 测试模板库

**背景**

`architecture.yaml` L192-194 已声明 Java 后端是 ArchUnit，Gate 6 的 Java 分支也确实在跑 `*Architecture*` 测试。但 xp-gate **不提供任何规则模板**，项目方只能从零手写，导致「Gate 6 通过」与「33 条规则被覆盖」毫无关系。

**要做的事**

1. 新建 `templates/archunit/`（或 `skills/` 下的 resources），为 33 条规则提供可直接复制的 ArchUnit 测试片段，按模板 A / B 分目录：
   - `templates/archunit/layered/`（模板 A：21 条）
   - `templates/archunit/ddd/`（模板 B：12 条）
2. 每个片段包含：规则编号、断言代码、`@ArchTest` 标注、所需 import 与被测包路径占位符。
3. 提供 `xp-gate init --archunit`（或 `xp-gate arch scaffold`）命令，按项目包结构生成可运行的初始测试类。
4. 片段需能被 Gate 6 的 `-Dtest='*Architecture*'` 发现（命名约定 `*ArchitectureTest`）。

**验收标准**

- [ ] AC-1：33 条规则各有对应测试片段，编号与源文档一一对应
- [ ] AC-2：生成的脚手架在标准 Maven 项目上 `mvn test -Dtest='*Architecture*'` 可运行（无编译错误）
- [ ] AC-3：故意引入违规代码后，对应规则测试失败
- [ ] AC-4：无违规时全部测试通过
- [ ] AC-5：文档说明模板 A / 模板 B 的启用判据（对齐源文档 5.3 节决策树）

**写作用域**：`templates/archunit/`、`src/npm-package/lib/`（脚手架命令）、`docs/`

---

## ARCH-06 【P1】Gate 6 输出 33 条规则覆盖矩阵，未覆盖不得静默 SKIP

**依赖**：ARCH-05

**问题**

当前 Gate 6 的 Java 分支（`githooks/pre-commit` L3620-3700）逻辑是：找到 `*Architecture*` 测试 → 跑 → 通过即 PASS；找不到 → SKIPPED。它**无法知道**项目实际覆盖了 33 条中的哪几条。覆盖 3 条和覆盖 33 条在报告里完全一样。

**要做的事**

1. 解析项目内 ArchUnit 测试源码，识别其覆盖了哪些规则编号（依赖 ARCH-05 片段中的统一标注，如 `@ArchTest static final ArchRule R01_... = ...` 或注释 `// rule: R01`）。
2. 计算覆盖矩阵，输出到 quality report：
   ```
   java architecture rules: 12/33 covered
     missing: R02 R05 R09 R13 ...
   ```
3. 未覆盖的 ERROR 规则 → Gate 6 不得为 PASS（按现有 `.architecture-skip` 豁免机制放行，而不是静默 SKIP）。
4. 与 ARCH-01 的 reason 体系打通。

**验收标准**

- [ ] AC-1：能正确统计给定 fixture 项目的规则覆盖数
- [ ] AC-2：覆盖矩阵出现在 quality report 中（机器可读 + 人可读两种形式）
- [ ] AC-3：ERROR 规则未全覆盖时 Gate 6 status ≠ PASS
- [ ] AC-4：存在 `.architecture-skip` 时按豁免处理且 reason 可区分
- [ ] AC-5：无 ArchUnit 测试的项目，reason 为 `architecture_not_configured` 且不再被当作通过

**写作用域**：`githooks/pre-commit`、`src/architecture/`、`src/npm-package/lib/check.js`

---

## ARCH-07 【P2】Gate 4 新增 Java 命名规范规则：R10 / R11 / R12

**背景**

`src/principles/adapters/java.ts` 已有 `extractClasses()` / `extractInterfaces()`，可拿到类名与行号。命名类规则是纯 AST 模式匹配，**不需要运行 Maven**，在 pre-commit 就能拦住，比 ArchUnit 快一个数量级。

**要做的事**

新增三个 principles 规则（命名空间建议 `arch.naming.*` 或复用 `clean-code.*`）：

| 规则 | 判定 | 默认级别 |
|---|---|---|
| R10 | `**/interfaces/rest/**` 下的类名以 `Controller` 结尾 | ERROR |
| R11 | `**/application/service/**` 下的类名以 `Service` 或 `ServiceImpl` 结尾 | ERROR |
| R12 | `**/infrastructure/repository/**` 与 `**/infrastructure/gateway/**` 下的类名以 `Mapper`/`DAO`/`Repository` 结尾 | ERROR |

**关键注意**

- 包路径判定要用**文件路径**而非 import 路径，且需兼容 Maven 多模块（`<module>/src/main/java/...`）。
- 需排除测试代码目录（`src/test/java`），除非规则明确要求。
- 与源文档一致：R10 只约束 `interfaces/rest` 包下，不要扩大成「所有类名」。

**验收标准**

- [ ] AC-1：`interfaces/rest/UserAPI.java` → R10 违规
- [ ] AC-2：`interfaces/rest/UserController.java` → 通过
- [ ] AC-3：`application/service/OrderManager.java` → R11 违规
- [ ] AC-4：`application/service/OrderServiceImpl.java` → 通过
- [ ] AC-5：`infrastructure/repository/UserDao.java` → R12 违规（后缀不在白名单）
- [ ] AC-6：`infrastructure/repository/UserMapper.java` → 通过
- [ ] AC-7：Maven 多模块路径 `core/src/main/java/...` 正确识别
- [ ] AC-8：非目标包（如 `util/FooHelper.java`）不误报

**写作用域**：`src/principles/rules/`、`src/principles/adapters/java.ts`、`src/principles/index.ts`

---

## ARCH-08 【P2】Gate 4 新增 Java 可见性规则：R13 / R22

**要做的事**

| 规则 | 判定 | 级别 |
|---|---|---|
| R13 | Domain 层所有字段必须是 `private` | ERROR |
| R22 | 领域实体禁止 `public` setter 方法 | ERROR |

**关键注意**

`java.ts` 目前能解析方法/成员，但**需要先确认字段可见性是否已可用**。若无，需补充字段解析（含多字段同行声明 `private int a, b;`、注解修饰 `@Column private String x;`、`transient`/`volatile` 等修饰符顺序）。

R22 的 setter 识别需覆盖：`setXxx` 命名 + 单参数 + 返回 void 或 `this`（链式）。

**验收标准**

- [ ] AC-1：`domain/Order.java` 中 `public String status;` → R13 违规
- [ ] AC-2：`private final String status;` → 通过
- [ ] AC-3：`protected int count;` → R13 违规（非 private）
- [ ] AC-4：实体中 `public void setStatus(String s)` → R22 违规
- [ ] AC-5：`public void cancel(String reason)` → 通过（不是 setter）
- [ ] AC-6：`private void setStatus(String s)` → 通过（非 public）
- [ ] AC-7：getter `public String getStatus()` 不误报
- [ ] AC-8：静态字段 `private static final Logger log` 处理符合预期

**写作用域**：`src/principles/rules/`、`src/principles/adapters/java.ts`

---

## ARCH-09 【P2】Gate 4 新增 Java 注入注解规则：R09 / R18

**要做的事**

| 规则 | 判定 | 级别 |
|---|---|---|
| R09 | Application / Infrastructure 层禁止字段上 `@Autowired` | ERROR |
| R18 | Domain 层禁止 `@Autowired` / `@Value` | ERROR |

**关键注意**

- 构造器注入合法：`public OrderService(UserService s)` → 通过。
- 需区分字段注入与 setter 注入：`@Autowired public void setX(..)` 在 Spring 中也是注入，是否纳入需先决策（建议：一并拦截，理由见源文档 3.2 节）。
- `@Value` 在构造器参数上是否放行需决策（建议：Domain 层一律不放行）。

**验收标准**

- [ ] AC-1：`@Autowired private UserService userService;` → R09 违规
- [ ] AC-2：`private final UserService userService;` + 构造器注入 → 通过
- [ ] AC-3：Domain 层 `@Value("${x}") private String x;` → R18 违规
- [ ] AC-4：Domain 层 `@Autowired` → R18 违规
- [ ] AC-5：Lombok `@RequiredArgsConstructor` 视为构造器注入 → 通过
- [ ] AC-6：注解跨行书写 `@Autowired\nprivate Foo foo;` 能识别

**写作用域**：`src/principles/rules/`、`src/principles/adapters/java.ts`

---

## ARCH-10 【P2】Gate 4 新增 Java 设计质量与命名规则：W02-W09

**要做的事**

| 规则 | 判定 | 级别 |
|---|---|---|
| W02 | 枚举类以 `Enum` 结尾或在 `enum`/`enums` 包中 | WARNING |
| W03 | Application/Domain 层禁止 `Handler` 后缀 | WARNING |
| W04 | Application/Domain 层禁止 `Manager` 后缀 | WARNING |
| W05 | Application/Domain 层禁止 `Processor` 后缀 | WARNING |
| W06 | Application Service 方法数 ≤ 30 | WARNING |
| W07 | Domain Model 实体至少有一个业务方法（非 getter/setter/equals/hashCode/toString） | WARNING |
| W08/W09 | `*Value`/`*VO` 结尾的类所有字段 `final` | WARNING |

**关于 W06 的语义差异（重要）**

现有 `clean-code.god-class` 阈值同为 30，但判定对象是「任意类的方法总数」，不看包路径。W06 要求**仅对 `application/service` 包**生效。两者不可互相替代：
- god-class 会把一个 31 方法的 DTO 判违规（W06 不该管）
- god-class 不区分包路径，无法表达「只有 Service 才查」

建议 W06 复用 `god-class` 的方法计数逻辑，但增加包路径限定，作为独立规则注册。

**关于 W08/W09**

源文档正文将其合并叙述（`W-8 ~ W-9`），附录索引计为两条。按「同一逻辑、两个模板各注册一次」实现（见分析文档第六节勘误 1）。

**验收标准**

- [ ] AC-1：`StatusColor` 枚举（非 Enum 后缀、非 enum 包）→ W02 告警
- [ ] AC-2：`enums/Color.java` → 通过
- [ ] AC-3：`application/service/OrderHandler.java` → W03 告警
- [ ] AC-4：`domain/OrderProcessor.java` → W05 告警
- [ ] AC-5：Utils 包下 `OrderHandler.java` → 不告警（不在 App/Domain 层）
- [ ] AC-6：`application/service/BigService.java` 含 31 个方法 → W06 告警
- [ ] AC-7：DTO 类含 31 个方法 → W06 不告警（但 god-class 可能告警，两者独立）
- [ ] AC-8：只有 getter/setter 的 `Order.java` → W07 告警
- [ ] AC-9：含 `public void cancel(String)` 的实体 → W07 通过
- [ ] AC-10：`MoneyValue` 有非 final 字段 → W08 告警
- [ ] AC-11：所有 WARNING 级别规则**不阻塞提交**，仅记录（对齐源文档 2.3 节）

**写作用域**：`src/principles/rules/`、`src/principles/adapters/java.ts`、`src/principles/config.ts`

---

## ARCH-11 【P2】Gate 4 新增 DDD 战术规则：R21 / B-ADP / B-EVT

**要做的事**

| 规则 | 判定 | 级别 |
|---|---|---|
| R21 | 领域实体至少有 `id` / `uuid` / `*Id` / `key` 之一 | ERROR |
| B-ADP | 适配器必须实现出站端口 | ERROR |
| B-EVT | 领域事件必须继承基类 | ERROR |

**前置决策（阻塞项）**

B-ADP 与 B-EVT **在源文档正文中没有任何章节定义**（只出现在附录索引），判定口径不明。实施前需向规范委员会确认：

- **B-ADP**：「适配器」如何识别？按类名后缀（`*Adapter`）、按包路径（`infrastructure/adapter/**`）、还是按注解？
- **B-EVT**：「基类」是项目自定义的（如 `DomainEvent`），还是框架提供的？规则如何获取基类全限定名（配置项？）

建议：先实现 R21（口径明确），B-ADP/B-EVT 待澄清后另开 issue。

**验收标准（R21 部分）**

- [ ] AC-1：`domain/model/Order.java` 无任何标识字段 → R21 违规
- [ ] AC-2：含 `private Long id;` → 通过
- [ ] AC-3：含 `private String orderId;`（`*Id` 后缀）→ 通过
- [ ] AC-4：含 `private String key;` → 通过
- [ ] AC-5：含 `private UUID uuid;` → 通过
- [ ] AC-6：仅 `getName()` 之类方法但无标识字段 → 违规

**写作用域**：`src/principles/rules/`、`src/principles/adapters/java.ts`

---

## ARCH-12 【P2】Gate 4 新增依赖方向语义规则：R08 / R15 / W01

**要做的事**

| 规则 | 判定 | 级别 |
|---|---|---|
| R08 | `*DTO`/`*Dto`/`*VO` 结尾的类不得 import Service 或 Repository | ERROR |
| R15 | `domain/event` 包下的类不得 import `infrastructure` 包下的类 | ERROR |
| W01 | `*Util`/`*Utils`/`*Helper` 结尾的类不得依赖 Application 层 Service | WARNING |

**关键注意**

这三条依赖方向单一、语义明确，可直接基于 `java.ts` 的 `imports` getter（已解析全限定名）实现，**不需等 ARCH-03 的 layer-contract**。若 ARCH-03 已就位，也可用其统一表达。

**验收标准**

- [ ] AC-1：`UserDTO` import `UserService` → R08 违规
- [ ] AC-2：`OrderVO` import `OrderRepository` → R08 违规
- [ ] AC-3：`UserDTO` 只 import `javax.validation` 注解 → 通过
- [ ] AC-4：`domain/event/OrderCompletedEvent` import `infrastructure/kafka/KafkaClient` → R15 违规
- [ ] AC-5：`domain/event/*` import `domain/model/*` → 通过
- [ ] AC-6：`StringUtils` import `OrderService` → W01 告警
- [ ] AC-7：`FileHelper` import `java.io.*` → 通过
- [ ] AC-8：W01 为 WARNING 不阻塞提交

**写作用域**：`src/principles/rules/`、`src/principles/adapters/java.ts`

---

## 附录 A：规则编号 → Issue 映射

| 规则 | 级别 | Issue |
|---|---|---|
| R01 | ERROR | ARCH-04（依赖 ARCH-03） |
| R02 | ERROR | **未覆盖** —— 建议并入 ARCH-04（同属分层方向） |
| R03 | ERROR | **未覆盖** —— 建议并入 ARCH-04（Domain import 黑名单） |
| R04 | ERROR | ARCH-04 |
| R05 | ERROR | **未覆盖** —— 建议并入 ARCH-04（App 层持久化框架黑名单） |
| R06 | ERROR | **已部分覆盖**（archlint `cyclic_dependency`，仅 TS/JS）；Java 侧缺口见 ARCH-03 |
| R07 | ERROR | **未覆盖** —— 建议并入 ARCH-04 |
| R08 | ERROR | ARCH-12 |
| R09 | ERROR | ARCH-09 |
| R10 | ERROR | ARCH-07 |
| R11 | ERROR | ARCH-07 |
| R12 | ERROR | ARCH-07 |
| R13 | ERROR | ARCH-08 |
| R14 | ERROR | **未覆盖** —— 建议并入 ARCH-04（Domain import 黑名单，与 R03 同实现） |
| R15 | ERROR | ARCH-12 |
| R16 | ERROR | **未覆盖** —— 建议增设 issue（Repository 接口位置） |
| R17 | ERROR | **未覆盖** —— 建议并入 ARCH-04 |
| R18 | ERROR | ARCH-09 |
| R19 | ERROR | ARCH-04 |
| R20 | ERROR | **未覆盖** —— 建议增设 issue（端口必须是 interface） |
| R21 | ERROR | ARCH-11 |
| R22 | ERROR | ARCH-08 |
| W01 | WARNING | ARCH-12 |
| W02 | WARNING | ARCH-10 |
| W03 | WARNING | ARCH-10 |
| W04 | WARNING | ARCH-10 |
| W05 | WARNING | ARCH-10 |
| W06 | WARNING | ARCH-10 |
| W07 | WARNING | ARCH-10 |
| W08 | WARNING | ARCH-10 |
| W09 | WARNING | ARCH-10 |
| B-ADP | ERROR | ARCH-11（口径待澄清） |
| B-EVT | ERROR | ARCH-11（口径待澄清） |

## 附录 B：建议补充的 issue（本文档未展开）

以下 6 条规则暂未独立成 issue，建议在 ARCH-03/ARCH-04 落地后评估：

| 规则 | 说明 | 建议归属 |
|---|---|---|
| R02 | Controller 禁止直接访问持久层 | ARCH-04（分层方向的具体化） |
| R03 | Domain 层零框架依赖 | ARCH-04（import 黑名单） |
| R05 | Application 禁止写原生 SQL | ARCH-04（import 黑名单） |
| R07 | Service 不得依赖 Controller | ARCH-04（反向方向） |
| R14 | `domain/model` 零框架依赖 | ARCH-04（同 R03） |
| R16 | Repository 接口只能在 Domain 定义 | 新 issue（需解析 interface 位置 + 实现类位置） |
| R17 | Domain Service 不注入 Infra 实现 | ARCH-04 |
| R20 | 端口必须是 interface | 新 issue（需识别 `domain/port/**` 是否为 interface） |

R03 与 R14 判定口径几乎相同（均为「Domain 层 import 框架类」），差异仅在被测包范围（`domain/**` vs `domain/model/**`），建议合并实现。

## 附录 C：优先级与工作量粗估

| Issue | 优先级 | 粗估 | 阻塞项 |
|---|---|---|---|
| ARCH-01 | P0 | S（1-2 天） | 无 |
| ARCH-02 | P0 | S（0.5 天，纯文档） | 无 |
| ARCH-03 | P1 | L（5-8 天） | 需先定 layer-contract 格式 |
| ARCH-04 | P1 | M（3-4 天） | ARCH-03 |
| ARCH-05 | P1 | L（5-7 天，33 个模板） | 无 |
| ARCH-06 | P1 | M（3-4 天） | ARCH-05 |
| ARCH-07 | P2 | S（1-2 天） | 无 |
| ARCH-08 | P2 | M（2-3 天，需补字段解析） | 无 |
| ARCH-09 | P2 | S（1-2 天） | 无 |
| ARCH-10 | P2 | M（3-4 天，8 条规则） | W08/W09 口径确认 |
| ARCH-11 | P2 | M（R21 简单，B-ADP/B-EVT 待澄清） | 规范委员会澄清 |
| ARCH-12 | P2 | S（1-2 天） | 无 |

**建议执行顺序**：ARCH-01 → ARCH-02 → ARCH-07 + ARCH-12（快速见效，纯 Java AST）→ ARCH-05 → ARCH-03 → ARCH-04 → ARCH-06 → 其余 P2。
