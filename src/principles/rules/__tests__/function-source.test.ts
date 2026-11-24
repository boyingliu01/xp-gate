/**
 * @test REQ-RULE-FUNCTION-SOURCE
 * @intent 每条按函数检查的规则都读同一份适配器数据、报同一种违规形状。这些管道被复制
 *         了三份，其中「违规指向哪一行」尤其危险：**三个规则各写一份
 *         `startLine ?? line ?? 1`，意味着针对某个规则写的行级豁免会漏掉同一个函数
 *         在另一规则下的违规，而且没有任何东西说明为什么。**
 *
 *         另外，缺行号时回退为 1 不是随意的：没有位置的违规无法被行级忽略压制，
 *         因此它保持可见，而不是被悄悄丢掉。
 *
 * @covers AC-RULE-FUNCTION-SOURCE-01
 * @covers AC-RULE-FUNCTION-SOURCE-02
 * @covers AC-RULE-FUNCTION-SOURCE-03
 */
import { describe, expect, it } from 'vitest';
import {
  extractFunctions,
  violationLineOf,
  severityOf,
} from '../function-source';
import type { InspectedFunction } from '../function-source';

describe('extractFunctions', () => {
  it('returns what the adapter reports', () => {
    const adapter = { extractFunctions: () => [{ name: 'a', paramCount: 9 }] };
    expect(extractFunctions(adapter)).toEqual([{ name: 'a', paramCount: 9 }]);
  });

  it('returns none when the adapter cannot report functions', () => {
    // An adapter that does not implement the surface contributes nothing; it must not
    // throw, because every rule calls this unconditionally.
    expect(extractFunctions({})).toEqual([]);
    expect(extractFunctions(undefined)).toEqual([]);
    expect(extractFunctions({ extractFunctions: undefined })).toEqual([]);
  });
});

describe('violationLineOf', () => {
  it('prefers startLine over line', () => {
    // Adapters disagree about which field they set; startLine is the more specific.
    expect(violationLineOf({ startLine: 12, line: 40 })).toBe(12);
  });

  it('falls back to line when startLine is absent', () => {
    expect(violationLineOf({ line: 40 })).toBe(40);
  });

  it('reports line 1 when neither is known', () => {
    // Deliberate: an unpinned violation cannot be suppressed by a line-based ignore,
    // so it stays visible rather than vanishing.
    expect(violationLineOf({})).toBe(1);
    expect(violationLineOf({ name: 'x' } as InspectedFunction)).toBe(1);
  });

  it('treats 0 as a position, not as missing', () => {
    // `?? ` is what makes this right: `||` would turn a 0 line into 1.
    expect(violationLineOf({ startLine: 0 })).toBe(0);
  });
});

describe('severityOf', () => {
  it('honours a configured severity', () => {
    expect(severityOf('error', 'warning')).toBe('error');
  });

  it('uses the rule default when nothing is configured', () => {
    expect(severityOf(undefined, 'info')).toBe('info');
    expect(severityOf(null, 'info')).toBe('info');
  });
});
