# ARCH 链路与快速见效 — 设计文档

> Sprint: `sprint/2026-11-03-01` ｜ 父单：`#685`（ArchUnit 33 条规则覆盖度）
> 范围：`#689`（ARCH-14）、`#694`（ARCH-07）、`#699`（ARCH-12）
> 状态：DESIGN

## 1. 本 Sprint 做什么、不做什么

本 Sprint 只做**三件事**，共同点是：不依赖 ARCH-03 的层契约编排，也不需要跑
Maven/ArchUnit，全部在 pre-commit 内完成。

| Issue | 编号 | 交付 | 形态 |
|---|---|---|---|
| `#689` | ARCH-14 | 架构工具进 `doctor` 注册表 | 数据登记 |
| `#694` | ARCH-07 | Java 命名规则 R10 / R11 / R12 | 纯 AST 匹配 |
| `#699` | ARCH-12 | 依赖方向规则 R08 / R15 / W01 | 纯 AST 匹配 |

**明确不在本 Sprint 内**：`#690`（层契约编排，needs-design 且有两个开放问题）、
`#692`（ArchUnit 模板库）、`#691`、`#693`，以及 `#695`–`#700` 的其余规则。
它们是 `#690` 编排体系的下游，先做会返工。

## 2. 为什么这三个可以合在一起

三者共享一个前置事实：**`java.ts` 已经能解析出所需的一切**，
`extractClasses()` / `extractInterfaces()` / `imports` getter 均已存在。
所以本 Sprint 没有一项需要扩展解析器，风险集中在「判定逻辑写对没有」。

`#689` 与其他两个没有代码交集，但它补的是同一条链的另一半：
即使 R10/R11/R12 写好了，用户缺 ArchUnit 时 `doctor` 报不出来，等于仍然无从诊断。

## 3. 逐项设计

### 3.1 #689 —— 架构工具进 doctor 注册表

在 `src/npm-package/lib/language-tools.js` 的 `LANGUAGE_REGISTRY` 中各语言 `tools` 数组追加：

| 语言 | 工具 | checkCmd | optional | 备注 |
|---|---|---|---|---|
| typescript | `@archlinter/cli` | `npx --no-install archlint --version` | true | 项目内 devDependency 优先 |
| typescript | `dependency-cruiser` | `npx --no-install depcruise --version` | true | 分层表达力更强（ARCH-03 用） |
| python | `import-linter` | `lint-imports --version` | true | `lint-imports` 是入口命令 |
| go | `arch-go` | `arch-go --version` | true | |
| java | `archunit` | *构建依赖*，见下 | true | 不按 CLI 判定 |
| kotlin | `konsist` | *构建依赖*，见下 | true | 同 Java |

**关键难点（AC-689-03）：Java/Kotlin 的 ArchUnit/Konsist 是构建依赖，不是 CLI。**
若沿用 `checkCmd` 探测，永远报「未安装」，是假阴性。判定改为扫描构建文件。

**每种语言只认自己的坐标**（架构专家 R1 第二轮指出：不区分会互相误判）：

| 语言 | 工具 | Maven/Gradle 坐标 | 误判风险 |
|---|---|---|---|
| java | archunit | `com.tngtech.archunit` | 若只搜 `archunit` 会漏掉 `archunit-junit5`、`archunit-example` 等变体 |
| kotlin | konsist | `com.lemonappdev:konsist` | Konsist 也可能被 Java 项目引用 |

所以判定必须**按 group 前缀 + 当前语言**双重匹配，不能只做全文 `includes()`：

- `java` → 构建文件匹配 `com.tngtech.archunit`
- `kotlin` → 构建文件匹配 `com.lemonappdev`（group 级，兼容 `konsist` 各制品）

一个 Kotlin 项目只声明了 Konsist 时，Java 的 archunit 条目仍报「未安装」——正确，
因为它确实没装。反过来 Java 项目声明了 Konsist 也不会让 Java 的 ArchUnit 判定变绿。

**多模块/version catalog 处理**（架构专家提出的 AC 缺口）：
Gradle 的 `libs.versions.toml` 场景下坐标写在 catalog 文件而非 `build.gradle.kts`。
因此构建文件扫描范围包含：`pom.xml`、`build.gradle`、`build.gradle.kts`、
`gradle/libs.versions.toml`。多模块项目只看**根**构建文件与 catalog
（子模块坐标经由根聚合或 catalog 声明，逐子目录扫描成本高且收益低）。

这需要给 `ToolDef` 增加一个可选字段 `detectBy`，取值为 `'cli'`（默认）或 `'build-file'`。
这是对现有结构的**增量扩展**，不改既有条目行为（AC-689-04）。

### 3.2 #694 —— Java 命名规则 R10 / R11 / R12

新文件 `src/principles/rules/arch/naming.ts`。目录归属见 §6.1（结论：新建 `rules/arch/`，
理由与代码依据在该节），此处不再给出备选，避免两处结论互斥。
规则 ID 采用 issue 建议的 `arch.naming.*` 命名空间：

| 规则 | 包路径判定 | 允许后缀 | 严重级 |
|---|---|---|---|
| `arch.naming.controller` (R10) | `**/interfaces/rest/**` | `Controller` | error |
| `arch.naming.service` (R11) | `**/application/service/**` | `Service` \| `ServiceImpl` | error |
| `arch.naming.repository` (R12) | `**/infrastructure/repository/**`、`**/infrastructure/gateway/**` | `Mapper` \| `DAO` \| `Repository` | error |

**路径判定必须用文件路径而非 import 路径**，且要兼容 Maven 多模块
（`core/src/main/java/com/x/...`）：判定锚定 `src/main/java/` 之后的相对包路径，
`src/test/java` 整棵排除。

一个易错点：`UserDao` 不在白名单（白名单是 `DAO` 大写），issue #694 的 AC-694-05 明确要求报违规。
实现需**区分大小写**，不能 `toLowerCase()` 后比较。

### 3.3 #699 —— 依赖方向规则 R08 / R15 / W01

| 规则 | 判定 | 严重级 |
|---|---|---|
| `arch.dependency.dto-layering` (R08) | `*DTO`/`*Dto`/`*VO` 结尾的类 import 了 Service 或 Repository | error |
| `arch.dependency.domain-event` (R15) | `domain/event` 包下的类 import 了 `infrastructure` 包 | error |
| `arch.dependency.util-service` (W01) | `*Util`/`*Utils`/`*Helper` 结尾的类依赖 Application 层 Service | **warning** |

基于 `java.ts` 已解析的**全限定名** imports 实现，不需要等 ARCH-03。

### W01 的「Application 层 Service」如何判定（消除二义）

架构专家指出该措辞有二义：是指包路径含 `application`，还是指类名以 `Service` 结尾？
两者会给出不同结果，必须定死。

**结论：以类名后缀为准，不叠加包路径条件。**

- 命中：被 import 的简单类名匹配 `*Service` 或 `*ServiceImpl`，
  **且**不命中 §6.3 的排除后缀
- 不命中：仅包路径含 `application` 但类名不以 `Service` 结尾（如 `OrderManager`）
- 不命中：类名以 `Service` 结尾但来自框架包（`java.*` / `javax.*` / `jakarta.*` /
  `org.springframework.*` / `com.fasterxml.*`）——这些是框架提供的服务，不是本项目
  Application 层，报出来是噪音

第三条用 FQN 前缀判定，与 §6.3 的排除后缀一样是**封闭集合**，可随真实误报增量补，
不引入白名单文件。

理由：与 R08 共用同一套「怎么算 Service」的知识，避免同一概念两套口径；
包路径不可靠（各项目包名不同），类名后缀则是本标准自身规定的（见 R11）。

### 判定依据速查（三条规则用的不是同一种信息，这不是矛盾）

架构专家在 R1 第二轮指出「R08 拒绝包路径、R15/W01 又用包路径」自相矛盾。
澄清：**每条规则用的信息由它要表达的东西决定**，三者本就不同类。

| 规则 | 判定依据 | 为什么是这个 |
|---|---|---|
| R08 | 被 import 的**类名**（+ 排除后缀） | 约束的是「DTO 不许依赖服务」，而 Service/Repository 在各项目包名千差万别，无法用固定包路径表达 |
| R15 | 源文件的**包路径** + 目标 import 的**包段** | 约束的是「领域事件层不许依赖基础设施层」，这是纯粹的分层关系，层由包路径定义 |
| W01 | 源文件的**文件名** + 目标类名后缀（+ 框架包前缀排除） | `*Util` 是命名约定；「Application Service」按类名后缀判定，理由见上一节 |

也就是说：R08 拒绝的是「用包路径识别被依赖方的角色」（因为不可靠），
而不是拒绝一切包路径判定。R15/W01 里的包路径是**本标准明确规定的层结构**
（`domain/event`、`infrastructure`），不是猜测。

R15 的「`infrastructure` 包」判定规则：目标 FQN 中**任一段**等于 `infrastructure`。
`domain/event` 同理——源文件路径中任一段等于 `domain` 且其下一段为 `event`。

R08 的「Service / Repository」如何识别？不靠包路径全匹配（各项目包名不同），
按**被 import 的类名后缀**判定：`*Service`/`*ServiceImpl` 视为 Service，
`*Repository`/`*Mapper`/`*DAO` 视为 Repository。与 R11/R12 的白名单保持一致，
避免同一个概念两套口径。

**但仅靠后缀会误报**，因此同时施加排除后缀（详见 §6.3）：
`*Constants` / `*Facade` / `*Config` / `*Exception` / `*Test` / `*Factory` /
`*Builder` / `*DTO` / `*VO` / `*Util`。排除优先于命中。
`UserService` 报违规，`OrderServiceConstants` 不报——两者后缀相同，靠排除区分。

W01 必须是 warning（AC-699-08：不阻塞提交）。交互语义已在 §6.2 关闭：
恒为 warning、不升级、不进 error 通道、不计入 Gate 4 阻塞判定，
但计入 Boy Scout 的 warning 总数并始终出现在报告中。

## 4. 共同约束

1. **镜像纪律**：`src/principles → src/npm-package/principles` 是字节镜像对，
   改完必须 `xp-gate sync-mirrors --write`，否则 CI 的 mirror parity 会红。
2. **规则登记四处齐全**：`rules/` 实现 + `__tests__/` 用例 + `rules/index.ts` 聚合
   + `reporter.ts` 的 SARIF 描述。缺一处就是死规则。
3. **测试注解强制**：每个测试文件必须带 `@test REQ-XXX`、`@intent`、`@covers AC-XXX`。
   REQ 编号见 §4.1（架构专家 MC-04：不定义 REQ 却强制引用，条款无法满足）。
4. **TDD**：先写 RED 测试再实现，每个 AC 至少一条用例。
5. **不动无关代码**：本 Sprint 不重构既有规则，不清理发现的既有告警
   （除非它恰好落在改动文件的 Boy Scout 清零义务内）。

### 4.1 REQ 编号（`specification.yaml` 追加）

`specification.yaml` 现有最大 REQ 号为 `REQ-725`，本 Sprint 追加三条：

| REQ | 对应 issue | 描述 | AC 映射 |
|---|---|---|---|
| `REQ-726` | `#689` | `doctor` 必须能诊断各语言架构工具的安装状态，并区分 CLI 工具与构建依赖工具 | AC-689-01 … AC-689-09 |
| `REQ-727` | `#694` | Java 命名规则 R10/R11/R12：按包路径约束 Controller/Service/Repository 类名后缀 | AC-694-01 … AC-694-08 |
| `REQ-728` | `#699` | Java 依赖方向规则 R08/R15/W01：DTO 不得依赖服务、领域事件不得依赖基础设施、Util 告警 | AC-699-01 … AC-699-14 |

兼容性两条（`AC-COMPAT-01/02`）归属 `REQ-726`——它们约束的是同一件事的副作用
（新增 `arch` 分组），不单独开 REQ。

测试文件与 REQ 的对应关系：一个测试文件 `@test` 填它所验证的主要 REQ，
不同 REQ 的用例放不同文件，避免一个文件背三条 REQ 导致可追溯性变虚：

| 测试文件 | `@test` | 覆盖 |
|---|---|---|
| `src/npm-package/lib/__tests__/doctor-arch-tools.test.js` | `REQ-726` | AC-689-* |
| `src/principles/__tests__/rules/arch-naming.test.ts` | `REQ-727` | AC-694-* |
| `src/principles/__tests__/rules/arch-dependency.test.ts` | `REQ-728` | AC-699-* |
| `src/principles/__tests__/config-arch-group.test.ts` | `REQ-726` | AC-COMPAT-01/02 |

**AC-COMPAT-01/02 的归属说明**（架构专家 R1 第 5 轮 MC-03 要求补齐）：
它们验证的是 `.principlesrc` 的**加载与合并行为**，与 `doctor` 无关，因此不放进
`doctor-arch-tools.test.js`；但也不单独开 REQ（它们是新增 `arch` 分组的副作用，
不是独立需求），故 `@test` 仍标 `REQ-726`，用独立测试文件保证可定位。
归属 REQ-726 但不与 doctor 测试同文件——这正是「一个文件背多 REQ 会让可追溯性变虚」
的边界：归属看语义，分文件看可定位性。

### 4.2 与 ARCH-03 层契约的关系（架构专家 MC-03）

本 Sprint 的 R08/R15/W01 与未来 ARCH-03 的 `.layer-contract.yaml` 确实在
「依赖方向」上有概念重叠，需明确演进关系，避免同一概念两套实现：

- **本 Sprint 实现的是「本标准的默认约定」**：R10/R11/R12 的包路径结构
  （`interfaces/rest`、`application/service`、`infrastructure/repository`）和
  R08/R15/W01 的方向禁令，都是 ArchUnit 33 条规范里**固定**的，不需要用户声明。
- **ARCH-03 实现的是「用户自定义层」**：用户用自己的层名和允许方向描述项目。
  当两者冲突时，**ARCH-03 的显式声明优先**——用户说了算。
- **共存方式**：ARCH-03 落地后，这三条规则改为「默认规则的实例化」，
  即由 ARCH-03 的生成器把 R08/R15/W01 表达成对应工具的配置；
  本 Sprint 的 principles 实现保留为**无 ARCH-03 配置时的兜底**。
  这也是为什么现在做不返工：判定逻辑（后缀集合、排除前缀）在 ARCH-03 下依然复用，
  届时只需替换「谁来触发」，不重写判定。

（此项写入 `docs/adr/0002-arch-rules-vs-layer-contract.md`——架构专家 R1 第 6 轮
mC-04 指出原文只写「见 docs/adr/」而未给编号，交付物不可定位。该 ADR 在 BUILD 阶段产出。）

### 4.3 通配 import 的行为（架构专家 R1 第 6 轮 mC-01）

通配形式 `import com.acme.service.*;` **没有具体类名**，无法判定被依赖的类是谁。

**结论：通配 import 不参与 R08/W01 的类名后缀判定，但参与 R15 的包段判定。**

- R08/W01 依赖「被 import 的简单类名」，通配 import 无此信息；强行推断只能靠命名猜测，
  那正是 R08 本要避免的误报来源。故跳过。
- R15 依赖「目标 FQN 的包段」，通配 import 的 FQN（`com.acme.infrastructure.*`）
  本身可判定，故照常生效。
- 行为需测钉住：DTO 中的 `import com.acme.service.*;` **不**触发 R08。

这是有意的取舍而非遗漏：宁可不报，也不产生无法解释的误报。

## 5. 验收标准总表（33 条 AC）

编号规则：`AC-<issue 号>-<两位序号>`，**全局唯一**。项目规范要求每个测试带
`@covers AC-XXX`，若三个 issue 各自从 AC-1 编号，`@covers AC-1` 就无法定位到
具体是哪条——R1 第二轮评审正是因此判定可追溯性契约无法落地。
故此处统一加 issue 号前缀，与仓库既有 `AC-715-01`、`AC-724-03` 等写法一致。

### #689 — 架构工具进 doctor 注册表（9 条）

- [ ] AC-689-01：`xp-gate doctor` 能报告各语言架构工具的安装状态
- [ ] AC-689-02：**CLI 型**工具缺失时输出该平台的安装命令，字符串与
      `LANGUAGE_REGISTRY` 中 `install[process.platform]` **完全一致**（§6.5）；不自动安装。
      构建依赖型（Java/Kotlin）不适用本条——它们没有包管理器安装命令，
      改由 AC-689-03 约束
- [ ] AC-689-03：Java/Kotlin 这类「构建依赖而非 CLI」的工具，检测逻辑正确
      （不误判为缺失）
- [ ] AC-689-04：不影响现有语言/工具的 doctor 输出
- [ ] AC-689-05：单测覆盖「已安装 / 未安装 / 构建依赖」三种状态
- [ ] AC-689-06：Gradle version catalog（`gradle/libs.versions.toml`）声明的
      ArchUnit/Konsist 也能被识别为已安装
- [ ] AC-689-07：Kotlin 项目只声明 Konsist 时，Java 的 archunit 条目**仍报未安装**
      （证明没有跨语言误判）；反之亦然
- [ ] AC-689-08：架构工具全部 `optional: true`，缺失**不改变** `doctor` 退出码语义
      （仍是 0），只在报告中列出
- [ ] AC-689-09：多模块 Maven/Gradle 项目只在**根**构建文件与 catalog 声明坐标时，
      也能识别为已安装；子模块目录不逐个扫描（§3.1 明确的行为，需测钉住）

### #694 — Java 命名规则 R10/R11/R12（8 条）

- [ ] AC-694-01：`interfaces/rest/UserAPI.java` → R10 违规
- [ ] AC-694-02：`interfaces/rest/UserController.java` → 通过
- [ ] AC-694-03：`application/service/OrderManager.java` → R11 违规
- [ ] AC-694-04：`application/service/OrderServiceImpl.java` → 通过
- [ ] AC-694-05：`infrastructure/repository/UserDao.java` → R12 违规（`DAOs` 白名单是
      大写 `DAO`，大小写敏感）
- [ ] AC-694-06：`infrastructure/repository/UserMapper.java` → 通过
- [ ] AC-694-07：Maven 多模块路径 `core/src/main/java/...` 正确识别
- [ ] AC-694-08：非目标包（如 `util/FooHelper.java`）不误报

### #699 — 依赖方向规则 R08/R15/W01（14 条）

- [ ] AC-699-01：`UserDTO` import `UserService` → R08 违规
- [ ] AC-699-02：`OrderVO` import `OrderRepository` → R08 违规
- [ ] AC-699-03：`UserDTO` 只 import `javax.validation` 注解 → 通过
- [ ] AC-699-04：`domain/event/OrderCompletedEvent` import
      `infrastructure/kafka/KafkaClient` → R15 违规
- [ ] AC-699-05：`domain/event/*` import `domain/model/*` → 通过
- [ ] AC-699-06：`StringUtils` import `OrderService` → W01 告警
- [ ] AC-699-07：`FileHelper` import `java.io.*` → 通过
- [ ] AC-699-08：W01 为 WARNING 不阻塞提交
- [ ] AC-699-09：`UserDTO` import `OrderServiceConstants` → **不报** R08
      （排除后缀优先于命中，防止常量类/门面被当成服务）
- [ ] AC-699-10：W01 单独存在时 `analyze` 产出的 violations 中**无**
      `severity === 'error'` 项
- [ ] AC-699-11：W01 单独存在时结果仍**出现在报告里**
      （反向断言：不阻塞 ≠ 不上报）
- [ ] AC-699-12：`OrderHelper` import
      `org.springframework.cloud.client.discovery.DiscoveryService` → **不报** W01。
      该目标以 `Service` 结尾，本会命中 W01 的目标条件，仅因 FQN 前缀属框架包而被排除
      ——**这才是真正触发排除机制的最小用例**。
      （原写法用 `StringUtils` 是错的：它不以 `Service` 结尾，根本不进入目标判定，
      测的是「后缀不命中」而非「框架包排除」，无法证伪。架构专家 R1 第 5 轮 MC-01）
- [ ] AC-699-13：`OrderHelper` import `com.acme.order.OrderService` → **报** W01。
      与 AC-699-12 成对，证明排除只对框架包生效，不会误伤本项目的服务依赖
- [ ] AC-699-14：`OrderVO` 中的 `import com.acme.service.*;`（通配）→ **不报** R08。
      通配 import 无类名信息，不参与后缀判定（§4.3）；但 `domain/event` 下的
      `import com.acme.infrastructure.*;` 仍报 R15

### 跨三项的兼容性约束（2 条）

这两条不属于任何单个 issue，约束的是「新增 `arch` 分组」这件事对**已有用户配置**
的影响（架构专家 MC-02 要求：偏离 `AC-<issue>-<seq>` 时必须显式声明为跨 issue 段）。
前缀 `AC-COMPAT` 是本文档唯一保留段，已在此说明其归属，不构成无主前缀。

- [ ] AC-COMPAT-01：既有用户的 `.principlesrc` **只含** `clean-code` / `solid` 两键时，
      加载后 `arch` 分组取默认值且不报错（新增分组不得要求用户补配置）
- [ ] AC-COMPAT-02：`.principlesrc` 中出现未知分组（如拼错的 `archx`）时的行为与
      改动前一致（不崩溃，也不静默吞掉既有分组）

## 6. 开放问题 —— 已全部关闭

> R1 评审（三专家）首轮结论 REQUEST_CHANGES，主要理由即「带着开放问题进 BUILD」。
> 以下为关闭结论，均已核对代码后确定，不再是待议项。

### 6.1 规则目录归属 → 新建 `rules/arch/`

**结论：新建 `src/principles/rules/arch/`**，不塞进 `clean-code/` 或 `solid/`。

依据（已核对 `config.ts`）：`PrinciplesConfig` 的 `rules` 是**固定字面量类型**，
只有 `'clean-code'` 和 `'solid'` 两个键；`getDefaultConfig()` 在 127–128 行 clone 两组，
`loadConfig()` 在 240–244 行显式两次 `mergeGroup`。架构规则不属于二者任一，
硬塞会让配置语义错位（用户看到 `clean-code.arch-naming` 这种自相矛盾的键）。

新增分组需同步改 4 处，这是本 Sprint 已评估并接受的改动量：

1. `config.ts` `PrinciplesConfig.rules` 增加 `'arch': { ... }`
2. `config.ts` 新增 `DEFAULT_ARCH_RULES`
3. `getDefaultConfig()` 的 clone 增加一组
4. `loadConfig()` 的 `mergeGroup` 增加一组

`reporter.ts` 的 `descriptions` 是 `Record<string, string>` 平表，与分组无关，
只需追加 6 条描述即可，不构成阻塞。

### 6.2 W01 与 Boy Scout 的交互 → 明确为「不进入 error 通道」

**结论：W01 恒为 `warning`，永不升级为 `error`；不计入 Gate 4 的阻塞判定。**

必须用测试钉住以下三条，而不是留给实现者假设：

- `analyze` 对只含 W01 违规的文件，返回的 violations 中**没有** `severity === 'error'` 的项
- `xp-gate principles` 对 W01-only 的结果 **exit 0**
- W01 仍出现在报告里（不能因为不阻塞就静默）——这条是反向断言，
  防止「不阻塞」被误实现成「不上报」

Boy Scout 计数口径：W01 计入该文件的 warning 总数，与现有 `missing-error-handling`
等 warning 级规则同等待遇，**不设特殊豁免**。理由：W01 是真实的架构异味，
计入趋势跟踪有价值；而它不阻塞提交的性质由 severity 本身保证，与计数无关。

### 6.3 R08 的误报风险 → 后缀判定 + 排除规则，两者缺一不可

技术专家 MC-01 指出：只按类名后缀识别 Service/Repository 会大量误报。
反例确实成立——`OrderServiceConstants`（常量类）、`PaymentServiceFacade`（门面）
都会命中 `*Service` 后缀，但它们不是服务。

**修正后的判定，两个条件同时满足才算违规：**

1. 被 import 的简单类名匹配后缀：`*Service` / `*ServiceImpl` / `*Repository` /
   `*Mapper` / `*DAO`
2. **且**该类名不匹配排除后缀：`*Constants` / `*Facade` / `*Config` /
   `*Exception` / `*Test` / `*Factory` / `*Builder` / `*DTO` / `*VO` / `*Util`

排除优先于命中。这样 `OrderServiceConstants` 因命中 `*Constants` 被排除，
`UserService` 仍正常报违规。说明性注释里必须写明「为什么需要排除」，
否则后人会以为它是冗余代码删掉。

**不引入白名单文件**。理由：本 Sprint 目标是「快速见效」，一个需要维护的白名单
会让规则在初期就背上门槛；排除后缀是封闭集合，可随真实误报增量补。

### 6.4 `detectBy` 字段 → 引入，但不做文件扫描缓存的早期优化

**结论：给 `ToolDef` 增加可选 `detectBy?: 'cli' | 'build-file'`，默认 `'cli'`。**

比「给 Java 单独写分支」好在：检测逻辑集中在 `language-tools.js` 一处，
不在 `doctor.js` 里散落 `if (lang === 'java')` 特判；后续 Konsist/ArchUnit 之外的
构建依赖工具可直接复用。

关于性能（MC-03）：`doctor` 的现有检测本就是**串行**逐个 `execSync`，
每次都要起进程（数十毫秒级），新增 1–2 次 `fs.existsSync` + 小文件读取
（`pom.xml` 通常几 KB）在量级上可忽略。**本 Sprint 不引入缓存**——
没有测量就优化是过早优化，且缓存会引入失效问题。若实测有影响，另开 issue 处理。

### 6.5 AC-689-02「可执行的安装提示」→ 定义为纯输出契约

MC-04 指出该条不可测。**收敛为可断言的契约：**

- 缺失时 `doctor` 输出必须包含**该平台的**安装命令字符串，且与
  `LANGUAGE_REGISTRY` 中 `install[process.platform]` 的值**完全一致**
- 输出必须包含工具名，便于用户复制搜索
- **不自动安装**。`--install-tools` 的既有语义不变，本 Sprint 不扩展它去覆盖
  架构工具（Java/Kotlin 是构建依赖，根本无法用包管理器命令安装）

测试断言方式：导出 registry 后直接比对字符串，不匹配正则、不匹配模糊措辞。

## 7. R1 评审结论

三专家首轮均 REQUEST_CHANGES，五条主要意见的处理：

| 专家意见 | 处理 |
|---|---|
| 开放问题未关闭 | §6 全部关闭并给出代码依据 |
| R08 后缀判定误报（MC-01） | §6.3 增加排除后缀，排除优先 |
| W01 与 Boy Scout 边界未定（MC-02） | §6.2 明确 + 三条可测断言（含反向断言） |
| `detectBy` 性能影响未评估（MC-03） | §6.4 说明现有检测已是串行起进程，不做过早优化 |
| AC-689-02 不可测（MC-04） | §6.5 收敛为字符串精确匹配契约 |
