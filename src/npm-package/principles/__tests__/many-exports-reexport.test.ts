/**
 * @test REQ-CCLINT-001
 * @intent a pure re-export barrel (export { … } from './x') forwards names but
 *         adds no module surface; counting each forwarded member inflates the
 *         many-exports metric and blocks Boy-Scout splits that are exactly what
 *         the rule asks for (common.ts → common-process.ts)
 * @covers AC-CCLINT-001-01
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { TypeScriptAdapter } from '../adapters/typescript';

vi.mock('fs', () => ({ readFileSync: vi.fn() }));

function exportCount(content: string): number {
  (readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(content);
  return new TypeScriptAdapter('t.ts').extractExports().length;
}

describe('extractExports counts module surface, not forwarded names', () => {
  it('does not count members of an export-from re-export block', () => {
    const content = [
      "export {",
      '  type ToolAvailability,',
      '  isToolAvailable,',
      '  runTool,',
      "  getChangedFiles,",
      "} from './common-process';",
      'export function local(): void {}',
      '',
    ].join('\n');
    // One local export only — the six forwarded names are not this module's surface.
    expect(exportCount(content)).toBe(1);
  });

  it('still counts local export { A, B } blocks without a from clause', () => {
    const content = ['export { alpha, beta };', 'const alpha = 1;', 'const beta = 2;', ''].join('\n');
    expect(exportCount(content)).toBe(2);
  });
});
