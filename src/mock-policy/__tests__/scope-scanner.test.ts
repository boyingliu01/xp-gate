/**
 * @test REQ-SCOPE-001 Scope Scanner
 * @intent Verify project scope scanning classifies imports correctly
 * @covers AC-SCOPE-01, AC-SCOPE-02, AC-SCOPE-03
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  simpleGlobMatch,
  isExternalImport,
  resolveToRealPath,
  loadExternalDependencies,
  classifyDependency,
  scanProjectScope,
} from '../scope-scanner';
import type { ScanOptions } from '../scope-scanner';
import type { ProjectScope } from '../types';

// ---------------------------------------------------------------------------
// simpleGlobMatch
// ---------------------------------------------------------------------------
describe('simpleGlobMatch', () => {
  it('matches exact literal patterns', () => {
    expect(simpleGlobMatch('src/index.ts', 'src/index.ts')).toBe(true);
  });

  it('rejects non-matching literal patterns', () => {
    expect(simpleGlobMatch('src/index.ts', 'src/foo.ts')).toBe(false);
  });

  it('matches ** (globstar) across path separators', () => {
    expect(simpleGlobMatch('src/**/*.ts', 'src/a/b/c.ts')).toBe(true);
  });

  it('matches * (single-star) within a single path segment', () => {
    expect(simpleGlobMatch('src/*.ts', 'src/index.ts')).toBe(true);
  });

  it('rejects * crossing path separators', () => {
    expect(simpleGlobMatch('src/*.ts', 'src/a/b.ts')).toBe(false);
  });

  it('matches ** at the root', () => {
    expect(simpleGlobMatch('**/*.ts', 'some/deep/file.ts')).toBe(true);
  });

  it('handles leading **/ patterns', () => {
    expect(simpleGlobMatch('**/foo', 'a/b/c/foo')).toBe(true);
  });

  it('handles trailing /** patterns', () => {
    expect(simpleGlobMatch('src/**', 'src/a/b/c')).toBe(true);
  });

  it('handles dots in filenames correctly', () => {
    expect(simpleGlobMatch('*.test.ts', 'foo.test.ts')).toBe(true);
    expect(simpleGlobMatch('*.test.ts', 'footest.ts')).toBe(false);
  });

  it('matches ? as a single non-slash character', () => {
    expect(simpleGlobMatch('src/?.ts', 'src/a.ts')).toBe(true);
    expect(simpleGlobMatch('src/?.ts', 'src/ab.ts')).toBe(false);
  });

  it('escapes regex special characters in patterns', () => {
    expect(simpleGlobMatch('src/file+[test].ts', 'src/file+[test].ts')).toBe(true);
    expect(simpleGlobMatch('src/file+[test].ts', 'src/fileXtest.ts')).toBe(false);
  });

  it('returns false for invalid regex patterns gracefully', () => {
    // A pattern that would cause regex construction to fail
    expect(simpleGlobMatch('src/[invalid', 'src/foo')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isExternalImport
// ---------------------------------------------------------------------------
describe('isExternalImport', () => {
  const defaultOptions: ScanOptions = {
    projectRoot: '/fake/project',
    imports: [],
    boundary: ['@/components/**', '@/utils/**'],
  };

  it('returns true for Node.js builtins', () => {
    expect(isExternalImport('fs', defaultOptions)).toBe(true);
    expect(isExternalImport('path', defaultOptions)).toBe(true);
    expect(isExternalImport('os', defaultOptions)).toBe(true);
    expect(isExternalImport('http', defaultOptions)).toBe(true);
    expect(isExternalImport('https', defaultOptions)).toBe(true);
    expect(isExternalImport('crypto', defaultOptions)).toBe(true);
    expect(isExternalImport('stream', defaultOptions)).toBe(true);
    expect(isExternalImport('events', defaultOptions)).toBe(true);
    expect(isExternalImport('util', defaultOptions)).toBe(true);
    expect(isExternalImport('url', defaultOptions)).toBe(true);
    expect(isExternalImport('querystring', defaultOptions)).toBe(true);
    expect(isExternalImport('assert', defaultOptions)).toBe(true);
    expect(isExternalImport('buffer', defaultOptions)).toBe(true);
    expect(isExternalImport('child_process', defaultOptions)).toBe(true);
    expect(isExternalImport('cluster', defaultOptions)).toBe(true);
    expect(isExternalImport('dns', defaultOptions)).toBe(true);
    expect(isExternalImport('net', defaultOptions)).toBe(true);
    expect(isExternalImport('tls', defaultOptions)).toBe(true);
    expect(isExternalImport('readline', defaultOptions)).toBe(true);
    expect(isExternalImport('process', defaultOptions)).toBe(true);
    expect(isExternalImport('v8', defaultOptions)).toBe(true);
    expect(isExternalImport('vm', defaultOptions)).toBe(true);
    expect(isExternalImport('zlib', defaultOptions)).toBe(true);
  });

  it('returns true for node: prefix builtins', () => {
    expect(isExternalImport('node:fs', defaultOptions)).toBe(true);
    expect(isExternalImport('node:path', defaultOptions)).toBe(true);
    expect(isExternalImport('node:crypto', defaultOptions)).toBe(true);
  });

  it('returns true for bare npm packages', () => {
    expect(isExternalImport('lodash', defaultOptions)).toBe(true);
    expect(isExternalImport('express', defaultOptions)).toBe(true);
    expect(isExternalImport('react', defaultOptions)).toBe(true);
    expect(isExternalImport('@scope/package', defaultOptions)).toBe(true);
  });

  it('returns false for relative imports starting with .', () => {
    expect(isExternalImport('./foo', defaultOptions)).toBe(false);
    expect(isExternalImport('../bar', defaultOptions)).toBe(false);
    expect(isExternalImport('./utils/helper', defaultOptions)).toBe(false);
  });

  it('returns false for @/ alias imports', () => {
    expect(isExternalImport('@/components/Button', defaultOptions)).toBe(false);
    expect(isExternalImport('@/utils/format', defaultOptions)).toBe(false);
  });

  it('returns false for absolute imports matching boundary', () => {
    const boundaryOptions: ScanOptions = {
      ...defaultOptions,
      boundary: ['@/components/**', '@/utils/**', 'src/modules/**'],
    };
    expect(isExternalImport('src/modules/auth', boundaryOptions)).toBe(false);
  });

  it('returns false for absolute imports starting with /', () => {
    expect(isExternalImport('/opt/node/foo', defaultOptions)).toBe(false);
  });

  it('returns true for bare imports not matching boundary', () => {
    const strictOptions: ScanOptions = {
      ...defaultOptions,
      boundary: ['src/components/**'],
    };
    expect(isExternalImport('src/utils/helper', strictOptions)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveToRealPath
// ---------------------------------------------------------------------------
describe('resolveToRealPath', () => {
  it('replaces @/ prefix with src/', () => {
    const result = resolveToRealPath('@/components/Button', '/project');
    expect(result).toBe('/project/src/components/Button');
  });

  it('preserves paths without @/ alias', () => {
    const result = resolveToRealPath('./foo/bar', '/project');
    // resolve normalizes ./ away
    expect(result).toBe('/project/foo/bar');
  });

  it('resolves absolute paths correctly', () => {
    const result = resolveToRealPath('/absolute/path', '/project');
    // Absolute paths remain absolute (resolve treats them as-is)
    expect(result).toBe('/absolute/path');
  });
});

// ---------------------------------------------------------------------------
// loadExternalDependencies
// ---------------------------------------------------------------------------
describe('loadExternalDependencies', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `scope-scanner-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no package.json', async () => {
    const deps = await loadExternalDependencies(tmpDir);
    expect(deps).toEqual([]);
  });

  it('reads dependencies from package.json', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          react: '^18.0.0',
          lodash: '^4.17.21',
        },
      }),
    );
    const deps = await loadExternalDependencies(tmpDir);
    expect(deps).toEqual(['lodash', 'react']);
  });

  it('includes devDependencies and peerDependencies', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^18.0.0' },
        devDependencies: { vitest: '^1.0.0' },
        peerDependencies: { react: '^18.0.0' },
      }),
    );
    const deps = await loadExternalDependencies(tmpDir);
    expect(deps).toEqual(['react', 'vitest']);
  });

  it('skips workspace:* protocol packages', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          react: '^18.0.0',
          'my-lib': 'workspace:*',
          'other-lib': 'workspace:^1.0.0',
        },
      }),
    );
    const deps = await loadExternalDependencies(tmpDir);
    expect(deps).toEqual(['react']);
  });

  it('handles invalid package.json gracefully', async () => {
    writeFileSync(join(tmpDir, 'package.json'), 'not-json');
    const deps = await loadExternalDependencies(tmpDir);
    expect(deps).toEqual([]);
  });

  it('handles empty package.json gracefully', async () => {
    writeFileSync(join(tmpDir, 'package.json'), '{}');
    const deps = await loadExternalDependencies(tmpDir);
    expect(deps).toEqual([]);
  });

  it('returns sorted package names', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          zod: '^3.0.0',
          axios: '^1.0.0',
        },
      }),
    );
    const deps = await loadExternalDependencies(tmpDir);
    expect(deps).toEqual(['axios', 'zod']);
  });
});

// ---------------------------------------------------------------------------
// classifyDependency
// ---------------------------------------------------------------------------
describe('classifyDependency', () => {
  const baseScope: ProjectScope = {
    implementedModules: ['@/components/Button', '@/utils/format'],
    unimplementedModules: ['@/components/FutureComponent', '@/utils/pendingUtil'],
    externalPackages: ['react', 'lodash', '@scope/package'],
    projectBoundary: ['@/components/**', '@/utils/**'],
  };

  const baseOptions: ScanOptions = {
    projectRoot: '/fake/project',
    imports: [],
    boundary: ['@/components/**', '@/utils/**'],
  };

  it('classifies implemented modules as internal', () => {
    expect(classifyDependency('@/components/Button', baseScope, baseOptions)).toBe('internal');
    expect(classifyDependency('@/utils/format', baseScope, baseOptions)).toBe('internal');
  });

  it('classifies unimplemented modules as pending', () => {
    expect(classifyDependency('@/components/FutureComponent', baseScope, baseOptions)).toBe('pending');
    expect(classifyDependency('@/utils/pendingUtil', baseScope, baseOptions)).toBe('pending');
  });

  it('classifies known external packages as external', () => {
    expect(classifyDependency('react', baseScope, baseOptions)).toBe('external');
    expect(classifyDependency('lodash', baseScope, baseOptions)).toBe('external');
  });

  it('classifies scoped external packages as external', () => {
    expect(classifyDependency('@scope/package', baseScope, baseOptions)).toBe('external');
  });

  it('classifies sub-path of external packages as external', () => {
    expect(classifyDependency('react/dom', baseScope, baseOptions)).toBe('external');
    expect(classifyDependency('lodash/map', baseScope, baseOptions)).toBe('external');
  });

  it('returns external for Node.js builtins', () => {
    expect(classifyDependency('fs', baseScope, baseOptions)).toBe('external');
    expect(classifyDependency('path', baseScope, baseOptions)).toBe('external');
  });

  it('uses existCache when provided', () => {
    const cache = new Map<string, boolean>();
    cache.set('/fake/project/src/foo', true);

    const result = classifyDependency('@/foo', baseScope, {
      ...baseOptions,
      boundary: ['@/**'],
    }, cache);

    expect(result).toBe('internal');
  });

  it('classifies non-existent boundary path as pending', () => {
    const cache = new Map<string, boolean>();
    cache.set('/fake/project/src/missing/helper', false);

    const result = classifyDependency('@/missing/helper', baseScope, {
      ...baseOptions,
      boundary: ['@/missing/**'],
    }, cache);

    expect(result).toBe('pending');
  });

  it('classifies unknown bare import as external', () => {
    expect(classifyDependency('unknown-pkg', baseScope, baseOptions)).toBe('external');
  });
});

// ---------------------------------------------------------------------------
// scanProjectScope (integration-level tests with real tmp dir)
// ---------------------------------------------------------------------------
describe('scanProjectScope', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `scope-scanner-integration-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Create a real project structure
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    mkdirSync(join(tmpDir, 'src', 'components'), { recursive: true });
    mkdirSync(join(tmpDir, 'src', 'utils'), { recursive: true });

    // Create some files that exist
    writeFileSync(join(tmpDir, 'src', 'components', 'Button.ts'), '');
    writeFileSync(join(tmpDir, 'src', 'utils', 'format.ts'), '');
    writeFileSync(join(tmpDir, 'src', 'index.ts'), '');

    // package.json with some dependencies
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          react: '^18.0.0',
          lodash: '^4.17.21',
        },
        devDependencies: {
          vitest: '^1.0.0',
        },
      }),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('classifies existing src files as implemented', async () => {
    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: ['./src/components/Button.ts', './src/utils/format.ts'],
      boundary: [],
    });

    expect(result.implementedModules).toContain('./src/components/Button.ts');
    expect(result.implementedModules).toContain('./src/utils/format.ts');
    expect(result.unimplementedModules).toEqual([]);
  });

  it('classifies non-existent files as unimplemented', async () => {
    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: ['./src/missing.ts'],
      boundary: [],
    });

    expect(result.implementedModules).toEqual([]);
    expect(result.unimplementedModules).toContain('./src/missing.ts');
  });

  it('classifies external npm packages', async () => {
    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: ['react', 'lodash', 'vitest'],
      boundary: [],
    });

    expect(result.externalPackages).toContain('react');
    expect(result.externalPackages).toContain('lodash');
    expect(result.externalPackages).toContain('vitest');
  });

  it('classifies Node.js builtins as external', async () => {
    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: ['fs', 'path', 'os'],
      boundary: [],
    });

    expect(result.externalPackages).toContain('fs');
    expect(result.externalPackages).toContain('path');
    expect(result.externalPackages).toContain('os');
  });

  it('handles @/ alias resolution', async () => {
    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: ['@/components/Button.ts', '@/utils/format.ts'],
      boundary: [],
    });

    expect(result.implementedModules).toContain('@/components/Button.ts');
    expect(result.implementedModules).toContain('@/utils/format.ts');
  });

  it('classifies boundary-matching imports as implemented', async () => {
    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: ['@/components/Button.ts'],
      boundary: ['@/components/**'],
    });

    expect(result.implementedModules).toContain('@/components/Button.ts');
  });

  it('removes duplicate entries from results', async () => {
    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: ['./src/index.ts', './src/index.ts', './src/index.ts'],
      boundary: [],
    });

    expect(result.implementedModules).toEqual(['./src/index.ts']);
  });

  it('stores projectBoundary in result', async () => {
    const boundary = ['@/components/**', '@/utils/**'];
    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: [],
      boundary,
    });

    expect(result.projectBoundary).toEqual(boundary);
  });

  it('classifies mixed imports correctly', async () => {
    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: [
        // External
        'react',
        'lodash',
        'fs',
        // Implemented
        './src/components/Button.ts',
        '@/utils/format.ts',
        // Unimplemented
        './src/missing.ts',
        '@/components/NonExistent.ts',
      ],
      boundary: ['@/components/**', '@/utils/**'],
    });

    expect(result.externalPackages).toContain('react');
    expect(result.externalPackages).toContain('lodash');
    expect(result.externalPackages).toContain('fs');

    expect(result.implementedModules).toContain('./src/components/Button.ts');
    expect(result.implementedModules).toContain('@/utils/format.ts');

    expect(result.unimplementedModules).toContain('./src/missing.ts');
    expect(result.unimplementedModules).toContain('@/components/NonExistent.ts');
  });

  it('handles @scope/npm-package bare imports', async () => {
    // Add a scoped package to package.json
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@scope/package': '^1.0.0',
        },
      }),
    );

    const result = await scanProjectScope({
      projectRoot: tmpDir,
      imports: ['@scope/package'],
      boundary: [],
    });

    expect(result.externalPackages).toContain('@scope/package');
  });
});
