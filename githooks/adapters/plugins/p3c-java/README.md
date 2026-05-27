# p3c-pmd — Alibaba Java Coding Guidelines Plugin

阿里 Java 开发规范检查插件，基于 [alibaba/p3c](https://github.com/alibaba/p3c) PMD 实现。

## 覆盖规则

54 条规则，10 个类别：

| 类别 | 规则数 | 内容 |
|------|--------|------|
| ali-comment | 6 | Javadoc 和注释规约 |
| ali-concurrent | 8 | 并发编程规约 |
| ali-constant | 3 | 常量定义规约 |
| ali-exception | 4 | 异常处理规约 |
| ali-flowcontrol | 6 | 控制语句规约 |
| ali-naming | 9 | 命名规约 |
| ali-oop | 7 | OOP 规约 |
| ali-orm | 5 | ORM/SQL 规约 |
| ali-other | 3 | 其他规约 |
| ali-set | 3 | 集合处理规约 |

## 安装

### Maven 项目

```bash
bash githooks/adapters/plugins/p3c-java/scripts/install-maven-p3c.sh
```

安装后会自动将 `xp-gate-p3c` profile 注入 pom.xml。

### Gradle 项目

```bash
bash githooks/adapters/plugins/p3c-java/scripts/install-gradle-p3c.sh
```

## 手动运行

```bash
# Maven
mvn clean verify -P xp-gate-p3c

# Gradle
./gradlew xp-gateP3cCheck
```

## 插件结构

```
p3c-java/
├── plugin.yml                              # 插件元数据
├── README.md                               # 说明文档
├── templates/
│   ├── maven/xp-gate-p3c-profile.xml        # Maven profile 模板
│   └── gradle/xp-gate-p3c-gradle.gradle     # Gradle 配置模板
└── scripts/
    ├── install-maven-p3c.sh               # Maven 安装脚本
    └── install-gradle-p3c.sh              # Gradle 安装脚本
```

## 与浩鲸规范的关系

浩鲸 Java 规范以阿里规范为基础，但增加了企业内部积累的经验规则。
本插件提供阿里规范作为**默认基线**。浩鲸个性化规范后续会在 `whalecloud-java` 插件中
作为增强层叠加。
