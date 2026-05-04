# Sprint Flow 支持 Web 前端/全栈应用 — Design

**Issue**: #28
**Date**: 2026-05-04
**Priority**: P1
**Status**: DESIGN

---

## Problem

sprint-flow 当前是纯 CLI/Backend 导向的流水线，对 Web 前端 (React/Next.js/Vue) 和全栈应用缺少：

1. **Phase 1**: 无 UI 设计探索 (design-shotgun)
2. **Phase 3**: 无系统化 QA 测试 (qa)、无视觉审计 (design-review)、无性能基线 (benchmark)
3. **Browse**: 仅 `localhost:3000`，不支持部署 URL、表单测试、认证页面
4. **No type detection**: 无法自动识别项目类型

## Solution

### 1. Project Type Auto-Detection

```
检测顺序:
1. package.json + next.config.js → web-nextjs
2. package.json + vite.config.ts + react → web-react
3. package.json + vue → web-vue
4. go.mod → backend-go
5. pom.xml → backend-springboot
6. manage.py/pyproject.toml (django) → backend-django
7. None matched → backend-cli (default)
```

### 2. Skill Injection by Type

| Phase | Backend (default) | Web Frontend (additional) |
|-------|------------------|--------------------------|
| Phase 1 (PLAN) | autoplan + delphi-review | + design-shotgun |
| Phase 2 (BUILD) | TDD + blind-review | (same) |
| Phase 3 (REVIEW) | delphi code-walkthrough + test-spec-alignment | + qa + design-review + benchmark |
| Browse | localhost:3000 (CLI tests) | 支持部署 URL + form/interaction testing |

### 3. New `--type` Parameter

```bash
/sprint-flow "开发用户登录页面" --type web-nextjs
/sprint-flow "开发 REST API" --type backend-django
# Default: auto-detect from project files
```

Overrides auto-detection when specified.

## Implementation

### Files to modify (project copy + central config)

1. `skills/sprint-flow/SKILL.md` — Add `--type` param, project-type-to-skill mapping
2. `skills/sprint-flow/references/phase-1-plan.md` — Conditional design-shotgun injection
3. `skills/sprint-flow/references/phase-3-review.md` — Conditional qa + design-review + benchmark
4. Also fix: project SKILL.md still has `cross-model-review` (should be `delphi-review` per #26)
