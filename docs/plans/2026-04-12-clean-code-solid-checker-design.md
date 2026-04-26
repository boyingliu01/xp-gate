# Clean Code & SOLID Principles Checker - Architecture Design

**Generated:** 2026-04-12
**Updated:** 2026-04-12 (Delphi Round 1 Fixes)
**Status:** Pending Delphi Round 2 Review

---

## 1. Executive Summary

This document outlines the architecture for a language-agnostic Clean Code and SOLID principle checking system for the XGate project. The system uses the **Adapter Pattern** to separate universal principles from language-specific AST parsers, with **ast-grep** as the core analysis engine.

---

## 2. Context

**Background:**
- Previous implementation was incorrectly placed in TypeScript-specific code
- Clean code and SOLID principles are **universal** - they apply to all languages
- User explicitly requires language-independence and proper architectural separation

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PRINCIPLES CHECKER ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  INTEGRATION LAYER                                                          │
│  ├── githooks/pre-commit (Gate 6)                                          │
│  ├── code-walkthrough (principles analysis module)                        │
│  └── code-reviewer (new skill)                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  CORE ENGINE: principles/                                                   │
│  ├── analyzer.ts - Rule orchestration                                      │
│  ├── reporter.ts - Output formatting                                        │
│  ├── config.ts - Thresholds                                                │
│  ├── rules/clean-code/ - 9 metric rules                                    │
│  └── rules/solid/ - 5 principle rules                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ADAPTER LAYER: language-adapters/                                          │
│  ├── typescript.ts, python.ts, go.ts, java.ts, kotlin.ts, dart.ts, swift.ts│
├─────────────────────────────────────────────────────────────────────────────┤
│  AST ENGINE: ast-grep (tree-sitter based)                                   │
│  Performance: ~43ms for 500 files, ~11MB memory                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Directory Structure

```
XGate/
├── src/
│   └── principles/                          # CORE - Language-agnostic
│       ├── index.ts                         # Main entry point
│       ├── analyzer.ts                      # Rule orchestration
│       ├── reporter.ts                      # Output formatting
│       ├── config.ts                        # Thresholds
│       ├── types.ts                         # Interfaces
│       ├── adapters/                        # Language adapters
│       │   ├── base.ts                     # Base interface
│       │   ├── typescript.ts
│       │   ├── python.ts
│       │   ├── go.ts
│       │   ├── java.ts
│       │   ├── kotlin.ts
│       │   ├── dart.ts
│       │   └── swift.ts
│       └── rules/
│           ├── clean-code/                 # 9 rules
│           └── solid/                      # 5 rules
│
├── githooks/
│   └── pre-commit                          # Add Gate 6
│
├── skills/
│   ├── code-walkthrough/                   # Add principles module
│   └── code-reviewer/                        # NEW skill
│
├── package.json                            # Node.js project definition
│
└── docs/plans/
    └── clean-code-solid-checker-design.md  # This document
```

---

## 5. Dependencies & Environment Requirements

### Runtime Dependencies

| Dependency | Version | Installation | Purpose |
|------------|---------|--------------|---------|
| **Node.js** | >=18.x | `brew install node` or [官网](https://nodejs.org/) | 运行 principles checker |
| **ast-grep** | latest | `npm install -g @ast-grep/cli` | AST pattern matching |
| **npm/yarn** | latest | Built-in with Node.js | Package management |

### Environment Verification

```bash
# Verify Node.js
node --version  # Should be >= 18.x

# Verify ast-grep
ast-grep --version  # Should show version info

# Verify npm
npm --version
```

### Platform Support

| Platform | Support Level | Notes |
|----------|---------------|-------|
| **Linux** | ✅ Full | Native bash support |
| **macOS** | ✅ Full | Native bash/zsh support |
| **Windows** | ⚠️ WSL/Git Bash required | PowerShell not supported; use WSL or Git Bash |
| **WSL** | ✅ Full | Windows Subsystem for Linux |

**Windows Users**: Install WSL2 or Git Bash before using this tool. PowerShell execution is not supported due to bash syntax requirements.

---

## 6. Clean Code Rules (Revised)

### 6.1 Metric Rules

| Rule ID | Name | Threshold | Severity | Notes |
|---------|------|-----------|----------|-------|
| `clean-code.long-function` | Function > 50 lines | 50 | warning | Count physical lines |
| `clean-code.large-file` | File > 500 lines | 500 | warning | Exclude blank/comment lines |
| `clean-code.god-class` | Class > 15 methods | 15 | warning | **Revised**: Exclude getters/setters |
| `clean-code.deep-nesting` | Nesting > 4 levels | 4 | warning | Count if/for/while/try blocks |
| `clean-code.too-many-params` | Parameters > 7 | 7 | info | **Revised**: Raised from 5 to 7 |

### 6.2 Magic Numbers Rule (Revised)

**Detection Method**: Detect non-semantic hardcoded numbers, excluding common safe values.

**Safe Values Exclusion List**:
```
[0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024]
```

**Examples**:
```typescript
// ✅ OK - Safe values
setTimeout(callback, 100);
if (index === 0) return;
const timeout = 30 * 1000;  // 30 seconds

// ❌ Warning - Non-semantic magic numbers
const taxRate = 0.0875;  // Should be named constant
const threshold = 42;    // Non-standard, should document
```

**Configuration**:
```json
{
  "magic-numbers": {
    "enabled": true,
    "exclude": [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024],
    "severity": "info"
  }
}
```

### 6.3 Missing Error Handling Rule (Revised)

**Scope**: Only detect missing error handling for **IO/External API operations**.

**Tracked Operations**:
- File system operations (read/write)
- Network requests (fetch/http)
- Database operations
- External API calls
- Async operations without try-catch

**Exclusions**:
- Pure functions (no side effects)
- Internal calculations
- Getter/setter methods
- Sync operations with known safety

**Examples**:
```typescript
// ❌ Warning - Missing error handling for IO
async function loadData() {
  const response = await fetch(url);  // No try-catch
  return response.json();
}

// ✅ OK - Has error handling
async function loadData() {
  try {
    const response = await fetch(url);
    return response.json();
  } catch (error) {
    logger.error('Failed to load data', error);
    return null;
  }
}

// ✅ OK - Pure function, no IO
function calculateTotal(items: Item[]) {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

### 6.4 Code Duplication Rule

**Detection Method**: Use **jscpd** (JavaScript Copy/Paste Detector) for token-based similarity detection.

**Threshold**: >15% similarity across minimum 50 tokens.

**Integration**:
```bash
# Install jscpd
npm install -g jscpd

# Run duplication check
jscpd --min-lines 5 --min-tokens 50 --reporters console
```

---

## 7. SOLID Rules (Revised Detection Methods)

### 7.1 SRP - Single Responsibility Principle

**Revised Detection**: Use measurable static indicators.

| Indicator | Threshold | Detection Method |
|-----------|-----------|------------------|
| Methods count | >15 | Count public methods |
| Import diversity | >3 categories | Group imports by domain |
| Field diversity | >3 categories | Analyze field types |

**Import Categories**:
- UI (components, styles)
- Data (models, repositories)
- Business (services, utils)
- Infrastructure (config, logging)

**Example**:
```typescript
// ❌ Warning - Multiple responsibilities
class UserController {
  // UI: 3 methods
  renderForm() {}
  validateInput() {}
  showError() {}
  
  // Data: 2 methods
  saveUser() {}
  loadUser() {}
  
  // Business: 3 methods
  calculateTax() {}
  sendEmail() {}
  generateReport() {}
}
// Import diversity: 3+ → SRP violation detected
```

### 7.2 OCP - Open/Closed Principle

**Revised Detection**: Detect **source modification** of base classes in derived class files.

**Detection Pattern**:
```typescript
// ❌ Warning - Direct modification of base class source
// If BaseClass source file is modified when adding DerivedClass
class DerivedClass extends BaseClass {
  // BaseClass source should NOT be modified for extension
}
```

**Exclusion**: Extension via inheritance/composition is OK.

**Note**: This rule only triggers if the base class source file appears in the same commit as derived class additions, indicating modification rather than extension.

### 7.3 LSP - Liskov Substitution Principle

**Revised Detection**: Detect **covariance/contravariance violations** in method signatures.

**Violation Patterns**:
- Return type becomes less specific (covariance violation)
- Parameter type becomes more specific (contravariance violation)
- Throwing new exception types not in base contract

**Example**:
```typescript
// ✅ OK - Proper override
class BaseRepo {
  findById(id: string): Entity | null
}
class DerivedRepo extends BaseRepo {
  findById(id: string): Entity | null  // Same signature
}

// ❌ Warning - LSP violation
class DerivedRepo extends BaseRepo {
  findById(id: number): Entity  // Changed parameter type
}
```

### 7.4 ISP - Interface Segregation Principle

**Detection**: Interface method count >10.

**Threshold**: 10 methods per interface.

**Example**:
```typescript
// ❌ Warning - Fat interface
interface UserRepository {
  findById(id): User
  findAll(): User[]
  save(user): void
  delete(id): void
  update(user): void
  count(): number
  search(query): User[]
  export(): string
  import(data): void
  validate(user): boolean
  notify(user): void  // >10 methods
}

// ✅ OK - Segregated interfaces
interface UserReader {
  findById(id): User
  findAll(): User[]
}
interface UserWriter {
  save(user): void
  delete(id): void
}
```

### 7.5 DIP - Dependency Inversion Principle

**Revised Detection**: Detect `new ClassName()` **direct instantiation in business logic**, excluding value objects and factories.

**Exclusion List**:
- Value objects: `new Date()`, `new Map()`, `new Set()`, `new Error()`
- Standard types: `new Array()`, `new Object()`, `new Promise()`
- Factory pattern: Classes named `*Factory`, `*Builder`

**Example**:
```typescript
// ❌ Warning - Direct instantiation of concrete dependency
class UserService {
  private repo = new UserRepository();  // Concrete instantiation
  
  getUser(id: string) {
    return this.repo.findById(id);
  }
}

// ✅ OK - Dependency injection (inversion)
class UserService {
  constructor(private repo: IRepository) {}  // Abstract dependency
  
  getUser(id: string) {
    return this.repo.findById(id);
  }
}

// ✅ OK - Value object (excluded)
class DateService {
  formatDate(date: Date) {
    return new Intl.DateTimeFormat().format(date);  // OK - standard API
  }
}
```

---

## 8. Technology Decision

**Selected: ast-grep**

| Criterion | ast-grep | semgrep | scc |
|-----------|----------|---------|-----|
| Speed | 43ms/500 files | 7,535ms/500 files | Fast |
| Memory | 11MB | 250MB | Low |
| AST-aware | Yes (tree-sitter) | Yes | Basic |

**Rationale:**
- ast-grep is 175x faster than semgrep
- Supports all target languages (TS, Python, Go, Java, Dart, Kotlin, Swift)
- Tree-sitter based AST matching is accurate and performant
- Low memory footprint suitable for git hook execution

**Estimated Overhead**: Rule engine adds ~50-100ms per rule. Total expected: <1s for 100 changed files, <10s for full project scan.

---

## 9. Integration Points

### GitHooks (pre-commit) - Gate 6

```bash
# ============================================================================
# Gate 6: Clean Code & SOLID Principles (MANDATORY)
# ============================================================================
echo ""
echo "→ Gate 6: Principles checker..."

if [ "$PROJECT_LANG" != "documentation-only" ]; then
  # Check Node.js availability
  if ! command -v node &> /dev/null; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "   ❌ ENVIRONMENT ERROR - COMMIT BLOCKED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Required tool 'node' (Node.js) is NOT installed."
    echo ""
    echo "Install commands:"
    echo "  macOS: brew install node"
    echo "  Linux: sudo apt-get install nodejs"
    echo "  Windows: Use WSL or Git Bash, then install node"
    echo ""
    exit 1
  fi
  
  # Check ast-grep availability
  if ! command -v ast-grep &> /dev/null; then
    echo ""
    echo "ℹ️  ast-grep not installed. Principles checker will use fallback."
    echo "   Recommend: npm install -g @ast-grep/cli"
  fi
  
  # Run principles checker on changed files
  PRINCIPLES_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx|js|jsx|py|go|java|kt|dart|swift)$' || true)
  
  if [ -n "$PRINCIPLES_FILES" ]; then
    node src/principles/index.js --files "$PRINCIPLES_FILES" --changed-only 2>&1 | head -50
    PRINCIPLES_EXIT=$?
    
    if [ "$PRINCIPLES_EXIT" -ne 0 ]; then
      echo ""
      echo "❌ PRINCIPLES VIOLATIONS DETECTED. Commit blocked."
      echo "Fix the clean code/SOLID violations above before committing."
      exit 1
    fi
    echo "✅ Principles check passed."
  fi
else
  echo "✅ Skipped (documentation-only project)."
fi
```

### Code-Walkthrough Integration

Add to `skills/code-walkthrough/SKILL.md`:

```yaml
principles_module:
  enabled: true
  rules:
    - clean-code.all
    - solid.all
  integration_point: expert_prompt
  output_format: principles_findings section
```

### Code-Reviewer Skill (New)

Create `skills/code-reviewer/SKILL.md`:

```yaml
name: code-reviewer
description: Code review with principles analysis
integrations:
  - principles.analyzer
  - ast-grep
output_formats:
  - console
  - SARIF (IDE compatible)
```

---

## 10. Atomic Commit Strategy (Simplified)

| # | Description | Files |
|---|-------------|-------|
| 1 | Core + Adapters + Config | `principles/`, `package.json`, `.principlesrc` |
| 2 | All Rules (clean-code + SOLID) | `rules/clean-code/`, `rules/solid/` |
| 3 | Integration (githooks + skills) | `githooks/pre-commit`, `skills/*/SKILL.md` |

---

## 11. Configuration (.principlesrc)

```json
{
  "rules": {
    "clean-code": {
      "long-function": { "enabled": true, "threshold": 50, "severity": "warning" },
      "large-file": { "enabled": true, "threshold": 500, "severity": "warning" },
      "god-class": { "enabled": true, "threshold": 15, "severity": "warning" },
      "deep-nesting": { "enabled": true, "threshold": 4, "severity": "warning" },
      "too-many-params": { "enabled": true, "threshold": 7, "severity": "info" },
      "magic-numbers": {
        "enabled": true,
        "exclude": [0, 1, -1, 2, 10, 100, 1000, 60, 24, 7, 30, 365, 256, 1024],
        "severity": "info"
      },
      "missing-error-handling": { "enabled": true, "scope": "io-only", "severity": "warning" },
      "unused-imports": { "enabled": true, "scope": "value-imports", "severity": "info" },
      "code-duplication": { "enabled": true, "threshold": 15, "severity": "warning" }
    },
    "solid": {
      "srp": { "enabled": true, "methodThreshold": 15, "severity": "warning" },
      "ocp": { "enabled": true, "severity": "info" },
      "lsp": { "enabled": true, "severity": "info" },
      "isp": { "enabled": true, "methodThreshold": 10, "severity": "info" },
      "dip": {
        "enabled": true,
        "exclude": ["Date", "Map", "Set", "Error", "Array", "Object", "Promise"],
        "severity": "warning"
      }
    }
  },
  "output": {
    "format": "console",
    "show-score": true,
    "colorize": true
  },
  "performance": {
    "mode": "changed-files-only",
    "mediumProjectDefinition": "10000 lines / 500 files"
  }
}
```

---

## 12. Performance Targets (Clarified)

| Metric | Target | Definition |
|--------|--------|------------|
| Execution time (changed files) | <5s | Up to 100 changed files |
| Execution time (full scan) | <10s | Medium project: 10k lines, 500 files |
| Memory usage | <50MB | Lightweight execution |
| False positive rate | <10% | Based on user feedback sampling |
| Language coverage | 7 languages | TS, Python, Go, Java, Kotlin, Dart, Swift |

**Performance Mode**: By default, analyze only changed files (`--changed-only`). Full project scan available via `--full` flag.

---

## 13. Success Criteria

1. ✅ Language-agnostic core in `principles/` directory
2. ✅ Adapter pattern implemented
3. ✅ ast-grep as AST engine
4. ✅ Node.js >=18 and ast-grep declared as dependencies
5. ✅ Windows support via WSL/Git Bash documented
6. ✅ SOLID rules with measurable detection methods
7. ✅ Magic numbers with exclusion list
8. ✅ Error handling scoped to IO operations
9. ✅ Integration with githooks
10. ✅ Performance targets met

---

## 14. Delphi Review Status

| Round | Status | Critical Issues | Resolution |
|-------|--------|-----------------|------------|
| Round 1 | REQUEST_CHANGES | 6 issues | Fixed in this revision |
| Round 2 | Pending | - | Awaiting expert review |

---

## 15. Open Questions (Resolved)

| # | Question | Resolution |
|---|----------|------------|
| 1 | Priority languages | TypeScript > Python > Go > Java > Dart |
| 2 | Threshold configuration | Project-level override supported via `.principlesrc` |
| 3 | Failure handling | Block on errors/warnings, info-level only logs |
| 4 | Performance mode | Changed files only by default, `--full` for full scan |

---

## 16. Appendix: Detection Examples

### A. Magic Numbers

```typescript
// ❌ Detected: non-semantic magic numbers
const COMMISSION_RATE = 0.1275;  // Should document meaning
const BATCH_SIZE = 47;           // Non-standard value

// ✅ OK: excluded safe values
for (let i = 0; i < items.length; i++) { }  // 0 is safe
const timeout = 30 * 1000;  // 30 seconds (30 and 1000 are safe)
```

### B. SRP Detection

```typescript
// ❌ Detected: 18 methods + imports from 4 categories
import { UserService } from './services';
import { UserComponent } from './components';
import { UserRepository } from './repositories';
import { Logger, Config } from './infrastructure';

class UserController {
  // ... 18 methods ...
}
```

### C. DIP Detection

```typescript
// ❌ Detected: direct instantiation
class OrderService {
  private payment = new PaymentGateway();  // Concrete dependency
}

// ✅ OK: dependency injection
class OrderService {
  constructor(private payment: IPaymentGateway) {}
}
```