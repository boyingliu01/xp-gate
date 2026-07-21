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
const { SprintStateManager } = require('./sprint-state-manager');

/**
 * Render ASCII dashboard from sprint state.
 * Reuses the formatSprintTable logic from sprint-status.
 * @param {object} state - Sprint state object
 * @returns {string} Rendered dashboard
 */
function renderDashboard(state) {
  if (!state) return 'No sprint state found';

  const PHASE_NAMES = {
    '1': 'PREP', '2': 'DESIGN', '3': 'BUILD',
    '4': 'VERIFY', '5': 'SHIP', '6': 'CLOSE',
  };

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
  const currentPhaseName = PHASE_NAMES[String(currentPhase)] || `Phase ${currentPhase}`;

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
    const name = (PHASE_NAMES[String(i)] || `Phase ${i}`).padEnd(10);
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
    console.log('');
    console.log('Examples:');
    console.log('  xp-gate phase-transition 1 completed');
    console.log('  xp-gate phase-transition 3 completed --render');
    console.log('  xp-gate phase-transition 2 in_progress --outputs \'{"spec":"path.yaml"}\'');
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
    const newState = manager.transitionPhase(phase, status, { outputs });

    console.log(`✅ Phase ${phase} transitioned to '${status}'`);

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

module.exports = { handlePhaseTransition, renderDashboard };
