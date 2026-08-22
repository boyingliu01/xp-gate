/**
 * @test REQ-006-01 Archlint executable and generated-mirror modeling
 * @intent Verify dead-code entry points cover canonical CJS/MJS executables while clone exclusions target generated skill mirrors
 * @covers AC-006-01
 */

const fs = require('node:fs');
const path = require('node:path');
const { load } = require('js-yaml');

const configPath = path.resolve(__dirname, '../../.archlint.yaml');

describe('Archlint analysis boundaries', () => {
  const config = load(fs.readFileSync(configPath, 'utf8'));

  it.each([
    'scripts/**/*.cjs',
    'scripts/**/*.mjs',
    'skills/**/__tests__/*.cjs',
  ])('models %s as a dead-code entry point', entryPoint => {
    expect(config.entry_points ?? []).toContain(entryPoint);
  });

  it('excludes the generated Qoder skill tree from clone analysis', () => {
    expect(config.rules.code_clone.exclude).toContain('plugins/qoder/skills/**');
  });

  it('keeps generated npm skill and plugin mirrors globally ignored', () => {
    expect(config.ignore).toEqual(expect.arrayContaining([
      'src/npm-package/skills/**',
      'src/npm-package/plugins/**',
    ]));
  });

  it.each([
    'skills/**',
    'skills/**/__tests__/**',
    '**/__tests__/**',
    'scripts/**',
  ])('keeps canonical path %s in global analysis', canonicalPath => {
    expect(config.ignore).not.toContain(canonicalPath);
  });
});
