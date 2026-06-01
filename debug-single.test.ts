import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFile } from 'fs/promises';
import { scanProjectScope } from './src/mock-policy/scope-scanner';
import MockDecisionEngine from './src/mock-policy/mock-decision-engine';
import type { MockPolicyConfig } from './src/mock-policy/types';

const config: MockPolicyConfig = {
  version: 1,
  layers: {
    unit: { mockPolicy: 'lenient', requireRealForImplemented: false, allowExternalMock: true, requirePendingRemoval: false, maxMockDensity: 100 },
    integration: { mockPolicy: 'strict', requireRealForImplemented: true, allowExternalMock: true, requirePendingRemoval: true, maxMockDensity: 30 },
    e2e: { mockPolicy: 'strict', requireRealForImplemented: true, allowExternalMock: false, requirePendingRemoval: false, maxMockDensity: 0 },
  },
  projectBoundary: ['src/**'],
  severity: 'warning',
};

function collectImports(content: string): string[] {
  const r = /import\s*(?:type\s*)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:from\s*)?['"]([^'"]+)['"]/g;
  const d = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const imports: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(content)) !== null) imports.push(m[1]);
  while ((m = d.exec(content)) !== null) imports.push(m[1]);
  return [...new Set(imports)];
}

describe('debug', () => {
  it('debug test', async () => {
    const tmpDir = join(tmpdir(), 'debug-' + Date.now());
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { stripe: '^12.0.0' } }));
    mkdirSync(join(tmpDir, 'src', 'utils'), { recursive: true });
    mkdirSync(join(tmpDir, 'src', '__tests__'), { recursive: true });
    writeFileSync(join(tmpDir, 'src', 'utils', 'helper.ts'), 'export const greet = () => "hello";');
    writeFileSync(join(tmpDir, 'src', 'utils', 'logger.ts'), 'export const log = (msg: any) => console.log(msg);');

    const testFile = join(tmpDir, 'src/__tests__/helper.integration.test.ts');
    writeFileSync(testFile, [
      "import { greet } from 'src/utils/helper';",
      "import { log } from 'src/utils/logger';",
      '',
      "describe('helper', () => {",
      "  it('should greet', () => {",
      "    expect(greet()).toBe('hello');",
      '  });',
      '});',
    ].join('\n'));

    const content = await readFile(testFile, 'utf-8');
    const collected = collectImports(content);
    console.log('collected:', collected);

    const scope = await scanProjectScope({
      projectRoot: tmpDir,
      imports: [...collected, 'src/utils/helper', 'src/utils/logger'],
      boundary: ['src/**'],
    });
    console.log('implementedModules:', scope.implementedModules);
    console.log('unimplementedModules:', scope.unimplementedModules);

    const engine = new MockDecisionEngine(scope, config);
    for (const imp of collected) {
      const d = engine.decide(imp, 'integration');
      console.log(`decide('${imp}'):`, JSON.stringify(d));
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
