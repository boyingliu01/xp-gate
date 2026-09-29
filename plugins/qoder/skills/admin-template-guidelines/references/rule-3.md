# Rule 3: Nunjucks Parentheses — Examples

## 优先级规则

```
表达式:     A <= B | lower
实际解析:   A <= (B | lower)  ← filter 先执行，比较的是 A 和 "lower" 后的 B
预期语义:   (A <= B) | lower  ← 先比较，结果再经 filter
```

## ❌ 错误示例

```nunjucks
{# admin/views/plans.njk — 反模式 #}

{# 比较在 filter 之后执行 → 逻辑错误 #}
{% if plan._interviews.length <= 15 | lower %}
  <span class="badge badge-small">Small Plan</span>
{% endif %}

{# 实际等价于: plan._interviews.length <= "lower" → 始终 true #}

{# 条件渲染中的陷阱 #}
{% if plan.status == 'completed' | title %}
  <span class="status-done">Done</span>
{% endif %}

{# 字符串格式化错误 #}
{{ plan.completionRate * 100 | round | default(0) }}
{# 当 completionRate 为 null 时，null * 100 = NaN → round(NaN) → 错误 #}
```

## ✅ 正确示例

```nunjucks
{# admin/views/plans.njk #}

{# 括号确保比较先执行 #}
{% if (plan._interviews.length <= 15) | lower %}
  <span class="badge badge-small">Small Plan</span>
{% endif %}

{# 条件判断中的正确使用 #}
{% if (plan.status == 'completed') | title %}
  <span class="status-done">Done</span>
{% endif %}

{# 数值计算中先处理 null #}
{{ (plan.completionRate ?? 0) * 100 | round(1) | default('0.0') }}%

{# 多层比较与 filter 组合 #}
{% if (plan._interviews.length >= 15 and plan._interviews.length <= 60) | bool %}
  <span class="badge badge-medium">Medium Plan</span>
{% elif (plan._interviews.length > 60) | bool %}
  <span class="badge badge-large">Large Plan</span>
{% endif %}

{# 安全渲染可选字段 #}
{% if (plan.description | length) > 0 %}
  <p class="description">{{ plan.description | truncate(120) }}</p>
{% else %}
  <p class="description text-muted">No description provided.</p>
{% endif %}
```

## 验证清单

- [ ] 所有 `{{ A <= B | filter }}` 改为 `{{ (A <= B) | filter }}`
- [ ] 所有 `{% if A == B | filter %}` 改为 `{% if (A == B) | filter %}`
- [ ] 使用 `| bool` 而非裸布尔表达式配合逻辑运算符
