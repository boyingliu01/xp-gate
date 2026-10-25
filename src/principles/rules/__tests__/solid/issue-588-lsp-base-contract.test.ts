/**
 * @test REQ-618
 * @intent The LSP rule must still DETECT a real violation when the base contract is
 *        available in the same file, so that #588's "stay silent when undetermined" fix
 *        does not degenerate into "never report anything".
 * @covers AC-618-04, AC-618-05
 */
import { describe, it, expect } from 'vitest';
import { lspRule } from '../../solid/lsp';

/** Adapter stub exposing exactly what the rule consumes. */
function adapterFor(classes: Array<{ name?: string; line?: number; code?: string }>) {
  return {
    detectLanguage: () => 'java',
    parseAST: () => undefined,
    extractFunctions: () => [],
    extractClasses: () => classes,
    countLines: () => 0,
  };
}

/**
 * A base class and a derived class in ONE file.
 *
 * `handle(DataSource ds)` is the base contract; the derived class may honour it or break
 * it. Both classes are visible, so the rule has everything it needs to decide — which is
 * exactly the case #588's fix must NOT silence.
 */
const BASE_WITH_ONE_PARAM = `
class BaseHandler {
  public void handle(DataSource ds) { }
}
`;

/** Line where the derived class starts in the two-class fixtures below. */
const DERIVED_CLASS_LINE = 4;

/** Line where the derived TypeScript class starts in the two-line-header fixtures. */
const TS_DERIVED_CLASS_LINE = 3;

describe('solid.lsp detects a violation when the base contract IS available', () => {
  it('reports a derived parameter type the base method does not accept', () => {
    const violations = lspRule.check('Handlers.java', adapterFor([
      { name: 'BaseHandler', line: 1, code: BASE_WITH_ONE_PARAM },
      {
        name: 'CsvHandler',
        line: DERIVED_CLASS_LINE,
        code: `class CsvHandler extends BaseHandler {
  public void handle(FileChannel channel) { }
}`,
      },
    ]) as never);

    // The point of the whole rule: an override that narrows or changes the parameter type
    // breaks substitutability, and here both sides are visible so the claim is earned.
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].ruleId).toBe('solid.lsp');
    expect(violations[0].message).toContain('FileChannel');
  });

  it('stays silent when the override keeps the base parameter type', () => {
    const violations = lspRule.check('Handlers.java', adapterFor([
      { name: 'BaseHandler', line: 1, code: BASE_WITH_ONE_PARAM },
      {
        name: 'CsvHandler',
        line: DERIVED_CLASS_LINE,
        code: `class CsvHandler extends BaseHandler {
  public void handle(DataSource ds) { }
}`,
      },
    ]) as never);

    expect(violations).toHaveLength(0);
  });

  it('stays silent when the base class is NOT in the file', () => {
    // The control for the two cases above: same derived code, no base declaration
    // available. Without this, a rule that simply reported every non-primitive parameter
    // would pass the first case and fail only by accident elsewhere.
    const violations = lspRule.check('Handlers.java', adapterFor([
      {
        name: 'CsvHandler',
        line: 1,
        code: `class CsvHandler extends BaseHandler {
  public void handle(FileChannel channel) { }
}`,
      },
    ]) as never);

    expect(violations).toHaveLength(0);
  });

  it('stays silent when the base method itself is not declared', () => {
    // Base visible, but it does not declare `handle` at all — an inherited method from
    // further up, which this analysis cannot see. Not a violation, not verifiable.
    const baseWithoutHandle = `class BaseHandler { public void close() { } }`;
    const violations = lspRule.check('Handlers.java', adapterFor([
      { name: 'BaseHandler', line: 1, code: baseWithoutHandle },
      {
        name: 'CsvHandler',
        line: 2,
        code: `class CsvHandler extends BaseHandler {
  public void handle(FileChannel channel) { }
}`,
      },
    ]) as never);

    expect(violations).toHaveLength(0);
  });

  it('resolves a base class referenced through a qualified name', () => {
    // `extends com.acme.BaseHandler` is ordinary Java; a plain string compare would miss
    // the base and silently downgrade a decidable case to silence.
    const violations = lspRule.check('Handlers.java', adapterFor([
      { name: 'BaseHandler', line: 1, code: BASE_WITH_ONE_PARAM },
      {
        name: 'CsvHandler',
        line: 2,
        code: `class CsvHandler extends com.acme.BaseHandler {
  public void handle(FileChannel channel) { }
}`,
      },
    ]) as never);

    expect(violations.length).toBeGreaterThan(0);
  });

  it('treats a parameter type the base method also declares as compatible', () => {
    // The positive half of the base comparison: this is the branch that returns `true`,
    // i.e. "I have a base contract AND it accepts this type". Without it the only
    // observable outcome of the base path would be a violation, and a rule that reported
    // every override with a resolvable base would still pass every other case here.
    const base = `class BaseHandler { public void handle(DataSource ds) { } }`;
    const violations = lspRule.check('Handlers.java', adapterFor([
      { name: 'BaseHandler', line: 1, code: base },
      {
        name: 'CsvHandler',
        line: 2,
        code: `class CsvHandler extends BaseHandler {
  public void handle(DataSource ds) { }
}`,
      },
    ]) as never);

    expect(violations).toHaveLength(0);
  });

  it('handles a generic and an array parameter type without crashing', () => {
    // Exercises `normaliseTypeName`'s stripping of `<...>`, `[]` and `?`. Those suffixes
    // are the reason `Map<String, Item>` does not get compared as the literal string
    // "Map<String, Item>", and the array/optional forms are ordinary in both languages.
    const base = `class BaseHandler { public void handle(Map<String, Item> index) { } }`;
    const violations = lspRule.check('Handlers.java', adapterFor([
      { name: 'BaseHandler', line: 1, code: base },
      {
        name: 'CsvHandler',
        line: 2,
        code: `class CsvHandler extends BaseHandler {
  public void handle(Map<String, Item> index) { }
}`,
      },
    ]) as never);

    expect(violations).toHaveLength(0);
  });

  it('reads TypeScript `name: Type` parameters, not Java ones', () => {
    // Every other case here runs the Java path. The rule is shared by both languages, and
    // #588's whole lesson is that a parser which only works for one of them silently
    // mangles the other — so the TypeScript path needs its own case, exercising
    // `extractTsParamType` rather than `extractJavaParamType`.
    const tsAdapter = { ...adapterFor([]), detectLanguage: () => 'typescript' };
    const base = `class BaseHandler {
  handle(ds: DataSource): void {}
}`;
    const derived = `class CsvHandler extends BaseHandler {
  handle(channel: FileChannel): void {}
}`;
    const violations = lspRule.check('handlers.ts', {
      ...tsAdapter,
      extractClasses: () => [
        { name: 'BaseHandler', line: 1, code: base },
        { name: 'CsvHandler', line: TS_DERIVED_CLASS_LINE, code: derived },
      ],
    } as never);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain('FileChannel');
  });

  it('stays silent for a TypeScript override that matches the base', () => {
    const tsAdapter = { ...adapterFor([]), detectLanguage: () => 'typescript' };
    const base = `class BaseHandler {
  handle(ds: DataSource): void {}
}`;
    const derived = `class CsvHandler extends BaseHandler {
  handle(ds: DataSource): void {}
}`;
    const violations = lspRule.check('handlers.ts', {
      ...tsAdapter,
      extractClasses: () => [
        { name: 'BaseHandler', line: 1, code: base },
        { name: 'CsvHandler', line: TS_DERIVED_CLASS_LINE, code: derived },
      ],
    } as never);

    expect(violations).toHaveLength(0);
  });

  it('treats an adapter without detectLanguage as non-Java rather than crashing', () => {
    // Older or third-party adapters may not implement `detectLanguage`. The rule must
    // fall back to the `name: Type` reading instead of throwing on an absent method —
    // a crash here would surface as a Gate 4 rule error, not as silence.
    const adapterWithoutLanguage = {
      parseAST: () => undefined,
      extractFunctions: () => [],
      countLines: () => 0,
      extractClasses: () => [
        { name: 'BaseHandler', line: 1, code: `class BaseHandler {\n  handle(ds: DataSource): void {}\n}` },
        {
          name: 'CsvHandler',
          line: TS_DERIVED_CLASS_LINE,
          code: `class CsvHandler extends BaseHandler {\n  handle(channel: FileChannel): void {}\n}`,
        },
      ],
    };

    const violations = lspRule.check('handlers.ts', adapterWithoutLanguage as never);

    expect(violations.length).toBeGreaterThan(0);
  });

  it('ignores a TypeScript parameter with no type annotation', () => {
    // `handle(id)` has no `: Type`, so `extractTsParamType` returns null and the parameter
    // contributes nothing. Without this the missing-annotation path is untested after the
    // #588 rewrite, and a regex change could start inventing types out of parameter names.
    const tsAdapter = {
      ...adapterFor([]),
      detectLanguage: () => 'typescript',
      extractClasses: () => [
        { name: 'BaseHandler', line: 1, code: `class BaseHandler {\n  handle(id): void {}\n}` },
        {
          name: 'CsvHandler',
          line: TS_DERIVED_CLASS_LINE,
          code: `class CsvHandler extends BaseHandler {\n  handle(id): void {}\n}`,
        },
      ],
    };

    expect(lspRule.check('handlers.ts', tsAdapter as never)).toHaveLength(0);
  });
});
