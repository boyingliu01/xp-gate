# Gate 9: Architecture Quality - Design Document

**Version**: 1.0
**Date**: 2026-04-15
**Author**: AI Assistant
**Status**: Pending Delphi Review

---

## 1. Background and Motivation

### Current State

The project has **8 quality gates** in pre-commit hooks:

| Gate | Check | Purpose |
|------|-------|---------|
| 1 | Static Analysis | TypeScript strict, language-specific lint |
| 2 | Additional Lint | .pre-commit-config.yaml |
| 3 | Unit Tests | All tests pass |
| 4 | Coverage | ≥80% threshold |
| 5 | Shell Check | shellcheck validation |
| 6 | Principles | Clean Code + SOLID (14 rules, 9 language adapters) |
| 7 | CCN | Cyclomatic complexity ≤5 warn, ≤10 block |
| 8 | Boy Scout | Warning baseline enforcement |

### Gap Analysis

**What's missing**: Architecture-level quality checks

Current Gate 6 (Principles) checks:
- Clean Code rules (long functions, god classes, deep nesting, magic numbers, etc.)
- SOLID principles (SRP, OCP, LSP, ISP, DIP)

**What's NOT checked**:
- Layer boundary violations (e.g., Domain importing Infrastructure)
- Dependency direction (Clean Architecture: outer → inner only)
- Circular dependencies across layers
- Module cohesion and coupling metrics

### Why This Matters

Without architecture checks:
- Gradual architecture erosion ("architecture decay")
- Layer boundaries become blurry
- Clean Architecture principles violated silently
- Long-term maintenance cost increases exponentially

---

## 2. Design Goals

### Primary Goals

1. **Enforce Clean Architecture layer order**
   - Dependencies must flow inward: Infrastructure → Application → Domain
   - Domain layer must be independent (no external dependencies)

2. **Detect layer boundary violations**
   - Cross-layer imports that violate architecture rules
   - Unauthorized dependencies (e.g., UI directly accessing database)

3. **Detect circular dependencies**
   - Across layers and modules
   - Within same layer (module-level cycles)

4. **Provide configurable rules**
   - Project-specific layer definitions
   - Custom dependency allow/deny lists
   - Thresholds for severity (error/warning/info)

### Secondary Goals

5. **Multi-language support**
   - TypeScript (primary)
   - Python, Go, Java, C++ (via adapters)

6. **Gradual adoption**
   - Baseline/ratchet mode (like Gate 8 Boy Scout)
   - Warning-only mode for initial rollout

7. **SARIF output integration**
   - Consistent with existing Gate 6 output
   - IDE/GitHub Actions compatibility

---

## 3. Proposed Implementation

### 3.1 Tool Selection

**Primary Tool**: **archlint** (TypeScript) - npm package: `@archlinter/cli`

> ⚠️ **重要说明**: 本文档之前错误使用 "architecture-linter" 名称，实际应使用 `archlint` (来自 `@archlinter/cli` 包)。
> - `archlint` = Rust实现，高性能，GitHub 130 stars
> - `architecture-linter` = 不同的工具，npm 包存在但使用量低
> - CLI 命令: `archlint` 或 `npx @archlinter/cli`

**Why archlint (@archlinter/cli)**:
| Feature | archlint (@archlinter/cli) | Alternatives |
|---------|----------------------------|--------------|
| **SARIF output** | ✅ Built-in (--output sarif) | ArchUnitTS: ❌ |
| **Built-in presets** | ✅ Clean/Hexagonal architecture | Others: Partial |
| **Baseline mode** | ✅ --baseline diff mode | Most: ❌ |
| **CLI-first** | ✅ Perfect for hooks | ArchUnitTS: Test-based |
| **Performance** | ✅ Rust implementation (~100ms) | Others: Node-based |
| **Layer rules** | ✅ Configurable | All: Yes |

**Alternative Consideration**: dependency-cruiser
- Strong for cycle detection
- Good for graph visualization
- But: SARIF support requires custom plugin

### 3.2 Architecture Rule Categories

**Rule Category 1: Layer Dependency Direction**

| Rule ID | Description | Default Severity |
|---------|-------------|------------------|
| `ARCH-001` | Domain layer must not import from outer layers | ERROR |
| `ARCH-002` | Application layer must not import from Infrastructure | ERROR |
| `ARCH-003` | Presentation layer must not import from Domain directly | ERROR |
| `ARCH-004` | Infrastructure layer must not import from Presentation | ERROR |

**Rule Category 2: Circular Dependencies**

| Rule ID | Description | Default Severity |
|---------|-------------|------------------|
| `ARCH-005` | No circular dependencies across layers | ERROR |
| `ARCH-006` | No circular dependencies within same layer | WARNING |
| `ARCH-007` | No circular dependencies across modules | WARNING |

**Rule Category 3: Layer Boundary Enforcement**

| Rule ID | Description | Default Severity |
|---------|-------------|------------------|
| `ARCH-008` | Domain entities must be in domain layer | INFO |
| `ARCH-009` | Repository interfaces must be in domain layer | WARNING |
| `ARCH-010` | Use case implementations must be in application layer | INFO |

**Rule Category 4: Coupling Metrics (Optional)**

| Rule ID | Description | Default Severity |
|---------|-------------|------------------|
| `ARCH-011` | Module cohesion (LCOM) threshold | WARNING |
| `ARCH-012` | Coupling between layers (CBO) threshold | WARNING |
| `ARCH-013` | Afferent coupling (incoming dependencies) | INFO |
| `ARCH-014` | Efferent coupling (outgoing dependencies) | INFO |

### 3.3 Configuration Schema

```yaml
# .architecturerc or architecture.yaml
version: 1

# Layer definitions (project-specific)
layers:
  domain:
    pattern: "src/domain/**"
    allowedImports: ["src/shared/**"]
    forbiddenImports: ["src/infrastructure/**", "src/application/**", "src/presentation/**"]
    
  application:
    pattern: "src/application/**"
    allowedImports: ["src/domain/**", "src/shared/**"]
    forbiddenImports: ["src/infrastructure/**", "src/presentation/**"]
    
  infrastructure:
    pattern: "src/infrastructure/**"
    allowedImports: ["src/application/**", "src/domain/**", "src/shared/**"]
    forbiddenImports: ["src/presentation/**"]
    
  presentation:
    pattern: "src/presentation/**"
    allowedImports: ["src/application/**", "src/domain/**", "src/shared/**"]
    forbiddenImports: []

# Rule activation and severity overrides
rules:
  ARCH-001: # Domain isolation
    enabled: true
    severity: error
    
  ARCH-003: # Presentation to Domain
    enabled: true
    severity: warning  # Override default
    
  ARCH-005: # Cross-layer cycles
    enabled: true
    severity: error
    
  ARCH-006: # Within-layer cycles
    enabled: false  # Disable for gradual adoption
    
  ARCH-011: # LCOM metrics
    enabled: false  # Advanced, optional

# Baseline for gradual adoption (like Boy Scout Gate 8)
# IMPORTANT: New projects should start with enabled: false
# Baseline mode is ONLY for historical projects with existing violations
baseline:
  enabled: false  # Default: false for new projects, true for historical projects
  file: ".architecture-baseline.json"
  mode: "ratchet"  # Allow existing violations, block new ones

# Output configuration
output:
  format: sarif  # sarif | json | console
  file: "architecture-report.sarif.json"

# Integration settings
integration:
  documentationOnlySkip: true  # Skip for doc-only projects (like Gate 6)
  toolRequired: true  # Zero tolerance - block if tool missing
```

### 3.4 Pre-commit Integration (Gate 9)

```bash
#!/bin/bash
# Gate 9: Architecture Quality Validation
# Location: githooks/pre-commit (after Gate 8)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Gate 9: Architecture Quality"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if this is a documentation-only project
if is_documentation_only; then
  echo "⚠️  Documentation-only project: Skipping architecture gate"
  exit 0
fi

# Check if architecture config exists
if [ ! -f "architecture.yaml" ] && [ ! -f ".architecturerc" ]; then
  echo "⚠️  No architecture configuration found: Skipping"
  echo "   Create architecture.yaml to enable this gate"
  exit 0
fi

# ========================================
# TypeScript Projects
# ========================================
if [ -f "tsconfig.json" ]; then
  echo "📋 TypeScript: Running archlint (@archlinter/cli)"
  
  # Check tool availability (zero tolerance)
  if ! command -v archlint &> /dev/null; then
    echo "❌ BLOCKED: archlint not installed"
    echo "   Install: npm install -g @archlinter/cli"
    echo "   Or: npm install @archlinter/cli --save-dev"
    echo "   Note: Package name is @archlinter/cli, NOT architecture-linter"
    exit 1
  fi
  
  # Check version compatibility
  # archlint --version output format: e.g., "archlint v2.0.0" or "2.0.0"
  ARCHLINT_VERSION=$(archlint --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [ -z "$ARCHLINT_VERSION" ]; then
    echo "⚠️  Warning: Could not parse archlint version, proceeding anyway"
  else
    # Parse major version
    MAJOR_VERSION=$(echo "$ARCHLINT_VERSION" | cut -d. -f1)
    if [ "$MAJOR_VERSION" -lt 2 ]; then
      echo "❌ BLOCKED: archlint version incompatible"
      echo "   Current: $ARCHLINT_VERSION"
      echo "   Required: >= 2.0.0"
      echo "   Update: npm update @archlinter/cli"
      exit 1
    fi
  fi
  
  # Run with baseline mode
  if [ -f ".architecture-baseline.json" ]; then
    archlint analyze --baseline .architecture-baseline.json --output sarif || exit 1
  else
    archlint analyze --output sarif || exit 1
  fi
  
  echo "✅ TypeScript architecture validation passed"
fi

# ========================================
# Python Projects
# ========================================
if [ -f "pyproject.toml" ] && [ -f "deply.yaml" ]; then
  echo "📋 Python: Running Deply"
  
  if ! command -v deply &> /dev/null; then
    echo "❌ BLOCKED: deply not installed"
    echo "   Install: pip install deply"
    exit 1
  fi
  
  # Check version compatibility (minimum 0.8.0)
  DEPLY_VERSION=$(deply --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [ -n "$DEPLY_VERSION" ]; then
    DEPLY_MAJOR=$(echo "$DEPLY_VERSION" | cut -d. -f1)
    DEPLY_MINOR=$(echo "$DEPLY_VERSION" | cut -d. -f2)
    # Accept versions >= 0.8.0
    if [ "$DEPLY_MAJOR" -eq 0 ] && [ "$DEPLY_MINOR" -lt 8 ]; then
      echo "❌ BLOCKED: deply version incompatible"
      echo "   Current: $DEPLY_VERSION"
      echo "   Required: >= 0.8.0"
      echo "   Update: pip install --upgrade deply"
      exit 1
    fi
  fi
  
  deply analyze || exit 1
  echo "✅ Python architecture validation passed"
fi

# ========================================
# Go Projects
# ========================================
if [ -f "go.mod" ] && [ -f "architecture_test.go" ]; then
  echo "📋 Go: Running architecture tests"
  
  # Go doesn't have a standalone tool, uses go test
  # Verify go toolchain version (minimum Go 1.18 for generics support in arch tests)
  GO_VERSION=$(go version 2>/dev/null | grep -oE 'go[0-9]+\.[0-9]+' | sed 's/go//')
  if [ -n "$GO_VERSION" ]; then
    GO_MAJOR=$(echo "$GO_VERSION" | cut -d. -f1)
    GO_MINOR=$(echo "$GO_VERSION" | cut -d. -f2)
    if [ "$GO_MAJOR" -lt 1 ] || ([ "$GO_MAJOR" -eq 1 ] && [ "$GO_MINOR" -lt 18 ]); then
      echo "❌ BLOCKED: Go version incompatible"
      echo "   Current: go$GO_VERSION"
      echo "   Required: >= go1.18"
      exit 1
    fi
  fi
  
  go test -run Architecture -v || exit 1
  echo "✅ Go architecture validation passed"
fi

# ========================================
# Java Projects
# ========================================
if [ -f "pom.xml" ] && [ -d "src/test/java/architecture" ]; then
  echo "📋 Java: Running ArchUnit tests"
  
  # Maven doesn't need explicit version check - pom.xml controls versions
  # But verify maven is available
  if ! command -v mvn &> /dev/null; then
    echo "❌ BLOCKED: mvn not installed"
    echo "   Install: Apache Maven"
    exit 1
  fi
  
  mvn test -Dtest=*ArchitectureTest || exit 1
  echo "✅ Java architecture validation passed"
fi

# ========================================
# C++ Projects (Custom - Future)
# ========================================
# C++ requires custom solution using existing adapter pattern
# Phase 1: Hard fail with explicit skip marker required
# Phase 2: Implement custom layer checker using regex/clang

# Helper function to detect C++ files
has_cpp_files() {
  find . -type f \( -name "*.cpp" -o -name "*.cxx" -o -name "*.cc" -o -name "*.hpp" -o -name "*.h" \) \
    -not -path "*/node_modules/*" -not -path "*/.git/*" | head -1 | grep -q .
}

if has_cpp_files; then
  # Use dot prefix to indicate this is a config file (should be committed)
  if [ -f ".skip-architecture-cpp" ]; then
    echo "⚠️  C++ architecture validation: Explicitly skipped"
    echo "   Reason: Gate 9 does not support C++ yet (Phase 2 future work)"
    echo "   Skip marker: .skip-architecture-cpp (committed to repo)"
    echo "   To enable: Remove .skip-architecture-cpp and implement custom checker"
  else
    echo "❌ BLOCKED: C++ project detected but Gate 9 architecture validation not implemented"
    echo "   C++ requires custom solution - see src/principles/adapters/cpp.ts"
    echo "   Options:"
    echo "     1. Add .skip-architecture-cpp marker file (commit to repo as technical debt)"
    echo "     2. Implement custom C++ layer checker (Phase 2 roadmap)"
    echo "     3. Wait for Phase 5 implementation"
    exit 1
  fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Gate 9: Architecture Quality PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

---

## 4. Configuration Options (回答用户问题)

### 4.1 规则可配置性

**Yes, 完全可配置**:

| 配置项 | 配置方式 | 说明 |
|--------|---------|------|
| **Layer definitions** | `architecture.yaml` → `layers` | 项目特定的层级定义 |
| **Rule activation** | `architecture.yaml` → `rules.X.enabled` | 开启/关闭特定规则 |
| **Severity override** | `architecture.yaml` → `rules.X.severity` | 覆盖默认严重级别 |
| **Allowed/Forbidden imports** | `architecture.yaml` → `layers.X.allowedImports` | 自定义允许/禁止的导入 |
| **Baseline mode** | `architecture.yaml` → `baseline.enabled` | 渐进式采用模式 |
| **Thresholds** | `architecture.yaml` → `rules.X.threshold` | 指标阈值（如 LCOM） |

### 4.2 配置文件位置

```bash
# Primary configuration file
architecture.yaml          # 推荐，YAML格式

# Alternative configuration
.architecturerc           # JSON格式
.architecturerc.json      # JSON格式
package.json#architecture # 嵌入package.json

# Baseline file (渐进式采用)
.architecture-baseline.json  # 存储现有违规，阻止新增
```

### 4.3 规则分类

**4大规则类别**:

1. **Layer Dependency Direction (层级依赖方向)**
   - ARCH-001 到 ARCH-004
   - 确保 Clean Architecture 依赖方向：外层 → 内层

2. **Circular Dependencies (循环依赖)**
   - ARCH-005 到 ARCH-007
   - 检测跨层、同层、跨模块的循环依赖

3. **Layer Boundary Enforcement (层级边界强制)**
   - ARCH-008 到 ARCH-010
   - 确保特定类型位于正确层级

4. **Coupling Metrics (耦合指标 - Optional)**
   - ARCH-011 到 ARCH-014
   - LCOM、CBO 等指标检查

**用户可配置**:
- 开启/关闭每条规则
- 调整每条规则的严重级别
- 自定义层级定义
- 自定义允许/禁止的导入

---

## 5. Integration with Existing System

### 5.1 与现有 Gates 的关系

| Gate | 关系 |
|------|------|
| Gate 6 (Principles) | 互补 - Principles 检查代码质量，Gate 9 检查架构质量 |
| Gate 7 (CCN) | 互补 - CCN 检查方法复杂度，Gate 9 检查模块耦合 |
| Gate 8 (Boy Scout) | 相同模式 - Gate 9 也使用 baseline/ratchet 模式 |

### 5.2 输出格式一致性

| Gate | 输出格式 | Gate 9 输出 |
|------|---------|------------|
| Gate 6 | SARIF 2.1.0 | SARIF 2.1.0 ✅ |
| Gate 7 | Text (lizard) | SARIF 2.1.0 ✅ |
| Gate 8 | JSON baseline | JSON baseline ✅ |

**统一输出**: SARIF 2.1.0 → GitHub Actions / IDE 集成

### 5.3 文档项目跳过

遵循现有 Gate 6 模式:
- 检测文档项目（无源码文件）
- 自动跳过架构检查
- 输出警告信息

---

## 6. Risk Analysis

### 6.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Tool availability (architecture-linter not installed) | 阻塞开发 | Zero tolerance → 强制安装，文档说明 |
| C++ support gap | C++ 项目无法检查 | Phase 1 跳过，Phase 2 自定义方案 |
| Baseline file maintenance | 基线文件需要更新 | 自动生成模式，类似 Gate 8 |
| Configuration complexity | 配置文件复杂 | Preset templates，示例配置 |

### 6.2 Process风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Adoption resistance | 团队不习惯架构检查 | Warning-only mode 初期，渐进式采用 |
| False positives | 合理的导入被误报 | AllowedImports 配置，例外规则 |
| Performance overhead | 检查时间过长 | Incremental mode (只检查变更文件) |

### 6.3 Design风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Layer definitions subjective | 层级定义有争议 | Delphi review 确认，团队共识 |
| Rule coverage incomplete | 规则不够全面 | 扩展性设计，可添加新规则 |
| Multi-language inconsistency | 不同语言规则不一致 | 统一配置 schema，语言适配 |

---

## 7. Alternative Approaches

### Alternative 1: Extend Principles Checker

**Approach**: 在 Gate 6 添加架构规则

**Pros**:
- 使用现有 adapter pattern
- 统一配置文件 (.principlesrc)
- 统一 SARIF 输出

**Cons**:
- Principles 是代码级规则，架构是模块级规则
- 不适合外部工具集成
- 复杂度增加

**Conclusion**: 不推荐，职责分离更清晰

### Alternative 2: dependency-cruiser

**Approach**: 使用 dependency-cruiser 作为主工具

**Pros**:
- 强大的依赖图分析
- SVG 可视化输出

**Cons**:
- SARIF 输出需要自定义插件
- 没有 preset 模板
- 没有 baseline mode

**Conclusion**: 可作为辅助工具，非主工具

### Alternative 3: Custom Implementation

**Approach**: 完全自定义实现

**Pros**:
- 完全控制
- 多语言统一

**Cons**:
- 开发成本高
- 维护成本高
- 缺少社区支持

**Conclusion**: 仅用于 C++ 等无成熟工具的语言

---

## 8. Implementation Phases

### Phase 1: Foundation (Week 1)

1. Add Gate 9 skeleton to pre-commit
2. Install architecture-linter (TypeScript)
3. Create default architecture.yaml template
4. Implement zero-tolerance tool check
5. Documentation-only skip logic

### Phase 2: Configuration (Week 2)

1. Define project-specific layers
2. Configure baseline mode
3. Tune severity levels
4. Create initial baseline file

### Phase 3: Multi-language (Week 3)

1. Add Python support (Deply)
2. Add Go support (goarchtest)
3. Add Java support (ArchUnit test pattern)

### Phase 4: Advanced Features (Week 4)

1. Coupling metrics (ARCH-011 to ARCH-014)
2. Incremental mode (只检查变更)
3. SARIF output integration
4. IDE/GitHub Actions integration

### Phase 5: C++ Support (Future)

1. Design C++ architecture adapter
2. Implement regex-based layer detection
3. Integrate with existing principles adapter

---

## 9. Success Metrics

| Metric | Target | Measurement |
|---------|--------|-------------|
| Architecture violations detected | ≥5 in first month | archlint output |
| False positive rate | <10% | Manual review |
| Adoption rate | 100% TypeScript projects | Config file presence |
| Performance overhead | <5s per commit | Benchmark |
| Team satisfaction | ≥7/10 | Survey |

---

## 10. Documentation Requirements

### Required Documentation

1. **architecture.yaml template** - 示例配置文件
2. **TOOL-INSTALLATION-GUIDE.md update** - 添加 architecture-linter 安装
3. **CONTRIBUTING.md update** - 添加 Gate 9 说明
4. **Architecture rules reference** - 规则详细说明
5. **Baseline adoption guide** - 渐进式采用指南

---

## 11. Open Questions for Delphi Review

### Critical Questions

1. **Layer definitions**: 默认层级定义是否合适？(domain/application/infrastructure/presentation)
2. **Tool selection**: architecture-linter 是否最佳选择？
3. **Baseline mode**: 是否应该默认开启 baseline mode？
4. **C++ support**: Phase 1 是否应该完全跳过 C++，还是提供警告？
5. **Severity defaults**: 默认严重级别是否合适？
6. **SARIF output**: 是否应该强制 SARIF 输出，还是允许多种格式？

### Major Questions

7. **Rule coverage**: 14条规则是否足够？是否需要更多？
8. **Performance**: 是否需要 incremental mode？
9. **Integration**: 是否应该与 Gate 6 Principles 合并？
10. **Documentation skip**: 文档项目跳过逻辑是否正确？

---

## 12. Conclusion

**Recommendation**: Add Gate 9 with archlint (@archlinter/cli) (TypeScript primary)

> ⚠️ **Corrected**: Document previously referenced "architecture-linter" which is incorrect. Use archlint from @archlinter/cli package.

**Key Benefits**:
- Enforce Clean Architecture principles
- SARIF output consistent with existing gates
- Baseline mode for gradual adoption
- Multi-language roadmap

**Next Steps**:
1. Delphi review this design document
2. Get APPROVED verdict
3. Implement Phase 1
4. Monitor and iterate

---

**Document prepared for Delphi Review**
**Reviewer instructions**: 请评审本设计文档，关注第11节 Open Questions

---

## Appendix A: Delphi Review Round 1 Fix Report

**Date**: 2026-04-15
**Review Mode**: 3 Experts (Architecture + Implementation perspectives)
**Round 1 Verdict**: REQUEST_CHANGES (Consensus 100%)

### Critical Issues Fixed

| Issue | Expert | Fix Applied | Location |
|-------|--------|-------------|----------|
| ARCH-003 Severity incorrect | Expert A (Critical 2) | Changed `WARNING` → `ERROR` | Section 3.2, line 117 |
| C++ strategy soft warning | Expert A (Critical 1), Expert B (Critical 2) | Changed to **hard fail** with explicit skip marker | Section 3.4, lines 306-327 |
| Tool version check missing | Expert A (Major 1), Expert B (Critical 1) | Added version compatibility check (>= 2.0.0) | Section 3.4, lines 247-256 |
| Baseline default enabled | Expert A (Major 2) | Changed `enabled: false` with explanation for new projects | Section 3.3, lines 193-198 |

### Fix Details

**Fix 1: ARCH-003 Severity**
```diff
- | `ARCH-003` | Presentation layer must not import from Domain directly | WARNING |
+ | `ARCH-003` | Presentation layer must not import from Domain directly | ERROR |
```
Reason: Presentation → Domain direct import violates Clean Architecture dependency direction (outer → inner).

**Fix 2: C++ Hard Fail Strategy**
```diff
- if has_cpp_files && [ ! -f "skip-architecture-cpp" ]; then
-   echo "⚠️  C++ architecture validation: Not yet implemented"
-   echo "   C++ requires custom solution - see src/principles/adapters/cpp.ts"
- fi

+ # Helper function to detect C++ files
+ has_cpp_files() {
+   find . -type f \( -name "*.cpp" -o -name "*.cxx" -o -name "*.cc" -o -name "*.hpp" -o -name "*.h" \) \
+     -not -path "*/node_modules/*" -not -path "*/.git/*" | head -1 | grep -q .
+ }
+
+ if has_cpp_files; then
+   if [ -f "skip-architecture-cpp" ]; then
+     echo "⚠️  C++ architecture validation: Explicitly skipped"
+   else
+     echo "❌ BLOCKED: C++ project detected but Gate 9 not implemented"
+     exit 1
+   fi
+ fi
```
Reason: Zero tolerance principle - unsupported languages must be explicitly skipped, not silently passed.

**Fix 3: Tool Version Check**
```diff
+ # Check version compatibility (minimum v2.0.0)
+ ARCHLINT_VERSION=$(archlint --version 2>/dev/null | head -1)
+ if ! echo "$ARCHLINT_VERSION" | grep -qE '^[2-9]\.|^1\.[4-9]'; then
+   echo "❌ BLOCKED: architecture-linter version incompatible"
+   exit 1
+ fi
```
Reason: CLI interfaces may differ across versions, ensure compatibility.

**Fix 4: Baseline Default**
```diff
- baseline:
-   enabled: true
+ # IMPORTANT: New projects should start with enabled: false
+ # Baseline mode is ONLY for historical projects
+ baseline:
+   enabled: false  # Default: false for new projects
```
Reason: New projects should start with zero violations mindset.

### Request Re-Review

**Round 2 Start**: 两位专家请验证修复是否正确。

---

## Appendix B: Delphi Review Round 1 (第二次) Fix Report

**Date**: 2026-04-15
**Review Mode**: 3 Experts (delphi-reviewer-architecture + delphi-reviewer-technical + delphi-reviewer-feasibility)
**Round 1 Verdict**: REQUEST_CHANGES (Consensus 100%)

### Critical Issues Fixed (Second Round 1)

| Issue | Expert | Fix Applied | Location |
|-------|--------|-------------|----------|
| **工具名称错误** | Expert B (C1), Expert C (C1) | Changed `architecture-linter` → `archlint` (@archlinter/cli) | Section 3.1, lines 92-104 |
| **Python/Go/Java version checks missing** | Expert A (C1), Expert B (C3) | Added version checks for all languages | Section 3.4, lines 286-349 |
| **版本检查正则表达式脆弱** | Expert C (C2) | Changed to robust version parsing | Section 3.4, lines 253-265 |
| **C++ skip marker naming** | Expert A (C2) | Changed to `.skip-architecture-cpp` (dot prefix) | Section 3.4, lines 370-383 |

### Fix Details (Second Round 1)

**Fix 1: Tool Name Correction**
```diff
- Primary Tool: **architecture-linter** (TypeScript)
+ Primary Tool: **archlint** (TypeScript) - npm package: @archlinter/cli

- Install: npm install -g architecture-linter
+ Install: npm install -g @archlinter/cli
```
Reason: `architecture-linter` is a different, less-used package. The correct tool is `archlint` from `@archlinter/cli`.

**Fix 2: Python Version Check**
```bash
+ DEPLY_VERSION=$(deply --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
+ if [ -n "$DEPLY_VERSION" ]; then
+   # Accept versions >= 0.8.0
+   if [ "$DEPLY_MAJOR" -eq 0 ] && [ "$DEPLY_MINOR" -lt 8 ]; then
+     echo "❌ BLOCKED: deply version incompatible"
+     exit 1
+   fi
+ fi
```
Reason: Consistency with TypeScript version check.

**Fix 3: Go Version Check**
```bash
+ GO_VERSION=$(go version 2>/dev/null | grep -oE 'go[0-9]+\.[0-9]+' | sed 's/go//')
+ if [ "$GO_MAJOR" -lt 1 ] || ([ "$GO_MAJOR" -eq 1 ] && [ "$GO_MINOR" -lt 18 ]); then
+   echo "❌ BLOCKED: Go version incompatible"
+   exit 1
+ fi
```
Reason: Go 1.18+ needed for generics support in architecture tests.

**Fix 4: C++ Skip Marker Naming**
```diff
- if [ -f "skip-architecture-cpp" ]; then
+ if [ -f ".skip-architecture-cpp" ]; then
+   echo "   Skip marker: .skip-architecture-cpp (committed to repo)"
```
Reason: Dot prefix indicates config file, should be committed to repo.

### Expert Consensus Analysis

| Expert | Round 1 Verdict | Confidence | Critical Found |
|--------|-----------------|------------|----------------|
| Expert A (Architecture) | REQUEST_CHANGES | 9/10 | Python/Go/Java version checks, C++ skip marker |
| Expert B (Technical) | REQUEST_CHANGES | 9/10 | **Tool name error**, Install instructions, Version checks |
| Expert C (Feasibility) | REQUEST_CHANGES | 8/10 | **Tool name error**, Version regex |

**共识 Critical Issues**:
1. **工具名称错误** - 2/3 专家共识 (Expert B + Expert C)
2. **Python/Go/Java版本检查缺失** - 2/3 专家共识 (Expert A + Expert B)

### Request Round 2 Review

**三位专家请验证所有修复是否正确**。