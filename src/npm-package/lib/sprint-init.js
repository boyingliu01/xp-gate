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
  const seq = String(Math.floor(Math.random() * MAX_SPRINT_SEQUENCE) + 1).padStart(2, '0');
  return `sprint-${dateStr}-${seq}`;
}

/** Sprint ids are `sprint-YYYYMMDD-NN`; the sequence is 1-99. */
const MAX_SPRINT_SEQUENCE = 99;
/** `YYYY-MM-DDTHH:MM:SS` is 19 characters once the separators are normalised. */
const TIMESTAMP_SECONDS_LENGTH = 19;

/**
 * Backup existing sprint state to .sprint-history/.
 * @param {string} projectRoot - Project root directory
 * @param {object} state - Current sprint state
 */
function backupSprintState(projectRoot, state) {
  const historyDir = path.join(projectRoot, '.sprint-history');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, TIMESTAMP_SECONDS_LENGTH);
  const backupFile = path.join(historyDir, `sprint-state-${state.id || 'unknown'}-${timestamp}.json`);
  try {
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }
    fs.writeFileSync(backupFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    // A backup that silently fails is worse than none: `--force` then overwrites
    // state the operator believed was preserved.
    throw new Error(`cannot back up sprint state to ${backupFile}: ${err.message}`);
  }
  return backupFile;
}

/**
 * CLI entry point for sprint-init command.
 * @param {string[]} args - CLI arguments
 * @returns {Promise<number>} Exit code
 */
/**
 * Parse `sprint-init` arguments.
 *
 * Extracted from `handleSprintInit` (CCN 31), and it fixes a latent defect while
 * doing so. The task description used to be "the first argument that is not a
 * flag and is not equal to the --dir/--issues VALUES". That comparison is by
 * value, so a task describing the very directory it targets --
 *
 *     xp-gate sprint-init "./src" --dir ./src
 *
 * -- found no task at all and failed with "Missing task_description". The flags
 * are now consumed positionally: a flag takes the next token as its value, and
 * the first token NOT consumed that way is the description.
 *
 * @param {string[]} args
 * @returns {{forceFlag?: boolean, dryRunFlag?: boolean, projectDir?: string,
 *   issues?: string, taskDescription?: string, error?: string}}
 */
function parseSprintInitArgs(args) {
  const forceFlag = args.includes('--force');
  const dryRunFlag = args.includes('--dry-run');

  const consumed = new Set();
  const takeValue = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0 || i + 1 >= args.length) return null;
    consumed.add(i + 1);
    return args[i + 1];
  };

  const dirValue = takeValue('--dir');
  const issuesValue = takeValue('--issues');
  const projectDir = dirValue === null ? process.cwd() : dirValue;
  const issues = issuesValue === null ? '' : issuesValue;

  let taskDescription;
  for (let i = 0; i < args.length; i += 1) {
    if (consumed.has(i)) continue;
    if (args[i].startsWith('--')) continue;
    taskDescription = args[i];
    break;
  }

  if (!taskDescription) {
    return { error: 'Missing task_description. Usage: xp-gate sprint-init "<task_description>"' };
  }
  return { forceFlag, dryRunFlag, projectDir, issues, taskDescription };
}

/**
 * Deal with a sprint that is already on disk: idempotent call, conflict, or
 * forced override.
 *
 * The three outcomes are one decision because they share a single precondition
 * (there IS existing state) and differ only in what the caller asked for. Split
 * out of `handleSprintInit` (162 lines), which read as a sequence of unrelated
 * blocks.
 *
 * The idempotent case is deliberately narrow: same task AND same branch AND not
 * detached. A detached HEAD has no branch identity to compare, so treating it as
 * a match would silently accept a second sprint on the same task.
 *
 * @param {object} manager SprintStateManager
 * @param {string} projectDir
 * @param {{taskDescription: string, branch: string, forceFlag: boolean, dryRunFlag: boolean}} opts
 * @returns {{exitCode?: number, existingState: object|null}}
 */
function handleExistingSprint(manager, projectDir, opts) {
  const { taskDescription, branch, forceFlag, dryRunFlag } = opts;

  let existingState = null;
  try {
    existingState = manager.read();
  } catch {
    // Corrupted state -- treat as no state; overwriting it is the only way out.
    existingState = null;
  }
  if (!existingState) return { existingState: null };

  const normalizedExisting = (existingState.task_description || '').trim();
  const normalizedNew = taskDescription.trim();
  const existingBranch = existingState.isolation?.branch || '';

  if (normalizedExisting === normalizedNew && existingBranch === branch && branch !== 'detached') {
    console.log('ℹ️  Sprint already initialized (idempotent call). Current state:');
    console.log('');
    console.log(renderDashboard(existingState));
    return { exitCode: 0, existingState };
  }

  if (!forceFlag) {
    if (dryRunFlag) {
      console.log(JSON.stringify({
        decision: 'deny',
        reason: `Active sprint "${existingState.id}" exists (task: "${normalizedExisting}")`,
        hint: 'Use --force to override (backs up old state)',
      }));
      return { exitCode: 0, existingState };
    }
    console.error(`Error: Active sprint "${existingState.id}" already exists.`);
    console.error(`  Task: "${normalizedExisting}"`);
    console.error(`  Branch: ${existingBranch}`);
    console.error('  Use --force to override (backs up old state to .sprint-history/)');
    return { exitCode: 1, existingState };
  }

  const backupPath = backupSprintState(projectDir, existingState);
  console.log(`📦 Backed up existing sprint to: ${backupPath}`);
  return { existingState };
}

/**
 * The most recent sprint's retro data, or null.
 *
 * Best effort by design: retro data only pre-populates fields, so a missing or
 * unparseable file must not stop a sprint from starting. Only the newest
 * `.sprint-history` entry is consulted -- carrying forward a retro from three
 * sprints ago would be worse than carrying none.
 *
 * @param {string} projectDir
 * @returns {object|null}
 */
function readPreviousRetro(projectDir) {
  const historyDir = path.join(projectDir, '.sprint-history');
  if (!fs.existsSync(historyDir)) return null;

  const entries = fs.readdirSync(historyDir).filter((f) => f.startsWith('sprint-')).sort().reverse();
  const newest = entries[0];
  if (!newest) return null;
  // `sprint-state-*.json` is a state snapshot, not a retro; only a retro file
  // carries the fields this feeds.
  if (newest.endsWith('.json') && !newest.includes('retro')) return null;

  try {
    return JSON.parse(fs.readFileSync(path.join(historyDir, newest), 'utf8'));
  } catch {
    // An unparseable retro carries nothing worth failing a sprint start over.
    return null;
  }
}

/**
 * The initial state for a new sprint.
 *
 * `evidence_schema_version: 2` is what turns Gate 5c's warnings into BLOCKs for
 * this sprint: a sprint created under the new rules is held to them. That is why
 * it is set here rather than inherited -- an old sprint keeps its leniency, a new
 * one gets none.
 *
 * Phase 6 / D7: the previous sprint's retro values are carried into `metrics`
 * so the new sprint starts with last sprint's rework rate and duration visible.
 *
 * @param {{projectDir: string, branch: string, taskDescription: string, issues: string, previousRetro: object|null}} opts
 * @returns {{sprintId: string, newState: object}}
 */
function buildSprintState(opts) {
  const { projectDir, branch, taskDescription, issues, previousRetro } = opts;
  const sprintId = generateSprintId();
  const startedAt = new Date().toISOString();
  const newState = {
    _schema_version: 1,
    evidence_schema_version: 2,
    id: sprintId,
    task_description: taskDescription.trim(),
    phase: 1,
    status: 'in_progress',
    started_at: startedAt,
    phase_history: [
      {
        phase: 1,
        name: 'PREP',
        status: 'in_progress',
        started_at: startedAt,
      },
    ],
    isolation: {
      worktree_path: projectDir,
      branch,
    },
    outputs: issues ? { issues } : {},
    metrics: {},
  };

  applyPreviousRetro(newState, previousRetro);
  return { sprintId, newState };
}

/**
 * Copy the previous sprint's headline metrics into the new sprint.
 *
 * Only the three values that describe how the last sprint WENT -- not its task,
 * branch or phase. Each is copied only when present, so a retro that predates a
 * field does not write a null.
 *
 * @param {object} newState mutated in place
 * @param {object|null} retro
 */
function applyPreviousRetro(newState, retro) {
  if (!retro) return;
  const carried = {
    previous_rework_rate: retro.rework_rate,
    previous_evidence_skips: retro.evidence_skips,
    previous_duration_seconds: retro.duration_seconds,
  };
  for (const [key, value] of Object.entries(carried)) {
    if (value != null) newState.metrics[key] = value;
  }
  if (Object.keys(newState.metrics).length === 0) return;
  console.log('📊 Auto-populated from previous sprint retro data:');
  for (const [key, value] of Object.entries(newState.metrics)) {
    console.log(`   ${key}: ${value}`);
  }
}

/** Print the sprint-init usage text. */
function printSprintInitUsage() {
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

async function handleSprintInit(args = []) {
  if (args.includes('--help')) {
    printSprintInitUsage();
    return 0;
  }

  // Parse arguments
  const parsed = parseSprintInitArgs(args);
  const { forceFlag, dryRunFlag, projectDir, issues, taskDescription } = parsed;
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    return 1;
  }

  const manager = new SprintStateManager(projectDir);
  const branch = detectBranch(projectDir);

  const existing = handleExistingSprint(manager, projectDir, {
    taskDescription, branch, forceFlag, dryRunFlag,
  });
  if (existing.exitCode !== undefined) return existing.exitCode;

  if (dryRunFlag) {
    console.log(JSON.stringify({
      decision: 'allow',
      reason: existing.existingState ? 'Would override existing sprint (--force)' : 'No existing sprint',
      branch,
      task_description: taskDescription.trim(),
    }));
    return 0;
  }

  const previousRetro = readPreviousRetro(projectDir);

  const { sprintId, newState } = buildSprintState({ projectDir, branch, taskDescription, issues, previousRetro });

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

module.exports = { handleSprintInit, detectBranch, generateSprintId, backupSprintState, parseSprintInitArgs };
