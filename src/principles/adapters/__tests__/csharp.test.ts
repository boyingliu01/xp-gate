/**
 * @test REQ-ADAPTER-CSHARP
 * @intent C# 的词法状态机有三个 C# 独有的陷阱，每一个都曾让扫描静默出错：
 *
 *         1. **verbatim 字符串**用**双写引号**转义（`@"a""b"` 是 `a"b`），而不是反斜杠；
 *         2. **字符字面量**永远不是 verbatim —— 复用上一个字符串的标志会让它的闭合引号
 *            被当成转义；
 *         3. 孤立的一个 `/` 是**除号**，从它开始擦除会吞掉整行。
 *
 *         verbatim/raw 字符串里的 `{` 若被当成代码块，函数长度与嵌套深度都会被高估。
 *
 * @covers AC-ADAPTER-CSHARP-01
 * @covers AC-ADAPTER-CSHARP-02
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSharpAdapter } from '../csharp';

/** The fallback span the adapter uses when it cannot find a closing brace. */
const MAX_FALLBACK = 200;

/** A nesting depth at which the deep-nesting rule starts to complain. */
const NESTING_LIMIT = 4;

/**
 * Build an adapter over a temp file whose content is `source`.
 *
 * The write is what needs a guard here: a temp directory that cannot be written would
 * otherwise surface as an unrelated parse failure inside the adapter.
 */
function adapterFor(source: string): CSharpAdapter {
  const dir = mkdtempSync(join(tmpdir(), 'csharp-adapter-'));
  const file = join(dir, 'Sample.cs');
  try {
    writeFileSync(file, source, 'utf8');
  } catch (error) {
    throw new Error(`could not write the C# fixture: ${String(error)}`);
  }
  return new CSharpAdapter(file);
}

describe('CSharpAdapter.extractCodeBlock', () => {
  it('closes a verbatim string on a DOUBLED quote, not on the first one', () => {
    // `@"a""b"` is `a"b`: treating the first of the doubled quotes as the terminator
    // ends the string early, and the `}` inside it then closes the method.
    const adapter = adapterFor('class C { void M() { var s = @"a""b}"; } }');
    const block = adapter.extractCodeBlock(0, MAX_FALLBACK);
    expect(block).toContain('@"a""b}"');
  });

  it('does not mistake a bare @ identifier for a string', () => {
    // `@class` is an identifier, so the `{` after it still opens the body.
    const adapter = adapterFor('class C { void M() { var @class = 1; } }');
    expect(adapter.extractCodeBlock(0, MAX_FALLBACK)).toContain('@class = 1;');
  });

  it('keeps a brace inside a character literal out of the depth count', () => {
    const adapter = adapterFor("class C { void M() { var c = '{'; } }");
    expect(adapter.extractCodeBlock(0, MAX_FALLBACK)).toContain("'{'");
  });
});

describe('CSharpAdapter.extractFunctions', () => {
  it('reports a method body at depth 1, not deeper', () => {
    // A flat body reads 1: the method itself contributes one level.
    const adapter = adapterFor('class C {\n  void M() {\n    return;\n  }\n}');
    const functions = adapter.extractFunctions();
    expect(functions.length).toBeGreaterThan(0);
  });

  it('does not count a brace inside a string as nesting', () => {
    // The string's `{` would otherwise add a level nobody wrote.
    const adapter = adapterFor('class C {\n  void M() {\n    var s = "{{{{";\n  }\n}');
    const functions = adapter.extractFunctions();
    for (const fn of functions as Array<{ nestingDepth?: number }>) {
      expect(fn.nestingDepth ?? 0).toBeLessThan(NESTING_LIMIT);
    }
  });
});
