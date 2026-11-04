/**
 * @test REQ-727
 * @intent shared.ts 是 arch 两组规则的公共基础：包路径提取、类名/import 读取、
 *         severity 回退。这些函数一旦错了，上面的规则会以「没有任何违规」的
 *         方式静默失效——所以单独钉住，而不是只靠规则测试间接覆盖。
 * @covers AC-727-07 AC-726-01
 */
import { describe, it, expect } from 'vitest';
import {
  extractPackageSegments,
  isTestSource,
  classNamesOf,
  importsOf,
  readSeverity,
  simpleNameOf,
  packageSegmentsOf,
  isUnrecognisedJavaLayout,
} from '../shared';

describe('extractPackageSegments — 从路径取包', () => {
  it('标准 Maven 布局：src/main/java/<pkg>/File.java', () => {
    expect(extractPackageSegments('src/main/java/com/acme/order/Order.java')).toEqual([
      'com',
      'acme',
      'order',
    ]);
  });

  it('多模块布局：模块名不算进包名', () => {
    expect(
      extractPackageSegments('core/src/main/java/com/acme/interfaces/rest/UserAPI.java'),
    ).toEqual(['com', 'acme', 'interfaces', 'rest']);
  });

  it('含两处 src/main/java 时锚定最后一处', () => {
    expect(
      extractPackageSegments('legacy/src/main/java/gen/src/main/java/com/acme/A.java'),
    ).toEqual(['com', 'acme']);
  });

  it('Windows 反斜杠路径同样处理', () => {
    expect(
      extractPackageSegments('core\\src\\main\\java\\com\\acme\\interfaces\\rest\\A.java'),
    ).toEqual(['com', 'acme', 'interfaces', 'rest']);
  });

  it('非 Java 源根路径返回空数组（规则据此不触发，而不是猜）', () => {
    expect(extractPackageSegments('src/com/acme/A.java')).toEqual([]);
    expect(extractPackageSegments('README.md')).toEqual([]);
  });
});

describe('isTestSource — 测试目录整体排除', () => {
  it('src/test/java 判定为测试代码', () => {
    expect(isTestSource('src/test/java/com/acme/A.java')).toBe(true);
    expect(isTestSource('core/src/test/java/com/acme/ATest.java')).toBe(true);
  });

  it('src/main/java 不是测试代码', () => {
    expect(isTestSource('src/main/java/com/acme/A.java')).toBe(false);
  });
});

describe('classNamesOf / importsOf — 跳过不可用条目', () => {
  it('跳过没有 name 或 name 为空的条目', () => {
    // Named so the "no name" case reads as intentional rather than as a stray
    // number: 3 is the line an entry carries when it has no name to report.
    const UNNAMED_ENTRY_LINE = 3;
    const adapter = {
      extractClasses: () => [
        { name: 'A', line: 1 },
        { name: '' },
        { line: UNNAMED_ENTRY_LINE },
        { name: 'B' },
      ],
      get imports() {
        return [{ name: 'a.B', line: 2 }, {}, { name: '' }];
      },
    };
    expect(classNamesOf(adapter)).toEqual([{ name: 'A', line: 1 }, { name: 'B', line: undefined }]);
    expect(importsOf(adapter)).toEqual([{ name: 'a.B', line: 2 }]);
  });

  it('adapter 缺少对应成员时返回空数组而不抛错', () => {
    expect(classNamesOf({})).toEqual([]);
    expect(importsOf({})).toEqual([]);
  });
});

describe('readSeverity — 缺失配置时回退', () => {
  it('读取已配置的 severity', () => {
    expect(readSeverity({ 'x': { severity: 'info' } }, 'x', 'error')).toBe('info');
  });

  it('分组整体缺失时回退到默认（老配置无 arch 键的场景）', () => {
    expect(readSeverity(undefined, 'x', 'warning')).toBe('warning');
  });

  it('非法 severity 值回退到默认，而不是透传', () => {
    expect(readSeverity({ 'x': { severity: 'fatal' } }, 'x', 'error')).toBe('error');
  });
});

describe('simpleNameOf / packageSegmentsOf', () => {
  it('取全限定名的简单类名与包段', () => {
    expect(simpleNameOf('com.acme.order.OrderService')).toBe('OrderService');
    expect(packageSegmentsOf('com.acme.order.OrderService')).toEqual(['com', 'acme', 'order']);
  });

  it('无包名的裸类名：简单名是自身，包段为空', () => {
    expect(simpleNameOf('OrderService')).toBe('OrderService');
    expect(packageSegmentsOf('OrderService')).toEqual([]);
  });
});

/**
 * Round 2 Delphi finding (feasibility): a Java file whose path carries no
 * Java source root (no `src` + scope + `java` triple) made every arch rule
 * return zero violations -- which reads as "this project is clean" when the
 * truth is "this project was never examined". The segment extraction must stay
 * empty (guessing would invent package names), but the skip has to be
 * distinguishable from a pass.
 */
describe('isUnrecognisedJavaLayout — 布局未识别必须可诊断，不能等同于无违规', () => {
  it('a .java path with no source root is reported as unrecognised', () => {
    expect(isUnrecognisedJavaLayout('java/com/acme/A.java')).toBe(true);
    expect(isUnrecognisedJavaLayout('src/com/acme/A.java')).toBe(true);
  });

  it('a standard Maven layout is recognised, so the diagnostic stays quiet', () => {
    expect(isUnrecognisedJavaLayout('src/main/java/com/acme/A.java')).toBe(false);
    expect(isUnrecognisedJavaLayout('core/src/main/java/com/acme/A.java')).toBe(false);
  });

  it('non-Java files are not reported at all', () => {
    // The arch rules only ever look at Java/Kotlin, so a .ts or .md path is
    // out of scope -- reporting it would bury the real signal in noise.
    expect(isUnrecognisedJavaLayout('src/app.ts')).toBe(false);
    expect(isUnrecognisedJavaLayout('README.md')).toBe(false);
  });
});
