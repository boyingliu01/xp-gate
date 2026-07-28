/**
 * xp-gate sprint-init — Programmatic sprint initialization.
 *
 * Resolves #366 (phase-transition never called by orchestrator).
 * Layer 1 of the three-layer enforcement mechanism.
 *
 * Creates .sprint-state/sprint-state.json as the single entry point
 * for sprint initialization. Replaces manual state file creation.
 *
 * Usage:
 *   xp-gate sprint-init "<task_description>" [--issues "<#123,#456>"] [--force] [--dry-run] [--dir <path>]
 *
 * Non-interactive design (LLM orchestrator cannot handle stdin):
 *   - Default: existing active sprint → error exit 1
 *   - --force: override existing sprint, backup old state to .sprint-history/
 *   - --dry-run: pre-check conflicts, no writes
 *   - Idempotent: same task_description + branch → output dashboard, exit 0
 *
 * @module sprint-init
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { SprintStateManager } = require('./sprint-state-manager');
const { renderDashboard } = require('./phase-transition');

/**
 * Detect current git branch.
 * @param {string} cwd - Working directory
 * @returns {string} Branch name or 'detached'
 */
function detectBranch(cwd) {
  try {
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return branch || 'detached';
  } catch {
    return 'unknown';
  }
}

/**
 * Generate sprint ID from date and sequence.
 * @returns {string} Sprint ID like "sprint-20260722-01"
 */
function generateSprintId() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
  return `sprint-${dateStr}-${seq}`;
}

/**
 * Backup existing sprint state to .sprint-history/.
 * @param {string} projectRoot - Project root directory
 * @param {object} state - Current sprint state
 */
function backupSprintState(projectRoot, state) {
  const historyDir = path.join(projectRoot, '.sprint-history');
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(historyDir, `sprint-state-${state.id || 'unknown'}-${timestamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(state, null, 2), 'utf8');
  return backupFile;
}

/**
 * CLI entry point for sprint-init command.
 * @param {string[]} args - CLI arguments
 * @returns {Promise<number>} Exit code
 */
async function handleSprintInit(args = []) {
  if (args.includes('--help')) {
    console.log('Usage: xp-gate sprint-init "<task_description>" [options]');
    console.log('');
    console.log('Arguments:');
    console.log('  task_description   Sprint task description (required)');
    console.log('');
    console.log('Options:');
    console.log('  --issues <list>    Comma-separated issue numbers (e.g. "#123,#456")');
    console.log('  --force            Override existing active sprint (backs up old state)');
    console.log('  --dry-run          Pre-check conflicts without writing');
    console.log('  --dir <path>       Project directory (default: cwd)');
    console.log('');
    console.log('Examples:');
    console.log('  xp-gate sprint-init "Implement user auth"');
    console.log('  xp-gate sprint-init "Fix #366" --issues "#366" --force');
    return 0;
  }

  // Parse arguments
  const forceFlag = args.includes('--force');
  const dryRunFlag = args.includes('--dry-run');
  const dirIdx = args.indexOf('--dir');
  const projectDir = dirIdx >= 0 ? args[dirIdx + 1] : process.cwd();
  const issuesIdx = args.indexOf('--issues');
  const issues = issuesIdx >= 0 ? args[issuesIdx + 1] : '';

  // First non-flag argument is task_description
  const taskDescription = args.find(a => !a.startsWith('--') && a !== projectDir && a !== issues);
  if (!taskDescription) {
    console.error('Error: Missing task_description. Usage: xp-gate sprint-init "<task_description>"');
    return 1;
  }

  const manager = new SprintStateManager(projectDir);
  const branch = detectBranch(projectDir);

  // Check existing sprint state
  let existingState = null;
  try {
    existingState = manager.read();
  } catch {
    // Corrupted state — treat as no state (will be overwritten)
    existingState = null;
  }

  if (existingState) {
    // Idempotent check: same task_description + branch → output dashboard, exit 0
    const normalizedExisting = (existingState.task_description || '').trim();
    const normalizedNew = taskDescription.trim();
    const existingBranch = existingState.isolation?.branch || '';

    if (normalizedExisting === normalizedNew && existingBranch === branch && branch !== 'detached') {
      console.log('ℹ️  Sprint already initialized (idempotent call). Current state:');
      console.log('');
      console.log(renderDashboard(existingState));
      return 0;
    }

    // Conflict: existing active sprint
    if (!forceFlag) {
      if (dryRunFlag) {
        console.log(JSON.stringify({
          decision: 'deny',
          reason: `Active sprint "${existingState.id}" exists (task: "${normalizedExisting}")`,
          hint: 'Use --force to override (backs up old state)',
        }));
        return 0;
      }
      console.error(`Error: Active sprint "${existingState.id}" already exists.`);
      console.error(`  Task: "${normalizedExisting}"`);
      console.error(`  Branch: ${existingBranch}`);
      console.error('  Use --force to override (backs up old state to .sprint-history/)');
      return 1;
    }

    // --force: backup and override
    const backupPath = backupSprintState(projectDir, existingState);
    console.log(`📦 Backed up existing sprint to: ${backupPath}`);
  }

  if (dryRunFlag) {
    console.log(JSON.stringify({
      decision: 'allow',
      reason: existingState ? 'Would override existing sprint (--force)' : 'No existing sprint',
      branch,
      task_description: taskDescription.trim(),
    }));
    return 0;
  }

  // Read previous sprint retro data for auto-population (Phase 6 / D7)
  const historyDir = path.join(projectDir, '.sprint-history');
  let previousRetro = null;
  if (fs.existsSync(historyDir)) {
    const entries = fs.readdirSync(historyDir).filter(f => f.startsWith('sprint-')).sort().reverse();
    for (const entry of entries) {
      if (entry.endsWith('.json') && !entry.includes('retro')) continue;
      const retroPath = path.join(historyDir, entry);
      if (fs.existsSync(retroPath)) {
        try {
          const raw = fs.readFileSync(retroPath, 'utf8');
          previousRetro = JSON.parse(raw);
          break;
        } catch {
          // Skip unparseable files
        }
      }
      break; // Only check the most recent sprint
    }
  }

  // Create new sprint state
  const sprintId = generateSprintId();
  const newState = {
    _schema_version: 1,
    evidence_schema_version: 2,  // Phase 5: new sprints default to full BLOCK enforcement
    id: sprintId,
    task_description: taskDescription.trim(),
    phase: 1,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    phase_history: [
      {
        phase: 1,
        name: 'PREP',
        status: 'in_progress',
        started_at: new Date().toISOString(),
      },
    ],
    isolation: {
      worktree_path: projectDir,
      branch,
    },
    outputs: issues ? { issues } : {},
    metrics: {},
  };

  // Phase 6 / D7: Auto-populate from previous sprint retro data
  if (previousRetro) {
    if (previousRetro.rework_rate != null) {
      newState.metrics.previous_rework_rate = previousRetro.rework_rate;
    }
    if (previousRetro.evidence_skips != null) {
      newState.metrics.previous_evidence_skips = previousRetro.evidence_skips;
    }
    if (previousRetro.duration_seconds != null) {
      newState.metrics.previous_duration_seconds = previousRetro.duration_seconds;
    }
    if (Object.keys(newState.metrics).length > 0) {
      console.log('📊 Auto-populated from previous sprint retro data:');
      for (const [key, value] of Object.entries(newState.metrics)) {
        console.log(`   ${key}: ${value}`);
      }
    }
  }

  // Write state atomically
  manager.write(newState);

  console.log(`✅ Sprint initialized: ${sprintId}`);
  console.log(`   Task: ${taskDescription.trim()}`);
  console.log(`   Branch: ${branch}`);
  if (issues) console.log(`   Issues: ${issues}`);
  console.log('');
  console.log(renderDashboard(newState));

  return 0;
}

module.exports = { handleSprintInit, detectBranch, generateSprintId, backupSprintState };
