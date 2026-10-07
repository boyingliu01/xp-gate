/**
 * @test REQ-486
 * @intent scripts/test-plugins.sh 在 Windows/Git Bash 必然假失败且无调用方，与全绿的
 *         .mjs 孪生构成永久红的守卫负资产；删除后必须没有任何现役文件再引用它（#486）
 * @covers AC-486-01, AC-486-02, AC-486-03
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const TEXT_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.json', '.md', '.yml', '.yaml', '.sh']);
const SKIPPED_DIRS = new Set(['node_modules', '.stryker-tmp', 'dist', '.git', '.sprint-state', '.xp-gate']);

// docs/plans/*, CHANGELOG and evidence artifacts record what happened; they are
// not live references and must not fail this guard.
const EXEMPT_PATHS = [
  'docs' + path.sep,
  'CHANGELOG.md',
  '.code-walkthrough-result.json',
  '.qoder' + path.sep,
  // This guard necessarily names the script it forbids.
  'scripts' + path.sep + '__tests__' + path.sep + 'dead-plugin-test-script.test.cjs',
];

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
      continue;
    }
    if (entry.isFile()) yield path.join(dir, entry.name);
  }
}

function liveFilesReferencing(name) {
  const hits = [];
  for (const file of walk(repoRoot)) {
    if (!TEXT_EXTENSIONS.has(path.extname(file))) continue;
    const relative = path.relative(repoRoot, file);
    if (EXEMPT_PATHS.some((exempt) => relative.startsWith(exempt))) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes(name)) hits.push(relative);
  }
  return hits;
}

describe('dead plugin-test script (#486)', () => {
  it('leaves no scripts/test-plugins.sh behind', () => {
    expect(fs.existsSync(path.join(repoRoot, 'scripts', 'test-plugins.sh'))).toBe(false);
  });

  it('keeps the cross-platform twin that replaces it', () => {
    // Anti-vacuity: deleting both halves would also satisfy the first check.
    expect(fs.existsSync(path.join(repoRoot, 'scripts', 'test-plugins.mjs'))).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:plugins']).toContain('test-plugins.mjs');
  });

  it.each(['AGENTS.md', path.join('plugins', 'AGENTS.md')])(
    'points %s at the twin instead of the deleted script',
    (relativeDoc) => {
      const doc = fs.readFileSync(path.join(repoRoot, relativeDoc), 'utf8');
      expect(doc).toContain('test-plugins.mjs');
      expect(doc).not.toContain('test-plugins.sh');
    }
  );

  it('has no remaining live reference to the deleted script', () => {
    expect(liveFilesReferencing('test-plugins.sh')).toEqual([]);
  });
});
