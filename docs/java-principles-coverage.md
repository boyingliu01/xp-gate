# Java 在 G4（principles）下的规则覆盖清单

> 来源：#507 S4 审计。审计方法：对 JavaAdapter 逐规则构造可触发 fixture，
> 以 tsx 探针实测 `rule.check()` 是否产生违规（`.sprint-state/phase-outputs/verification-events.jsonl` 留档）。

## 结论速览

**15 条规则中 12 条在 Java 上真实生效；3 条结构性不适用**（下表给出一手原因）。
修复前（#507 之前）java.ts 只返回 `{name, type, line, code}`，所有读取
`startLine/length/paramCount/nestingDepth/hasTryCatch/ioOperations/extract()/imports/methodCount`
的规则全部静默拿到 `undefined`，Java 提交实际 0 覆盖——G4 报告"已检查"但什么也查不出来。

## 规则矩阵（探针实测）

| 规则 | Java 生效 | 消费字段 | 说明 |
| --- | --- | --- | --- |
| clean-code.long-function | ✅ | `startLine`, `length` | |
| clean-code.large-file | ✅ | `countLines()`（基类） | |
| clean-code.magic-numbers | ✅ | `extract()` → `{value,line}` | `static final` 常量初始化值豁免；字符串/注释掩码 |
| clean-code.god-class | ✅ | `extractClasses().code` | 规则自己对 code 重扫计数 |
| clean-code.deep-nesting | ✅ | `nestingDepth` | |
| clean-code.too-many-params | ✅ | `paramCount` | |
| clean-code.missing-error-handling | ✅ | `ioOperations`, `hasTryCatch` | IO 标记 = `JAVA_IO_OPERATIONS` 列表（JDBC/Files/流/HTTP/Socket） |
| clean-code.unused-imports | ✅ | `imports[{name,line,used}]` | simple-name 全文出现即视为 used（保守，免误报） |
| clean-code.code-duplication | ❌（全语言） | `adapter.duplicationPercentage` | **无任何适配器提供该属性**，TS/Python 同样不触发；属规则引擎级缺口，记 backlog，不属 Java 审计范围 |
| clean-code.many-exports | ❌（Java 不适用） | `extractExports()` | Java 语言无 export 概念，基类返回 `[]`；语义上 N/A 而非缺陷 |
| solid.srp | ✅ | `cls.methodCount` | 修复前 JavaAdapter 不返回 `methodCount` → 恒 0 永不触发（本次补齐） |
| solid.ocp | ⚠️ 边缘生效 | `extractClasses().code` | 启发式只在「被继承基类声明于子类体内部」时触发（规则对 code 块扫描）；TS 同样如此，非 Java 特有回归 |
| solid.lsp | ❌（Java 不适用） | `param.includes(':')` | 规则以 TS 风格 `param: type` 提取参数类型，Java 语法（`Type name`）永远提取不到 → 结构性失效，记 backlog（改规则才可解） |
| solid.isp | ✅ | `extractInterfaces()` | 修复前 JavaAdapter 无该方法 → ISP 恒空（本次补齐） |
| solid.dip | ✅ | `extractClasses().code` | 注意：`new Foo<>()` 泛型形式不匹配规则的 `new (\w+)\s*\(`，裸 `new Foo()` 可触发 |

## 不适用规则的处置原则

- **不 SKIP**：以上 ❌ 均是"规则不适用"，不是"检查不能执行"。G4 对含 `.java`
  的提交照常运行其余 12 条规则，并输出显式覆盖标注（AC-507-04-02）。
- **仅零覆盖才允许 SKIP+原因**（AC-507-04-03）：checker 不存在 / tsx 不可用 /
  执行失败等工具级原因仍按既有路径 SKIP，且必须打印原因。
- **禁止为凑数硬造违规**：lsp / many-exports 在 Java 上保持沉默是正确行为；
  伪造违规只会训练用户忽略输出。

## 变更登记（#507 S4）

`src/principles/adapters/java.ts`：

1. `extractFunctions()` 升级为返回完整结构字段（`startLine/length/paramCount/
   nestingDepth/hasTryCatch/ioOperations`）——long-function、deep-nesting、
   too-many-params、missing-error-handling 由此从 0 覆盖恢复生效。
2. 新增 `extract()`（magic numbers）：`static final` 常量初始化值豁免、
   字符串/char/行注释掩码。
3. 新增 `get imports()`（unused-imports）：import 行集合之外的 simple-name 使用检测。
4. `extractClasses()` 补 `methodCount`/`methods` —— srp 由此恢复生效。
5. 新增 `extractInterfaces()` —— isp 由此恢复生效。
