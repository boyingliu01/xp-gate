# Rule 6: HTMX + Alpine Separation — Examples

## ❌ 错误示例：HTMX 与 Alpine 混用

```nunjucks
{# admin/views/plans.njk — 反模式 #}

{# 使用 Alpine 做服务端请求 — 职责错误 #}
<div x-data="{ plans: [], loading: false }"
     x-init="loading = true; fetch('/admin/api/plans').then(r => r.json()).then(d => plans = d); loading = false">
  <template x-for="plan in plans" :key="plan.id">
    <div>
      <span x-text="plan.name"></span>
      {# 删除操作使用 Alpine 而非 HTMX — 失去服务端渲染优势 #}
      <button @click="fetch('/admin/plans/' + plan.id, { method: 'DELETE' })
        .then(() => plans = plans.filter(p => p.id !== plan.id))">
        Delete
      </button>
    </div>
  </template>
</div>

{# HTMX 驱动下拉菜单状态 — 职责错误 #}
<div hx-get="/admin/plans" hx-swap="innerHTML">
  <button hx-on::after-request="this.nextElementSibling.style.display = 'block'">
    Show Filters
  </button>
  <div style="display: none">
    <input type="text" name="search" placeholder="Search..."
           hx-get="/admin/plans" hx-trigger="keyup changed delay:300ms" />
  </div>
</div>
```

## ✅ 正确示例：职责分离

```nunjucks
{# admin/views/plans.njk #}

{# 整体布局与内容列表由 HTMX 驱动 #}
<div id="plans-content" hx-boost="true">
  <div class="header-bar" x-data="{ showFilters: false }">
    <h1>Interview Plans</h1>

    {# 下拉菜单状态由 Alpine 管理 #}
    <button type="button" @click="showFilters = !showFilters"
            :class="{ 'active': showFilters }">
      Filters
    </button>

    {# Alpine 控制本地显示/隐藏 #}
    <div x-show="showFilters" x-transition class="filter-panel">
      {# 搜索输入通过 HTMX 触发服务端请求 #}
      <input type="text" name="search" placeholder="Search plans..."
             hx-get="/admin/plans"
             hx-target="#plans-list"
             hx-trigger="keyup changed delay:300ms"
             hx-indicator=".search-spinner" />
    </div>
  </div>

  {# 列表内容完全由 HTMX 服务端渲染 #}
  <div id="plans-list">
    {% for plan in plans %}
    <div class="plan-card" id="plan-{{ plan.id }}">
      <h3>{{ plan.name }}</h3>
      <p>Status: {{ plan.status | upper }}</p>
      <p>Completion: {{ plan.completionRate | round(1) }}%</p>

      <div class="actions">
        {# 删除操作通过 HTMX 提交，服务端响应更新 DOM #}
        <button class="btn-danger"
                hx-delete="/admin/plans/{{ plan.id }}"
                hx-target="#plan-{{ plan.id }}"
                hx-swap="outerHTML"
                hx-confirm="Are you sure you want to delete this plan?"
                x-data="{ deleting: false }"
                hx-on::before-request="deleting = true"
                hx-on::after-request="deleting = false">
          <span x-show="!deleting">Delete</span>
          <span x-show="deleting" class="spinner">Deleting...</span>
        </button>
      </div>
    </div>
    {% endfor %}
  </div>
</div>
```

```nunjucks
{# admin/views/modals/confirm-delete.njk — Modal 由 Alpine 管理 #}

<div x-data="{ open: false, targetId: null, targetName: '' }"
     @open-modal.window="open = true; targetId = $event.detail.id; targetName = $event.detail.name"
     x-show="open"
     x-cloak
     class="modal-backdrop"
     @click.self="open = false">

  <div class="modal-content" x-transition>
    <h2>Confirm Delete</h2>
    <p>Are you sure you want to delete "<span x-text="targetName"></span>"?</p>

    <div class="modal-actions">
      <button @click="open = false">Cancel</button>

      {# 真正的删除操作通过 HTMX 提交 #}
      <button class="btn-danger"
              hx-delete="/admin/plans/"
              hx-vals='js:{ id: targetId }'
              hx-target="#plans-list"
              @click="open = false">
        Confirm Delete
      </button>
    </div>
  </div>
</div>
```

```nunjucks
{# admin/views/templates/edit.njk — 表单字段本地验证由 Alpine 管理 #}

<form x-data="{
  name: '',
  nameError: '',
  content: '',
  contentError: '',
  get isValid() {
    return this.name.length > 0 && this.content.length > 0 && !this.nameError && !this.contentError;
  },
  validateName(value) {
    this.name = value;
    this.nameError = value.length < 3 ? 'Name must be at least 3 characters.' : '';
  },
  validateContent(value) {
    this.content = value;
    this.contentError = value.trim().length === 0 ? 'Content cannot be empty.' : '';
  }
}" hx-post="/admin/templates/{{ template.id }}"
   hx-target="#form-result"
   hx-swap="innerHTML"
   hx-on::before-request="if (!isValid) { $event.preventDefault(); }">

  <div class="form-group">
    <label for="name">Template Name</label>
    <input type="text" id="name" name="name"
           x-model="name"
           @input="validateName(name)"
           :class="{ 'error': nameError }"
           value="{{ template.name }}" />
    <span x-show="nameError" x-text="nameError" class="field-error"></span>
  </div>

  <div class="form-group">
    <label for="content">Template Content</label>
    <textarea id="content" name="content" rows="20"
              x-model="content"
              @input="validateContent(content)"
              :class="{ 'error': contentError }">{{ template.content }}</textarea>
    <span x-show="contentError" x-text="contentError" class="field-error"></span>
  </div>

  <div class="form-actions">
    <button type="submit" :disabled="!isValid" class="btn-primary">
      Save Template
    </button>
    <a href="/admin/templates" class="btn-secondary">Cancel</a>
  </div>
</form>

{# HTMX 响应结果区域 #}
<div id="form-result"></div>
```

## 分离原则

1. **HTMX 是服务端与 DOM 之间的桥梁** — 所有数据变更、页面导航、内容更新必须通过 HTMX
2. **Alpine 是组件状态的管理者** — 只管理不需要服务端参与的 UI 状态（开关、显隐、验证）
3. **HTMX 属性不应操作 DOM 状态** — `hx-on::after-request` 里不应出现 `element.style.display`
4. **Alpine 方法不应发起 fetch** — `@click="fetch('/api/...')"` 是反模式，应用 `hx-get/hx-post`
