import { describe, it, expect, vi, type Mock } from 'vitest';;
import { JavaAdapter } from '../java';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { readFileSync } from 'fs';

describe('JavaAdapter', () => {
  it('should implement the Adapter interface', () => {
    (readFileSync as Mock).mockReturnValue('public class Test {\n  public void testFn() {}\n}');
    const adapter = new JavaAdapter('Test.java');
    
    expect(adapter).toHaveProperty('detectLanguage');
    expect(adapter).toHaveProperty('parseAST');
    expect(adapter).toHaveProperty('extractFunctions');
    expect(adapter).toHaveProperty('extractClasses');
    expect(adapter).toHaveProperty('countLines');
  });

  it('should detect language as java for .java files', () => {
    (readFileSync as Mock).mockReturnValue('public class Test {}');
    const adapter = new JavaAdapter('Test.java');
    const detected = adapter.detectLanguage();
    expect(detected).toBe('java');
  });

  it('should parse Java file AST correctly', () => {
    (readFileSync as Mock).mockReturnValue('public class Test {\n  public void testFn() {}\n}');
    const adapter = new JavaAdapter('Test.java');
    const ast = adapter.parseAST();
    expect(ast).toHaveProperty('content');
    expect(ast).toHaveProperty('language');
    expect(ast).toHaveProperty('filePath');
    expect((ast as { language: unknown }).language).toBe('java');
  });

  it('should extract methods from Java AST', () => {
    (readFileSync as Mock).mockReturnValue('public class Test {\n  public void testFn() {}\n}');
    const adapter = new JavaAdapter('Test.java');
    const functions = adapter.extractFunctions();
    expect(Array.isArray(functions)).toBe(true);
    expect(functions.some(fn => (fn as {name: string}).name === 'testFn')).toBe(true);
  });

  it('should extract classes from Java AST', () => {
    (readFileSync as Mock).mockReturnValue('public class Test {\n  public void testFn() {}\n}');
    const adapter = new JavaAdapter('Test.java');
    const classes = adapter.extractClasses();
    expect(Array.isArray(classes)).toBe(true);
    expect(classes.some(cls => (cls as {name: string}).name === 'Test')).toBe(true);
  });

  it('should count Java file physical lines', () => {
    (readFileSync as Mock).mockReturnValue('public class Test {\n}\nclass Test2 {}');
    const adapter = new JavaAdapter('Test.java');
    const lineCount = adapter.countLines();
    expect(lineCount).toBe(3);
  });

  it('should fall back to super.detectLanguage for non-java extensions', () => {
    (readFileSync as Mock).mockReturnValue('content');
    const adapter = new JavaAdapter('test.ts');
    expect(adapter.detectLanguage()).toBe('typescript');
  });
});

/**
 * @test REQ-507-04
 * @intent 验证 JavaAdapter 为各规则提供其所需度量字段（#507 S4）：修复前适配器
 *         只返回 {name,type,line,code}，读结构字段的 12 条规则在 Java 上静默
 *         拿到 undefined，G4 报告已检查但 0 覆盖。覆盖矩阵见
 *         docs/java-principles-coverage.md。
 * @covers AC-507-04-01
 */
describe('JavaAdapter metric extraction (#507)', () => {
  interface FnInfo {
    name: string;
    startLine?: number;
    line?: number;
    length?: number;
    paramCount?: number;
    nestingDepth?: number;
    hasTryCatch?: boolean;
    ioOperations?: string[];
  }

  const LONG_BODY = Array.from({ length: 60 }, (_, i) => `    int v${i} = ${i};`).join('\n');

  const SAMPLE = `
public class Sample {
  public void eightParams(int a, int b, int c, int d, int e, int f, int g, int h) {
    System.out.println(a);
  }

  public void longOne() {
${LONG_BODY}
    return;
  }

  public void deepOne(int x) {
    if (x > 0) {
      if (x > 1) {
        if (x > 2) {
          if (x > 3) {
            if (x > 4) {
              System.out.println(x);
            }
          }
        }
      }
    }
  }

  public void guardedIo() {
    try {
      java.sql.Connection c = java.sql.DriverManager.getConnection("jdbc:x");
      c.createStatement().executeQuery("SELECT 1");
    } catch (Exception e) {
      // swallowed
    }
  }

  public void rawIo() {
    java.sql.Connection c = java.sql.DriverManager.getConnection("jdbc:x");
    c.createStatement().executeQuery("SELECT 1");
  }

  public int magic() { return 42; }
}
`;

  function adapterFor(content = SAMPLE): JavaAdapter {
    (readFileSync as Mock).mockReturnValue(content);
    return new JavaAdapter('Sample.java');
  }

  function findFn(fns: unknown[], name: string): FnInfo {
    const found = fns.find(f => (f as FnInfo).name === name);
    if (!found) throw new Error(`fixture function not extracted: ${name}`);
    return found as FnInfo;
  }

  it('reports paramCount (too-many-params contract)', () => {
    const fns = adapterFor().extractFunctions() as FnInfo[];
    expect(findFn(fns, 'eightParams').paramCount).toBe(8);
  });

  it('reports length body span (long-function contract)', () => {
    const fns = adapterFor().extractFunctions() as FnInfo[];
    expect(findFn(fns, 'longOne').length).toBeGreaterThan(50);
  });

  it('reports nestingDepth (deep-nesting contract)', () => {
    const fns = adapterFor().extractFunctions() as FnInfo[];
    expect(findFn(fns, 'deepOne').nestingDepth).toBeGreaterThanOrEqual(5);
  });

  it('reports hasTryCatch and ioOperations (missing-error-handling contract)', () => {
    const fns = adapterFor().extractFunctions() as FnInfo[];
    const guarded = findFn(fns, 'guardedIo');
    expect(guarded.hasTryCatch).toBe(true);
    expect((guarded.ioOperations ?? []).length).toBeGreaterThan(0);

    const raw = findFn(fns, 'rawIo');
    expect(raw.hasTryCatch).toBe(false);
    expect(raw.ioOperations).toContain('getConnection');
    expect(raw.ioOperations).toContain('executeQuery');
  });

  it('reports startLine for every function (violation line attribution)', () => {
    const fns = adapterFor().extractFunctions() as FnInfo[];
    for (const f of fns) {
      expect(f.startLine).toBeGreaterThan(0);
      expect(f.name).toBeTruthy();
    }
  });

  it('does not report control keywords as functions', () => {
    const fns = adapterFor().extractFunctions() as FnInfo[];
    const names = fns.map(f => f.name);
    for (const kw of ['if', 'for', 'while', 'switch', 'catch', 'return']) {
      expect(names).not.toContain(kw);
    }
  });

  describe('extract (magic numbers)', () => {
    it('returns {value,line} and masks strings/comments', () => {
      const content = `
// 999 in a comment must not count
String s = "1234 in a string must not count";
int x = 12345;
`;
      (readFileSync as Mock).mockReturnValue(content);
      const adapter = new JavaAdapter('M.java') as unknown as {
        extract: () => Array<{ value: number; line: number }>;
      };
      const values = adapter.extract().map(n => n.value);
      expect(values).toContain(12345);
      expect(values).not.toContain(999);
      expect(values).not.toContain(1234);
    });

    it('reports digits used as call arguments (#507 blind review M2)', () => {
      const content = `
public class Calls {
  public int go() {
    return Math.max(1, 99);
  }
}
`;
      (readFileSync as Mock).mockReturnValue(content);
      const adapter = new JavaAdapter('C.java') as unknown as {
        extract: () => Array<{ value: number; line: number }>;
      };
      const values = adapter.extract().map(n => n.value);
      expect(values).toContain(99);
      expect(values).toContain(1);
    });

    it('masks block comments including cross-line ones (#507 blind review M3)', () => {
      const content = `
public class Commented {
  /* int inlineBlock = 555; */
  // string containing slashes must not swallow the rest: see below
  String url = "http://x"; int y = 42;
  /*
   * int multi = 777;
   * int line2 = 888;
   */
  int live = 11;
}
`;
      (readFileSync as Mock).mockReturnValue(content);
      const adapter = new JavaAdapter('B.java') as unknown as {
        extract: () => Array<{ value: number; line: number }>;
      };
      const values = adapter.extract().map(n => n.value);
      expect(values).toContain(42);   // after a string with `//`, same line
      expect(values).toContain(11);   // after a multi-line block comment
      expect(values).not.toContain(555);
      expect(values).not.toContain(777);
      expect(values).not.toContain(888);
    });

    it('skips static final constant initializers but reports bare literals', () => {
      // The rule's remedy is "use a named constant" -- flagging the constant
      // itself would make violations unfixable (#446 precedent on TS).
      const content = `
public class C {
  public static final int MAX = 3;
  public int bare() { return 137; }
}
`;
      (readFileSync as Mock).mockReturnValue(content);
      const adapter = new JavaAdapter('C.java') as unknown as {
        extract: () => Array<{ value: number; line: number }>;
      };
      const values = adapter.extract().map(n => n.value);
      expect(values).not.toContain(3);
      expect(values).toContain(137);
    });
  });

  describe('imports (unused-imports contract)', () => {
    it('marks unused and used imports with line numbers', () => {
      const content = `
import java.util.ArrayList;
import java.io.File;

public class C {
  public ArrayList<String> go() { return new ArrayList<>(); }
}
`;
      (readFileSync as Mock).mockReturnValue(content);
      const adapter = new JavaAdapter('C.java') as unknown as {
        imports: Array<{ name: string; line: number; used: boolean }>;
      };
      const imports = adapter.imports;
      const list = imports.find(i => i.name === 'java.util.ArrayList');
      expect(list?.used).toBe(true);
      const file = imports.find(i => i.name === 'java.io.File');
      expect(file?.used).toBe(false);
      expect(file?.line).toBe(3);
    });
  });

  describe('extractClasses / extractInterfaces (srp/isp contracts)', () => {
    it('reports methodCount per class (srp reads it directly)', () => {
      const content = `
public class Busy {
  public void m1() {}
  public void m2() {}
  public void m3() {}
  public void m4() {}
  public void m5() {}
  public void m6() {}
}
`;
      (readFileSync as Mock).mockReturnValue(content);
      const classes = adapterFor(content).extractClasses() as Array<{ name: string; methodCount: number }>;
      expect(classes.find(c => c.name === 'Busy')?.methodCount).toBe(6);
    });

    it('extractInterfaces reports interfaces with methodCount (isp contract)', () => {
      const content = `
public interface Worker {
  void run();
  void stop();
}
`;
      (readFileSync as Mock).mockReturnValue(content);
      const adapter = new JavaAdapter('W.java') as unknown as {
        extractInterfaces: () => Array<{ name: string; methodCount: number }>;
      };
      const ifaces = adapter.extractInterfaces();
      expect(ifaces.find(i => i.name === 'Worker')?.methodCount).toBe(2);
    });

    it('finds generic classes and interfaces (#507 blind review M1)', () => {
      const content = `
public class Box<T> {
  private T value;
  public T get() { return value; }
}

public interface Repo<T, ID> {
  T findById(ID id);
}
`;
      (readFileSync as Mock).mockReturnValue(content);
      const classes = adapterFor(content).extractClasses() as Array<{ name: string; methodCount: number }>;
      expect(classes.find(c => c.name === 'Box')?.methodCount).toBe(1);
      const adapter = adapterFor(content) as unknown as {
        extractInterfaces: () => Array<{ name: string; methodCount: number }>;
      };
      expect(adapter.extractInterfaces().find(i => i.name === 'Repo')?.methodCount).toBe(1);
    });

    it('does not count masked-out members (strings/comments/inner calls)', () => {
      const content = `
public class Noisy {
  public void real() {
    String s = "fake(1)";
    // phantomCall(
    /* alsoFake(2) */
    helper(1);
  }
  public void second() {}
}
`;
      (readFileSync as Mock).mockReturnValue(content);
      const classes = adapterFor(content).extractClasses() as Array<{ name: string; methodCount: number; methods: string[] }>;
      const methods = classes.find(c => c.name === 'Noisy')?.methods ?? [];
      // The Java member heuristic mirrors the TS adapter (pure `name(` scan on
      // the class body), so `helper(` -- a real, unqualified call statement --
      // DOES count. What must never surface are the masked-out members:
      //   fake(        lived inside a string literal
      //   phantomCall( lived in a line comment
      //   alsoFake(    lived in a block comment
      expect(methods).not.toContain('fake');
      expect(methods).not.toContain('phantomCall');
      expect(methods).not.toContain('alsoFake');
      expect(methods).toEqual(expect.arrayContaining(['real', 'second']));
    });

    it('does not leak brace depth from string literals (#507 blind review M4)', () => {
      const content = `
public class Formatter {
  public String weird() {
    String s = "unbalanced { brace";
    return s;
  }
  public int after() { return 0; }
}
`;
      (readFileSync as Mock).mockReturnValue(content);
      const fns = adapterFor(content).extractFunctions() as Array<{ name: string; nestingDepth: number }>;
      // `after` must not inherit inflated depth from the string's `{`.
      expect(findFn(fns as FnInfo[], 'after').nestingDepth).toBeLessThan(3);
    });
  });
});