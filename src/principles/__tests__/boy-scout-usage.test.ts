/**
 * @test REQ-453
 * @intent 使用文本从 `boy-scout.ts` 移到了独立模块，因为门禁的花括号验证把这个多行
 *         模板折进了 `showHelp` 的复杂度（报 7–8，而函数体只有一行 `console.log`，
 *         lizard 实测 CCN 1）。
 *
 *         移动的前提是**文本本身不能变**——它是用户读到的全部界面。这几条断言锁住
 *         三件用户依赖的事：帮助里出现每个受支持的选项、入口用法出现在首行、以及模块
 *         导出的是文本而不是函数。
 *
 * @covers AC-453-01
 */
import { describe, expect, it } from 'vitest';
import { USAGE_TEXT } from '../boy-scout-usage';

describe('USAGE_TEXT', () => {
  it('names the entry point on its first line', () => {
    // A usage block that does not start with the invocation is unreadable at a glance.
    expect(USAGE_TEXT.split('\n')[1]).toContain('boy-scout');
  });

  it('documents every flag the parser accepts', () => {
    // The flags below are the ones `parseArgs` handles; a help text that omits one sends
    // the reader to the source.
    for (const flag of ['--new-files', '--modified-files', '--baseline', '--prune-baseline']) {
      expect(USAGE_TEXT).toContain(flag);
    }
  });

  it('is plain text, not a template with placeholders left in', () => {
    // It was written as a template literal, so an unescaped `${` would be evaluated at
    // module load rather than printed.
    expect(USAGE_TEXT).not.toContain('${');
  });
});
