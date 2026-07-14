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

function writeScript(path, content) {
  fs.writeFileSync(path, content, 'utf8');
}

function writeDoc(path, content) {
  fs.writeFileSync(path, content, 'utf8');
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

  test('returns true when pre-commit gate counts match between script and docs', () => {
    // Script with 3 gates (GATE 1, GATE 2, GATE 3)
    const scriptContent = [
      '#!/bin/bash',
      '# GATE 1: Code Quality',
      'echo "running gate 1"',
      '# GATE 2: Duplicate Code',
      'echo "running gate 2"',
      '# GATE 3: Complexity',
      'echo "running gate 3"',
    ].join('\n');
    writeScript(preCommitPath, scriptContent);

    // Pre-push with 0 M-gates (not relevant for this test)
    writeScript(prePushPath, '#!/bin/bash\necho "no gates"');

    // README with 3 pre-commit gates (Gate 0, Gate 1, Gate 2)
    const readmeContent = [
      '# README',
      '| Gate | Name |',
      '|------|------|',
      '| Gate 0 | Version |',
      '| Gate 1 | Code Quality |',
      '| Gate 2 | Duplicate Code |',
    ].join('\n');
    writeDoc(readmePath, readmeContent);

    // AGENTS.md with 3 pre-commit gates (0, 1, 2)
    const agentsContent = [
      '# AGENTS',
      '| Gate | Name |',
      '|------|------|',
      '| 0 | Version |',
      '| 1 | Code Quality |',
      '| 2 | Duplicate Code |',
    ].join('\n');
    writeDoc(agentsPath, agentsContent);

    const result = checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath);
    expect(result).toBe(true);
  });

  test('exits with error when pre-commit gate count in script exceeds docs', () => {
    // Script with 3 gates (use "Gate" not "GATE" to match actual regex)
    const scriptContent = [
      '#!/bin/bash',
      '# Gate 1: Code Quality',
      '# Gate 2: Duplicate Code',
      '# Gate 3: Complexity',
    ].join('\n');
    writeScript(preCommitPath, scriptContent);
    writeScript(prePushPath, '#!/bin/bash');

    // README with only 2 pre-commit gates (fewer than script)
    const readmeContent = [
      '| Gate | Name |',
      '|------|------|',
      '| Gate 0 | Version |',
      '| Gate 1 | Code Quality |',
    ].join('\n');
    writeDoc(readmePath, readmeContent);

    // AGENTS.md with 3 pre-commit gates (matches script)
    const agentsContent = [
      '| Gate | Name |',
      '|------|------|',
      '| 0 | Version |',
      '| 1 | Code Quality |',
      '| 2 | Duplicate Code |',
    ].join('\n');
    writeDoc(agentsPath, agentsContent);

    const result = checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath);
    expect(result).toBe(false);
  });

  test('exits with error when pre-push gate count mismatches', () => {
    // Pre-commit: 1 gate in script, 1 in docs (match)
    const scriptContent = '#!/bin/bash\n# GATE 1: Code Quality';
    writeScript(preCommitPath, scriptContent);

    // Pre-push: 2 M-gates in script (M, M2)
    const prePushContent = [
      '#!/bin/bash',
      '# GATE M: Mutation Testing',
      'echo "gate m"',
      '# Gate M2: Mock Density',
      'echo "gate m2"',
    ].join('\n');
    writeScript(prePushPath, prePushContent);

    // README: 1 pre-push gate (only M, missing M2)
    const readmeContent = [
      '| Gate | Name |',
      '|------|------|',
      '| Gate 0 | Version |',
      '',
      '| Gate M | Mutation |',
    ].join('\n');
    writeDoc(readmePath, readmeContent);

    // AGENTS.md: 2 pre-push gates (M, M2 — matches script)
    const agentsContent = [
      '| Gate | Name |',
      '|------|------|',
      '| 0 | Version |',
      '',
      '| M | Mutation |',
      '| M2 | Mock Density |',
    ].join('\n');
    writeDoc(agentsPath, agentsContent);

    const result = checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath);
    expect(result).toBe(false);
  });

  test('skips missing doc files with warning instead of crashing', () => {
    // Script with 1 gate
    const scriptContent = '#!/bin/bash\n# GATE 1: Code Quality';
    writeScript(preCommitPath, scriptContent);
    writeScript(prePushPath, '#!/bin/bash');

    // README exists with matching count
    const readmeContent = [
      '| Gate | Name |',
      '|------|------|',
      '| Gate 0 | Version |',
    ].join('\n');
    writeDoc(readmePath, readmeContent);

    // AGENTS.md does NOT exist — should be skipped with warning
    const nonExistentAgents = path.join(tempDir, 'NONEXISTENT_AGENTS.md');

    const result = checkDocsDrift(preCommitPath, prePushPath, readmePath, nonExistentAgents);
    expect(result).toBe(true);
  });

  test('returns true when pre-push gate counts match', () => {
    // Pre-commit: 1 gate in script, 1 in docs
    writeScript(preCommitPath, '#!/bin/bash\n# GATE 1: Code Quality');
    const readmePreCommit = '| Gate | Name |\n|------|------|\n| Gate 0 | Version |';
    const agentsPreCommit = '| Gate | Name |\n|------|------|\n| 0 | Version |';

    // Pre-push: 3 M-gates in script (M, M2, M3)
    const prePushContent = [
      '#!/bin/bash',
      '# GATE M: Mutation Testing',
      '# GATE M2: Mock Density',
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
    expect(result).toBe(true);
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

  test('syncAdapters includes sprint-gate.sh in gate script sync (#335)', () => {
    const githooksDir = path.join(repoRoot, 'githooks');
    const gateFiles = fs.readdirSync(githooksDir).filter(f =>
      (f.startsWith('gate-') || f === 'sprint-gate.sh') && f.endsWith('.sh')
    );

    expect(gateFiles).toContain('sprint-gate.sh');
    expect(gateFiles).toContain('gate-3.sh');
    expect(gateFiles).toContain('gate-4.sh');
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

  test('returns true when adapter files are byte-identical between source and mirror', () => {
    const content = '#!/bin/bash\necho "hello world"\n';
    fs.writeFileSync(path.join(srcDir, 'adapter-typescript.sh'), content);
    fs.writeFileSync(path.join(mirrorDir, 'adapter-typescript.sh'), content);

    fs.writeFileSync(path.join(srcDir, 'adapter-python.sh'), '#!/bin/bash\necho "python"\n');
    fs.writeFileSync(path.join(mirrorDir, 'adapter-python.sh'), '#!/bin/bash\necho "python"\n');

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(true);
  });

  test('returns false when file in source is missing from mirror', () => {
    fs.writeFileSync(path.join(srcDir, 'adapter-typescript.sh'), '#!/bin/bash');
    // NOT writing to mirrorDir

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(false);
  });

  test('returns false when file in mirror is missing from source', () => {
    fs.writeFileSync(path.join(mirrorDir, 'extra.sh'), '#!/bin/bash');
    // NOT writing to srcDir

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(false);
  });

  test('returns false when file content differs (checksum mismatch)', () => {
    fs.writeFileSync(path.join(srcDir, 'adapter-typescript.sh'), '#!/bin/bash\n# line 1\n');
    fs.writeFileSync(path.join(mirrorDir, 'adapter-typescript.sh'), '#!/bin/bash\n# different line\n');

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(false);
  });

  test('skips with true when source directory does not exist', () => {
    const nonExistentSrc = path.join(tempDir, 'nonexistent');
    fs.mkdirSync(mirrorDir, { recursive: true });
    fs.writeFileSync(path.join(mirrorDir, 'adapter-typescript.sh'), '#!/bin/bash');

    const result = checkAdapterDrift(nonExistentSrc, mirrorDir);
    expect(result).toBe(true);
  });

  test('skips with true when mirror directory does not exist', () => {
    const nonExistentMirror = path.join(tempDir, 'nonexistent');
    fs.writeFileSync(path.join(srcDir, 'adapter-typescript.sh'), '#!/bin/bash');

    const result = checkAdapterDrift(srcDir, nonExistentMirror);
    expect(result).toBe(true);
  });

  test('handles subdirectories in adapter tree', () => {
    const pluginsDir = path.join(srcDir, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'adapter-common.sh'), 'common');
    fs.writeFileSync(path.join(pluginsDir, 'p3c-plugin.sh'), 'p3c');

    const mirrorPluginsDir = path.join(mirrorDir, 'plugins');
    fs.mkdirSync(mirrorPluginsDir, { recursive: true });
    fs.writeFileSync(path.join(mirrorDir, 'adapter-common.sh'), 'common');
    fs.writeFileSync(path.join(mirrorPluginsDir, 'p3c-plugin.sh'), 'p3c');

    const result = checkAdapterDrift(srcDir, mirrorDir);
    expect(result).toBe(true);
  });
});
