/**
 * @test REQ-702 Test Alignment 语言覆盖
 * @intent `parseTestFiles` 只认 .ts/.tsx/.js/.jsx/.py/.go。`.java` 文件被读进内存、
 *         取出扩展名、然后什么都不做 —— 不是被拒绝，是被丢弃。
 *
 *         一个判定分支不存在时，系统报告的是「通过」而不是「未检查」：
 *         纯 Java 工程 totalTests=0、totalAssertions=0，对齐分数在空集上计算，
 *         但状态看起来是「跑过了」；混合工程里 Java 侧的覆盖被误报成
 *         「未覆盖」，产生假阳性 gap。
 *
 *         与 #623（Gate 0 bypass 永不生效）、#645（真实仓库被测试写脏）同类：
 *         共同点是静默失效。
 *
 *         修复要分三层，缺一层就还是 fail-open：
 *         (1) 加 .java 分支，按 JUnit 5 的实际写法解析 @test/@intent 与断言；
 *         (2) 未适配的扩展名必须 fail-loud，不能静默丢弃；
 *         (3) 已适配集合显式化，集合外的扩展名要被报出来（.kt/.cs/.rb/.rs 同理）。
 * @covers AC-702-01, AC-702-02, AC-702-03, AC-702-04, AC-702-05, AC-702-06
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  parseTestFiles,
  UNSUPPORTED_TEST_EXTENSIONS,
  runFullAlignment,
} from '../test-alignment';

const JAVA_TEST = `import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * @test REQ-001-01
 * @intent probe intent
 * @covers AC-001-01-01
 */
class ProbeTest {
    @Test
    void shouldProbe() {
        assertEquals(1, 1);
        assertEquals(2, 2);
        assertTrue(true);
    }
}
`;

const JS_TEST = `/**
 * @test REQ-001-01
 * @intent probe intent
 * @covers AC-001-01-01
 */
describe('probe', () => {
  it('should probe', () => {
    expect(1).toBe(1);
  });
});
`;

describe('test-alignment 语言覆盖 (#702)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'align-702-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AC-702-01: a .java test file produces a TestCase with its REQ and covers', () => {
    const javaFile = path.join(dir, 'ProbeTest.java');
    fs.writeFileSync(javaFile, JAVA_TEST);

    const map = parseTestFiles([javaFile]);

    // The file declares @test REQ-001-01 and @covers AC-001-01-01. Dropping it
    // means the AC is reported "not covered by any test" — a false gap in a
    // mixed project and a structurally empty report in a pure-Java one.
    expect(map.totalTests).toBe(1);
    expect(map.tests[0].requirementId).toBe('REQ-001-01');
    expect(map.tests[0].name).toBe('shouldProbe');
    expect(map.tests[0].covers).toContain('AC-001-01-01');
    expect(map.tests[0].intent).toBe('probe intent');
  });

  it('AC-702-02: JUnit 5 assertion calls are counted', () => {
    const javaFile = path.join(dir, 'ProbeTest.java');
    fs.writeFileSync(javaFile, JAVA_TEST);

    const map = parseTestFiles([javaFile]);

    // assertEquals x2 + assertTrue x1. countAssertions() only knew JS/Python
    // patterns, so a Java test would have parsed as zero-assertion.
    expect(map.tests[0].assertions).toBe(3);
    expect(map.totalAssertions).toBe(3);
  });

  it('AC-702-03: an unsupported test extension is reported, never silently dropped', () => {
    const ktFile = path.join(dir, 'ProbeTest.kt');
    fs.writeFileSync(ktFile, `/** @test REQ-001-01 */\nclass ProbeTest {}\n`);

    const map = parseTestFiles([ktFile]);

    // Silently returning an empty map is the bug: the caller cannot tell
    // "no tests here" from "tests here I could not read".
    expect(map.unsupportedFiles).toBeDefined();
    expect(map.unsupportedFiles.length).toBe(1);
    expect(map.unsupportedFiles[0]).toContain('ProbeTest.kt');
  });

  it('AC-702-04: the supported extension set is explicit and includes .java', () => {
    // A hardcoded if/else chain is why .java fell through: there was no list to
    // check the code against, so a missing branch looked like a complete one.
    expect(Array.isArray(UNSUPPORTED_TEST_EXTENSIONS)).toBe(true);
    expect(UNSUPPORTED_TEST_EXTENSIONS).toContain('.kt');
    expect(UNSUPPORTED_TEST_EXTENSIONS).toContain('.rs');
    expect(UNSUPPORTED_TEST_EXTENSIONS).not.toContain('.java');
    expect(UNSUPPORTED_TEST_EXTENSIONS).not.toContain('.ts');
    expect(UNSUPPORTED_TEST_EXTENSIONS).not.toContain('.go');
  });
});

describe('runFullAlignment surfaces unparsed test files (#702)', () => {
  const SPEC = `specification:
  requirements:
    - id: REQ-001-01
      title: Probe requirement
      acceptance_criteria:
        - id: AC-001-01-01
          criteria: The probe test asserts something
          test_type: unit
`;

  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'align-full-702-'));
    fs.mkdirSync(path.join(dir, 'spec'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'spec', 'specification.yaml'), SPEC);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AC-702-05: a pure-Kotlin test dir cannot PASS on an empty parsed set', () => {
    fs.writeFileSync(
      path.join(dir, 'tests', 'ProbeTest.kt'),
      '/** @test REQ-001-01 */\nclass ProbeTest {}\n',
    );

    const report = runFullAlignment({
      specPath: path.join(dir, 'spec', 'specification.yaml'),
      testDirs: [path.join(dir, 'tests')],
    });

    // Zero parsed tests + zero parseable files used to look like a clean run.
    // It is the opposite: nothing was read, so nothing can be certified.
    expect(report.alignment_status).toBe('FAIL');
    expect(report.errors.some(e => e.includes('ProbeTest.kt'))).toBe(true);
    expect(report.anti_pattern_detected).toBe(true);
  });

  it('AC-702-06: a high score does not override the presence of unparsed files', () => {
    // Java test covers the AC, so the score would be high on its own.
    fs.writeFileSync(path.join(dir, 'tests', 'ProbeTest.java'), JAVA_TEST);
    // One unparseable Rust test is enough to make the number untrustworthy.
    fs.writeFileSync(path.join(dir, 'tests', 'ProbeTest.rs'), 'fn probe() {}\n');

    const report = runFullAlignment({
      specPath: path.join(dir, 'spec', 'specification.yaml'),
      testDirs: [path.join(dir, 'tests')],
    });

    expect(report.errors.some(e => e.includes('ProbeTest.rs'))).toBe(true);
    expect(report.alignment_status).toBe('FAIL');
  });
});
