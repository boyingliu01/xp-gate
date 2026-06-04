# 对齐验证算法

## 核心原则

**使用确定性算法验证对齐，不依赖 LLM 语义理解。**

---

## 算法实现

### Step 1: 解析 Specification

```typescript
interface SpecificationMap {
  requirements: Requirement[];
  designDecisions: DesignDecision[];
  apiContracts: ApiContract[];
}

interface Requirement {
  id: string;                    // REQ-AUTH-001
  description: string;
  acceptanceCriteria: string[];  // ["AC-AUTH-001-01", "AC-AUTH-001-02"]
  edgeCases: string[];
  securityConsiderations: string[];
}

function parseSpecification(specPath: string): SpecificationMap {
  // 使用 YAML parser，不依赖 LLM
  const content = fs.readFileSync(specPath, 'utf-8');
  const spec = yaml.parse(content);
  
  return {
    requirements: spec.requirements.map(r => ({
      id: r.id,
      description: r.description,
      acceptanceCriteria: r.acceptance_criteria?.map(ac => ac.id) || [],
      edgeCases: r.edge_cases || [],
      securityConsiderations: r.security_considerations || []
    })),
    designDecisions: spec.design_decisions?.map(d => d.id) || [],
    apiContracts: spec.api_contracts?.map(a => a.endpoint) || []
  };
}
```

---

### Step 2: 解析测试文件

```typescript
interface TestMap {
  tests: TestCase[];
  totalTests: number;
  totalAssertions: number;
}

interface TestCase {
  name: string;
  file: string;
  requirementId: string | null;   // 从 @test 标签提取
  intent: string | null;           // 从 @intent 标签提取
  covers: string[];                // 从 @covers 标签提取
  edgeCases: string[];             // 从 @edge_cases 标签提取
  assertions: number;              // 断言数量
}

function parseTestFiles(testPaths: string[]): TestMap {
  const tests: TestCase[] = [];
  let totalAssertions = 0;
  
  for (const path of testPaths) {
    const content = fs.readFileSync(path, 'utf-8');
    
    // 根据文件类型选择解析器
    if (path.endsWith('.ts') || path.endsWith('.js')) {
      const result = parseTypeScriptTests(content, path);
      tests.push(...result.tests);
      totalAssertions += result.assertions;
    } else if (path.endsWith('.py')) {
      const result = parsePythonTests(content, path);
      tests.push(...result.tests);
      totalAssertions += result.assertions;
    } else if (path.endsWith('.go')) {
      const result = parseGoTests(content, path);
      tests.push(...result.tests);
      totalAssertions += result.assertions;
    }
  }
  
  return { tests, totalTests: tests.length, totalAssertions };
}

// TypeScript/JavaScript 解析
function parseTypeScriptTests(content: string, filePath: string): { tests: TestCase[], assertions: number } {
  const tests: TestCase[] = [];
  let totalAssertions = 0;
  
  // 使用正则提取 JSDoc 注释和测试函数
  const testPattern = /\/\*\*([\s\S]*?)\*\/\s*(test|it|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  
  let match;
  while ((match = testPattern.exec(content)) !== null) {
    const jsdoc = match[1];
    const testName = match[3];
    
    // 提取标签
    const requirementId = extractTag(jsdoc, '@test');
    const intent = extractTag(jsdoc, '@intent');
    const covers = extractAllTags(jsdoc, '@covers');
    const edgeCases = extractAllTags(jsdoc, '@edge_cases');
    
    // 计算断言数量 (expect, assert, should)
    const testBody = extractTestBody(content, match.index);
    const assertions = countAssertions(testBody);
    totalAssertions += assertions;
    
    tests.push({
      name: testName,
      file: filePath,
      requirementId,
      intent,
      covers,
      edgeCases,
      assertions
    });
  }
  
  return { tests, assertions: totalAssertions };
}

// Python 解析
function parsePythonTests(content: string, filePath: string): { tests: TestCase[], assertions: number } {
  const tests: TestCase[] = [];
  let totalAssertions = 0;
  
  // 提取注释和测试函数
  const testPattern = /(# @test\s+(\S+)[\s\S]*?)def\s+(test_\w+)/g;
  
  let match;
  while ((match = testPattern.exec(content)) !== null) {
    const comments = match[1];
    const testName = match[3];
    
    const requirementId = extractTagFromComment(comments, '@test');
    const intent = extractTagFromComment(comments, '@intent');
    const covers = extractAllTagsFromComment(comments, '@covers');
    const edgeCases = extractAllTagsFromComment(comments, '@edge_cases');
    
    // 计算 assert 语句数量
    const testBody = extractPythonFunctionBody(content, match.index);
    const assertions = (testBody.match(/\bassert\b/g) || []).length;
    totalAssertions += assertions;
    
    tests.push({
      name: testName,
      file: filePath,
      requirementId,
      intent,
      covers,
      edgeCases,
      assertions
    });
  }
  
  return { tests, assertions: totalAssertions };
}

// Go 解析
function parseGoTests(content: string, filePath: string): { tests: TestCase[], assertions: number } {
  const tests: TestCase[] = [];
  let totalAssertions = 0;
  
  // 提取注释和测试函数
  const testPattern = /(\/\/ @test\s+(\S+)[\s\S]*?)func\s+(Test_\w+)/g;
  
  let match;
  while ((match = testPattern.exec(content)) !== null) {
    const comments = match[1];
    const testName = match[3];
    
    const requirementId = extractTagFromGoComment(comments, '@test');
    const intent = extractTagFromGoComment(comments, '@intent');
    const covers = extractAllTagsFromGoComment(comments, '@covers');
    const edgeCases = extractAllTagsFromGoComment(comments, '@edge_cases');
    
    // 计算 assert/t.Require 数量
    const testBody = extractGoFunctionBody(content, match.index);
    const assertions = (testBody.match(/\bassert\.|t\.Require|t\.Error/g) || []).length;
    totalAssertions += assertions;
    
    tests.push({
      name: testName,
      file: filePath,
      requirementId,
      intent,
      covers,
      edgeCases,
      assertions
    });
  }
  
  return { tests, assertions: totalAssertions };
}
```

---

### Step 3: 对齐验证

```typescript
interface AlignmentReport {
  score: number;
  issues: AlignmentIssue[];
  coverage: CoverageReport;
  passed: boolean;
}

interface AlignmentIssue {
  type: 'MISSING_TEST' | 'MISSING_AC_COVERAGE' | 'MISSING_EDGE_CASE' 
      | 'MISSING_INTENT' | 'INCORRECT_INTENT' | 'LOW_ASSERTIONS';
  severity: 'Critical' | 'Major' | 'Minor';
  requirementId?: string;
  acId?: string;
  testId?: string;
  message: string;
}

interface CoverageReport {
  requirementsCovered: number;
  requirementsTotal: number;
  acCovered: number;
  acTotal: number;
  edgeCasesCovered: number;
  edgeCasesTotal: number;
  testsWithIntent: number;
  testsTotal: number;
}

function verifyAlignment(
  specMap: SpecificationMap, 
  testMap: TestMap
): AlignmentReport {
  const issues: AlignmentIssue[] = [];
  const coverage: CoverageReport = {
    requirementsCovered: 0,
    requirementsTotal: specMap.requirements.length,
    acCovered: 0,
    acTotal: 0,
    edgeCasesCovered: 0,
    edgeCasesTotal: 0,
    testsWithIntent: 0,
    testsTotal: testMap.totalTests
  };
  
  // 规则 1: 每个 requirement 必须有测试
  for (const req of specMap.requirements) {
    const hasTest = testMap.tests.some(t => t.requirementId === req.id);
    if (!hasTest) {
      issues.push({
        type: 'MISSING_TEST',
        severity: 'Critical',
        requirementId: req.id,
        message: `Requirement ${req.id} 没有对应的测试`
      });
    } else {
      coverage.requirementsCovered++;
    }
    
    // 规则 2: 每个 AC 必须有断言覆盖
    for (const acId of req.acceptanceCriteria) {
      coverage.acTotal++;
      const hasCoverage = testMap.tests.some(t => t.covers.includes(acId));
      if (!hasCoverage) {
        issues.push({
          type: 'MISSING_AC_COVERAGE',
          severity: 'Major',
          requirementId: req.id,
          acId,
          message: `Acceptance Criteria ${acId} 没有被测试覆盖`
        });
      } else {
        coverage.acCovered++;
      }
    }
    
    // 规则 3: 每个 edge case 应该有测试
    for (const edgeCase of req.edgeCases) {
      coverage.edgeCasesTotal++;
      const hasTest = testMap.tests.some(t => t.edgeCases.includes(edgeCase));
      if (!hasTest) {
        issues.push({
          type: 'MISSING_EDGE_CASE',
          severity: 'Minor',
          requirementId: req.id,
          message: `Edge case "${edgeCase}" 没有对应的测试`
        });
      } else {
        coverage.edgeCasesCovered++;
      }
    }
  }
  
  // 规则 4: 每个测试必须有意图声明
  for (const test of testMap.tests) {
    if (!test.intent) {
      issues.push({
        type: 'MISSING_INTENT',
        severity: 'Major',
        testId: test.name,
        message: `Test ${test.name} 缺少 @intent 声明`
      });
    } else {
      coverage.testsWithIntent++;
    }
    
    // 规则 5: 每个测试应该有足够的断言
    if (test.assertions < 2) {
      issues.push({
        type: 'LOW_ASSERTIONS',
        severity: 'Minor',
        testId: test.name,
        message: `Test ${test.name} 只有 ${test.assertions} 个断言，可能不够充分`
      });
    }
  }
  
  // 计算分数
  const score = calculateScore(issues, coverage);
  
  return {
    score,
    issues,
    coverage,
    passed: score >= 80
  };
}
```

---

### Step 4: 分数计算

```typescript
function calculateScore(issues: AlignmentIssue[], coverage: CoverageReport): number {
  // 维度权重
  const weights = {
    requirementCoverage: 30,
    acCoverage: 25,
    testIntent: 20,
    edgeCaseCoverage: 15,
    testDataValidity: 10
  };
  
  // 计算各维度得分
  const reqScore = (coverage.requirementsCovered / coverage.requirementsTotal) * weights.requirementCoverage;
  
  const acScore = coverage.acTotal > 0 
    ? (coverage.acCovered / coverage.acTotal) * weights.acCoverage 
    : weights.acCoverage; // 如果没有 AC，给满分
  
  const intentScore = (coverage.testsWithIntent / coverage.testsTotal) * weights.testIntent;
  
  const edgeScore = coverage.edgeCasesTotal > 0
    ? (coverage.edgeCasesCovered / coverage.edgeCasesTotal) * weights.edgeCaseCoverage
    : weights.edgeCaseCoverage;
  
  // 测试数据有效性基于断言数量
  const avgAssertions = coverage.testsTotal > 0 
    ? /* 需要从 testMap 传入 */ 3 
    : 0;
  const dataScore = avgAssertions >= 3 ? weights.testDataValidity 
    : (avgAssertions / 3) * weights.testDataValidity;
  
  // 扣除 Critical/Major 问题分数
  const criticalCount = issues.filter(i => i.severity === 'Critical').length;
  const majorCount = issues.filter(i => i.severity === 'Major').length;
  
  const penalty = criticalCount * 5 + majorCount * 2;
  
  const totalScore = Math.max(0, reqScore + acScore + intentScore + edgeScore + dataScore - penalty);
  
  return Math.round(totalScore * 10) / 10;
}
```

---

## 辅助函数

```typescript
// 从 JSDoc 提取单个标签
function extractTag(jsdoc: string, tag: string): string | null {
  const pattern = new RegExp(`@${tag}\\s+(.+?)(?:\\n|\\*/)`);
  const match = jsdoc.match(pattern);
  return match ? match[1].trim() : null;
}

// 从 JSDoc 提取所有标签
function extractAllTags(jsdoc: string, tag: string): string[] {
  const pattern = new RegExp(`@${tag}\\s+([\\w\\-,\\s]+?)(?:\\n|\\*)`, 'g');
  const matches = [];
  let match;
  while ((match = pattern.exec(jsdoc)) !== null) {
    // 处理逗号分隔的多个值
    const values = match[1].split(',').map(v => v.trim());
    matches.push(...values);
  }
  return matches;
}

// 计算断言数量
function countAssertions(code: string): number {
  // 匹配 expect(), assert, should
  const patterns = [
    /expect\s*\(/g,
    /assert\.\w+\(/g,
    /\.should\./g
  ];
  
  let count = 0;
  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}
```

---

## Legacy 模式算法

```typescript
function verifyLegacyMode(testMap: TestMap): AlignmentReport {
  // Legacy 模式只验证测试覆盖率，不验证对齐
  
  const issues: AlignmentIssue[] = [];
  
  // 检查是否有跳过的测试
  const skippedTests = testMap.tests.filter(t => t.name.includes('.skip') || t.name.includes('xit'));
  if (skippedTests.length > 0) {
    issues.push({
      type: 'SKIPPED_TESTS',
      severity: 'Major',
      message: `发现 ${skippedTests.length} 个跳过的测试`
    });
  }
  
  // 计算基本分数
  const score = testMap.totalTests > 0 && testMap.totalAssertions > 0 ? 80 : 0;
  
  return {
    score,
    issues,
    coverage: {
      requirementsCovered: 0,
      requirementsTotal: 0,
      acCovered: 0,
      acTotal: 0,
      edgeCasesCovered: 0,
      edgeCasesTotal: 0,
      testsWithIntent: testMap.tests.filter(t => t.intent).length,
      testsTotal: testMap.totalTests
    },
    passed: score >= 80 && issues.filter(i => i.severity === 'Critical').length === 0
  };
}
```

---

## 性能优化

```typescript
// 缓存已解析的文件
const parseCache = new Map<string, { mtime: number, result: any }>();

function parseWithCache<T>(path: string, parser: (content: string) => T): T {
  const stat = fs.statSync(path);
  const cached = parseCache.get(path);
  
  if (cached && cached.mtime === stat.mtimeMs) {
    return cached.result;
  }
  
  const content = fs.readFileSync(path, 'utf-8');
  const result = parser(content);
  
  parseCache.set(path, { mtime: stat.mtimeMs, result });
  return result;
}
```