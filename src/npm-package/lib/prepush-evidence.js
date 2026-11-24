'use strict';
/**
 * Pre-push evidence checks: the code walkthrough and the bypass audit.
 *
 * Both ask the same question in different registers -- "was this push reviewed,
 * and if the review was bypassed, is that recorded?" A walkthrough that is missing,
 * malformed, not APPROVED, or written against another commit cannot vouch for this
 * push, and each of those is reported separately because each needs a different
 * action from the reader.
 *
 * Owned by `phase-transition.js`, which re-exports these.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { validateEvidence } = require('./phase-transition.js');

const GIT_REPOSITORY_ENV_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
  'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
];

function createRepositoryGitEnv() {
  const env = { ...process.env };
  for (const name of GIT_REPOSITORY_ENV_VARS) {
    delete env[name];
  }
  return env;
}

function checkEvidence(phase, projectDir) {
  return validateEvidence(phase, projectDir);
}

/**
 * Validate .code-walkthrough-result.json for code walkthrough mode.
 * Ported from githooks/pre-push Gate MW inline jq logic.
 *
 * @param {string} projectDir - Project root directory
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
/**
 * Why this walkthrough result cannot be accepted, or null when it can.
 *
 * Returned rather than thrown so the caller keeps one error shape. The verdict is
 * checked before the commit: "not approved" is a review outcome the reader can act
 * on, while a malformed commit id is a file defect -- leading with the second
 * would send them to regenerate a review that was already rejected on its merits.
 *
 * @param {object} data
 * @returns {string|null}
 */
function validateWalkthroughVerdict(data) {
  if (data.verdict !== 'APPROVED') {
    return `Code walkthrough verdict is "${data.verdict}" — must be APPROVED`;
  }
  if (typeof data.commit !== 'string' || !/^[0-9a-f]{7,64}$/i.test(data.commit)) {
    return 'Code walkthrough commit must be a hexadecimal Git commit ID';
  }
  return null;
}

/**
 * Read the walkthrough result, or say why it cannot be used.
 *
 * The "not found" message names the command that produces the file, because that
 * is what the reader has to run -- "file missing" alone leaves them guessing
 * between five review modes.
 *
 * @param {string} filePath
 * @returns {{data?: object, error?: string}}
 */
function loadWalkthroughFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { error: '.code-walkthrough-result.json not found — run delphi-review --mode code-walkthrough before push' };
  }
  try {
    return { data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch {
    return { error: '.code-walkthrough-result.json is malformed JSON' };
  }
}

function checkWalkthrough(projectDir) {
  const walkthroughFile = path.join(projectDir, '.code-walkthrough-result.json');
  const errors = [];
  const warnings = [];

  const loaded = loadWalkthroughFile(walkthroughFile);
  if (loaded.error) {
    errors.push(loaded.error);
    return { ok: false, errors, warnings };
  }
  const data = loaded.data;

  const invalid = validateWalkthroughVerdict(data);
  if (invalid) {
    errors.push(invalid);
    return { ok: false, errors, warnings };
  }

  try {
    const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectDir,
      env: createRepositoryGitEnv(),
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    if (data.commit !== currentCommit) {
      errors.push(`Code walkthrough commit ${data.commit} does not match HEAD ${currentCommit}`);
      return { ok: false, errors, warnings };
    }
  } catch {
    errors.push('Unable to resolve the current Git commit for code walkthrough validation');
    return { ok: false, errors, warnings };
  }

  // Check expiration
  if (data.expires) {
    const expiry = new Date(data.expires).getTime();
    if (Date.now() > expiry) {
      errors.push(`Code walkthrough expired at ${data.expires}`);
      return { ok: false, errors, warnings };
    }
  }

  return { ok: true, errors, warnings };
}

/**
 * D8 Layer 3: Check bypass audit log for any --no-verify bypassed commits on the current branch.
 * Blocks phase transition if bypassed commits exist.
 *
 * @param {string} projectDir - Project root directory
 * @returns {{ ok: boolean, bypassedCommits: string[] }}
 */
function checkBypassAudit(projectDir) {
  const auditFile = path.join(projectDir, '.xp-gate', 'bypass-audit.jsonl');
  const bypassedCommits = [];

  if (!fs.existsSync(auditFile)) {
    return { ok: true, bypassedCommits };
  }

  const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'precommit_bypass' && entry.commit) {
        // Verify the commit is on the current branch
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', entry.commit, 'HEAD'], {
            cwd: projectDir,
            env: createRepositoryGitEnv(),
            stdio: 'pipe',
          });
          bypassedCommits.push(entry.commit);
        } catch {
          // Commit not on current branch — not relevant
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { ok: bypassedCommits.length === 0, bypassedCommits };
}

module.exports = { checkEvidence, checkWalkthrough, checkBypassAudit, validateWalkthroughVerdict, loadWalkthroughFile, createRepositoryGitEnv, GIT_REPOSITORY_ENV_VARS };
