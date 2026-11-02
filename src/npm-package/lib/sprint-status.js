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
const { execFileSync } = require('child_process');
const { discoverActiveSprints } = require('./sprint-discovery');
const { SprintStateManager } = require('./sprint-state-manager');

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
 * Uses SprintStateManager for schema validation + auto-migration.
 * @param {string} dir - Project root directory
 * @returns {object|null} Parsed sprint state, or null if not found or malformed
 */
function readSprintState(dir) {
  try {
    const manager = new SprintStateManager(dir);
    return manager.read();
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
    case 'skipped': return '⏭️';
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
    status === 'in_progress' ? 'In Progress' :
    status === 'skipped' ? 'Skipped' : 'Pending';
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

// #369: fix commit matching — conventional commits + keyword boundary
const FIX_RE = /^(fix(\(.+\))?:)|\b(fix|bugfix|hotfix|patch|修复)\b/i;

/**
 * Git env with every repo-redirecting variable stripped, so `cwd` is the only
 * thing that decides which repository is inspected.
 */
function cleanGitEnv() {
  const gitEnv = { ...process.env };
  for (const name of [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT', 'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE',
    'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_INDEX_FILE',
    'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
    'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
  ]) {
    delete gitEnv[name];
  }
  return gitEnv;
}

/**
 * Commit counts for a sprint's own time window: start → completion (#704).
 *
 * The old signature took only a lower bound, and the caller passed
 * `completed_at` — by definition the moment the sprint ENDED. Every sprint
 * commit happened before it, so `git log --since <completed_at>` returned an
 * empty set and the rework rate was structurally 0. The interval that matters
 * is "sprint start → sprint end", so both bounds are now explicit and neither
 * can drift away from the other.
 *
 * Returns BOTH numbers from a single `git log` call: the rate is `fix / total`,
 * and `total` was previously read from `state.metrics.total_sprint_commits`,
 * which nothing ever wrote — it was always 0, then floored to 1 by
 * `Math.max(total, 1)`, which is what turned "no data" into a confident 0%.
 *
 * `total === 0` is a meaningful answer (nothing to measure in the window) and is
 * reported as such rather than being dressed up as 0% rework.
 *
 * @param {string} repoDir - Repository root
 * @param {string|undefined} sinceDate - Sprint start (ISO 8601); omitted = unbounded
 * @param {string|undefined} untilDate - Sprint completion (ISO 8601); omitted = unbounded
 * @returns {{fix: number, total: number}} counts within the window
 */
function getWindowCommitCounts(repoDir, sinceDate, untilDate) {
  const empty = { fix: 0, total: 0 };
  if (!sinceDate) return empty;
  try {
    const args = ['log', '--all'];
    // --since/--until compare committer dates; missing or unparsable values are
    // ignored by git, which would silently widen the window back to "everything".
    // So only pass a bound that is actually a valid timestamp.
    if (!Number.isNaN(new Date(sinceDate).getTime())) args.push('--since', sinceDate);
    if (untilDate && !Number.isNaN(new Date(untilDate).getTime())) args.push('--until', untilDate);
    args.push('--pretty=format:%s');

    const out = execFileSync('git', args, {
      cwd: repoDir, env: cleanGitEnv(), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const subjects = out.split('\n').map(l => l.trim()).filter(Boolean);
    return { fix: subjects.filter(s => FIX_RE.test(s)).length, total: subjects.length };
  } catch {
    return empty;
  }
}

/**
 * Handle --rework-check mode: compute rework rate for recently closed sprints (#369).
 * @param {string} searchDir - Project root directory
 * @param {number} windowDays - Window in days after completed_at
 * @returns {Promise<number>} Exit code
 */
async function handleReworkCheck(searchDir, windowDays) {
  const stateDir = path.join(searchDir, '.sprint-state');
  const historyDir = path.join(stateDir, 'sprint-history');
  const sprintStateFile = path.join(stateDir, 'sprint-state.json');

  const sprints = [];

  // Current sprint-state.json
  if (fs.existsSync(sprintStateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(sprintStateFile, 'utf8'));
      if (state.metrics && state.metrics.completed_at) {
        sprints.push({ id: state.id || 'unknown', state, file: sprintStateFile });
      }
    } catch { /* skip malformed */ }
  }

  // History files
  if (fs.existsSync(historyDir)) {
    for (const f of fs.readdirSync(historyDir).filter(f => f.endsWith('.json'))) {
      try {
        const fp = path.join(historyDir, f);
        const state = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (state.metrics && state.metrics.completed_at) {
          sprints.push({ id: state.id || f.replace('.json', ''), state, file: fp });
        }
      } catch { /* skip malformed */ }
    }
  }

  const now = Date.now();
  const windowMs = windowDays * 86400000;
  const inWindow = sprints.filter(s => {
    const t = new Date(s.state.metrics.completed_at).getTime();
    return !isNaN(t) && (now - t) <= windowMs;
  });

  if (inWindow.length === 0) {
    console.log(`No closed sprints within ${windowDays} day${windowDays === 1 ? '' : 's'}`);
    return 0;
  }

  console.log(`Rework Rate Check (window: ${windowDays} days)`);
  console.log('─'.repeat(60));

  let hasAlert = false;
  let hasUnmeasurable = false;
  for (const { id, state, file } of inWindow) {
    // #704: the window is the sprint itself (start → completion), and both
    // counts come from one `git log` over that window. Previously the total was
    // read from a field nothing wrote, and the `--since` bound was the END of
    // the sprint, so both numbers were structurally 0 and the rate could only
    // ever be 0 — while the summary line still said "within acceptable rate".
    const { fix: fixCommits, total: totalCommits } = getWindowCommitCounts(
      searchDir,
      state.started_at,
      state.metrics.completed_at,
    );

    // No commits in the window means the rate is undefined, not zero. Reporting
    // 0.0% here would rebuild the same false reassurance one level down, so the
    // sprint is surfaced as unmeasurable and never counts as "within threshold".
    if (totalCommits === 0) {
      hasUnmeasurable = true;
      console.log(`  ${id}: 0 fix / 0 total commits — NOT MEASURABLE (no commits in sprint window)`);
      continue;
    }

    const rate = fixCommits / totalCommits;

    // Persist what was actually measured. The previous code wrote the rate
    // unconditionally, which meant a transposed 0 could overwrite a value a
    // human had already corrected; now the denominator is persisted alongside
    // it so the next run can be checked against its own evidence.
    state.metrics.rework_rate = rate;
    state.metrics.total_sprint_commits = totalCommits;
    state.metrics.fix_sprint_commits = fixCommits;
    try {
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    } catch { /* non-fatal */ }

    const pct = (rate * 100).toFixed(1);
    console.log(`  ${id}: ${pct}% (${fixCommits} fix / ${totalCommits} total commits)`);
    if (rate > 0.30) {
      console.log(`  ⚠️  ${id}: ${pct}% rework — exceeds 30% threshold`);
      hasAlert = true;
    }
  }

  console.log('─'.repeat(60));
  if (hasAlert) {
    console.log('⚠️  Rework rate alert: one or more sprints exceed 30% threshold');
  } else if (hasUnmeasurable) {
    // "All sprints within acceptable rate" would be a claim about sprints that
    // were never measured. Say which is which instead of picking the cheerful one.
    console.log('⚠️  Some sprints could not be measured (no commits in window) — not certified as within threshold');
  } else {
    console.log('All sprints within acceptable rework rate (≤30%)');
  }

  return 0;
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
    // Path traversal protection: must be under cwd. Use path.relative instead
    // of a prefix match so a sibling like `<cwd>2` cannot bypass the check
    // (#392-#5).
    const rel = path.relative(process.cwd(), searchDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      console.error('Error: --dir path must be under current working directory');
      return 1;
    }
  }

  // #369: --rework-check is mutually exclusive with regular status view
  if (args.includes('--rework-check')) {
    const wdIdx = args.indexOf('--window-days');
    const windowDays = (wdIdx >= 0 && args[wdIdx + 1]) ? parseInt(args[wdIdx + 1], 10) : 7;
    return handleReworkCheck(searchDir, isNaN(windowDays) ? 7 : windowDays);
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
  // Exported for #704: the rework-rate arithmetic was only reachable through
  // the CLI, so the only way to test it was to shell out and parse console
  // output. A function nobody can call directly is a function nobody can pin.
  handleReworkCheck,
};
