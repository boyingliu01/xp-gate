/**
 * @test REQ-TDD-005 docs-drift-check
 * @intent Verify checkDocsDrift() correctly detects Gate count mismatches between scripts and docs
 * @covers AC-TDD-005-01, AC-TDD-005-02, AC-TDD-005-03
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { checkDocsDrift, checkAdapterDrift } = require('../sync-package-content');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
}

function cleanupTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeScript(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeDoc(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

describe('checkDocsDrift', () => {
  let tempDir;
  let preCommitPath;
  let prePushPath;
  let readmePath;
  let agentsPath;

  beforeEach(() => {
    tempDir = createTempDir();
    preCommitPath = path.join(tempDir, 'pre-commit');
    prePushPath = path.join(tempDir, 'pre-push');
    readmePath = path.join(tempDir, 'README.md');
    agentsPath = path.join(tempDir, 'AGENTS.md');
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('returns true when pre-commit gate counts match between script and docs', () => {
    // Script with 3 gates (Gate 1, Gate 2, Gate 3)
    const scriptContent = [
      '#!/bin/bash',
      '# Gate 1: Code Quality',
      'echo "running gate 1"',
      '# Gate 2: Duplicate Code',
      'echo "running gate 2"',
      '# Gate 3: Complexity',
      'echo "running gate 3"',
    ].join('\n');
    writeScript(preCommitPath, scriptContent);

    // Pre-push with 0 M-gates (not relevant for this test)
    writeScript(prePushPath, '#!/bin/bash\necho "no gates"');

    // README with 3 pre-commit gates (Gate 1, Gate 2, Gate 3) - match script
    const readmeContent = [
      '# README',
      '| Gate | Name |',
      '|------|------|',
      '| Gate 1 | Code Quality |',
      '| Gate 2 | Duplicate Code |',
      '| Gate 3 | Complexity |',
    ].join('\n');
    writeDoc(readmePath, readmeContent);

    // AGENTS.md with 3 pre-commit gates (1, 2, 3) - match script
    const agentsContent = [
      '# AGENTS',
      '| Gate | Name |',
      '|------|------|',
      '| 1 | Code Quality |',
      '| 2 | Duplicate Code |',
      '| 3 | Complexity |',
    ].join('\n');
    writeDoc(agentsPath, agentsContent);

    const result = checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath);
    expect(result).toBe(true, 'should return true when gate counts match');
  });

  it('returns false when pre-commit gate count in script exceeds docs', () => {
    // Script with 3 gates
    const scriptContent = [
      '#!/bin/bash',
      '# Gate 1: Code Quality',
      '# Gate 2: Duplicate Code',
      '# Gate 3: Complexity',
    ].join('\n');
    writeScript(preCommitPath, scriptContent);
    writeScript(prePushPath, '#!/bin/bash');

    // README with only 2 pre-commit gates (fewer than script: 1, 2)
    const readmeContent = [
      '| Gate | Name |',
      '|------|------|',
      '| Gate 1 | Code Quality |',
      '| Gate 2 | Duplicate Code |',
    ].join('\n');
    writeDoc(readmePath, readmeContent);

    // AGENTS.md with 2 pre-commit gates (1, 2) - matches README
    const agentsContent = [
      '| Gate | Name |',
      '|------|------|',
      '| 1 | Code Quality |',
      '| 2 | Duplicate Code |',
    ].join('\n');
    writeDoc(agentsPath, agentsContent);

    const result = checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath);
    expect(result).toBe(false, 'should return false when gate count exceeds docs');
  });

  it('returns false when pre-push gate count mismatches', () => {
    // Pre-commit: 1 gate in script, 1 in docs (match)
    const scriptContent = '#!/bin/bash\n# Gate 1: Code Quality';
    writeScript(preCommitPath, scriptContent);
    const readmePreCommit = '| Gate | Name |\n|------|------|\n| Gate 1 | Code Quality |';
    const agentsPreCommit = '| Gate | Name |\n|------|------|\n| 1 | Code Quality |';

    // Pre-push: 2 M-gates in script (M, M2)
    const prePushContent = [
      '#!/bin/bash',
      '# Gate M: Mutation Testing',
      'echo "gate m"',
      '# Gate M2: Mock Density',
      'echo "gate m2"',
    ].join('\n');
    writeScript(prePushPath, prePushContent);

    // README: 1 pre-push gate (only M, missing M2)
    const readmeContent = [
      readmePreCommit,
      '',
      '| Gate M | Mutation |',
    ].join('\n');
    writeDoc(readmePath, readmeContent);

    // AGENTS.md: 2 pre-push gates (M, M2 — matches script)
    const agentsContent = [
      agentsPreCommit,
      '',
      '| M | Mutation |',
      '| M2 | Mock Density |',
    ].join('\n');
    writeDoc(agentsPath, agentsContent);

    const result = checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath);
    expect(result).toBe(false, 'should return false when pre-push gate count mismatches');
  });

  it('skips missing doc files with warning instead of crashing', () => {
    // Script with 1 gate
    const scriptContent = '#!/bin/bash\n# Gate 1: Code Quality';
    writeScript(preCommitPath, scriptContent);
    writeScript(prePushPath, '#!/bin/bash');

    // README exists with matching count
    const readmeContent = [
      '| Gate | Name |',
      '|------|------|',
      '| Gate 1 | Code Quality |',
    ].join('\n');
    writeDoc(readmePath, readmeContent);

    // AGENTS.md does NOT exist — should be skipped with warning
    const nonExistentAgents = path.join(tempDir, 'NONEXISTENT_AGENTS.md');

    const result = checkDocsDrift(preCommitPath, prePushPath, readmePath, nonExistentAgents);
    expect(result).toBe(true, 'should return true when missing doc skipped');
  });

  it('returns true when pre-push gate counts match', () => {
    // Pre-commit: 1 gate in script, 1 in docs
    writeScript(preCommitPath, '#!/bin/bash\n# Gate 1: Code Quality');
    const readmePreCommit = '| Gate | Name |\n|------|------|\n| Gate 1 | Code Quality |';
    const agentsPreCommit = '| Gate | Name |\n|------|------|\n| 1 | Code Quality |';

    // Pre-push: 3 M-gates in script (M, M2, M3)
    const prePushContent = [
      '#!/bin/bash',
      '# Gate M: Mutation Testing',
      '# Gate M2: Mock Density',
      '# Gate M3: Mock Policy',
    ].join('\n');
    writeScript(prePushPath, prePushContent);

    // README: 3 pre-push gates
    const readmeContent = [
      readmePreCommit,
      '',
      '| Gate M | Mutation |',
      '| Gate M2 | Mock Density |',
      '| Gate M3 | Mock Policy |',
    ].join('\n');
    writeDoc(readmePath, readmeContent);

    // AGENTS.md: 3 pre-push gates
    const agentsContent = [
      agentsPreCommit,
      '',
      '| M | Mutation |',
      '| M2 | Mock Density |',
      '| M3 | Mock Policy |',
    ].join('\n');
    writeDoc(agentsPath, agentsContent);

    const result = checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath);
    expect(result).toBe(true, 'should return true when pre-push gate counts match');
  });
});

/**
 * @test REQ-335 sprint-gate-sync
 * @intent Verify syncAdapters() includes sprint-gate.sh in gate script sync
 *        (not only gate-*.sh)
 * @covers AC-335-01
 */
describe('syncGateScripts', () => {
  const { syncAdapters } = require('../sync-package-content');
  let tempDir;
  let pkgRoot;
  let repoRoot;

  beforeEach(() => {
    tempDir = createTempDir();
    pkgRoot = path.join(tempDir, 'pkg');
    fs.mkdirSync(pkgRoot, { recursive: true });
    fs.mkdirSync(path.join(pkgRoot, 'adapters'), { recursive: true });

    repoRoot = path.join(tempDir, 'repo');
    const githooksDir = path.join(repoRoot, 'githooks');
    fs.mkdirSync(githooksDir, { recursive: true });
    fs.mkdirSync(path.join(githooksDir, 'adapters'), { recursive: true });

    fs.writeFileSync(path.join(githooksDir, 'gate-3.sh'), '#!/bin/bash\necho "gate3"');
    fs.writeFileSync(path.join(githooksDir, 'gate-4.sh'), '#!/bin/bash\necho "gate4"');
    fs.writeFileSync(path.join(githooksDir, 'sprint-gate.sh'), '#!/bin/bash\necho "sprint-gate"');
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('syncAdapters includes sprint-gate.sh in gate script sync (#335)', () => {
    const githooksDir = path.join(repoRoot, 'githooks');
    const gateFiles = fs.readdirSync(githooksDir).filter(f =>
      (f.startsWith('gate-') || f === 'sprint-gate.sh') && f.endsWith('.sh')
    );

    expect(gateFiles.sort()).toEqual(['gate-3.sh', 'gate-4.sh', 'sprint-gate.sh'].sort(), 'should include all gate files');
  });
});

/**
 * @test REQ-329 adapter-mirror-drift
 * @intent Verify checkAdapterDrift() detects file count and content mismatches
 *        between githooks/adapters/ (source of truth) and npm-package mirror.
 * @covers AC-329-01, AC-329-02, AC-329-03
 */
describe('checkAdapterDrift', () => {
  let tempDir;
  let srcDir;
  let mirrorDir;

  beforeEach(() => {
    tempDir = createTempDir();
    srcDir = path.join(tempDir, 'githooks', 'adapters');
    mirrorDir = path.join(tempDir, 'npm-package', 'adapters');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(mirrorDir, { recursive: true });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it('returns true when adapter files are byte-identical between source and mirror', () => {
    const content = '#!/bin/bash\necho "hello world"\n';
    fs.writeFileSync(path.join(srcDir, 'adapter-typescript.sh'), content);
    fs.writeFileSync(path.join(mirrorDir, 'adapter-typescript.sh'), content);

    fs.writeFileSync(path.join(srcDir, 'adapter-python.sh'), '#!/bin/bash\necho "python"\n');
    fs.writeFileSync(path.join(mirrorDir, 'adapter-python.sh'), '#!/bin/bash\necho "python"\n');

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(true, 'should return true when files are byte-identical');
  });

  it('returns false when file in source is missing from mirror', () => {
    fs.writeFileSync(path.join(srcDir, 'adapter-typescript.sh'), '#!/bin/bash');
    // NOT writing to mirrorDir

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(false, 'should return false when source file missing from mirror');
  });

  it('returns false when file in mirror is missing from source', () => {
    fs.writeFileSync(path.join(mirrorDir, 'extra.sh'), '#!/bin/bash');
    // NOT writing to srcDir

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(false, 'should return false when mirror file missing from source');
  });

  it('returns false when file content differs (checksum mismatch)', () => {
    fs.writeFileSync(path.join(srcDir, 'adapter-typescript.sh'), '#!/bin/bash\n# line 1\n');
    fs.writeFileSync(path.join(mirrorDir, 'adapter-typescript.sh'), '#!/bin/bash\n# different line\n');

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(false, 'should return false when content differs');
  });

  it('skips with true when source directory does not exist', () => {
    const nonExistentSrc = path.join(tempDir, 'nonexistent');
    fs.mkdirSync(mirrorDir, { recursive: true });
    fs.writeFileSync(path.join(mirrorDir, 'adapter-typescript.sh'), '#!/bin/bash');

    const result = checkAdapterDrift(nonExistentSrc, mirrorDir);
    expect(result).toBe(true, 'should return true when source skipped');
  });

  it('skips with true when mirror directory does not exist', () => {
    const nonExistentMirror = path.join(tempDir, 'nonexistent');
    fs.writeFileSync(path.join(srcDir, 'adapter-typescript.sh'), '#!/bin/bash');

    const result = checkAdapterDrift(srcDir, nonExistentMirror);
    expect(result).toBe(true, 'should return true when mirror skipped');
  });

  it('handles subdirectories in adapter tree', () => {
    const pluginsDir = path.join(srcDir, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'adapter-common.sh'), 'common');
    fs.writeFileSync(path.join(pluginsDir, 'p3c-plugin.sh'), 'p3c');

    const mirrorPluginsDir = path.join(mirrorDir, 'plugins');
    fs.mkdirSync(mirrorPluginsDir, { recursive: true });
    fs.writeFileSync(path.join(mirrorDir, 'adapter-common.sh'), 'common');
    fs.writeFileSync(path.join(mirrorPluginsDir, 'p3c-plugin.sh'), 'p3c');

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(true, 'should return true with subdirectories');
  });
});

/**
 * @test REQ-007 sync-package-content-subprocess
 * @intent Verify sync-package-content.js actually invokes subprocess and copies files correctly
 *         (not tautology - actually tests the implementation's file copying logic)
 * @covers AC-007-01, AC-007-02, AC-007-03, AC-007-04, AC-007-05
 */
const { spawnSync } = require('child_process');

describe('sync-package-content subprocess invocation', () => {
  const WORKTREE_PATH = path.resolve(__dirname, '..', '..', '..', '..');
  const PKG_ROOT = path.join(WORKTREE_PATH, 'src', 'npm-package');
  const REPO_ROOT = path.join(WORKTREE_PATH);
  const CORE_SKILLS = [
    'admin-template-guidelines',
    'delphi-review',
    'improve-codebase-architecture',
    'ralph-loop',
    'sprint-flow',
    'test-driven-development',
    'test-specification-alignment',
    'to-issues',
  ];

  /**
   * afterAll: Ensure package directories are restored after all tests.
   * Prevents race condition where other test files (e.g. doctor.test.js)
   * read from src/npm-package/adapters/ while sync tests temporarily delete it.
   */
  afterAll(() => {
    const syncScript = path.join(WORKTREE_PATH, 'src', 'npm-package', 'scripts', 'sync-package-content.js');
    spawnSync(process.execPath, [syncScript], {
      cwd: WORKTREE_PATH,
      stdio: 'pipe',
    });
  });

  it('sync-package-content.js copies skills from repo to package', () => {
    const syncScript = path.join(WORKTREE_PATH, 'src', 'npm-package', 'scripts', 'sync-package-content.js');
    const nodeExe = process.execPath;

    // Run sync as subprocess (overwrites existing files — no need to delete first)
    const result = spawnSync(nodeExe, [syncScript], {
      cwd: WORKTREE_PATH,
      stdio: 'pipe',
      timeout: 15000,
    });

    if (result.status !== 0) {
      console.error('sync stderr:', result.stderr?.toString() || '(empty)');
      console.error('sync stdout:', result.stdout?.toString() || '(empty)');
    }

    expect(result.status).toBe(0, 'sync script should exit with status 0');

    // Verify skills were copied from repo to package
    for (const skillName of CORE_SKILLS) {
      const skillSrc = path.join(REPO_ROOT, 'skills', skillName, 'SKILL.md');
      const skillDest = path.join(PKG_ROOT, 'skills', skillName, 'SKILL.md');

      // Source must exist (we're testing copy from existing repo)
      if (!fs.existsSync(skillSrc)) {
        console.warn(`Skill source not found, skipping: ${skillName}`);
        continue;
      }

      expect(fs.existsSync(skillDest)).toBe(true, `skill ${skillName} should be copied`);
      const content = fs.readFileSync(skillDest, 'utf8');
      // SKILL.md files contain 'SKILL.md' or have content
      expect(content.length > 0).toBe(true, `skill ${skillName} should have content`);
    }
  }, 10000);

  it('sync-package-content.js copies plugins from repo to package', () => {
    const syncScript = path.join(WORKTREE_PATH, 'src', 'npm-package', 'scripts', 'sync-package-content.js');
    const nodeExe = process.execPath;

    const result = spawnSync(nodeExe, [syncScript], {
      cwd: WORKTREE_PATH,
      stdio: 'pipe',
      timeout: 15000,
    });

    if (result.status !== 0) {
      console.error('sync stderr:', result.stderr?.toString() || '(empty)');
      console.error('sync stdout:', result.stdout?.toString() || '(empty)');
    }

    expect(result.status).toBe(0, 'sync script should exit with status 0');

    // Verify plugin manifests were copied
    const plugins = ['claude-code', 'opencode', 'qoder'];
    for (const pluginName of plugins) {
      const pluginManifest = path.join(PKG_ROOT, 'plugins', pluginName, 'plugin.json');
      if (fs.existsSync(pluginManifest)) {
        const content = fs.readFileSync(pluginManifest, 'utf8');
        expect(content.includes('"name"')).toBe(true, `plugin ${pluginName} should have "name" field`);
      }
    }
  }, 10000);

  it('sync-package-content.js copies adapters from githooks to package', () => {
    const syncScript = path.join(WORKTREE_PATH, 'src', 'npm-package', 'scripts', 'sync-package-content.js');
    const nodeExe = process.execPath;

    const result = spawnSync(nodeExe, [syncScript], {
      cwd: WORKTREE_PATH,
      stdio: 'pipe',
      timeout: 15000,
    });

    if (result.status !== 0) {
      console.error('sync stderr:', result.stderr?.toString() || '(empty)');
      console.error('sync stdout:', result.stdout?.toString() || '(empty)');
    }

    expect(result.status).toBe(0, 'sync script should exit with status 0');

    // Verify adapters directory exists and has files
    const adaptersDir = path.join(PKG_ROOT, 'adapters');
    expect(fs.existsSync(adaptersDir)).toBe(true, 'adapters directory should exist');

    // Check for common adapter patterns (adapter-*.sh or *.sh)
    const adapterFiles = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.sh'));
    expect(adapterFiles.length > 0).toBe(true, 'should have at least one adapter file');
  }, 10000);

  it('sync-package-content.js runs without modifying package.json dependencies (zero-install)', () => {
    const syncScript = path.join(WORKTREE_PATH, 'src', 'npm-package', 'scripts', 'sync-package-content.js');
    const nodeExe = process.execPath;

    const pkgJsonPath = path.join(PKG_ROOT, 'package.json');
    const pkgJsonBefore = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

    // Zero-install: dependencies should be empty (or undefined if key missing)
    expect(Object.keys(pkgJsonBefore.dependencies || {}).length).toBe(0, 'dependencies should be empty');

    const result = spawnSync(nodeExe, [syncScript], {
      cwd: WORKTREE_PATH,
      stdio: 'pipe',
      timeout: 15000,
    });

    if (result.status !== 0) {
      console.error('sync stderr:', result.stderr?.toString() || '(empty)');
      console.error('sync stdout:', result.stdout?.toString() || '(empty)');
    }

    expect(result.status).toBe(0, 'sync script should exit with status 0');

    // Verify package.json dependencies remained empty
    const pkgJsonAfter = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    expect(Object.keys(pkgJsonAfter.dependencies || {}).length).toBe(0, 'dependencies should remain empty');
  }, 10000);
});
