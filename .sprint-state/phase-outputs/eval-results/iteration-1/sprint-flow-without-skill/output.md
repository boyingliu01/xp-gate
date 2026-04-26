# Sprint 计划：用户登录功能

## 需求分析

### 核心功能
1. **邮箱密码登录** — 传统登录方式
2. **OAuth2.0 第三方登录** — GitHub + Google
3. **记住我功能** — 持久化登录状态
4. **登录状态管理** — Session/Token 管理

### 需求拆解

| 编号 | 需求 | 优先级 | 复杂度 |
|------|------|--------|--------|
| REQ-001 | 用户邮箱密码注册 | P0 | 中 |
| REQ-002 | 用户邮箱密码登录 | P0 | 中 |
| REQ-003 | GitHub OAuth2.0 登录 | P0 | 高 |
| REQ-004 | Google OAuth2.0 登录 | P0 | 高 |
| REQ-005 | 记住我功能 | P1 | 中 |
| REQ-006 | 登录状态管理/会话保持 | P0 | 中 |
| REQ-007 | 安全措施（限流、加密等） | P0 | 高 |

---

## 技术方案

### 架构设计

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│   API Layer  │────▶│   Database   │
│  (React/Vue) │     │  (REST API)  │     │  (PostgreSQL)│
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                     ┌──────┴───────┐
                     │  Auth Service │
                     │  (JWT/Session)│
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Email    │ │ GitHub   │ │ Google   │
        │ Password │ │ OAuth2.0 │ │ OAuth2.0 │
        └──────────┘ └──────────┘ └──────────┘
```

### 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| 后端框架 | Express.js / Spring Boot | 成熟、文档丰富 |
| 数据库 | PostgreSQL | 关系型、事务支持好 |
| 认证 | JWT + Refresh Token | 无状态、可扩展 |
| 密码加密 | bcrypt | 行业标准 |
| OAuth | passport.js / spring-security-oauth | 社区成熟方案 |
| 前端 | React + TypeScript | 类型安全 |
| 缓存 | Redis | Session/Token 黑名单 |

### 数据模型

```sql
-- 用户表
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),  -- OAuth 用户可能为空
    display_name VARCHAR(100),
    avatar_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- OAuth 关联表
CREATE TABLE oauth_accounts (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    provider VARCHAR(50) NOT NULL,  -- 'github' or 'google'
    provider_user_id VARCHAR(255) NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(provider, provider_user_id)
);

-- 刷新令牌表
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    remember_me BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### API 设计

```
POST   /api/auth/register          # 邮箱注册
POST   /api/auth/login             # 邮箱密码登录
POST   /api/auth/logout            # 登出
POST   /api/auth/refresh           # 刷新 Token
GET    /api/auth/github            # GitHub OAuth 发起
GET    /api/auth/github/callback   # GitHub OAuth 回调
GET    /api/auth/google            # Google OAuth 发起
GET    /api/auth/google/callback   # Google OAuth 回调
GET    /api/auth/me                # 获取当前用户信息
```

### 认证流程

#### 邮箱密码登录
1. 用户提交 email + password + remember_me
2. 后端验证密码 (bcrypt.compare)
3. 生成 access_token (15min) + refresh_token (7天/30天)
4. remember_me=true → refresh_token 有效期30天，否则7天
5. 返回 token，前端存储 (httpOnly cookie 或 localStorage)

#### OAuth2.0 登录
1. 前端跳转 `/api/auth/github` → 重定向到 GitHub 授权页
2. 用户授权 → GitHub 回调 `/api/auth/github/callback?code=xxx`
3. 后端用 code 换取 access_token
4. 用 access_token 获取用户信息
5. 查找或创建用户 + oauth_accounts 记录
6. 生成 JWT token，重定向回前端

### 记住我功能设计

| 场景 | remember_me=false | remember_me=true |
|------|-------------------|------------------|
| Access Token | 15min | 15min |
| Refresh Token | 7天 | 30天 |
| 存储 | httpOnly cookie (Session) | httpOnly cookie (Persistent) |
| 关闭浏览器 | Token 失效 | Token 保持 |

### 安全措施

1. **密码安全**: bcrypt (cost factor 12)
2. **限流**: 登录接口 5次/分钟/IP
3. **CSRF 保护**: SameSite cookie + CSRF token
4. **XSS 防护**: httpOnly cookie 存储 token
5. **Token 黑名单**: Redis 存储已注销的 refresh_token
6. **输入验证**: email 格式、密码强度要求
7. **审计日志**: 登录/登出事件记录

---

## 开发计划

### Phase 1: 基础架构 (Day 1-2)
- [ ] 项目初始化 (目录结构、依赖安装)
- [ ] 数据库 schema 创建 + migration
- [ ] 用户模型 + Repository 层
- [ ] 基础认证中间件

### Phase 2: 邮箱密码登录 (Day 2-3)
- [ ] 注册 API (POST /api/auth/register)
- [ ] 登录 API (POST /api/auth/login)
- [ ] JWT 生成 + 验证逻辑
- [ ] Refresh Token 机制
- [ ] 登出 API (POST /api/auth/logout)
- [ ] 记住我功能

### Phase 3: OAuth2.0 登录 (Day 3-5)
- [ ] GitHub OAuth 配置 + 流程
- [ ] Google OAuth 配置 + 流程
- [ ] OAuth 用户自动注册/关联
- [ ] 回调处理 + 错误处理

### Phase 4: 前端集成 (Day 5-6)
- [ ] 登录页面 UI
- [ ] 注册页面 UI
- [ ] OAuth 登录按钮
- [ ] 记住我 checkbox
- [ ] Token 管理层
- [ ] 路由守卫

### Phase 5: 安全 + 测试 (Day 6-7)
- [ ] 限流中间件
- [ ] Token 黑名单
- [ ] 单元测试 (认证逻辑)
- [ ] 集成测试 (API 端到端)
- [ ] 安全测试 (OWASP 基本检查)

---

## 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| OAuth 配置复杂 | 中 | 中 | 提前在测试环境配置，参考官方文档 |
| Token 安全漏洞 | 低 | 高 | 使用 httpOnly cookie，定期轮换密钥 |
| 第三方 API 变更 | 低 | 中 | 抽象 OAuth 层，便于适配 |
| 并发 Token 管理 | 中 | 中 | Redis 分布式锁 |
| 密码泄露 | 低 | 高 | bcrypt 加密，不记录明文日志 |

---

## 验收标准

### AC-001: 邮箱密码登录
- 用户可以使用有效邮箱+密码登录
- 无效密码返回 401 错误
- 密码错误 5 次后锁定 15 分钟

### AC-002: OAuth2.0 登录
- 点击 GitHub/Google 按钮跳转授权页
- 授权后自动创建账户或关联已有账户
- 同一邮箱的 OAuth 账户自动合并

### AC-003: 记住我
- 勾选"记住我"后关闭浏览器重新打开仍保持登录
- 未勾选则关闭浏览器后 session 失效
- Refresh Token 按配置过期

### AC-004: 安全
- 所有密码 bcrypt 加密存储
- 登录 API 有限流保护
- Token 存储在 httpOnly cookie 中
- 登出后 Token 立即失效

---

## 注意事项

1. OAuth 应用需要提前在 GitHub/Google 开发者平台创建
2. 生产环境密钥不要硬编码，使用环境变量
3. Google OAuth 需要 GCP 项目 + OAuth 同意屏幕配置
4. 记住我功能要注意 GDPR 合规（告知用户数据存储）
5. 考虑多设备登录场景（是否允许同时登录、单点登录等）

---

## 待确认问题

1. **技术栈确认**: 项目用什么后端框架？（Node.js/Express 还是 Spring Boot？）
2. **前端框架**: React 还是 Vue？是否已有项目？
3. **部署环境**: Docker？云服务？
4. **OAuth 应用**: 是否已创建 GitHub/Google OAuth App？
5. **多设备策略**: 是否允许同一账户多设备同时登录？
6. **密码策略**: 最小长度？是否要求特殊字符？
7. **邮箱验证**: 注册后是否需要邮箱验证？
