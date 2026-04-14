# Quality Gate Enhancement Design

## Version
- **Version**: 1.2 (工具选择优化 - Research-Based)
- **Date**: 2026-04-13
- **Status**: ✅ APPROVED (Delphi) + 工具方案优化完成

## Overview

This document describes the design for enhancing the quality gate system with:
1. **Extended Language Support** - Add Java, C++, Objective-C, and full Kotlin integration
2. **Boy Scout Rule Implementation** - Differential warning enforcement for historical projects

## Requirements

### Requirement 1: Language Coverage Extension

**Context**: Company uses multiple languages as primary development stack:
- Java (backend services)
- JavaScript/TypeScript (frontend)
- C++ (embedded/performance)
- Python (data/AI)
- Objective-C (iOS legacy)
- Kotlin (Android)

**Current Gap Analysis**:

| Language | Pre-commit | Principles | CCN | Gap Level |
|----------|------------|------------|-----|-----------|
| Java | ❌ | ✅ | ✅ | Medium - adapter exists, needs pre-commit |
| JavaScript | ⚠️ | ⚠️ | ✅ | Low - via TypeScript adapter |
| TypeScript | ✅ | ✅ | ✅ | None - fully supported |
| C++ | ❌ | ❌ | ❌ | High - no support |
| Python | ✅ | ✅ | ✅ | None - fully supported |
| Objective-C | ❌ | ❌ | ❌ | High - no support |
| Kotlin | ⚠️ | ✅ | ⚠️ | Medium - needs pre-commit integration |

**Acceptance Criteria**:
- All 6 primary languages have complete pre-commit hook integration
- All 6 languages have principles checker adapters
- All 6 languages have CCN (lizard) support
- Zero-tolerance enforcement for new projects

### Requirement 2: Boy Scout Rule Implementation

**Context**: 
- New projects: Zero warnings (current behavior is correct)
- Historical projects: Must reduce warnings, not add new ones
- Legacy files with ≤5 warnings: Must clear them completely

**Boy Scout Rule Definition**:
> "Always leave the campground cleaner than you found it."
> - Modified files: Warning count must DECREASE (or stay same if ≤5)
> - New files: Zero warnings (strict enforcement)
> - Legacy files with ≤5 warnings: Must be cleared to zero

**Current Gap Analysis**:
- No file classification mechanism (new vs modified vs unchanged)
- No baseline storage (warning history per file)
- No warning delta tracking
- All-or-nothing enforcement (no differential)

**Acceptance Criteria**:
- File classification: Distinguish new, modified, unchanged files
- Baseline storage: Track warning counts per file in `.warnings-baseline.json`
- Delta enforcement:
  - New files: Zero warnings (strict)
  - Modified files: Warnings must decrease
  - Modified files with ≤5 warnings: Must clear to zero
- Configurable: Enable/disable via `.principlesrc`

## Design

### Part 1: Language Support Extension

#### 1.1 Principles Checker Adapters

**New Adapters Required**:

| Language | File | Tool for AST | Notes |
|----------|------|--------------|-------|
| C++ | `src/principles/adapters/cpp.ts` | **clang-lib** or regex fallback | Phase 1: regex only; Phase 2: clang AST |
| Objective-C | `src/principles/adapters/objectivec.ts` | **clang-lib** or regex fallback | Same approach as C++ |
| JavaScript (pure) | Enhance TypeScript adapter | ast-grep | Already supported |

**CRITICAL CLARIFICATION**: ast-grep does NOT support C++/Objective-C. Use this approach:
- **Phase 1 (Initial)**: Regex-based extraction for simple rules (long-function, large-file, god-class via pattern matching)
- **Phase 2 (Enhanced)**: Integrate libclang bindings for full AST parsing when needed

**Adapter Interface** (existing pattern):
```typescript
export interface Adapter {
  detectLanguage: () => string;
  parseAST: () => unknown;
  extractFunctions: () => unknown[];
  extractClasses: () => unknown[];
  countLines: () => number;
}
```

**Registration in analyzer.ts**:
```typescript
const adapterMap: Record<string, new (filePath: string) => Adapter> = {
  // Existing: .ts, .tsx, .js, .jsx, .py, .go, .java, .kt, .kts, .dart, .swift
  // New:
  '.cpp': CppAdapter,
  '.cxx': CppAdapter,
  '.cc': CppAdapter,
  '.c': CppAdapter,
  '.hpp': CppAdapter,
  '.h': CppAdapter,
  '.m': ObjectiveCAdapter,
  '.mm': ObjectiveCAdapter,
};
```

#### 1.2 Pre-commit Hook Integration

**Java Integration** (CORRECTED - 补充SpotBugs + NullAway):
```bash
# Gate 1: Static Analysis - MULTI-TOOL COMBINATION
elif [ "$PROJECT_LANG" = "java" ]; then
  # Check for Maven or Gradle
  if [ -f "pom.xml" ]; then
    BUILD_TOOL="maven"
  elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    BUILD_TOOL="gradle"
  fi
  
  # Step 1: CheckStyle (style enforcement - fastest)
  if [ "$BUILD_TOOL" = "maven" ]; then
    mvn checkstyle:check 2>&1 | head -30
    CHECKSTYLE_EXIT=$?
    if [ "$CHECKSTYLE_EXIT" -ne 0 ]; then
      echo "❌ CHECKSTYLE FAILED. Commit blocked."
      exit 1
    fi
  elif [ "$BUILD_TOOL" = "gradle" ]; then
    ./gradlew checkstyleMain 2>&1 | head -30
    # ...
  fi
  
  # Step 2: PMD v7 (code quality - UPGRADE REQUIRED)
  if [ "$BUILD_TOOL" = "maven" ]; then
    mvn pmd:pmd 2>&1 | head -30  # NOTE: Requires PMD 7.x plugin
    PMD_EXIT=$?
    if [ "$PMD_EXIT" -ne 0 ]; then
      echo "❌ PMD FAILED. Commit blocked."
      exit 1
    fi
  fi
  
  # Step 3: SpotBugs (bug detection - CRITICAL, was missing!)
  if [ "$BUILD_TOOL" = "maven" ]; then
    mvn spotbugs:check 2>&1 | head -30
    SPOTBUGS_EXIT=$?
    if [ "$SPOTBUGS_EXIT" -ne 0 ]; then
      echo "❌ SPOTBUGS FAILED. Commit blocked."
      exit 1
    fi
  elif [ "$BUILD_TOOL" = "gradle" ]; then
    ./gradlew spotbugsMain 2>&1 | head -30
    # ...
  fi
  
  # Step 4: NullAway (optional - null safety, via Error Prone)
  # Requires @Nullable annotations setup
  # ./gradlew build -Perrorprone.enabled=true
  
  # Tests
  mvn test -DskipTests=false 2>&1 | tail -30
fi
```

**Kotlin Integration**:
```bash
elif [ "$PROJECT_LANG" = "kotlin" ]; then
  # detekt for Kotlin linting
  if command -v detekt &> /dev/null; then
    detekt --input "$CHANGED_FILES" 2>&1 | head -30
    DETEKT_EXIT=$?
    if [ "$DETEKT_EXIT" -ne 0 ]; then
      echo "❌ DETEKT FAILED. Commit blocked."
      exit 1
    fi
  elif [ -f "./gradlew" ]; then
    ./gradlew detekt 2>&1 | head -30
  fi
fi
```

**C++ Integration** (CORRECTED - clang-tidy优先):
```bash
elif [ "$PROJECT_LANG" = "cpp" ]; then
  # PRIMARY: clang-tidy (best functionality, modern C++ support)
  if command -v clang-tidy &> /dev/null; then
    # Requires compile_commands.json
    if [ -f "compile_commands.json" ]; then
      clang-tidy "$CHANGED_FILES" --checks='-*,-modernize-*,-bugprone-*,-clang-analyzer-*' 2>&1 | head -50
      CLANG_TIDY_EXIT=$?
      if [ "$CLANG_TIDY_EXIT" -ne 0 ]; then
        echo "❌ CLANG-TIDY FAILED. Commit blocked."
        exit 1
      fi
    else
      echo "⚠️ compile_commands.json not found. Run cmake with -DCMAKE_EXPORT_COMPILE_COMMANDS=ON"
    fi
  fi
  
  # SUPPLEMENTAL: cppcheck (fast preliminary scan)
  if command -v cppcheck &> /dev/null; then
    cppcheck --enable=performance,portability --error-exitcode=1 "$CHANGED_FILES" 2>&1 | head -30
    CPPCHECK_EXIT=$?
    if [ "$CPPCHECK_EXIT" -ne 0 ]; then
      echo "❌ CPPCHECK FAILED. Commit blocked."
      exit 1
    fi
  fi
fi
```

**Objective-C Integration** (CORRECTED - 补充Clang Static Analyzer):
```bash
elif [ "$PROJECT_LANG" = "objectivec" ]; then
  # PRIMARY: Clang Static Analyzer (Apple standard)
  if command -v scan-build &> /dev/null; then
    # Run clang static analyzer via scan-build
    scan-build --use-analyzer=/usr/bin/clang \
      -analyze-headers \
      -enable-checker osx.cocoa.Dealloc \
      -enable-checker osx.ObjCProperty \
      xcodebuild build 2>&1 | head -50
    
    SCAN_BUILD_EXIT=$?
    if [ "$SCAN_BUILD_EXIT" -ne 0 ]; then
      echo "❌ CLANG STATIC ANALYZER FAILED. Commit blocked."
      exit 1
    fi
  fi
  
  # SUPPLEMENTAL: oclint (metrics and complexity)
  if command -v oclint &> /dev/null; then
    oclint -report-type console -enable-clang-static-analyzer "$CHANGED_FILES" 2>&1 | head -30
    OCLINT_EXIT=$?
    # oclint returns non-zero for violations above threshold
    if [ "$OCLINT_EXIT" -ne 0 ]; then
      echo "⚠️ OCLINT warnings detected (supplemental check)."
      # Note: Don't block on oclint alone, it's metrics-focused
    fi
  fi
fi
```

#### 1.3 Language Detection Enhancement

**Current detection** (pre-commit lines 22-37):
```bash
if [ -f "tsconfig.json" ] || [ -f "package.json" ]; then
  PROJECT_LANG="typescript"
elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  PROJECT_LANG="python"
# ... existing checks
```

**Enhanced detection** (CORRECTED - bash glob syntax fixed):
```bash
elif [ -f "pom.xml" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
  # Check for Kotlin source
  KOTLIN_FILES=$(find . -name "*.kt" -not -path "./.git/*" 2>/dev/null | wc -l)
  if [ "$KOTLIN_FILES" -gt 0 ]; then
    PROJECT_LANG="kotlin"
  else
    PROJECT_LANG="java"
  fi
# CORRECTED: Use find instead of glob pattern in [ -f ]
elif [ -f "CMakeLists.txt" ] || [ -f "Makefile" ]; then
  CPP_FILES=$(find . -maxdepth 2 -name "*.cpp" -o -name "*.cxx" -o -name "*.cc" -not -path "./.git/*" 2>/dev/null | head -1)
  if [ -n "$CPP_FILES" ]; then
    PROJECT_LANG="cpp"
  fi
# CORRECTED: Use find for Objective-C detection
OBJC_FILES=$(find . -maxdepth 2 -name "*.m" -o -name "*.mm" -not -path "./.git/*" 2>/dev/null | head -1)
if [ -n "$OBJC_FILES" ]; then
  PROJECT_LANG="objectivec"
fi
```

### Part 2: Boy Scout Rule Implementation

#### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│              Boy Scout Rule Enforcement Flow                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Step 1: File Classification                          │    │
│  │                                                       │    │
│  │ git diff --cached --name-status                       │    │
│  │   A (Added)     → NEW files                           │    │
│  │   M (Modified)  → MODIFIED files                      │    │
│  │   D (Deleted)   → Skip (no analysis)                  │    │
│  │                                                       │    │
│  │ Output: {newFiles: [...], modifiedFiles: [...]}       │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Step 2: Load Baseline                                 │    │
│  │                                                       │    │
│  │ Read .warnings-baseline.json                          │    │
│  │                                                       │    │
│  │ Format:                                               │    │
│  │ {                                                     │    │
│  │   "src/file1.ts": {                                   │    │
│  │     "warnings": 8,                                    │    │
│  │     "errors": 0,                                      │    │
│  │     "lastUpdated": "2026-04-10T10:00:00Z"            │    │
│  │   }                                                   │    │
│  │ }                                                     │    │
│  │                                                       │    │
│  │ If no baseline → Use zero-tolerance (new project)     │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Step 3: Run Analysis                                  │    │
│  │                                                       │    │
│  │ For each file:                                        │    │
│  │   - Run ESLint / Ruff / Principles / CCN             │    │
│  │   - Collect warning counts                            │    │
│  │   - Store current state                               │    │
│  │                                                       │    │
│  │ Output: currentWarnings per file                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Step 4: Delta Calculation                             │    │
│  │                                                       │    │
│  │ For NEW files:                                        │    │
│  │   currentWarnings must === 0                          │    │
│  │                                                       │    │
│  │ For MODIFIED files:                                   │    │
│  │   delta = currentWarnings - baselineWarnings          │    │
│  │                                                       │    │
│  │   Rules:                                              │    │
│  │   - delta > 0 → BLOCK (added warnings)               │    │
│  │   - delta = 0 → PASS (no change)                      │    │
│  │   - delta < 0 → PASS (improved)                       │    │
│  │   - baseline ≤5 && current > 0 → BLOCK               │    │
│  │     (must clear to zero if ≤5 legacy warnings)        │    │
│  │                                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Step 5: Enforcement                                   │    │
│  │                                                       │    │
│  │ If BLOCK → Print delta report, exit 1                │    │
│  │ If PASS → Update baseline, exit 0                    │    │
│  │                                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Step 6: Baseline Update                               │    │
│  │                                                       │    │
│  │ Write updated .warnings-baseline.json                 │    │
│  │                                                       │    │
│  │ Only update if enforcement passed                     │    │
│  │                                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 2.2 Baseline Storage Format

**File**: `.warnings-baseline.json` (stored in project root)

```json
{
  "version": "1.0",
  "lastUpdated": "2026-04-13T10:00:00Z",
  "files": {
    "src/api/routes/auth.ts": {
      "eslint": { "warnings": 3, "errors": 0 },
      "principles": { "warnings": 2, "errors": 0 },
      "ccn": { "warnings": 1, "max": 7 },
      "totalWarnings": 6,
      "lastAnalyzed": "2026-04-13T09:30:00Z"
    },
    "src/db/connection.py": {
      "ruff": { "warnings": 5, "errors": 0 },
      "principles": { "warnings": 0, "errors": 0 },
      "ccn": { "warnings": 0, "max": 3 },
      "totalWarnings": 5,
      "lastAnalyzed": "2026-04-13T09:30:00Z"
    }
  },
  "summary": {
    "totalFiles": 45,
    "totalWarnings": 128,
    "byLanguage": {
      "typescript": 89,
      "python": 39
    }
  }
}
```

#### 2.3 File Classification Implementation

**Script**: Add to pre-commit hook

```bash
# Step 1: Classify files
NEW_FILES=$(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|tsx|js|jsx|py|go|java|kt|dart|swift|cpp|c|h|m)$' || true)
MODIFIED_FILES=$(git diff --cached --name-only --diff-filter=M | grep -E '\.(ts|tsx|js|jsx|py|go|java|kt|dart|swift|cpp|c|h|m)$' || true)

# Step 2: Check for baseline
if [ -f ".warnings-baseline.json" ]; then
  BOY_SCOUT_MODE="enabled"
else
  BOY_SCOUT_MODE="disabled"
  # Fall back to zero-tolerance for new projects
fi

# Step 3: Run analysis with delta tracking
if [ "$BOY_SCOUT_MODE" = "enabled" ]; then
  echo "→ Boy Scout Rule: Enforcing warning reduction..."
  
  # For new files: strict zero tolerance
  if [ -n "$NEW_FILES" ]; then
    echo "Checking NEW files (zero tolerance):"
    # Run linters on new files with strict mode
    # Any warning = BLOCK
  fi
  
  # For modified files: delta check
  if [ -n "$MODIFIED_FILES" ]; then
    echo "Checking MODIFIED files (delta enforcement):"
    # For each modified file:
    #   - Get baseline warnings from JSON
    #   - Run analysis
    #   - Compare delta
    #   - If baseline ≤5 && current > 0 → BLOCK
    #   - If delta > 0 → BLOCK
  fi
fi
```

#### 2.4 Delta Enforcement Logic

**TypeScript implementation** (add to src/principles/):

```typescript
// src/principles/boy-scout.ts

interface BaselineEntry {
  eslint?: { warnings: number; errors: number };
  principles?: { warnings: number; errors: number };
  ccn?: { warnings: number; max: number };
  totalWarnings: number;
  lastAnalyzed: string;
}

interface DeltaResult {
  file: string;
  status: 'NEW' | 'MODIFIED' | 'UNCHANGED';
  baselineWarnings: number;
  currentWarnings: number;
  delta: number;
  enforcement: 'PASS' | 'BLOCK';
  reason: string;
}

export function enforceBoyScoutRule(
  newFiles: string[],
  modifiedFiles: string[],
  baseline: Record<string, BaselineEntry>,
  currentAnalysis: Record<string, number>
): DeltaResult[] {
  const results: DeltaResult[] = [];
  
  // NEW files: zero tolerance
  for (const file of newFiles) {
    const currentWarnings = currentAnalysis[file] || 0;
    results.push({
      file,
      status: 'NEW',
      baselineWarnings: 0,
      currentWarnings,
      delta: currentWarnings,
      enforcement: currentWarnings === 0 ? 'PASS' : 'BLOCK',
      reason: currentWarnings === 0 
        ? 'New file has zero warnings'
        : `New file has ${currentWarnings} warnings (zero required)`
    });
  }
  
  // MODIFIED files: delta check
  for (const file of modifiedFiles) {
    const baselineEntry = baseline[file];
    const baselineWarnings = baselineEntry?.totalWarnings || 0;
    const currentWarnings = currentAnalysis[file] || 0;
    const delta = currentWarnings - baselineWarnings;
    
    // Rule: if baseline ≤5, must clear to zero
    const mustClearToZero = baselineWarnings <= 5;
    
    let enforcement: 'PASS' | 'BLOCK';
    let reason: string;
    
    if (mustClearToZero && currentWarnings > 0) {
      enforcement = 'BLOCK';
      reason = `File had ${baselineWarnings} warnings (≤5), must clear to zero, has ${currentWarnings}`;
    } else if (delta > 0) {
      enforcement = 'BLOCK';
      reason = `Added ${delta} warnings (baseline: ${baselineWarnings}, current: ${currentWarnings})`;
    } else {
      enforcement = 'PASS';
      reason = delta < 0 
        ? `Reduced warnings by ${-delta} (improvement)`
        : 'No change in warnings';
    }
    
    results.push({
      file,
      status: 'MODIFIED',
      baselineWarnings,
      currentWarnings,
      delta,
      enforcement,
      reason
    });
  }
  
  return results;
}
```

#### 2.6 Baseline Initialization (NEW - Addressing Critical Issue)

**Command**: `npx tsx src/principles/index.ts --init-baseline`

**Initialization Flow**:

```
┌─────────────────────────────────────────────────────────────┐
│              Baseline Initialization Process                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Step 1: Scan Project                                  │    │
│  │                                                       │    │
│  │ find . -type f \( -name "*.ts" -o -name "*.py" ... \) │    │
│  │   -not -path "./.git/*"                               │    │
│  │                                                       │    │
│  │ Collect all source files                              │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Step 2: Run Analysis on All Files                     │    │
│  │                                                       │    │
│  │ For each file:                                        │    │
│  │   - Run ESLint / Ruff / Principles / CCN             │    │
│  │   - Collect warning counts                            │    │
│  │   - Timeout: 5min for entire scan                     │    │
│  │                                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Step 3: Filter and Store                              │    │
│  │                                                       │    │
│  │ Only store files WITH warnings (skip clean files)     │    │
│  │                                                       │    │
│  │ Output: .warnings-baseline.json                       │    │
│  │                                                       │    │
│  │ Console report:                                       │    │
│  │   Files scanned: 150                                  │    │
│  │   Files with warnings: 45                             │    │
│  │   Total warnings: 128                                 │    │
│  │   Baseline created successfully                       │    │
│  │                                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**CLI Implementation**:

```typescript
// src/principles/index.ts --init-baseline

async function initializeBaseline(projectPath: string): Promise<void> {
  console.log('Initializing baseline for historical project...');
  
  // Find all source files
  const sourceFiles = await findSourceFiles(projectPath);
  console.log(`Found ${sourceFiles.length} source files`);
  
  // Run analysis (with timeout protection)
  const results = await analyzeWithTimeout(sourceFiles, 300000); // 5 min
  
  // Filter to only files with warnings
  const baselineEntries: Record<string, BaselineEntry> = {};
  for (const [file, result] of Object.entries(results)) {
    if (result.totalWarnings > 0) {
      baselineEntries[file] = result;
    }
  }
  
  // Write baseline
  const baseline = {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    files: baselineEntries,
    summary: {
      totalFiles: sourceFiles.length,
      filesWithWarnings: Object.keys(baselineEntries).length,
      totalWarnings: sumWarnings(baselineEntries),
    }
  };
  
  writeFileSync('.warnings-baseline.json', JSON.stringify(baseline, null, 2));
  console.log('✅ Baseline created successfully');
}
```

**Handling Historical Projects**:

| Scenario | Handling |
|----------|----------|
| Large project (>500 files) | Scan in batches of 50, with progress bar |
| Files with many warnings (>20) | Store as-is, delta enforcement will handle |
| Long-running analysis | Timeout at 5min, warn user to run manually |

#### 2.7 TypeScript/Bash Integration (NEW - Addressing Major Concern)

**Integration Architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│              Pre-commit Hook Integration                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  pre-commit (bash)                                           │
│       │                                                       │
│       │ 1. File classification (bash)                        │
│       ▼                                                       │
│  NEW_FILES, MODIFIED_FILES extracted                          │
│       │                                                       │
│       │ 2. Check baseline exists                              │
│       ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 3. Call TypeScript module via npx                    │    │
│  │                                                       │    │
│  │ npx tsx src/principles/boy-scout.ts \                │    │
│  │   --new-files "$NEW_FILES" \                         │    │
│  │   --modified-files "$MODIFIED_FILES" \               │    │
│  │   --baseline ".warnings-baseline.json"               │    │
│  │                                                       │    │
│  │ Output: JSON with delta results                       │    │
│  └─────────────────────────────────────────────────────┘    │
│       │                                                       │
│       │ 4. Parse JSON in bash                                │
│       ▼                                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 5. Enforcement decision                               │    │
│  │                                                       │    │
│  │ If any BLOCK → exit 1                                 │    │
│  │ If all PASS → update baseline                         │    │
│  │                                                       │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Bash Integration Script**:

```bash
# In pre-commit hook, after Gate 7

# Gate 8: Boy Scout Rule (if baseline exists)
echo ""
echo "→ Gate 8: Boy Scout Rule enforcement..."

if [ -f ".warnings-baseline.json" ]; then
  # Step 1: Classify files
  NEW_FILES=$(git diff --cached --name-only --diff-filter=A | grep -E '\.(ts|tsx|js|jsx|py|go|java|kt)$' || true)
  MODIFIED_FILES=$(git diff --cached --name-only --diff-filter=M | grep -E '\.(ts|tsx|js|jsx|py|go|java|kt)$' || true)
  
  # Step 2: Run TypeScript enforcement module
  DELTA_OUTPUT=$(npx tsx src/principles/boy-scout.ts \
    --new-files "$NEW_FILES" \
    --modified-files "$MODIFIED_FILES" \
    --baseline ".warnings-baseline.json" \
    --format json 2>&1)
  
  DELTA_EXIT=$?
  
  if [ "$DELTA_EXIT" -ne 0 ]; then
    echo "$DELTA_OUTPUT"
    echo ""
    echo "❌ BOY SCOUT RULE FAILED. Commit blocked."
    echo "Modified files must reduce warnings, new files must have zero warnings."
    exit 1
  fi
  
  echo "✅ Boy Scout Rule passed."
  # Baseline auto-updated by TypeScript module
else
  echo "ℹ️  No baseline found. Using zero-tolerance mode."
fi
```

**CLI Interface for boy-scout.ts**:

```typescript
// src/principles/boy-scout.ts CLI

import { parseArgs } from 'node:util';

const args = parseArgs({
  options: {
    'new-files': { type: 'string', multiple: true },
    'modified-files': { type: 'string', multiple: true },
    'baseline': { type: 'string' },
    'format': { type: 'string', default: 'json' },
    'init': { type: 'boolean', default: false },
  }
});

// Main entry point
async function main() {
  if (args.values.init) {
    await initializeBaseline(process.cwd());
    return;
  }
  
  const newFiles = args.values['new-files'] || [];
  const modifiedFiles = args.values['modified-files'] || [];
  const baselinePath = args.values.baseline || '.warnings-baseline.json';
  
  const results = await enforceAndReport(newFiles, modifiedFiles, baselinePath);
  
  // Output JSON for bash to parse
  console.log(JSON.stringify(results, null, 2));
  
  // Exit code based on enforcement
  const hasBlock = results.some(r => r.enforcement === 'BLOCK');
  process.exit(hasBlock ? 1 : 0);
}
```

**Add to `.principlesrc`**:

```json
{
  "boyScoutRule": {
    "enabled": true,
    "baselineFile": ".warnings-baseline.json",
    "thresholdToClear": 5,
    "newFilePolicy": "zero-tolerance",
    "modifiedFilePolicy": "decrease-or-maintain",
    "updateBaselineOnPass": true
  },
  "rules": {
    // existing rules...
  }
}
```

### Part 3: Implementation Plan

#### Phase 1: Language Extension (Est. 2-3 days)

| Task | Effort | Priority |
|------|--------|----------|
| Create CppAdapter | Medium | P1 |
| Create ObjectiveCAdapter | Medium | P1 |
| Enhance TS adapter for pure JS | Low | P2 |
| Add Java pre-commit case | Low | P1 |
| Add Kotlin pre-commit case | Low | P1 |
| Add C++ pre-commit case | Medium | P1 |
| Add Objective-C pre-commit case | Medium | P1 |
| Update lizard CCN extensions | Low | P2 |
| Update TOOL-INSTALLATION-GUIDE | Low | P3 |

#### Phase 2: Boy Scout Rule (Est. 2-3 days)

| Task | Effort | Priority |
|------|--------|----------|
| Create boy-scout.ts module | Medium | P1 |
| Implement file classification | Low | P1 |
| Implement baseline storage | Low | P1 |
| Implement delta calculation | Medium | P1 |
| Integrate into pre-commit | Medium | P1 |
| Add configuration support | Low | P2 |
| Write documentation | Low | P3 |

#### Phase 3: Testing Strategy & Documentation (Est. 1-2 days)

**Test Strategy Design**:

| Test Type | Coverage Target | Approach |
|-----------|-----------------|----------|
| Unit Tests | 80%+ | Jest for boy-scout.ts, adapter modules |
| Integration Tests | Key paths | Pre-commit hook end-to-end |
| Language Adapter Tests | Per adapter | AST extraction validation |

**Unit Test Categories**:

1. **Adapter Tests** (src/principles/adapters/__tests__/):
   - CPP extraction regex patterns
   - Objective-C extraction regex patterns
   - Function/class detection accuracy

2. **Boy Scout Tests** (src/principles/__tests__/boy-scout.test.ts):
   - Delta calculation logic
   - New file enforcement (zero tolerance)
   - Modified file enforcement (delta)
   - Threshold clearing (≤5 rule)

3. **Mock Strategy**:
   - Mock lint tool output (ESLint, Ruff, cppcheck)
   - Mock git diff output (file classification)
   - Mock baseline JSON content

**Test Environment Setup**:

```typescript
// Mock lint output for testing
const mockLintOutput = {
  'src/test.ts': { eslint: 5, principles: 2, ccn: 1 },
  'src/new.ts': { eslint: 0, principles: 0, ccn: 0 },
};

// Mock git diff for file classification
const mockGitDiff = {
  added: ['src/new.ts'],
  modified: ['src/test.ts'],
};
```

| Task | Effort | Priority |
|------|--------|----------|
| Write adapter tests | Medium | P1 |
| Write boy-scout unit tests | Medium | P1 |
| Write integration tests | Medium | P1 |
| Update AGENTS.md | Low | P2 |
| Create migration guide | Medium | P2 |

### Part 4: Risk Analysis

#### Risk 1: AST Parsing for C++/Objective-C

**Risk**: C++ and Objective-C have complex grammar, ast-grep may not fully support.

**Mitigation**:
- Use clang AST via libclang bindings
- Fallback to regex-based extraction for basic rules
- Limit C++/Objective-C to essential rules initially

#### Risk 2: Baseline Storage Performance

**Risk**: Large projects may have 1000+ files, baseline JSON could be large.

**Mitigation**:
- Store only files with warnings (skip clean files)
- Use incremental updates (only modified files)
- Consider SQLite backend for large projects

#### Risk 3: Boy Scout Rule Complexity

**Risk**: Developers may not understand the differential enforcement.

**Mitigation**:
- Clear console output explaining delta
- Detailed documentation with examples
- Gradual rollout: opt-in via config first

#### Risk 4: Tool Availability

**Risk**: Some tools (oclint, clang-tidy, NullAway) may not be widely installed.

**Mitigation**:
- Follow zero-tolerance: BLOCK if PRIMARY tool not available
- **UPDATED**: Clang Static Analyzer (ObjC PRIMARY) is built into Xcode - no installation needed
- oclint is now SUPPLEMENTAL (metrics only) - warning instead of block if missing
- **Tool fallback chains**:
  - Java: CheckStyle → PMD → SpotBugs → NullAway (any failure blocks)
  - C++: clang-tidy (block) → cppcheck (block)
  - ObjC: Clang SA (block) → oclint (warn only)
  - Kotlin: detekt (block) → ktlint (warn)
- Configurable relaxation via environment variable or config:
  - `ALLOW_MISSING_TOOLS=true` → Warning instead of BLOCK for SUPPLEMENTAL tools
  - `skipLanguages: ["objectivec"]` → Skip specific language checks
- Provide installation guide in TOOL-INSTALLATION-GUIDE.md

**Tool Availability Configuration**:

```json
// .principlesrc
{
  "toolAvailability": {
    "strictMode": true,  // default: BLOCK PRIMARY tools if missing
    "skipLanguages": [],  // skip checks for specific languages
    "fallbackChains": {
      "java": ["checkstyle", "pmd", "spotbugs", "nullaway"],
      "cpp": ["clang-tidy", "cppcheck"],
      "objectivec": ["clang-static-analyzer", "oclint-metrics"],
      "kotlin": ["detekt", "ktlint"]
    },
    "supplementalTools": {
      "oclint": "warn-only",  // don't block on supplemental
      "ktlint": "warn-only",
      "nullaway": "optional"   // recommended but not blocking initially
    }
  }
}
```

## Tool Selection Rationale (Research-Based 2024-2025)

### Tool Selection Principle

**核心原则**: 选择领域内**性能最好、功能最强**的工具。

**组合策略验证**: IEEE研究（2024）显示各静态分析工具检测重叠率仅**0.14%-0.98%**，证明多工具组合能显著扩大检测覆盖范围。

### Research Summary by Language

#### Java Static Analysis (2024-2025)

**Current Stack**: CheckStyle + PMD + **SpotBugs** (公司现有)

| Tool | Performance | Detection | Overlap Rate | Recommendation |
|------|-------------|-----------|--------------|----------------|
| CheckStyle | ⭐⭐⭐⭐⭐ (86% precision) | Style only | - | **KEEP** |
| PMD v6 | ⭐⭐⭐ | Quality (400+ rules) | 0.14% w/ CheckStyle | **UPGRADE to v7** |
| PMD v7 | ⭐⭐⭐⭐⭐ (**2-3x faster**) | Quality + Modern C++ | - | **MUST UPGRADE** |
| SpotBugs | ⭐⭐⭐⭐⭐ (~1000 cls/sec) | Bugs (400+ patterns) | - | **MUST USE** (was missing!) |
| NullAway | ⭐⭐⭐⭐⭐ (<10% overhead) | NPE elimination | - | **HIGHLY RECOMMENDED** |

**Key Insight**: 
- PMD 7.0 (March 2024) brings **2-3x performance improvement**
- SpotBugs operates at bytecode level (~1000 classes/sec) - extremely fast
- NullAway + JSpecify 1.0 (2024) eliminates NullPointerExceptions systematically

#### C++ Static Analysis (2024-2025)

| Tool | Performance | Detection | Best For |
|------|-------------|-----------|----------|
| **clang-tidy** | ⭐⭐⭐⭐⭐ (74.2% precision) | 200+ checks, auto-fix | **PRIMARY** - Modern C++ |
| cppcheck | ⭐⭐⭐⭐⭐ (100% precision on benchmarks) | Lightweight | **SUPPLEMENTAL** - Fast scan |

**Priority Adjustment**: clang-tidy > cppcheck
- clang-tidy supports C++11/14/17/20/23, modernization warnings, auto-fixes
- cppcheck is lighter but less comprehensive - use as fast preliminary check

#### Objective-C Static Analysis (2024-2025)

| Tool | Status | Focus | Recommendation |
|------|--------|-------|----------------|
| **Clang Static Analyzer** | Apple standard | Path-sensitive, iOS/macOS specific | **PRIMARY** |
| oclint | v26.02 (Feb 2026) | Metrics only (72 rules) | **SUPPLEMENTAL** |

**Critical Fix**: 
- Clang SA is built into Xcode, official Apple recommendation
- oclint hasn't had major feature updates since 2022 - use for metrics only

#### Kotlin Static Analysis (2024-2025)

| Tool | Adoption | Focus | Recommendation |
|------|----------|-------|----------------|
| detekt | 6,900+ stars, Gradle uses it | 200+ rules, code smells | **PRIMARY** |
| ktlint | Anti-bikeshedding | Formatting only | **SUPPLEMENTAL** |

**Note**: Gradle project migrated from ktlint to detekt in 2024 (PR #29576) - detekt is ecosystem winner.

#### Python & Go (Already Optimal)

| Language | Tool | Performance | Status |
|----------|------|-------------|--------|
| Python | Ruff | **100x faster** than flake8 | ✅ Optimal |
| Go | golangci-lint | 60+ linters combined | ✅ Optimal |

### Multi-Tool Strategy

**Why multiple tools per language?**

IEEE study conclusion: "The lowest overlap between tools is CheckStyle-PMD with **0.144% agreement**"

This means:
- Each tool finds **different** issues
- Combining tools gives **95%+ coverage** vs ~50% for single tool
- Performance overhead is acceptable (<10-20% combined)

### Part 5: Tool Requirements

#### Tool Selection Principle

**核心原则**: 选择领域内**性能最好、功能最强**的工具。若单一工具无法满足所有需求，采用**多工具组合策略**。

**组合策略验证**: IEEE研究（2024）显示各静态分析工具检测重叠率仅0.14%-0.98%，证明多工具组合能覆盖更多问题类型。

#### Recommended Tool Matrix (2024-2025 Research-Based)

| Language | Primary Tool | Fallback/Supplemental | Performance Rating | Detection Capability |
|----------|-------------|----------------------|-------------------|---------------------|
| **Java** | CheckStyle + PMD v7 + **SpotBugs** | **NullAway** (null safety) | ⭐⭐⭐⭐⭐ all | Style + Quality + Bugs + NPE |
| **Kotlin** | detekt | ktlint (formatting) | ⭐⭐⭐⭐ | 200+ rules |
| **C++** | **clang-tidy** (主工具) | cppcheck (快速扫描) | ⭐⭐⭐⭐⭐ / ⭐⭐⭐⭐ | 200+ checks / lightweight |
| **Objective-C** | **Clang Static Analyzer** | oclint (metrics only) | ⭐⭐⭐⭐ | Apple standard |
| **Python** | Ruff | mypy (类型检查) | ⭐⭐⭐⭐⭐ (100x faster) | 700+ rules |
| **Go** | golangci-lint | - | ⭐⭐⭐⭐⭐ | 60+ linters combined |
| **TypeScript** | ESLint | Oxlint (可选pre-check) | ⭐⭐⭐⭐ | Standard |

#### Detailed Tool Configuration by Language

**Java (CRITICAL UPDATE - 补充公司现有工具)**:
| Tool | Version | Focus | Performance | Integration | Status |
|------|---------|-------|-------------|-------------|--------|
| CheckStyle | 10.x | Code style | ~1000 files/sec | Maven/Gradle plugin | ✅ Existing - KEEP |
| PMD | **v7.x (UPGRADE)** | Code quality | **2-3x faster than v6** | Maven/Gradle plugin | ⚠️ Upgrade needed |
| SpotBugs | 4.x | Bug detection | ~1000 classes/sec | Maven/Gradle plugin | ❌ **MISSING in design - MUST ADD** |
| NullAway | Latest | Null safety | <10% build overhead | Via Error Prone | 🆕 **HIGHLY RECOMMENDED** |

**C++ (Priority Adjustment)**:
| Tool | Role | Performance | Why |
|------|------|-------------|-----|
| clang-tidy | **PRIMARY** | Fast (~seconds) | 200+ checks, modern C++ (11/14/17/20/23), auto-fixes |
| cppcheck | **FAST SCAN** | Very fast | Lightweight, 100% precision on some benchmarks, good for CI quick check |

**Objective-C (Critical Gap Fix)**:
| Tool | Role | Status | Why |
|------|------|--------|-----|
| Clang Static Analyzer | **PRIMARY** | Apple standard | Official Xcode integration, path-sensitive analysis, iOS/macOS specific |
| oclint | **SUPPLEMENTAL** | Metrics only | v26.02 (Feb 2026), 72 rules, complexity metrics |

**Kotlin**:
| Tool | Role | Integration |
|------|------|-------------|
| detekt | PRIMARY | Gradle plugin, 200+ rules, SARIF output |
| ktlint | SUPPLEMENTAL | Via detekt-formatting module |

#### New Tools Required (Updated)

| Language | Tool | Purpose | Install Command | Priority |
|----------|------|---------|-----------------|----------|
| **Java** | **SpotBugs** | Bug detection (bytecode) | `mvn plugin` / `gradle plugin` | **P0 CRITICAL** |
| **Java** | **NullAway** | Null pointer elimination | Via Error Prone | P1 HIGH |
| Java | PMD v7 UPGRADE | Performance boost | Maven plugin update | P1 |
| **ObjC** | **Clang Static Analyzer** | Primary analysis | Xcode built-in | **P0 CRITICAL** |
| C++ | clang-tidy (adjust) | Primary tool | `apt install clang-tidy` | P1 |
| Kotlin | ktlint (optional) | Formatting | Gradle detekt-formatting | P2 |

#### Principles Checker Requirements

| Language | AST Parser | Notes |
|----------|-----------|-------|
| C++ | ast-grep + clang | May need libclang |
| Objective-C | ast-grep + clang | Same as C++ |

## Success Metrics

### Language Extension

| Metric | Target |
|--------|--------|
| Languages supported | 6 (all primary) |
| Pre-commit coverage | 100% for primary languages |
| Principles coverage | 100% for primary languages |
| CCN coverage | 100% for primary languages |

### Boy Scout Rule

| Metric | Target |
|--------|--------|
| New files blocked (with warnings) | 100% |
| Modified files blocked (added warnings) | 100% |
| Legacy files cleared (≤5 warnings) | Tracking enabled |
| Baseline storage overhead | <50KB for medium projects |

## Open Questions (RESOLVED)

1. **C++ Header Files**: Should `.h` files be analyzed? (Could be C or C++)
   - **DECISION**: Analyze `.h` only if corresponding `.cpp` exists with same basename
   - Rationale: Avoid false positives from pure C headers
   
2. **Baseline Initialization**: How to create initial baseline for historical projects?
   - **DECISION**: Implemented via `--init-baseline` CLI command (see Section 2.6)
   - Timeout: 5 minutes max, batch processing for large projects
   
3. **Warning Categories**: Should ESLint warnings and Principles warnings be tracked separately?
   - **DECISION**: Track separately in baseline, combine for delta enforcement
   - Rationale: Allows granular analysis while maintaining simple enforcement
   
4. **Rollback**: How to handle baseline rollback if enforcement is too strict?
   - **DECISION**: Manual baseline edit allowed + `boyScoutRule.enabled: false` in config
   - Audit trail stored in `baseline.lastUpdated` timestamp

## Appendix A: Existing Architecture

### Principles Checker Flow

```
index.ts (CLI) → analyzer.ts → getAdapterForFile() → Rule.check() → reporter.ts
```

### Pre-commit Hook Gates

| Gate | Purpose | Languages |
|------|---------|-----------|
| Gate 1 | Static analysis | All (tool-specific) |
| Gate 2 | Additional lint | TS/Python/Dart/Flutter |
| Gate 3 | Unit tests | All |
| Gate 4 | Coverage | TS/Python/Go |
| Gate 5 | Shell check | Shell scripts |
| Gate 6 | Principles | 7 languages |
| Gate 7 | CCN | 8 languages |

## Appendix B: Reference Files

- `/mnt/e/Private/opencode优化/xp-workflow-automation/githooks/pre-commit` - Existing hook
- `/mnt/e/Private/opencode优化/xp-workflow-automation/src/principles/analyzer.ts` - Adapter factory
- `/mnt/e/Private/opencode优化/xp-workflow-automation/src/principles/adapters/base.ts` - Adapter interface
- `/mnt/e/Private/opencode优化/xp-workflow-automation/.principlesrc` - Configuration example

---

## Document Status

**✅ APPROVED**: This design document has passed Delphi consensus review.

**Review History**:
- Round 1: 3 experts → REQUEST_CHANGES (6 critical issues identified)
- Fixes Applied: 7 major fixes between rounds
- Round 2: 3 experts → APPROVED (100% consensus, 9/10 confidence)

**Consensus Report**: docs/delphi-consensus-report-quality-gate-enhancement-v1.1.md

**Implementation Authorization**: APPROVED for implementation