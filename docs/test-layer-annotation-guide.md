# 测试分层标注规范

> Issue #359 — 分层自动化测试防护网

## 三层测试体系

| 层级 | 定位 | Mock 策略 | 核心关注 |
|------|------|----------|---------|
| **Unit** | 零件质量 | 允许 mock 外部依赖 | 函数级实现正确性 |
| **Integration** | 组件质量 | 接口外可 mock，接口内禁 mock | 模块间协作正确性 |
| **E2E** | 整机质量 | 系统内禁 mock，系统外可 mock | 业务流程贯通 |

## 标注格式

每个测试文件**必须**在文件头部 JSDoc 中标注测试层级：

```typescript
/**
 * @test-type unit
 * @test REQ-001
 * @intent 验证 version parser 的正确性
 * @covers AC-001
 */
```

也支持行注释格式：

```typescript
// @test-type integration
import { describe, it, expect } from 'vitest';
```

## 标注规则

1. **新测试文件**：`@test-type` 标注为**强制**（pre-commit Gate 5c BLOCK）
2. **已有测试文件**：不追溯，但输出 WARNING 建议补充
3. **有效值**：`unit` | `integration` | `e2e`（大小写不敏感）
4. **未标注**：按文件路径推断（回退行为），但不推荐依赖

## 路径推断规则（回退）

| 路径模式 | 推断层级 |
|---------|---------|
| `*.e2e.test.ts`, `/e2e/` | e2e |
| `*.integration.test.ts`, `/integration/` | integration |
| `/__tests__/`, `*.test.ts`, `*.spec.ts` | unit |
| 其他 | unknown |

## Mock 使用指南

### Unit 测试
- ✅ 允许 mock 所有外部依赖（数据库、API、文件系统）
- ✅ 推荐 `vi.mock()` / `vi.fn()` 隔离被测单元
- 🎯 目标：快速验证函数逻辑

### Integration 测试
- ✅ 可 mock 接口外部的依赖
- ❌ 接口范围内的模块必须使用真实实现
- 🎯 目标：验证模块间数据流转

### E2E 测试
- ✅ 可 mock 系统外部依赖（第三方 API、外部服务）
- ❌ 系统内模块**禁止** mock
- 🎯 目标：验证完整业务流程贯通

## 示例

### Unit 测试示例
```typescript
/**
 * @test-type unit
 * @test REQ-001
 * @intent 验证 parseVersion 函数的版本解析逻辑
 */
import { describe, it, expect, vi } from 'vitest';
import { parseVersion } from '../version-parser';

vi.mock('fs/promises'); // 外部依赖可以 mock

describe('parseVersion', () => {
  it('should parse semver string', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });
});
```

### E2E 测试示例
```typescript
/**
 * @test-type e2e
 * @test REQ-E2E-001
 * @intent 验证完整的用户注册→登录→退出流程
 */
import { describe, it, expect, vi } from 'vitest';

// ✅ 可以 mock 外部邮件服务
vi.mock('nodemailer');

// ❌ 不可 mock 系统内的 AuthService
// import { AuthService } from '../../src/services/auth';
// vi.mock('../../src/services/auth'); // 违规！

describe('User Registration E2E', () => {
  it('should complete full registration flow', async () => {
    // 使用真实的 AuthService，验证完整流程
  });
});
```
