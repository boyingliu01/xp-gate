---
name: specification-generator
description: 从 APPROVED 设计文档自动提取需求 + AC 生成轻量 specification.yaml。不需要人工调用——在 sprint-flow Phase 1 完成后、delphi-review APPROVED 后、或 test-spec-alignment 执行前（如过期）自动触发。
---

# Specification Generator（轻量化）

## 职责

从 APPROVED 的设计文档（markdown）自动提取需求描述和 Acceptance Criteria，生成轻量 specification.yaml。

**不需要人工调用**。自动触发点：
1. sprint-flow Phase 1 完成后
2. delphi-review APPROVED 后
3. test-spec-alignment 执行前（检查 spec 是否最新，过期则自动重新生成）

---

## 输出格式

```yaml
specification:
  source: "docs/plans/2026-04-14-auth-design.md"
  generated: "2026-04-14"
  
  requirements:
    - description: "用户可以用用户名密码登录"
      acceptance_criteria:
        - given: "用户存在且密码正确"
          when: "POST /login"
          then: "返回 200 + JWT token"
    - description: "Token 过期后可以刷新"
      acceptance_criteria:
        - given: "有效但已过期的 refresh token"
          when: "POST /refresh"
          then: "返回新 token"
```

---

## 执行步骤

### Step 1: 读取设计文档

从 Phase 1 输出路径读取 APPROVED 的设计文档（`.sprint-state/phase-outputs/` 目录）。

### Step 2: 提取需求和 AC

从文档中提取：
- 需求描述（自然语言段落标题或标记）
- Acceptance Criteria（Given/When/Then 格式）
- 如设计文档未明确 Given/When/Then，从行为描述中推断

### Step 3: 写入 specification.yaml

直接覆盖写入项目根目录 `specification.yaml`。

- 不做版本管理
- 不做冲突检测
- 不做模块推断
- 不保留旧版本备份

### Step 4: 验证生成文件

确认文件是有效 YAML 且包含至少一个 requirement。

---

## 与 test-spec-alignment 的联动

test-spec-alignment 执行时：

1. 检查 specification.yaml 是否存在
2. 检查 specification.yaml 的 modified time 是否晚于设计文档
3. 如不存在或已过期 → 自动重新生成
4. 然后执行两阶段验证

**不需要用户手动调用 specification-generator。**

---

## 移除的功能（对比原方案）

| 原功能 | 原因 |
|--------|------|
| CREATE/UPDATE 双模式 | 单模式：直接覆盖即可 |
| SHA-256 冲突检测 | 自动生成无冲突 |
| semver 版本管理 | 不需要追踪版本 |
| deprecated 自动归档 | 不需要保留历史 |
| 多文档优先级 | 单一来源：APPROVED 设计文档 |
| 模块前缀自动推断 | 不需要模块管理 |
| temp + backup + atomic rename | 直接覆盖写入 |

---

## 验证

生成后检查：

| 检查项 | 标准 |
|--------|------|
| YAML 有效 | yq 验证通过 |
| 至少一个需求 | requirements 数组非空 |
| 至少一个 AC | 每个 requirement 至少有一个 acceptance_criteria |
| source 有效 | source 字段指向的设计文档存在 |
