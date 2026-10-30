# 分析：ArchUnit 企业级架构治理 33 条规则 × XP-Gate 覆盖度核对

- 日期：2026-10-30
- 来源文档：《ArchUnit 企业级架构治理》33 条规则（公司内网 doc）
- 核对对象：`v0.32.1.0`（`VERSION`），`@archlinter/cli@0.16.0`
- 结论：**33 条中 0 条精确实现，2 条部分覆盖（近义但语义不同），31 条未实现**
- 配套 issue 清单：`docs/plans/2026-10-30-archunit-33-rules-issues.md`

---

## 一、先给出三个颠覆性结论

在逐条核对之前，必须先说清楚三件事。它们的严重程度远高于「缺了 31 条规则」，而且是「已实现」的部分失效的根因。

### 结论 1：`architecture.yaml` 的分层定义是**死配置**，Gate 6 从未校验过任何一条分层规则

`architecture.yaml` 是本仓库定义「Clean Architecture 层边界」的唯一载体，文档（`githooks/TOOL-INSTALLATION-GUIDE.md` L280+、`docs/ARCHITECTURE.md` L296+）反复承诺它在 Gate 6 生效。实测结论是**它完全不起作用**：

1. **Gate 6 从不把 `architecture.yaml` 传给 archlint。** `githooks/pre-commit` L3541/L3543 只有两条调用：
   ```bash
   run_archlint diff .architecture-baseline.json --fail-on high
   run_archlint scan . -f table --quiet
   ```
   没有任何 `--config`。`architecture.yaml` 只被当作**存在性检查**（`[ -f "$PROJECT_ROOT/architecture.yaml" ]`，L3509），用来决定「Gate 6 是否算配置齐全」。

2. **即便强行传进去，archlint 0.16 也不认这个 schema。** 实测：
   ```
   $ archlint scan . --config architecture.yaml
   error: Config error: rules: data did not match any variant of untagged enum
          RuleConfig at line 10 column 3
   ```
   上游 schema（`archlint.schema.json`）的顶层属性只有 `ignore` / `aliases` / `entry_points` / `rules` / `overrides` / `scoring` / `watch` / `extends` / `framework` / `tsconfig` / `max_file_size` / `git` / `diff` — **没有 `layers`**。`RuleFullConfig` 也只接受 `severity` / `enabled` / `exclude` 三个键。

3. **`layer_violation` 检测器存在，但它拿不到任何分层定义。** 二进制里确实定义了 `LayerConfig` 结构（字段 `name` / `path` / `allowed_imports`），说明上游预留了分层能力。但：
   - 上游 `archlint.schema.json` 的顶层属性里**没有** `layers`（也没有任何能容纳 `LayerConfig` 数组的键）；
   - 实测把 `layers: [{name, path, allowed_imports}]`（list 形式）、`layers: {domain: {pattern, ...}}`（map 形式）、`namespaces` / `modules` 等形式喂给 `--config`，**全部被静默忽略**——不报错，也不产生 `layer_violation`；
   - 用 `-A`（全检测器）和 `-d layer_violation`（显式指定）两种方式强制运行，依然 `smells: []`。

   最直接的 A/B 对照（`domain` 反向 import `infrastructure`）：
   ```
   配置 layers 前: ["Unknown Smell", "Unused Variable detected"]
   配置 layers 后: ["Unknown Smell", "Unused Variable detected"]   ← 完全一致
   ```

> **净效果**：一个项目就算写出教科书级别的 `architecture.yaml`，Gate 6 通过也不代表分层守住了。它只证明「没有代码克隆 / 循环依赖 / 上帝模块 / 死代码」，而这些是**通用代码坏味道**，不是**架构约束**。这是当前最大的假阳性来源 —— 门禁在报告一个它没有测量的维度。

### 结论 2：`ARCH-001` ~ `ARCH-014` 是**文档编号，不是实现**

`architecture.yaml` L48-62 的注释块、`docs/ARCHITECTURE.md` L296-309、`githooks/TOOL-INSTALLATION-GUIDE.md` L351+ 都在讲 `ARCH-001..014` 共 14 条架构规则，很容易读成 xp-gate 实现了 14 条规则。

实际上：
- `grep -rn "ARCH-0" src/` 在 `src/` 下**零命中**（除 `version-parser.test.ts` 里一个无关的 `REQ-ARCH-001-02` 标签）。
- `src/architecture/` 目录里**只有 `version-parser.ts`**（Gate 0 版本一致性用），没有任何一条架构规则的检查代码。
- 那 14 个键名只是写在 YAML 里的**配置占位**，而承载它们的 `rules:` 块恰好是 archlint 0.16 唯一会硬报错的块。

最近提交 `#447` 已经半承认了这一点（`src/npm-package/lib/arch.js` L11-12 注释：「this repo's pre-0.16 `architecture.yaml` `rules:` block is rejected by archlint 0.16's own validator」），但**只修了 CLI 一侧**（改走 built-in rules + `--use-config` opt-in），**Gate 6 一侧的分层承诺依旧悬空**，且 `architecture.yaml` 本身没被清理。

### 结论 3：`docs/ARCHITECTURE.md` 声称的 14 条「已启用」，实际一条都没有

`docs/ARCHITECTURE.md` L296-309 的表格给 `ARCH-001`~`ARCH-005`、`ARCH-008`~`ARCH-010` 标了「是」（已启用）。但 `architecture.yaml` 的 `rules:` 块在 0.16 下整体解析失败，这 9 条「已启用」实测全部不生效。

更糟的是 `.architecture-baseline.json` 里的 244 条 smell，按类型分布：

```
HighCognitiveComplexity   83
HighCyclomaticComplexity  50
CodeClone                 48
DeadCode                  35
DeadSymbol                 8
LargeFile                  6
DeepNesting                6
LongParameterList          4
BarrelFileAbuse            2
OrphanType                 2
```

**一条分层/边界类违规都没有** —— 不是因为项目架构干净，而是因为这类检测从来没跑过。

---

## 二、33 条规则覆盖度矩阵

图例：
- ✅ **已实现** = 语义一致、默认开启、能真正拦截
- 🟡 **部分覆盖** = 有相近检查，但语义、粒度或强制力不同（下面逐条说明差在哪）
- ❌ **未实现** = 无对应检查

「落点」列指 xp-gate 侧承载该检查的位置；「-」表示无。

### 模板 A（分层架构，21 条）

| ID | 级别 | 规则 | 状态 | 落点 | 差距说明 |
|---|---|---|---|---|---|
| R01 | ERROR | 严格四层依赖方向 | ❌ | - | Gate 6 只跑 archlint built-in，无分层定义可用（结论 1） |
| R02 | ERROR | Controller 禁止直接访问持久层 | ❌ | - | 无 Controller↔Mapper/Repository 规则；`layer_violation` 无法配置 |
| R03 | ERROR | Domain 层零框架依赖 | ❌ | - | 无「domain 包内禁止 Spring/JPA/MyBatis import」规则 |
| R04 | ERROR | Infra 实现不暴露给 Application | ❌ | - | 同上，无层间 import 白/黑名单生效路径 |
| R05 | ERROR | Application 层禁止写原生 SQL | ❌ | - | 无持久化框架 import 黑名单（Semgrep Gate 9 有可能覆盖裸 SQL 注入，但非本规则语义） |
| R06 | ERROR | 禁止循环依赖 | 🟡 | archlint `cyclic_dependency` / `package_cycles` | **只覆盖 TS/JS**，Java 项目完全不生效；且是文件级循环，非「包 A↔包 B」包级语义 |
| R07 | ERROR | Service 不得依赖 Controller | ❌ | - | 无反向分层方向检查 |
| R08 | ERROR | DTO 不得依赖 Service | ❌ | - | 无「`*DTO/*VO` 后缀类不得 import Service/Repository」规则 |
| R09 | ERROR | 禁止 @Autowired 字段注入 | ❌ | - | Gate 4 `solid.dip` 检查的是依赖倒置抽象，**不是**字段注入 vs 构造器注入；Java 侧无 `@Autowired` 字段检测 |
| R10 | ERROR | Controller 必须以 Controller 结尾 | ❌ | - | `rest` 包下类名后缀无检查 |
| R11 | ERROR | Service 必须以 Service/ServiceImpl 结尾 | ❌ | - | `application/service` 包下类名后缀无检查 |
| R12 | ERROR | 数据访问类以 Mapper/DAO/Repository 结尾 | ❌ | - | `infrastructure/repository`、`infrastructure/gateway` 无检查 |
| R13 | ERROR | Domain 字段必须 private | ❌ | - | `java.ts` 能解析类成员，但无「包内字段可见性」规则 |
| W01 | WARNING | 工具类不应依赖 Service | ❌ | - | 无 `*Util/*Utils/*Helper` 的依赖检查 |
| W02 | WARNING | 枚举以 Enum 结尾或在 enum 包 | ❌ | - | 无枚举命名检查 |
| W03 | WARNING | 禁止 Handler 泛化后缀 | ❌ | - | 无后缀黑名单 |
| W04 | WARNING | 禁止 Manager 泛化后缀 | ❌ | - | 无后缀黑名单 |
| W05 | WARNING | 禁止 Processor 泛化后缀 | ❌ | - | 无后缀黑名单 |
| W06 | WARNING | Service 方法数 ≤ 30 | 🟡 | Gate 4 `clean-code.god-class`（阈值 30） | **语义不同**：god-class 按「类的方法总数」判，不看是否 `application/service` 包；对 Controller/DTO 一视同仁 |
| W07 | WARNING | 实体不应是贫血模型 | ❌ | - | 无「除 getter/setter/equals/hashCode/toString 外至少一个方法」检查 |
| W08 | WARNING | 值对象字段应 final（分层） | ❌ | - | 无 `*Value/*VO` 字段 final 检查 |

### 模板 B（DDD 架构，12 条）

| ID | 级别 | 规则 | 状态 | 落点 | 差距说明 |
|---|---|---|---|---|---|
| R14 | ERROR | `domain/model` 零框架依赖 | ❌ | - | 同 R03 |
| R15 | ERROR | Domain Event 不能依赖 Infrastructure | ❌ | - | 无 `domain/event` → infrastructure import 检查 |
| R16 | ERROR | Repository 接口只能在 Domain 层定义 | ❌ | - | `architecture.yaml` ARCH-008 声称覆盖，实测不生效（结论 1） |
| R17 | ERROR | Domain Service 不能注入 Infra 实现 | ❌ | - | 无 `domain/service` 依赖限制 |
| R18 | ERROR | Domain 层禁止 @Autowired/@Value | ❌ | - | 无注解黑名单 |
| R19 | ERROR | Application Service 只能依赖 Domain | ❌ | - | `architecture.yaml` ARCH-002 声称覆盖，实测不生效 |
| R20 | ERROR | 端口必须是接口 | ❌ | - | 无 `domain/port/{inbound,outbound}` 必须为 interface 的检查 |
| R21 | ERROR | Entity 必须有标识字段 | ❌ | - | 无「`id`/`uuid`/`*Id`/`key` 至少其一」检查 |
| R22 | ERROR | Entity 禁止 public setter | ❌ | - | 无 setter 可见性检查（`java.ts` 可解析成员，但无该规则） |
| R09* | ERROR | （模板 B 复用） | ❌ | - | 见 R09 |
| B-ADP | ERROR | 适配器必须实现出站端口 | ❌ | - | 无 outbound port 实现关系检查 |
| B-EVT | ERROR | 领域事件必须继承基类 | ❌ | - | 无继承体系检查 |
| W09 | WARNING | 值对象字段应 final（DDD） | ❌ | - | 同 W08 |

> 注：源文档正文 3.7/4.4 把 W03~W05、W08~W09 分别合并叙述（`W-3 ~ W-5`、`W-8 ~ W-9`），但附录索引与总量（33 = 22 ERROR + 11 WARNING）把它们各自计为独立规则。本分析按附录索引的 33 条逐条展开。

### 覆盖度汇总

| 状态 | 条数 | 占比 | 涉及规则 |
|---|---|---|---|
| ✅ 已实现 | 0 | 0% | — |
| 🟡 部分覆盖 | 2 | 6% | R06（仅 TS/JS）、W06（语义不同） |
| ❌ 未实现 | 31 | 94% | 其余全部 |

按模板：
- **模板 A（21 条）**：0 完整 / 2 部分（R06、W06）/ 19 未实现
- **模板 B（12 条）**：0 / 0 / 12 未实现

按级别：
- **ERROR（22 条）**：0 完整 / 1 部分（R06）/ 21 未实现
- **WARNING（11 条）**：0 / 1（W06）/ 10 未实现

---

## 三、为什么「只有 2 条沾边」

根因是一个**语言与规则集的错配**：

1. **规则集面向 Java + Spring Boot。** 33 条里 R01-R05、R07-R13、R14-R22、B-ADP、B-EVT、W01-W09 全部依赖 Java 的包结构（`interfaces/rest`、`application/service`、`domain/model`）、Spring 注解（`@Autowired`、`@Value`）和框架类（MyBatis Mapper、JPA Repository）。这些概念在 TypeScript 里没有对等物。

2. **xp-gate 的架构检测主力是 archlint，而 archlint 只做 TS/JS。** `architecture.yaml` L184-195 已经承认这个分工：Python→import-linter、Go→arch-go、**Java→ArchUnit**、C++→`supported: false`。也就是说 —— **对 Java，xp-gate 的设计是「把规则交给项目自己写的 ArchUnit 测试」**。

3. **而这个「交给 ArchUnit」的交接是空心的。** Gate 6 的 Java 分支（`githooks/pre-commit` L3620-3700）只做一件事：`find */src/test/java -name '*Architecture*'` 找到测试类后跑 `mvn -q test -Dtest='*Architecture*'`。它**不知道这 33 条规则的存在**，不检查项目里是否真的实现了这 33 条，也不提供任何模板。所以：
   - 项目没写 ArchUnit 测试 → Gate 6 走 SKIPPED（`architecture_not_configured`），分层零校验；
   - 项目写了但只覆盖 3 条 → Gate 6 PASS，剩下 30 条静默漏过；
   - 两者在报告里**都是绿色**。

---

## 四、改进建议

按「先修假阳性，再补能力」的顺序组织。详细验收标准见配套 issue 文档。

### P0 —— 止血：门禁不能继续报告它没测量的东西

1. **把 `architecture.yaml` 的死配置问题暴露出来（而非静默忽略）。** Gate 6 在文件存在但解析失败/不含可执行规则时，必须显式 WARN 并降级 status，不能再把它当「架构已配置」的证据。
2. **`docs/ARCHITECTURE.md` 与 `architecture.yaml` 的 14 条「已启用」必须更正。** 当前表格是对用户的事实性误导。

### P1 —— 让「交给 ArchUnit」这条路真的能走通

3. **提供 33 条规则的 ArchUnit 落地能力**，而不是只检测 `*Architecture*` 测试是否通过：
   - 规则模板库：把 33 条翻译成可复制的 ArchUnit 测试片段（分模板 A / B）；
   - Gate 6 增强：识别项目已覆盖哪些规则、未覆盖哪些，输出覆盖矩阵；
   - 缺失覆盖 → 按 `.architecture-skip` 同款豁免机制处理，而不是静默 SKIP。

### P2 —— 补 Java 侧可静态判定的规则到 Gate 4

`src/principles/adapters/java.ts`（503 行，已能解析 import / 类 / 方法 / 成员）已经具备大部分基础能力。命名类与可见性类规则（R10、R11、R12、R13、R21、R22、W02-W05、W07-W09）本质是 AST 模式匹配，**不需要运行 Maven**，可以直接作为 Gate 4 principles 规则实现 —— 这比 ArchUnit 快得多，且在 pre-commit 就能拦住。

### P3 —— 分层规则的语言无关化

R01/R04/R19 这类「层间依赖方向」规则的**语义是语言无关的**，只是当前的载体（archlint）只懂 TS。建议抽出一层 `layer-contract` 抽象：用一套 YAML 描述层与允许的依赖方向，由各语言后端（TS→import 图、Java→`java.ts` 的 import 解析、Python→import-linter）统一消费。这样 33 条里依赖方向类的 10 条可以一次覆盖多语言。

---

## 五、核对方法（可复现）

```bash
# 1. 确认 ARCH-001..014 在 src/ 下无实现
grep -rn "ARCH-0" src/

# 2. 确认 Gate 6 不传 --config
grep -n "run_archlint " githooks/pre-commit
#    → L3541 diff .architecture-baseline.json --fail-on high
#    → L3543 scan . -f table --quiet

# 3. 确认 archlint 0.16 拒绝 architecture.yaml 的 rules: 块
cd <含 architecture.yaml 的目录>
archlint scan . --config architecture.yaml
#    → Config error: rules: data did not match any variant ...

# 4. 确认上游 schema 无 layers 键
curl -s https://raw.githubusercontent.com/archlinter/archlint/main/resources/archlint.schema.json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s).properties)))"

# 5. 确认 layer_violation 无法被触发
archlint scan <样例工程> -f json --config <任意 layers 形式> -d layer_violation
#    → smells: [] ，即使存在 domain → infrastructure 反向依赖

# 6. 确认 baseline 无分层类 smell
node -e "const j=require('./.architecture-baseline.json');
const c={};j.smells.forEach(s=>c[s.smellType]=(c[s.smellType]||0)+1);console.log(c)"
```

---

## 六、对源文档的两处勘误

核对时发现源文档自身有三处内部不一致，建议在实施 issue 时一并澄清：

1. **W08/W09 在正文被合并为 `W-8 ~ W-9`（4.4 节），但附录索引把它们列为两条独立规则**，并靠此凑满 11 条 WARNING。建议明确：究竟是「同一条规则在模板 A/B 下各计一次」，还是「两条字段不同」。拆 issue 时按「同一条规则、两个模板各计一次」处理（即实现一份逻辑、两处注册）。

2. **B-ADP / B-EVT 没有出现在正文任何章节**（三、四章都没有 3.x/4.x 节对应），只存在于附录索引。它们的判定口径需要补充说明：「适配器必须实现出站端口」—— 如何识别「适配器」？按类名后缀、按包路径，还是按注解？

3. **规则编号连续性存疑**：正文 3.2 节标题为「依赖规则」，列出规则 6-9；但 5.1 节汇总表说「依赖规则 5 条（4 ERROR + 1 WARNING）」。第 5 条实为 W01（工具类不应依赖 Service），即 W01 被归入「依赖规则」分类。附录索引的分类列与 5.1 节一致，正文小节归类不同。实施时以 5.1 汇总表为准。
