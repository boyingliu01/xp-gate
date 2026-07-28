/**
 * xp-gate phase-transition — Programmatic sprint phase transition
 *
 * Resolves #338 (dashboard never auto-renders) and #146 (sprint-state enforcement).
 * 
 * This CLI command is the programmatic entry point for sprint phase transitions.
 * The sprint-flow SKILL.md MUST instruct the orchestrator to call this command
 * after each phase completion, replacing text-level MUST instructions with
 * a concrete CLI invocation.
 *
 * Usage:
 *   xp-gate phase-transition <phase> <status> [--outputs <json>] [--render]
 *
 * Examples:
 *   xp-gate phase-transition 1 completed
 *   xp-gate phase-transition 2 in_progress
 *   xp-gate phase-transition 3 completed --outputs '{"spec":"path/to/spec.yaml"}'
 *   xp-gate phase-transition 3 completed --render  (auto-render dashboard)
 *
 * @module phase-transition
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { SprintStateManager } = require('./sprint-state-manager');

/**
 * Shared phase name lookup — single source of truth.
 * Used by renderDashboard, sprint-audit, and Layer 1 gate check.
 */
const PHASE_NAMES = {
  1: 'PREP', 2: 'DESIGN', 3: 'BUILD',
  4: 'VERIFY', 5: 'SHIP', 6: 'CLOSE',
};

/**
 * Phase-specific evidence file requirements.
 * Each entry defines the evidence file path, required fields, and a blocking check.
 * Phases NOT in this map require no evidence validation in v0.17.1.
 */
const EVIDENCE_FILES = {
  2: {
    path: '.sprint-state/phase-outputs/requirements-reviewed.json',
    requiredFields: ['verdict', 'requirements_hash'],
    blockingCheck: (data) => data.verdict === 'APPROVED',
    blockingMessage: 'Requirements review verdict is not APPROVED',
  },
  4: {
    path: '.sprint-state/phase-outputs/test-alignment-report.json',
    requiredFields: ['alignment_status', 'head_commit', 'spec_hash'],
    blockingCheck: (data) => data.alignment_status === 'PASS',
    blockingMessage: 'Test alignment status is not PASS',
  },
};

/**
 * Get current HEAD commit hash from a project directory.
 * Returns 'unknown' if not in a git repo.
 * @param {string} projectDir
 * @returns {string}
 */
function getCurrentHeadCommit(projectDir) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Compute SHA-256 hash of a file's contents.
 * @param {string} filePath
 * @returns {string} hex digest
 */
function computeFileHash(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Validate phase evidence files for a given phase transition.
 *
 * Returns { ok: boolean, errors: string[], warnings: string[] }.
 * - For phases not in EVIDENCE_FILES: ok=true, no errors.
 * - For phases with evidence requirements:
 *   - If evidence_schema_version >= 2 (new sprint): missing/invalid evidence → ok=false (BLOCK)
 *   - If evidence_schema_version missing or < 2 (legacy sprint): missing/invalid → ok=true with WARNING
 *
 * @param {number} phase - Phase number (1-6)
 * @param {string} projectDir - Project root directory
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateEvidence(phase, projectDir) {
  const evidenceConfig = EVIDENCE_FILES[phase];
  if (!evidenceConfig) {
    return { ok: true, errors: [], warnings: [] };
  }

  // Read sprint state to determine evidence_schema_version
  let evidenceSchemaVersion = 0;
  try {
    const manager = new SprintStateManager(projectDir);
    const state = manager.read();
    if (state && typeof state.evidence_schema_version === 'number') {
      evidenceSchemaVersion = state.evidence_schema_version;
    }
  } catch {
    // If state can't be read, treat as legacy (version 0)
  }

  const isLegacySprint = evidenceSchemaVersion < 2;
  const errors = [];
  const warnings = [];

  const evidenceFilePath = path.join(projectDir, evidenceConfig.path);
  const fileName = path.basename(evidenceConfig.path);

  // Check file existence
  if (!fs.existsSync(evidenceFilePath)) {
    const msg = `Evidence file missing: ${evidenceConfig.path}`;
    if (isLegacySprint) {
      warnings.push(`WARNING: ${msg}. Upgrade sprint with evidence_schema_version >= 2 to enforce.`);
      return { ok: true, errors: [], warnings };
    }
    errors.push(msg);
    return { ok: false, errors, warnings };
  }

  // Parse JSON
  let data;
  try {
    const raw = fs.readFileSync(evidenceFilePath, 'utf8');
    data = JSON.parse(raw);
  } catch {
    const msg = `${fileName} is malformed JSON`;
    if (isLegacySprint) {
      warnings.push(`WARNING: ${msg}. Upgrade sprint with evidence_schema_version >= 2 to enforce.`);
      return { ok: true, errors: [], warnings };
    }
    errors.push(msg);
    return { ok: false, errors, warnings };
  }

  // Check required fields
  for (const field of evidenceConfig.requiredFields) {
    if (!(field in data)) {
      const msg = `${fileName} is missing required field: ${field}`;
      if (isLegacySprint) {
        warnings.push(`WARNING: ${msg}. Upgrade sprint with evidence_schema_version >= 2 to enforce.`);
      } else {
        errors.push(msg);
      }
    }
  }

  // If any required fields missing for new sprint, block early
  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  // Run blocking check
  if (!evidenceConfig.blockingCheck(data)) {
    const msg = `${fileName}: ${evidenceConfig.blockingMessage} (got: ${JSON.stringify(data[evidenceConfig.requiredFields[0]])})`;
    if (isLegacySprint) {
      warnings.push(`WARNING: ${msg}. Upgrade sprint with evidence_schema_version >= 2 to enforce.`);
      return { ok: true, errors: [], warnings };
    }
    errors.push(msg);
    return { ok: false, errors, warnings };
  }

  // Phase-specific anti-staleness checks
  if (phase === 4) {
    // head_commit check
    const currentHead = getCurrentHeadCommit(projectDir);
    if (data.head_commit !== currentHead) {
      const msg = `${fileName}: head_commit mismatch — report has "${data.head_commit}", current HEAD is "${currentHead}"`;
      if (isLegacySprint) {
        warnings.push(`WARNING: ${msg}. Upgrade sprint with evidence_schema_version >= 2 to enforce.`);
      } else {
        errors.push(msg);
      }
    }

    // spec_hash check (only if specification.yaml exists)
    const specPath = path.join(projectDir, 'specification.yaml');
    if (fs.existsSync(specPath)) {
      const expectedHash = computeFileHash(specPath);
      if (data.spec_hash !== expectedHash) {
        const msg = `${fileName}: spec_hash mismatch — specification.yaml has changed since report was generated`;
        if (isLegacySprint) {
          warnings.push(`WARNING: ${msg}. Upgrade sprint with evidence_schema_version >= 2 to enforce.`);
        } else {
          errors.push(msg);
        }
      }
    }
  }

  // Phase 2: requirements_hash existence check (full verification in v0.18.0)
  if (phase === 2) {
    if (typeof data.requirements_hash !== 'string' || data.requirements_hash.length === 0) {
      const msg = `${fileName}: requirements_hash must be a non-empty string`;
      if (isLegacySprint) {
        warnings.push(`WARNING: ${msg}. Upgrade sprint with evidence_schema_version >= 2 to enforce.`);
      } else {
        errors.push(msg);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return { ok: true, errors: [], warnings };
}

/**
 * Append an evidence-skipped audit entry to .xp-gate/audit.jsonl.
 * @param {string} projectDir
 * @param {number} phase
 * @param {string} reason
 */
function logEvidenceSkip(projectDir, phase, reason) {
  const auditDir = path.join(projectDir, '.xp-gate');
  if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
  }
  const entry = {
    timestamp: new Date().toISOString(),
    event: 'evidence_skipped',
    phase,
    reason,
    commit_hash: getCurrentHeadCommit(projectDir),
  };
  fs.appendFileSync(path.join(auditDir, 'audit.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Render ASCII dashboard from sprint state.
 * Reuses the formatSprintTable logic from sprint-status.
 * @param {object} state - Sprint state object
 * @returns {string} Rendered dashboard
 */
function renderDashboard(state) {
  if (!state) return 'No sprint state found';

  const PHASE_NAMES_LOCAL = PHASE_NAMES;

  function statusIcon(status) {
    switch (status) {
      case 'completed': return '✅';
      case 'in_progress': return '🔄';
      case 'skipped': return '⏭️';
      case 'failed': return '❌';
      case 'paused': return '⏸️';
      default: return '⏳';
    }
  }

  function formatDuration(seconds) {
    if (seconds == null || seconds === 0) return '-';
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
  }

  const branch = state.isolation?.branch || 'unknown';
  const sprintId = state.id || 'unknown';
  const taskDesc = state.task_description || state.issue_title || '-';
  const overallStatus = state.status || 'running';
  const startedAt = state.started_at ? state.started_at.slice(0, 16).replace('T', ' ') : '-';

  // Build phase history lookup
  const historyLookup = {};
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      historyLookup[String(ph.phase)] = ph;
    }
  }

  const currentPhase = state.phase || 1;
  const currentPhaseName = PHASE_NAMES_LOCAL[String(currentPhase)] || `Phase ${currentPhase}`;

  // Progress bar
  const completedCount = Object.values(historyLookup).filter(h => h.status === 'completed').length;
  const pct = Math.round((completedCount / 6) * 100);
  const filled = '█'.repeat(completedCount);
  const current = currentPhase <= 6 ? '▓' : '';
  const empty = '░'.repeat(Math.max(0, 6 - completedCount - (current ? 1 : 0)));
  const progressBar = `[${filled}${current}${empty}] ${pct}%`;

  // Build lines
  const lines = [];
  lines.push('+============================================================+');
  lines.push(`|  SPRINT PROGRESS                      ${sprintId.padEnd(20)}|`);
  lines.push('+============================================================+');
  lines.push(`|  需求: ${(taskDesc).slice(0, 54).padEnd(54)}|`);
  lines.push(`|  分支: ${(branch).slice(0, 54).padEnd(54)}|`);
  lines.push(`|  状态: ${(overallStatus).slice(0, 15).padEnd(15)}        启动: ${startedAt.slice(0, 19).padEnd(19)}|`);
  lines.push('+============================================================+');
  lines.push('|                                                             |');

  for (let i = 1; i <= 6; i++) {
    const entry = historyLookup[String(i)];
    const icon = statusIcon(entry?.status || (i < currentPhase ? 'completed' : i === currentPhase ? 'in_progress' : 'pending'));
    const name = (PHASE_NAMES_LOCAL[String(i)] || `Phase ${i}`).padEnd(10);
    const dur = formatDuration(entry?.duration_seconds).padEnd(8);
    lines.push(`|  ${icon} Phase ${i}/6  ${name} ${dur}          |`);
  }

  lines.push('|                                                             |');
  lines.push(`|  ${progressBar.padEnd(58)}|`);
  lines.push('+============================================================+');
  lines.push(`|  > 当前: Phase ${currentPhase}/6 ${currentPhaseName}`.padEnd(59) + '|');
  lines.push(`|    状态: ${(entry_status(currentPhase, historyLookup)).padEnd(50)}|`);
  lines.push('+============================================================+');

  // Outputs section
  if (state.outputs && Object.keys(state.outputs).length > 0) {
    lines.push('|  输出物:                                                     |');
    for (const [key, val] of Object.entries(state.outputs)) {
      lines.push(`|    ${(`${key}: ${val}`).slice(0, 55).padEnd(55)}|`);
    }
    lines.push('+============================================================+');
  }

  return lines.join('\n');

  function entry_status(phaseNum, lookup) {
    const e = lookup[String(phaseNum)];
    return e?.status || (phaseNum < currentPhase ? 'completed' : phaseNum === currentPhase ? 'in_progress' : 'pending');
  }
}

/**
 * CLI entry point for phase-transition command.
 * @param {string[]} args - CLI arguments
 * @returns {Promise<number>} Exit code
 */
async function handlePhaseTransition(args = []) {
  if (args.includes('--help')) {
    console.log('Usage: xp-gate phase-transition <phase> <status> [options]');
    console.log('');
    console.log('Arguments:');
    console.log('  phase    Phase number (1-6)');
    console.log('  status   Status: in_progress | completed | skipped | failed | paused');
    console.log('');
    console.log('Options:');
    console.log('  --outputs <json>   JSON object of outputs to record');
    console.log('  --render           Render ASCII dashboard after transition');
    console.log('  --dir <path>       Project directory (default: cwd)');
    console.log('  --skip-evidence <reason>  Skip evidence validation (requires reason)');
    console.log('');
    console.log('Examples:');
    console.log('  xp-gate phase-transition 1 completed');
    console.log('  xp-gate phase-transition 3 completed --render');
    console.log('  xp-gate phase-transition 2 in_progress --outputs \'{"spec":"path.yaml"}\'');
    console.log('  xp-gate phase-transition 4 completed --skip-evidence "Emergency hotfix"');
    return 0;
  }

  if (args.length < 2) {
    console.error('Error: Missing required arguments. Usage: xp-gate phase-transition <phase> <status>');
    return 1;
  }

  const phase = parseInt(args[0], 10);
  const status = args[1];
  const renderFlag = args.includes('--render');
  const dirIdx = args.indexOf('--dir');
  const projectDir = dirIdx >= 0 ? args[dirIdx + 1] : process.cwd();

  const outputsIdx = args.indexOf('--outputs');
  let outputs = {};
  if (outputsIdx >= 0 && args[outputsIdx + 1]) {
    try {
      outputs = JSON.parse(args[outputsIdx + 1]);
    } catch (err) {
      console.error(`Error: Invalid JSON for --outputs: ${err.message}`);
      return 1;
    }
  }

  // Parse --skip-evidence flag
  const skipEvidenceIdx = args.indexOf('--skip-evidence');
  let skipEvidence = false;
  let skipEvidenceReason = '';
  if (skipEvidenceIdx >= 0) {
    skipEvidence = true;
    const nextArg = args[skipEvidenceIdx + 1];
    // Reason is the next arg if it exists and doesn't start with '--'
    if (nextArg && !nextArg.startsWith('--')) {
      skipEvidenceReason = nextArg;
    }
  }

  // Validate inputs
  if (phase < 1 || phase > 6) {
    console.error(`Error: Phase must be 1-6, got ${phase}`);
    return 1;
  }

  const validStatuses = ['in_progress', 'completed', 'skipped', 'failed', 'paused'];
  if (!validStatuses.includes(status)) {
    console.error(`Error: Status must be one of: ${validStatuses.join(', ')}`);
    return 1;
  }

  // Execute transition
  try {
    const manager = new SprintStateManager(projectDir);

    // ── Layer 1: Pre-transition gate check ──
    // Check BEFORE transitionPhase() to validate previous phase completion.
    // Runs when status === 'in_progress' and phase >= 2.
    // No side effects — only outputs WARNING, does not modify state.
    if (status === 'in_progress' && phase >= 2) {
      const preState = manager.read();
      if (preState && Array.isArray(preState.phase_history)) {
        const prevPhase = phase - 1;
        const prevEntry = preState.phase_history.find(e => e.phase === prevPhase);
        const prevName = PHASE_NAMES[prevPhase] || `Phase ${prevPhase}`;
        // 'completed' and 'skipped' are both valid predecessor statuses
        if (!prevEntry || (prevEntry.status !== 'completed' && prevEntry.status !== 'skipped')) {
          console.warn(
            `⚠️  [sprint-audit] Phase ${prevPhase} (${prevName}) not recorded as 'completed'`
          );
          console.warn(
            `   Previous phase may have been skipped. Run: xp-gate phase-transition ${prevPhase} completed`
          );
        }
      }
      // If no sprint-state.json exists yet, skip check (no previous phase to validate)
    }

    // ── Layer 2: Evidence validation (blocks on status === 'completed') ──
    if (status === 'completed' && EVIDENCE_FILES[phase]) {
      if (skipEvidence) {
        if (!skipEvidenceReason) {
          console.error('Error: --skip-evidence requires --reason "<text>" to be provided');
          return 1;
        }
        logEvidenceSkip(projectDir, phase, skipEvidenceReason);
        console.warn('⚠️  Evidence skipped. This will appear in retro reports. Single-sprint limit: >2 skips per sprint will trigger an alert.');
      } else {
        const evidence = validateEvidence(phase, projectDir);
        for (const w of evidence.warnings) {
          console.warn(`⚠️  [sprint-audit] ${w}`);
        }
        if (!evidence.ok) {
          for (const e of evidence.errors) {
            console.error(`❌ [sprint-audit] ${e}`);
          }
          console.error(`   Phase ${phase} (${PHASE_NAMES[phase]}) cannot transition to 'completed' without valid evidence.`);
          console.error(`   Use --skip-evidence "<reason>" to bypass (audited).`);
          return 1;
        }
      }
    }

    const newState = manager.transitionPhase(phase, status, { outputs });

    console.log(`✅ Phase ${phase} transitioned to '${status}'`);

    // ── Layer 1.5: Auto-trigger Layer 2 reminder on Phase 6 completed ──
    if (phase === 6 && status === 'completed') {
      console.log('');
      console.log('📋 [sprint-audit] Sprint complete — run final coverage audit:');
      console.log('   npx xp-gate sprint-audit');
    }

    // Auto-render dashboard if --render flag is set
    if (renderFlag) {
      console.log('');
      const dashboard = renderDashboard(newState);
      console.log(dashboard);
    }

    return 0;
  } catch (err) {
    console.error(`Error: Phase transition failed: ${err.message}`);
    return 1;
  }
}

/**
 * Read-only evidence check for a given phase. Validates evidence without modifying sprint state.
 * D3 (Unify Evidence Validation): replaces sprint-gate.sh inline JSON parsing.
 *
 * @param {number} phase - Phase number (1-6)
 * @param {string} projectDir - Project root directory
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
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
function checkWalkthrough(projectDir) {
  const walkthroughFile = path.join(projectDir, '.code-walkthrough-result.json');
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(walkthroughFile)) {
    errors.push('.code-walkthrough-result.json not found — run delphi-review --mode code-walkthrough before push');
    return { ok: false, errors, warnings };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(walkthroughFile, 'utf8'));
  } catch {
    errors.push('.code-walkthrough-result.json is malformed JSON');
    return { ok: false, errors, warnings };
  }

  // Check verdict
  if (data.verdict !== 'APPROVED') {
    errors.push(`Code walkthrough verdict is "${data.verdict}" — must be APPROVED`);
    return { ok: false, errors, warnings };
  }

  // Check commit is ancestor of HEAD
  if (data.commit) {
    try {
      execSync(`git merge-base --is-ancestor ${data.commit} HEAD`, {
        cwd: projectDir, stdio: 'pipe',
      });
    } catch {
      errors.push(`Code walkthrough commit ${data.commit} is not an ancestor of HEAD`);
      return { ok: false, errors, warnings };
    }
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
          execSync(`git merge-base --is-ancestor ${entry.commit} HEAD`, {
            cwd: projectDir, stdio: 'pipe',
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

module.exports = { handlePhaseTransition, renderDashboard, PHASE_NAMES, validateEvidence, checkEvidence, checkWalkthrough, checkBypassAudit };
