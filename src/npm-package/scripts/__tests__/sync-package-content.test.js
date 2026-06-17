/**
 * @test REQ-TDD-005 docs-drift-check
 * @intent Verify checkDocsDrift() correctly detects Gate count mismatches between scripts and docs
 * @covers AC-TDD-005-01, AC-TDD-005-02, AC-TDD-005-03
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Import the function under test
const { checkDocsDrift } = require('../sync-package-content');

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
    // Script with 3 gates
    const scriptContent = [
      '#!/bin/bash',
      '# GATE 1: Code Quality',
      '# GATE 2: Duplicate Code',
      '# GATE 3: Complexity',
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

    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    expect(() => {
      checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath);
    }).toThrow('process.exit(1)');

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
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

    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    expect(() => {
      checkDocsDrift(preCommitPath, prePushPath, readmePath, agentsPath);
    }).toThrow('process.exit(1)');

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
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
