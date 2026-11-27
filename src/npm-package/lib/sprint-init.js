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
/**
 * The first argument that is neither a flag nor a value consumed by one.
 *
 * A value is skipped via `consumed` rather than by inspecting its shape: `--issues
 * "#1,#2"` looks nothing like a flag, and treating it as the task description would
 * silently swap the two.
 *
 * @param {string[]} args
 * @param {Set<number>} consumed indices already claimed by a flag
 * @returns {string|undefined}
 */
function firstPositional(args, consumed) {
  const index = args.findIndex((arg, i) => !consumed.has(i) && !arg.startsWith('--'));
  return index >= 0 ? args[index] : undefined;
}

/**
 * The exit code for a request that never reaches sprint creation: `--help`, or a
 * missing task description.
 *
 * @param {object} parsed
 * @returns {number|null} null when the caller should continue
 */
function earlyExitFor(parsed) {
  if (parsed.helpFlag) {
    printSprintInitUsage();
    return 0;
  }
  if (parsed.error) {
    console.error(`Error: ${parsed.error}`);
    return 1;
  }
  return null;
}

function parseSprintInitArgs(args) {
  const helpFlag = args.includes('--help');
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

  const taskDescription = firstPositional(args, consumed);
  if (!taskDescription) {
    return { helpFlag, error: 'Missing task_description. Usage: xp-gate sprint-init "<task_description>"' };
  }
  return { helpFlag, forceFlag, dryRunFlag, projectDir, issues, taskDescription };
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
  const existingState = readExistingState(manager);
  if (!existingState) return { existingState: null };

  const same = identityOf(existingState, opts);
  if (isIdempotentCall(same, opts.branch)) return reportIdempotent(existingState);

  if (!opts.forceFlag) return refuseOverride(existingState, same, opts.dryRunFlag);

  return forceOverride(projectDir, existingState);
}

/**
 * Read the current state, treating a corrupted file as absent.
 *
 * Overwriting a corrupt state is the only way out of it, so "unreadable" must mean
 * the same thing here as "not there".
 *
 * @param {object} manager SprintStateManager
 * @returns {object|null}
 */
function readExistingState(manager) {
  try {
    return manager.read();
  } catch {
    return null;
  }
}

/**
 * The normalised facts that decide whether this is the same sprint.
 *
 * @param {object} state
 * @param {{taskDescription: string}} opts
 * @returns {{task: string, branch: string}}
 */
function identityOf(state, opts) {
  return {
    task: (state.task_description || '').trim(),
    branch: state.isolation?.branch || '',
    newTask: opts.taskDescription.trim(),
  };
}

/**
 * Whether the call is a repeat of the sprint already on disk.
 *
 * `detached` is excluded on purpose: a detached HEAD has no branch identity to
 * compare, so treating it as a match would silently accept a second sprint on the
 * same task.
 *
 * @param {{task: string, branch: string, newTask: string}} same
 * @param {string} branch
 * @returns {boolean}
 */
function isIdempotentCall(same, branch) {
  return same.task === same.newTask && same.branch === branch && branch !== 'detached';
}

/** Report that the sprint is already initialised and show it. */
function reportIdempotent(existingState) {
  console.log('ℹ️  Sprint already initialized (idempotent call). Current state:');
  console.log('');
  console.log(renderDashboard(existingState));
  return { exitCode: 0, existingState };
}

/**
 * Refuse to replace an active sprint without `--force`.
 *
 * A dry run reports the same decision as JSON instead of failing, so a caller can
 * check for a conflict without handling a non-zero exit.
 */
function refuseOverride(existingState, same, dryRunFlag) {
  if (dryRunFlag) {
    console.log(JSON.stringify({
      decision: 'deny',
      reason: `Active sprint "${existingState.id}" exists (task: "${same.task}")`,
      hint: 'Use --force to override (backs up old state)',
    }));
    return { exitCode: 0, existingState };
  }
  console.error(`Error: Active sprint "${existingState.id}" already exists.`);
  console.error(`  Task: "${same.task}"`);
  console.error(`  Branch: ${same.branch}`);
  console.error('  Use --force to override (backs up old state to .sprint-history/)');
  return { exitCode: 1, existingState };
}

/** Replace the existing sprint, after taking a backup. */
function forceOverride(projectDir, existingState) {
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
/** Whether a history entry is a RETRO rather than a state snapshot. */
function isRetroFile(name) {
  // `sprint-state-*.json` is a state snapshot, not a retro; only a retro file carries
  // the fields this feeds.
  return !name.endsWith('.json') || name.includes('retro');
}

/** The newest `sprint-*` entry in the history directory, or null. */
function newestHistoryEntry(historyDir) {
  const entries = fs.readdirSync(historyDir).filter((f) => f.startsWith('sprint-')).sort().reverse();
  return entries[0] || null;
}

function readPreviousRetro(projectDir) {
  const historyDir = path.join(projectDir, '.sprint-history');
  if (!fs.existsSync(historyDir)) return null;

  const newest = newestHistoryEntry(historyDir);
  if (!newest || !isRetroFile(newest)) return null;

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
/** The retro fields carried into the next sprint's metrics, and their source names. */
const CARRIED_RETRO_FIELDS = {
  previous_rework_rate: 'rework_rate',
  previous_evidence_skips: 'evidence_skips',
  previous_duration_seconds: 'duration_seconds',
};

/**
 * Copy the previous sprint's headline metrics into the new one.
 *
 * Only values that are PRESENT are copied: a retro written before a field existed
 * must not write `null` into the new sprint's metrics, because a null reads as
 * "measured at nothing".
 *
 * @param {object} newState mutated in place
 * @param {object|null} retro
 */
function applyPreviousRetro(newState, retro) {
  if (!retro) return;
  for (const [target, source] of Object.entries(CARRIED_RETRO_FIELDS)) {
    if (retro[source] != null) newState.metrics[target] = retro[source];
  }
  announceCarriedMetrics(newState.metrics);
}

/**
 * Print the metrics just carried forward, if any.
 *
 * @param {object} metrics
 */
function announceCarriedMetrics(metrics) {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return;
  console.log('📊 Auto-populated from previous sprint retro data:');
  for (const [key, value] of entries) console.log(`   ${key}: ${value}`);
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
  const parsed = parseSprintInitArgs(args);
  const early = earlyExitFor(parsed);
  if (early !== null) return early;

  const { forceFlag, dryRunFlag, projectDir, issues, taskDescription } = parsed;

  const manager = new SprintStateManager(projectDir);
  const branch = detectBranch(projectDir);

  const existing = handleExistingSprint(manager, projectDir, {
    taskDescription, branch, forceFlag, dryRunFlag,
  });
  // An exitCode means the existing-sprint handler already decided the outcome.
  if (existing.exitCode !== undefined) return existing.exitCode;

  if (dryRunFlag) {
    reportDryRunAllow(existing.existingState, branch, taskDescription);
    return 0;
  }

  createAndAnnounce(manager, { projectDir, branch, taskDescription, issues });
  return 0;
}

/**
 * A dry run's "would proceed" answer, as JSON.
 *
 * It says WHY it would proceed -- overriding an existing sprint is a different
 * situation from starting a fresh one, and a caller checking the answer needs that.
 *
 * @param {object|null} existingState
 * @param {string} branch
 * @param {string} taskDescription
 */
function reportDryRunAllow(existingState, branch, taskDescription) {
  console.log(JSON.stringify({
    decision: 'allow',
    reason: existingState ? 'Would override existing sprint (--force)' : 'No existing sprint',
    branch,
    task_description: taskDescription.trim(),
  }));
}

/**
 * Build the state, write it, and show it.
 *
 * The dashboard is printed from the object that was WRITTEN, not from a re-read:
 * re-reading would show what the filesystem kept, which is a different claim from
 * what this command decided.
 *
 * @param {object} manager SprintStateManager
 * @param {{projectDir: string, branch: string, taskDescription: string, issues: string}} ctx
 */
function createAndAnnounce(manager, ctx) {
  const { projectDir, branch, taskDescription, issues } = ctx;
  const { sprintId, newState } = buildSprintState({
    projectDir, branch, taskDescription, issues, previousRetro: readPreviousRetro(projectDir),
  });

  manager.write(newState);

  console.log(`✅ Sprint initialized: ${sprintId}`);
  console.log(`   Task: ${taskDescription.trim()}`);
  console.log(`   Branch: ${branch}`);
  if (issues) console.log(`   Issues: ${issues}`);
  console.log('');
  console.log(renderDashboard(newState));
}

module.exports = { handleSprintInit, detectBranch, generateSprintId, backupSprintState, parseSprintInitArgs };
