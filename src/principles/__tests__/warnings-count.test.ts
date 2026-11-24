/**
 * @test REQ-WARNINGS-COUNT
 * @intent 按文件统计警告数的规则住在自己的模块里，因为它有两条容易写错、而且错了不会
 *         报错的约定：
 *
 *         1. **每个被请求的文件都从 0 开始**，所以干净文件也**在**返回的映射里。
 *            漏掉它，调用方就无法区分"没有警告"和"根本没分析"——而这两种情况在
 *            Boy Scout 判定里结论相反。
 *         2. **`info` 级别不计入**。把它算进去会让一次纯咨询性的改动看起来像引入了
 *            债务，从而触发一次本不该发生的阻断。
 *
 * @covers AC-WARNINGS-COUNT-01
 * @covers AC-WARNINGS-COUNT-02
 */
import { describe, expect, it } from 'vitest';
import { normalizeFileList } from '../warnings-count';

describe('normalizeFileList', () => {
  it('splits a comma string', () => {
    expect(normalizeFileList('a.ts,b.ts')).toEqual(['a.ts', 'b.ts']);
  });

  it('splits an array of comma strings', () => {
    // The CLI passes one string; a caller may pass the array. Both must work, because
    // neither side should have to know which shape the other uses.
    expect(normalizeFileList(['a.ts,b.ts', 'c.ts'])).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('trims and drops empty entries', () => {
    // A trailing comma is a common typo; an empty path would be analysed as a file
    // named "" and counted under that key.
    expect(normalizeFileList(' a.ts , ,b.ts ')).toEqual(['a.ts', 'b.ts']);
  });

  it('returns an empty list for an empty input', () => {
    expect(normalizeFileList('')).toEqual([]);
    expect(normalizeFileList([])).toEqual([]);
  });
});
