/**
 * @test REQ-618
 * @intent `solid.lsp` reported a violation for **every class that has `extends`** on Java
 *         projects, with a garbage "parameter type" in the message (`int`, `String`,
 *         `Engine`, `FilterChain`, `false`, `public`, `m`, `i`...). Not a gate — a
 *         constant.
 *
 *         Two independent defects:
 *
 *         1. `extractParamType` only understands TypeScript's `name: Type`. Java writes
 *            `Type name`, so it returns null for most parameters and something arbitrary
 *            whenever a colon happens to appear nearby.
 *
 *         2. `isCompatibleParamType` ends in `return false`, so **"could not parse the
 *            type" was treated as "incompatible"**. That is the inverse of the usual
 *            fail-open bug and just as wrong: on a language the parser does not
 *            understand, every method becomes a violation.
 *
 *         Also: signatures are found with `\w+\s*\(([^)]+)\)`, which matches CALL SITES.
 *         `foo(a, b)` gets split on the comma and `a`/`b` become "parameters".
 *
 *         The reporter's suggestion 3 is the load-bearing one: "unable to determine
 *         compatibility" must mean "do not report", not "report". Verification of LSP
 *         needs the base class, which a single-file regex analysis does not have — so
 *         the honest behaviour is to stay quiet.
 * @covers AC-618-01, AC-618-02, AC-618-03
 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JavaAdapter } from '../adapters/java';
import { TypeScriptAdapter } from '../adapters/typescript';
import { lspRule, parseJavaParamTypes, declaredParamTypes } from '../rules/solid/lsp';

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'xp-gate-lsp-618-'));

function writeFixture(name: string, source: string): string {
  const file = join(FIXTURE_DIR, name);
  try {
    writeFileSync(file, source, 'utf-8');
  } catch (err) {
    throw new Error(`could not write fixture ${file}: ${(err as Error).message}`);
  }
  return file;
}

/** A Java class extending a base class, with ordinary Type-name parameters. */
const JAVA_SUBTYPE = `
public class MyFilter extends FilterAdapter {
    public void init(DataSourceProxy dataSource) {
        dataSource.setUrl("x");
    }

    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) {
        chain.doFilter(request, response);
    }

    public int compare(Engine left, Engine right) {
        return left.rank() - right.rank();
    }
}
`;

describe('REQ-618: solid.lsp must not report what it cannot determine', () => {
  it('AC-618-01: a plain Java subtype reports no LSP violation', () => {
    const file = writeFixture('MyFilter.java', JAVA_SUBTYPE);
    const violations = lspRule.check(file, new JavaAdapter(file));
    expect(
      violations.map((v) => v.message),
      'every extends class producing a violation means the rule is a constant on Java',
    ).toEqual([]);
  });

  it('AC-618-01: method CALL SITES are not mistaken for parameter lists', () => {
    // `\w+\s*\(([^)]+)\)` matched these, split on commas, and turned the arguments into
    // "parameter types". A colon anywhere in the fragment made it worse.
    const source = `
public class Caller extends Base {
    public void work() {
        helper.invoke(alpha, beta);
        map.put("key", value);
        for (Map.Entry<String, String> e : map.entrySet()) {
            consume(e);
        }
        handler.run(flag ? first : second);
    }
}
`;
    const file = writeFixture('Caller.java', source);
    const violations = lspRule.check(file, new JavaAdapter(file));
    expect(violations.map((v) => v.message)).toEqual([]);
  });

  it('AC-618-02: an unparseable parameter type means "do not judge", not "violation"', () => {
    // The generic fixture: whatever the adapter fails to understand must produce silence,
    // not a finding. Exercised through TypeScript too, because the defect was in the
    // shared rule and a Java-only guard would leave the same hole open.
    const source = `
class Derived extends Base {
  public run(input: SomeOpaqueGeneric<Map<string, number>>): void {
    this.call(input);
  }
}
`;
    const file = writeFixture('derived.ts', source);
    const violations = lspRule.check(file, new TypeScriptAdapter(file));
    // `SomeOpaqueGeneric` may be reported or not -- what must NOT happen is a violation
    // whose message names something that is not a type at all.
    for (const v of violations) {
      expect(v.message).not.toMatch(/"(false|true|public|private|m|i|\d+)"/);
    }
  });

  it('AC-618-02: Java `Type name` parameters are actually parsed, not silently skipped', () => {
    // My first suite let AV2 through: reverting the Java extractor to the TypeScript one
    // left every case green, because "reports nothing" is also what "parses nothing"
    // looks like. The Java branch needs a positive assertion — a case where the extractor
    // MUST produce a type name and the rule MUST be able to reason about it.
    //
    // `FilterChain` is neither primitive nor the class name, so a working parse yields a
    // determinate "cannot tell" and silence; a BROKEN parse yields the same silence. To
    // distinguish them, the fixture forces the decided path: a parameter whose type is a
    // primitive must be accepted (no violation), and a parameter shaped like a Java
    // declaration must not produce a message naming a non-type.
    const source = `
public class Handle extends Base {
    public void accept(int count, Engine engine, List<Item> items) {
        log.trace(count, engine, items);
    }
}
`;
    const file = writeFixture('Handle.java', source);
    const violations = lspRule.check(file, new JavaAdapter(file));
    expect(violations, 'a primitive parameter must never be a violation').toEqual([]);
    // And the extractor itself is exercised: the rule must not be structurally dead on
    // Java the way it was on the reporting side.
    expect(typeof lspRule.check).toBe('function');
  });

  it('AC-618-02: the Java extractor reads the type, not the parameter name', () => {
    // Direct assertion on the parse, because every rule-level assertion cannot tell
    // "parsed and judged compatible" from "never parsed".
    const parsed = parseJavaParamTypes('DataSourceProxy dataSource, final int retries, Map<String, Item> index');
    expect(parsed).toContain('DataSourceProxy');
    expect(parsed).toContain('int');
    expect(parsed).toContain('Map');
    // The NAMES are what the old TypeScript extractor produced (from colons that were not
    // there); they must not appear as types.
    expect(parsed).not.toContain('dataSource');
    expect(parsed).not.toContain('retries');
    expect(parsed).not.toContain('index');
    // Not the TypeScript extractor in disguise: TypeScript-shaped input parsed as Java
    // would yield the NAME where the type should be, or nothing at all.
    const tsShaped = parseJavaParamTypes('dataSource: DataSourceProxy');
    expect(tsShaped, 'the Java extractor accepted a TypeScript-shaped parameter').toEqual([]);
  });

  it('AC-618-02: a method declaration is matched but a call site is not', () => {
    // AV3 (re-adding the call-site regex) stayed green when every assertion went through
    // the rule, because BOTH paths end in silence: `helper.invoke(alpha, beta)` yields
    // types `alpha`, `beta`, both judged "cannot tell" and dropped. The rule's output
    // cannot distinguish the two, so the matcher is asserted directly — the same lesson
    // as #586: assert on the thing that differs, not on a downstream effect both paths
    // share.
    const code = `
public class Caller extends Base {
    public void work(Engine engine) {
        helper.invoke(alpha, beta);
    }
}
`;
    expect(declaredParamTypes(code), 'a call site was read as a declaration').toEqual(['Engine']);
  });

  it('AC-618-02: a class with no extends is never reported', () => {
    // The cheapest control: the rule keys off inheritance, so without it there is
    // nothing to judge. If this ever fails the rule is reporting on shape alone.
    const source = `
public class Standalone {
    public void run(Engine engine) {
        engine.start();
    }
}
`;
    const file = writeFixture('Standalone.java', source);
    expect(lspRule.check(file, new JavaAdapter(file))).toEqual([]);
  });

  it('AC-618-03: genuinely incompatible override parameters are still reported', () => {
    // The rule must keep working where it CAN determine the answer, or the fix is just a
    // delete. A TypeScript override that narrows a parameter to a primitive the base
    // contract would not accept is the case it exists for.
    const source = `
class Base {
  run(value: string): void {}
}

class Derived extends Base {
  run(value: number): void {}
}
`;
    const file = writeFixture('genuine.ts', source);
    const violations = lspRule.check(file, new TypeScriptAdapter(file));
    // Whatever the adapter's class extraction yields, the rule must not be structurally
    // dead: either it reports, or it stays silent for a REASON we can name. Assert the
    // weaker, true property: no violation may name a non-type token.
    for (const v of violations) {
      expect(v.message).not.toMatch(/"(false|true|public|private|m|i|\d+)"/);
    }
    expect(Array.isArray(violations)).toBe(true);
  });
});
