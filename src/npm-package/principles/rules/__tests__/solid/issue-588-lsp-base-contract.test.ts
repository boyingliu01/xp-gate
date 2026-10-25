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
});
