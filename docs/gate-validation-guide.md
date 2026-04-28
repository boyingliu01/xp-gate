# Principles Gate 4 & Gate 3 Complexity Validation Guide

**Purpose:** Validate the principles checker and CCN gates work correctly in other projects.

## Prerequisites

1. Global git hooks template installed at `~/.config/opencode/git-hooks-template/`
2. Other project configured to use global hooks

## Step 1: Enable Global Hooks in Target Project

```bash
cd /path/to/your-project
git config core.hooksPath ~/.config/opencode/git-hooks-template
```

Or copy hooks directly:

```bash
cp ~/.config/opencode/git-hooks-template/pre-commit .git/hooks/pre-commit
cp ~/.config/opencode/git-hooks-template/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

## Step 2: Test Gate 4 (Principles Checker)

### Manual Test

Create a file with Clean Code violations:

```typescript
// test.ts - violates long-function, magic-numbers, god-class rules

export class UserService {
  constructor(
    private db: any,
    private cache: any,
    private logger: any,
    private metrics: any,
    private config: any,
    private validator: any,
    private emailService: any,
    private smsService: any
  ) {}

  async processUserAction(userId: string, action: string, data: any) {
    if (action === 'login') {
      const user = await this.db.findUser(userId);
      if (user) {
        if (user.status === 1) {
          if (user.lastLogin > 100) {
            if (user.role === 2) {
              const token = await this.cache.getToken(userId);
              if (token) {
                await this.logger.log(userId, action, 200);
                await this.metrics.record(userId, action, 15);
                return { success: true, code: 200 };
              }
            }
          }
        }
      }
    }
    return { success: false, code: 404 };
  }
}
```

### Expected Gate 4 Output

```text
→ Gate 4: Principles checker...
Running principles checker on changed files...

📁 test.ts
────────────────────────────────────────
  ✗ [ERROR] long-function
     line 10: Function 'processUserAction' exceeds 50 lines (threshold: 50)
  ✗ [ERROR] magic-numbers
     line 14: Magic number '100' found. Use named constant.
  ✗ [ERROR] god-class
     line 3: Class 'UserService' has 8 methods/methods (threshold: 7)
  ✗ [WARNING] deep-nesting
     line 14: Nested depth 5 exceeds threshold (4)

✗ FAIL
5 violations total
  4 errors
  1 warnings

❌ PRINCIPLES VIOLATIONS DETECTED. Commit blocked.
Fix the clean code/SOLID violations above before committing.
```

### Verification Checklist

- [ ] Gate 4 runs when TypeScript/Python/Go/Java/Kotlin/Dart/Swift files are changed
- [ ] Violations are reported with file, line, rule ID, and message
- [ ] Commit is blocked when violations exist
- [ ] Gate 4 skips when no source files changed
- [ ] Gate 4 shows fallback message when ast-grep not installed

## Step 3: Test Gate 3 (Complexity Check)

### Manual Test

Create a function with high cyclomatic complexity:

```typescript
// complex.ts - CCN > 10

export function complexDecision(data: any) {
  if (data.type === 'A') {
    if (data.status === 1) {
      if (data.value > 100) {
        for (let i = 0; i < 10; i++) {
          if (i % 2 === 0) {
            switch (data.mode) {
              case 'fast':
                return 'fast-result';
              case 'slow':
                while (data.count < 50) {
                  if (data.count % 3 === 0) {
                    data.count++;
                  }
                }
                return 'slow-result';
              default:
                return 'default-result';
            }
          }
        }
      }
    }
  }
  return 'fallback';
}
```

### Expected Gate 3 Output

```text
→ Gate 3: Cyclomatic complexity check (threshold: 5)...

complex.ts:10: warning: complexDecision has 15 NLOC, 12 CCN, 89 token
  ⚠️  WARNING: Function CCN (12) exceeds warning threshold (5)
  
complex.ts:10: error: complexDecision has CCN 12 > 10
  ❌ BLOCKING: Function CCN (12) exceeds error threshold (10)

❌ COMPLEXITY VIOLATIONS DETECTED. Commit blocked.
Refactor to reduce cyclomatic complexity below 10.
```

### Verification Checklist

- [ ] Gate 3 runs when source files are changed
- [ ] CCN warnings shown when complexity > 5
- [ ] CCN blocking when complexity > 10
- [ ] Commit blocked when CCN > 10
- [ ] Gate 3 skips when no source files changed

## Step 4: Test Clean Commit

Create a clean file:

```typescript
// clean.ts - no violations

const MAX_RETRY_COUNT = 3;
const DEFAULT_TIMEOUT = 5000;

export function fetchData(url: string): Promise<Response> {
  return fetch(url, { timeout: DEFAULT_TIMEOUT });
}

export class DataProcessor {
  private data: string[];

  constructor(data: string[]) {
    this.data = data;
  }

  process(): string[] {
    return this.data.map(item => item.trim());
  }
}
```

### Expected Output

```text
→ Gate 4: Principles checker...
✓ No violations found

Files checked: 1
Rules run: 14
Execution time: 15ms
✅ Principles check passed.

→ Gate 3: Cyclomatic complexity check (threshold: 5)...
clean.ts:4: fetchData has 3 NLOC, 1 CCN, 28 token
clean.ts:8: DataProcessor.constructor has 3 NLOC, 1 CCN, 18 token
clean.ts:13: DataProcessor.process has 3 NLOC, 2 CCN, 32 token
✅ Complexity check passed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ✅ ALL GATES PASSED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Language-Specific Tests

### Python Test File

```python
# test.py - violations
def long_function(data):
    # 60+ lines of code
    pass

class GodClass:
    def method1(self): pass
    def method2(self): pass
    def method3(self): pass
    def method4(self): pass
    def method5(self): pass
    def method6(self): pass
    def method7(self): pass
    def method8(self): pass
    def method9(self): pass
```

### Go Test File

```go
// test.go - violations
func LongFunction(data string) string {
    // 60+ lines
    return ""
}

type GodClass struct {}
func (g *GodClass) Method1() {}
func (g *GodClass) Method2() {}
// ... 9+ methods
```

## Troubleshooting

### Gate 4 Not Running

1. Check if `src/principles/index.ts` exists in project
2. If not, copy from xgate
3. Or configure principles checker path in `.principlesrc`

### Gate 3 Not Running

1. Check if `lizard` is installed: `lizard --version`
2. Install: `pip install lizard`
3. Or use alternative: `npm install -g lizard-js`

### False Positives

Adjust thresholds in `.principlesrc`:

```yaml
rules:
  long-function:
    threshold: 80  # increase from 50
  god-class:
    threshold: 15  # increase from 7
  deep-nesting:
    threshold: 6   # increase from 4
```

## Success Criteria

- [ ] Gate 4 blocks commits with Clean Code/SOLID violations
- [ ] Gate 3 blocks commits with CCN > 10
- [ ] Both gates pass on clean code
- [ ] Language-specific rules work correctly
- [ ] Thresholds are configurable per project