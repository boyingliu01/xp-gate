# whalecloud-java — 浩鲸科技 Java 编码规范增强插件

浩鲸 Java 规范以阿里 p3c-pmd 规范为基础，但增加了企业内部积累的经验规则和安全规范。

## 规则覆盖

106 条规则（74 强制 + 32 推荐），在 p3c-pmd 54 条基线规则之上叠加：

| 类别 | 规则数 | 内容 |
|------|--------|------|
| wc-collection | 12 | 集合处理增强 — subList/addAll/asList/map 视图等 p3c 未覆盖的陷阱 |
| wc-concurrent | 14 | 并发编程增强 — 锁策略/双重检查锁/HashMap 死循环等 |
| wc-exception | 11 | 异常处理规范 — 异常分类处理/finally 规范/异常匹配 |
| wc-logging | 7 | 日志输出规范 — 占位符/级别判断/重复打印/国际化 |
| wc-security | 10 | 安全管理规范 — SQL 注入/MD5/HTTP 超时/HttpClient |
| wc-resource | 6 | 资源管理规范 — 资源关闭/finally-return/静态块 |
| wc-style | 18 | 编码风格规范 — 访问控制/赋值语句/类型转换/POJO/序列化 |
| wc-performance | 8 | 性能优化规范 — 字符串连接/正则预编译/I/O 缓冲 |
| wc-security-chapter | 10+ | 安全篇 — SQL/XML/日志/命令注入，路径标准化，Zip 炸弹防护 |

## 与 p3c-pmd 关系

```
┌─────────────────────────────────────────┐
│           xp-gate-pre-commit              │
│              Gate 1                     │
├─────────────────────────────────────────┤
│  whalecloud-java (106 条)               │
│    ┌─────────────────────────────────┐  │
│    │  浩鲸增强层 (74+32 条自定义)     │  │
│    └─────────────────────────────────┘  │
│    ┌─────────────────────────────────┐  │
│    │  p3c-pmd 基线 (54 条阿里规则)   │  │
│    └─────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

p3c-pmd 是**必要不充分条件**。启用 whalecloud-java 自动包含 p3c-pmd。

## 安装

### Maven

```bash
bash githooks/adapters/plugins/whalecloud-java/scripts/install-maven-whalecloud.sh
```

### Gradle

```bash
bash githooks/adapters/plugins/whalecloud-java/scripts/install-gradle-whalecloud.sh
```

## 手动运行

```bash
# Maven
mvn clean verify -P xp-gate-whalecloud-java

# 同时运行 p3c-pmd + whalecloud（推荐）
mvn clean verify -P xp-gate-p3c,xp-gate-whalecloud-java

# Gradle
./gradlew xp-gateWhalecloudCheck
```

## 检查工具链

| 工具 | 版本 | 用途 |
|------|------|------|
| PMD | 7.7.0 | 静态分析 + 自定义规则集 |
| CheckStyle | 10.21.3 | 代码风格检查 |
| SpotBugs | 4.7.3 | 字节码分析 + 安全检测 |
| FindSecBugs | 1.12.0 | 安全漏洞扫描 |
| Lizard | 1.17.10 | 圈复杂度检测 |

## 插件结构

```
whalecloud-java/
├── plugin.yml                                  # 插件元数据
├── README.md                                   # 说明文档
├── rules/                                      # 规则定义目录
│   ├── collection/     # 集合处理规则
│   ├── concurrency/    # 并发编程规则
│   ├── exception/      # 异常处理规则
│   ├── logging/        # 日志规范规则
│   ├── security/       # 安全管理规则
│   ├── resource/       # 资源管理规则
│   ├── style/          # 编码风格规则
│   └── performance/    # 性能优化规则
├── templates/
│   ├── maven/          # Maven profile 模板
│   └── gradle/         # Gradle 配置模板
└── scripts/
    ├── install-maven-whalecloud.sh
    └── install-gradle-whalecloud.sh
```
