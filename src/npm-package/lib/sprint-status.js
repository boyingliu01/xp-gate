/**
 * xp-gate sprint-status — Sprint Flow progress CLI
 *
 * Reads .sprint-state/sprint-state.json (canonical schema per skills/sprint-flow/SKILL.md L893-942)
 * and renders a formatted progress table.
 *
 * @module sprint-status
 */

const fs = require('fs');
const path = require('path');
const { discoverActiveSprints } = require('./sprint-discovery');

// Phase constants (inlined; was shared-phase-constants.js, removed in v0.13.0 slimming)
const PHASE_NAMES = {
  '1': 'PREP', '2': 'DESIGN', '3': 'BUILD',
  '4': 'VERIFY', '5': 'SHIP', '6': 'CLOSE',
};
const PHASE_ORDER = ['1', '2', '3', '4', '5', '6'];

function parseTime(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return isNaN(t) ? 0 : t;
}

function getLatestTimestamp(state) {
  if (!state || !state.started_at) return 0;
  const started = parseTime(state.started_at);
  if (!started) return 0;
  const timestamps = [started];
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      timestamps.push(parseTime(ph.completed_at));
      timestamps.push(parseTime(ph.started_at));
      timestamps.push(parseTime(ph.timestamp));
    }
  }
  return Math.max(...timestamps);
}

function isStale(state) {
  if (!state || !state.started_at) return false;
  const latest = getLatestTimestamp(state);
  return latest > 0 && Date.now() - latest > 3600000;
}

/**
 * Read and parse sprint-state.json from a project directory.
 * @param {string} dir - Project root directory
 * @returns {object|null} Parsed sprint state, or null if not found or malformed
 */
function readSprintState(dir) {
  try {
    const stateFile = path.join(dir, '.sprint-state', 'sprint-state.json');
    if (!fs.existsSync(stateFile)) return null;
    const raw = fs.readFileSync(stateFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Get a phase's status icon.
 * @param {'completed'|'in_progress'|'pending'|string} status
 * @returns {string} Icon character
 */
function statusIcon(status) {
  switch (status) {
    case 'completed': return '✅';
    case 'in_progress': return '🔄';
    default: return '⏳';
  }
}

/**
 * Format a duration in seconds to a human-readable string.
 * @param {number|null} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (seconds == null || seconds === 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

/**
 * Format the sprint header lines (task description, ID, branch).
 * @param {object} state - Sprint state object
 * @param {string} branch - Branch name
 * @returns {string[]} Header lines
 */
function buildHeader(state, branch) {
  return [
    `Sprint: ${state.task_description}`,
    `ID: ${state.id || 'unknown'}  |  Branch: ${branch}`,
  ];
}

/**
 * Format the metrics line (tests, coverage).
 * @param {object} metrics - Sprint metrics object
 * @returns {string|null} Metrics line or null if no metrics
 */
function buildMetricsLine(metrics) {
  const parts = [];
  if (metrics.tests_passed != null) {
    parts.push(`Tests: ${metrics.tests_passed} passed${metrics.tests_failed ? `, ${metrics.tests_failed} failed` : ''}`);
  }
  if (metrics.coverage_pct != null) {
    parts.push(`Coverage: ${metrics.coverage_pct}%`);
  }
  return parts.length > 0 ? `Metrics: ${parts.join('  |  ')}` : null;
}

/**
 * Build a phase lookup map from phase_history array.
 * @param {object} state - Sprint state object
 * @returns {object} Map of phase key → phase history entry
 */
function buildPhaseLookup(state) {
  const map = {};
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      map[String(ph.phase)] = ph;
    }
  }
  return map;
}

/**
 * Format a single phase row line.
 * @param {string} key - Phase key (e.g. '0', '1')
 * @param {object|undefined} history - Phase history entry
 * @param {number} maxNameLen - Max phase name length for padding
 * @returns {string} Formatted phase line
 */
function formatPhaseLine(key, history, maxNameLen) {
  const name = history?.phase_name || PHASE_NAMES[key] || key;
  const status = history?.status || 'pending';
  const icon = statusIcon(status);
  const dur = formatDuration(history?.duration_seconds);
  const statusLabel = status === 'completed' ? 'Completed' :
    status === 'in_progress' ? 'In Progress' : 'Pending';
  return `  Phase ${key.padStart(4)}  ${name.padEnd(maxNameLen + 1)} ${icon} ${dur.padEnd(5)} ${statusLabel}`;
}

/**
 * Format REQ-level progress sub-lines for a phase (typically BUILD).
 * @param {object|undefined} history - Phase history entry with optional reqs
 * @returns {string[]} Array of REQ progress lines (may be empty)
 */
function formatReqLines(history) {
  if (!history?.reqs) return [];
  const lines = [];
  for (const [reqId, req] of Object.entries(history.reqs)) {
    lines.push(`    ${statusIcon(req.status)} ${reqId}  ${req.name}`);
  }
  return lines;
}

/**
 * Render sprint state as a formatted table string.
 * @param {object} state - Sprint state object
 * @returns {string}
 */
function formatSprintTable(state) {
  if (!state || !state.task_description) {
    return 'No active sprint in this directory';
  }

  const branch = state.isolation?.branch || 'unknown';
  const metrics = state.metrics || {};
  const lines = buildHeader(state, branch);

  const metricsLine = buildMetricsLine(metrics);
  if (metricsLine) lines.push(metricsLine);

  if (isStale(state)) {
    lines.push('⚠️  State may be stale (last updated >1h ago)');
  }
  lines.push('');

  const historyByPhase = buildPhaseLookup(state);

  let maxNameLen = 'Phase'.length;
  for (const key of PHASE_ORDER) {
    const name = historyByPhase[key]?.phase_name || PHASE_NAMES[key] || key;
    if (name.length > maxNameLen) maxNameLen = name.length;
  }

  const sep = '─'.repeat(maxNameLen + 40);
  lines.push(sep);

  for (const key of PHASE_ORDER) {
    lines.push(formatPhaseLine(key, historyByPhase[key], maxNameLen));
    lines.push(...formatReqLines(historyByPhase[key]));
  }

  lines.push(sep);
  return lines.join('\n');
}

/**
 * Convert sprint state to JSON string.
 * @param {object} state - Sprint state object
 * @returns {string} JSON string
 */
function jsonMode(state) {
  return JSON.stringify(state, null, 2);
}

/**
 * CLI entry point. Parses args and executes the appropriate mode.
 * @param {string[]} args - CLI subargs (without 'sprint-status')
 * @returns {Promise<number>} Exit code
 */
async function handleSprintStatus(args = []) {
  const jsonFlag = args.includes('--json');
  const watchFlag = args.includes('--watch');
  const allFlag = args.includes('--all');
  const dirIdx = args.indexOf('--dir');
  let searchDir = process.cwd();

  if (dirIdx >= 0 && dirIdx + 1 < args.length) {
    searchDir = path.resolve(args[dirIdx + 1]);
    // Path traversal protection: must be under cwd
    if (!searchDir.startsWith(process.cwd())) {
      console.error('Error: --dir path must be under current working directory');
      return 1;
    }
  }

  if (allFlag) {
    return handleAllSprints(searchDir, jsonFlag, watchFlag);
  }

  const state = readSprintState(searchDir);

  if (!state) {
    console.log('No active sprint in this directory');
    return 0;
  }

  if (jsonFlag) {
    console.log(jsonMode(state));
    return 0;
  }

  if (watchFlag) {
    const stateFile = path.join(searchDir, '.sprint-state', 'sprint-state.json');
    return watchMode(stateFile);
  }

  console.log(formatSprintTable(state));
  return 0;
}

/**
 * Handle --all mode: discover all active sprints across worktrees.
 * @param {string} searchDir - Starting directory
 * @param {boolean} jsonFlag - JSON output mode
 * @param {boolean} watchFlag - Watch mode (not supported in --all)
 * @returns {Promise<number>} Exit code
 */
async function handleAllSprints(searchDir, jsonFlag, watchFlag) {
  if (watchFlag) {
    console.error('Error: --watch is not supported with --all');
    return 1;
  }

  const sprints = discoverActiveSprints(searchDir);

  if (sprints.length === 0) {
    console.log('No active sprints found');
    return 0;
  }

  if (jsonFlag) {
    console.log(jsonMode(sprints.map(s => ({
      ...s.state,
      source_path: s.sourcePath,
      worktree_exists: s.worktreeExists,
    }))));
    return 0;
  }

  for (let i = 0; i < sprints.length; i++) {
    const { state, worktreeExists } = sprints[i];
    console.log(formatSprintTable(state));
    if (worktreeExists) {
      console.log(`  Worktree: ${state.isolation?.worktree_path || 'unknown'}`);
    }
    if (i < sprints.length - 1) {
      console.log('\n' + '='.repeat(60) + '\n');
    }
  }

  return 0;
}

/**
 * Watch mode: listen for changes to the sprint state file.
 * Prefers fs.watch(), falls back to fs.watchFile().
 * @param {string} stateFile - Path to sprint-state.json
 * @returns {Promise<number>} This never resolves normally (process.exit on SIGINT)
 */
function watchMode(stateFile) {
  return new Promise((resolve) => {
    const dir = path.dirname(stateFile);
    let watcher = null;

    try {
      watcher = fs.watch(dir, (eventType, filename) => {
        if (filename === 'sprint-state.json' || filename === path.basename(stateFile)) {
          const state = readSprintState(path.dirname(dir)); // parent of .sprint-state
          if (state) {
            console.clear();
            console.log(formatSprintTable(state));
          }
        }
      });
    } catch {
      // Fallback to fs.watchFile
      try {
        fs.watchFile(stateFile, { interval: 5000 }, () => {
          const state = readSprintState(path.dirname(dir));
          if (state) {
            console.clear();
            console.log(formatSprintTable(state));
          }
        });
      } catch {
        console.error('Watch mode not available on this platform');
        resolve(1);
        return;
      }
    }

    // Initial render
    const initialState = readSprintState(path.dirname(dir));
    if (initialState) {
      console.log(formatSprintTable(initialState));
    }
    console.log('Watching for changes... (Ctrl+C to stop)');

    // Cleanup on exit
    process.on('SIGINT', () => {
      if (watcher) {
        try { watcher.close(); } catch {}
      }
      try { fs.unwatchFile(stateFile); } catch {}
      console.log('\nStopped watching.');
      resolve(0);
    });
  });
}

module.exports = {
  readSprintState,
  formatSprintTable,
  jsonMode,
  isStale,
  handleSprintStatus,
};
