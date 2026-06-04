# Specification YAML 格式规范

## 标准格式

```yaml
specification:
  id: "SPEC-XXX-XXX"
  name: "模块/功能名称"
  version: "1.0.0"
  
  # 需求列表
  requirements:
    - id: "REQ-XXX-001"
      description: "需求描述"
      priority: "MUST" | "SHOULD" | "MAY"
      
      # 验收标准 (Gherkin 格式)
      acceptance_criteria:
        - id: "AC-XXX-001-01"
          given: "前置条件"
          when: "触发动作"
          then: "期望结果"
        
        - id: "AC-XXX-001-02"
          given: "..."
          when: "..."
          then: "..."
      
      # 边界条件
      edge_cases:
        - "边界条件1"
        - "边界条件2"
      
      # 安全考虑
      security_considerations:
        - "安全要点1"
      
      # 测试覆盖要求
      test_coverage_requirements:
        unit: true
        integration: true
        e2e: false
  
  # 设计决策
  design_decisions:
    - id: "DD-XXX-001"
      description: "设计决策描述"
      rationale: "决策理由"
      alternatives_considered:
        - "备选方案1"
        - "备选方案2"
  
  # API 契约
  api_contracts:
    - endpoint: "POST /api/xxx"
      description: "API 描述"
      request:
        body:
          field1: "type"
          field2: "type"
      response:
        success:
          status: 200
          body:
            field1: "type"
        failure:
          status: 400
          body:
            error: "string"
```

---

## 完整示例：用户认证模块

```yaml
specification:
  id: "SPEC-AUTH-001"
  name: "User Authentication Module"
  version: "1.0.0"
  
  requirements:
    # REQ-1: 用户登录
    - id: "REQ-AUTH-001"
      description: "用户使用正确的用户名和密码可以成功登录"
      priority: "MUST"
      
      acceptance_criteria:
        - id: "AC-AUTH-001-01"
          given: "用户存在且密码正确"
          when: "用户提交登录表单"
          then: "系统返回 200 状态码和有效 JWT token"
        
        - id: "AC-AUTH-001-02"
          given: "用户存在且密码正确"
          when: "用户提交登录表单"
          then: "返回的 token 过期时间 >= 1小时"
        
        - id: "AC-AUTH-001-03"
          given: "用户存在且密码正确"
          when: "用户提交登录表单"
          then: "token 包含用户 ID 和角色信息"
      
      edge_cases:
        - "密码包含特殊字符 (@#$%^&*)"
        - "用户名包含空格"
        - "并发登录请求"
        - "超长用户名 (>100字符)"
        - "超长密码 (>200字符)"
      
      security_considerations:
        - "密码不能明文传输"
        - "使用 HTTPS"
        - "登录失败不暴露用户是否存在"
        - "记录登录日志"
      
      test_coverage_requirements:
        unit: true
        integration: true
        e2e: true
    
    # REQ-2: 登录失败
    - id: "REQ-AUTH-002"
      description: "用户使用错误的密码登录失败"
      priority: "MUST"
      
      acceptance_criteria:
        - id: "AC-AUTH-002-01"
          given: "用户存在但密码错误"
          when: "用户提交登录表单"
          then: "系统返回 401 状态码"
        
        - id: "AC-AUTH-002-02"
          given: "密码错误次数 >= 3"
          when: "用户尝试登录"
          then: "账户被锁定 15 分钟"
        
        - id: "AC-AUTH-002-03"
          given: "用户不存在"
          when: "用户提交登录表单"
          then: "系统返回 401 状态码（不暴露用户不存在）"
      
      edge_cases:
        - "密码错误 2 次后第 3 次正确"
        - "锁定期间尝试登录"
        - "锁定时间边界 (14分59秒, 15分00秒, 15分01秒)"
      
      security_considerations:
        - "不暴露具体错误原因（用户不存在 vs 密码错误）"
        - "防暴力破解"
    
    # REQ-3: Token 刷新
    - id: "REQ-AUTH-003"
      description: "用户可以刷新过期的 token"
      priority: "SHOULD"
      
      acceptance_criteria:
        - id: "AC-AUTH-003-01"
          given: "用户有有效的 refresh token"
          when: "用户请求刷新 token"
          then: "系统返回新的 access token"
        
        - id: "AC-AUTH-003-02"
          given: "用户的 refresh token 已过期"
          when: "用户请求刷新 token"
          then: "系统返回 401 状态码，要求重新登录"
  
  design_decisions:
    - id: "DD-AUTH-001"
      description: "使用 JWT 进行身份认证"
      rationale: "无状态，支持分布式部署，减少数据库查询"
      alternatives_considered:
        - "Session-based auth: 需要分布式 session 存储"
        - "API Key: 不适合用户登录场景"
    
    - id: "DD-AUTH-002"
      description: "密码使用 bcrypt 哈希存储"
      rationale: "安全性高，计算成本可调，防彩虹表"
    
    - id: "DD-AUTH-003"
      description: "双 token 机制 (access + refresh)"
      rationale: "平衡安全性和用户体验，access token 短期有效"
  
  api_contracts:
    - endpoint: "POST /api/auth/login"
      description: "用户登录"
      request:
        body:
          username: "string (required, 1-100 chars)"
          password: "string (required, 1-200 chars)"
      response:
        success:
          status: 200
          body:
            token: "string (JWT)"
            refreshToken: "string"
            expiresIn: "number (seconds)"
        failure:
          status: 401
          body:
            error: "Invalid credentials"
            attemptsRemaining: "number (optional)"
    
    - endpoint: "POST /api/auth/logout"
      description: "用户登出"
      request:
        headers:
          Authorization: "Bearer <token>"
      response:
        success:
          status: 200
          body:
            message: "Logged out successfully"
    
    - endpoint: "POST /api/auth/refresh"
      description: "刷新 token"
      request:
        body:
          refreshToken: "string"
      response:
        success:
          status: 200
          body:
            token: "string (new JWT)"
            expiresIn: "number"
        failure:
          status: 401
          body:
            error: "Invalid or expired refresh token"
```

---

## 测试标签格式

### TypeScript/JavaScript

```typescript
/**
 * @test REQ-AUTH-001
 * @intent 验证用户使用正确凭据可以成功登录
 * @covers AC-AUTH-001-01, AC-AUTH-001-02, AC-AUTH-001-03
 * @edge_cases password_with_special_chars, concurrent_login
 */
describe('REQ-AUTH-001: User Login', () => {
  test('AC-AUTH-001-01: returns 200 and valid token', async () => {
    // Given: 用户存在且密码正确
    const user = await createTestUser({ password: 'correctpassword' });
    
    // When: 用户提交登录表单
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: 'correctpassword' });
    
    // Then: 系统返回 200 状态码和有效 JWT token
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
    expect(() => jwt.verify(response.body.token, JWT_SECRET)).not.toThrow();
  });
});
```

### Python (pytest)

```python
# @test REQ-AUTH-001
# @intent 验证用户使用正确凭据可以成功登录
# @covers AC-AUTH-001-01, AC-AUTH-001-02
# @edge_cases password_with_special_chars, concurrent_login
class Test_REQ_AUTH_001_UserLogin:
    """
    REQ-AUTH-001: 用户登录测试
    
    @test REQ-AUTH-001
    @intent 验证用户使用正确凭据可以成功登录
    """
    
    def test_AC_AUTH_001_01_returns_200_and_token(self):
        """AC-AUTH-001-01: 返回 200 和有效 token"""
        # Given: 用户存在且密码正确
        user = create_test_user(password='correctpassword')
        
        # When: 用户提交登录表单
        response = client.post('/api/auth/login', json={
            'username': user.username,
            'password': 'correctpassword'
        })
        
        # Then: 系统返回 200 状态码和有效 JWT token
        assert response.status_code == 200
        assert 'token' in response.json
```

### Go

```go
// @test REQ-AUTH-001
// @intent 验证用户使用正确凭据可以成功登录
// @covers AC-AUTH-001-01, AC-AUTH-001-02
// @edge_cases password_with_special_chars, concurrent_login
func Test_REQ_AUTH_001_UserLogin(t *testing.T) {
    // AC-AUTH-001-01: 返回 200 和有效 token
    
    // Given: 用户存在且密码正确
    user := createTestUser(t, "correctpassword")
    
    // When: 用户提交登录表单
    resp := httptest.NewRecorder()
    req := httptest.NewRequest("POST", "/api/auth/login", 
        strings.NewReader(fmt.Sprintf(`{"username":"%s","password":"correctpassword"}`, user.Username)))
    router.ServeHTTP(resp, req)
    
    // Then: 系统返回 200 状态码和有效 JWT token
    assert.Equal(t, 200, resp.Code)
    // ... 更多断言
}
```

---

## 必需字段检查清单

### Specification 层级

- [ ] `specification.id` - 唯一标识符
- [ ] `specification.name` - 模块名称
- [ ] `specification.version` - 版本号
- [ ] `specification.requirements` - 需求列表 (至少 1 个)

### Requirement 层级

- [ ] `requirements[].id` - REQ-XXX-XXX 格式
- [ ] `requirements[].description` - 需求描述
- [ ] `requirements[].priority` - MUST/SHOULD/MAY
- [ ] `requirements[].acceptance_criteria` - 验收标准 (至少 1 个)

### Acceptance Criteria 层级

- [ ] `acceptance_criteria[].id` - AC-XXX-XXX-XX 格式
- [ ] `acceptance_criteria[].given` - 前置条件
- [ ] `acceptance_criteria[].when` - 触发动作
- [ ] `acceptance_criteria[].then` - 期望结果

### 测试标签层级

- [ ] `@test REQ-XXX-XXX` - 关联 requirement
- [ ] `@intent 描述` - 测试意图
- [ ] `@covers AC-XXX-XX` - 覆盖的 AC (推荐)