#!/usr/bin/env node
/**
 * render-sprint-progress.cjs
 *
 * Reads sprint-state.json and renders an ASCII progress dashboard.
 * Usage: node scripts/render-sprint-progress.cjs [path-to-sprint-state.json]
 *
 * Exit codes:
 *   0 - rendered successfully
 *   1 - file not found or parse error
 */

const fs = require('fs');
const path = require('path');

// ── Phase definitions (ordered, 11 phases) ──────────────────────────────
const PHASES = [
  { num: -1,   name: 'ISOLATE',       label: 'Phase -1  ' },
  { num: -0.5, name: 'AUTO-ESTIMATE', label: 'Phase -0.5' },
  { num: 0,    name: 'THINK',         label: 'Phase 0   ' },
  { num: 1,    name: 'PLAN',          label: 'Phase 1   ' },
  { num: 2,    name: 'BUILD',         label: 'Phase 2   ' },
  { num: 3,    name: 'REVIEW',        label: 'Phase 3   ' },
  { num: 4,    name: 'USER ACCEPT',   label: 'Phase 4   ' },
  { num: 5,    name: 'FEEDBACK',      label: 'Phase 5   ' },
  { num: 6,    name: 'SHIP',          label: 'Phase 6   ' },
  { num: 7,    name: 'LAND',          label: 'Phase 7   ' },
  { num: 8,    name: 'CLEANUP',       label: 'Phase 8   ' },
];

const STATUS_ICONS = {
  completed: '\u2705',
  running:   '\uD83D\uDD04',
  paused:    '\u23F8\uFE0F',
  pending:   '\u2B1C',
  skipped:   '\u23ED\uFE0F',
  failed:    '\u274C',
};

const PROGRESS_CHARS = {
  completed: '\u2588',
  running:   '\u2593',
  pending:   '\u2591',
  skipped:   '\u2592',
};

// ── Next-action lookup ──────────────────────────────────────────────────
const NEXT_ACTIONS = {
  '-1:completed':   ['\u786E\u8BA4\u73AF\u5883', '\u68C0\u67E5 worktree \u8DEF\u5F84\uFF0C\u51C6\u5907\u8FDB\u5165\u9700\u6C42\u5206\u6790'],
  '-0.5:completed': ['\u786E\u8BA4\u8BC4\u4F30', '\u67E5\u770B AUTO-ESTIMATE \u7ED3\u679C\uFF0C\u9009\u62E9\u6D41\u7A0B\u7EA7\u522B'],
  '0:completed':    ['\u786E\u8BA4\u8BBE\u8BA1', '\u5BA1\u9605\u8BBE\u8BA1\u6587\u6863\uFF0C\u786E\u8BA4\u540E\u8FDB\u5165 Phase 1'],
  '0:paused':       ['\u5BA1\u9605\u8BBE\u8BA1', '\u8BBE\u8BA1\u6587\u6863\u7B49\u5F85\u60A8\u7684 APPROVED \u786E\u8BA4'],
  '1:completed':    ['\u786E\u8BA4\u8BC4\u5BA1', 'delphi-review \u5DF2\u901A\u8FC7\uFF0C\u68C0\u67E5 specification.yaml'],
  '1:paused':       ['\u7B49\u5F85\u8BC4\u5BA1', 'delphi-review \u8FDB\u884C\u4E2D\u6216\u7B49\u5F85 taste_decisions \u786E\u8BA4'],
  '2:completed':    ['\u5BA1\u9605\u4EE3\u7801', 'BUILD \u5B8C\u6210\uFF0C\u8FDB\u5165 Phase 3 REVIEW'],
  '2:running':      ['\u7B49\u5F85\u6784\u5EFA', 'ralph-loop \u8FED\u4EE3\u4E2D\uFF0C\u65E0\u9700\u64CD\u4F5C'],
  '3:completed':    ['\u5F00\u59CB\u9A8C\u6536', '\u8FDB\u5165 Phase 4 \u4EBA\u5DE5\u9A8C\u6536'],
  '4:completed':    ['\u786E\u8BA4\u53CD\u9988', '\u9A8C\u6536\u5B8C\u6210\uFF0CPhase 5 \u81EA\u52A8\u8FDB\u884C'],
  '4:paused':       ['\u6267\u884C\u9A8C\u6536', '\u5FC5\u987B\u4EBA\u5DE5\u9A8C\u6536\uFF0C\u8BF7\u5B9E\u9645\u4F7F\u7528\u540E\u786E\u8BA4'],
  '5:completed':    ['\u786E\u8BA4\u53D1\u5E03', '\u53CD\u9988\u5DF2\u6536\u96C6\uFF0C\u51C6\u5907\u8FDB\u5165 Phase 6 SHIP'],
  '6:completed':    ['\u786E\u8BA4\u5408\u5E76', 'PR \u5DF2\u521B\u5EFA\uFF0C\u786E\u8BA4\u662F\u5426\u5408\u5E76'],
  '7:completed':    ['\u786E\u8BA4\u6E05\u7406', '\u5408\u5E76\u6210\u529F\uFF0C\u51C6\u5907\u6E05\u7406 worktree'],
  '8:completed':    ['Sprint \u5B8C\u6210', '\u68C0\u67E5 Sprint Summary\uFF0C\u5982\u6709 emergent issues \u8003\u8651 Sprint 2'],
};

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Format seconds into human-readable duration.
 * @param {number|null|undefined} secs
 * @returns {string}
 */
function formatDuration(secs) {
  if (secs == null || secs < 0) return '-';
  if (secs < 60) return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return `${d}d ${h}h`;
}

/**
 * Format ISO timestamp to "YYYY-MM-DD HH:MM".
 * @param {string|null} iso
 * @returns {string}
 */
function formatTimestamp(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '-';
  }
}

/**
 * Get phase status from phase_history array or infer from currentPhase.
 * @param {Array|null} history
 * @param {number} phaseNum
 * @param {number} currentPhase
 * @returns {string}
 */
function getPhaseStatus(history, phaseNum, currentPhase) {
  if (history) {
    const entry = history.find((h) => h.phase === phaseNum);
    if (entry) return entry.status;
  }
  // Backward compat: infer from currentPhase
  if (phaseNum < currentPhase) return 'completed';
  if (phaseNum === currentPhase) return 'running';
  return 'pending';
}

/**
 * Get phase duration from phase_history.
 * @param {Array|null} history
 * @param {number} phaseNum
 * @returns {number|null}
 */
function getPhaseDuration(history, phaseNum) {
  if (!history) return null;
  const entry = history.find((h) => h.phase === phaseNum);
  return entry ? entry.duration_seconds : null;
}

// ── Main render ─────────────────────────────────────────────────────────

/**
 * Render sprint progress dashboard.
 * @param {object} state - parsed sprint-state.json
 * @returns {string} rendered ASCII dashboard
 */
function renderDashboard(state) {
  const id = state.id || '-';
  const taskDesc = state.task_description || '-';
  const branch = (state.isolation && state.isolation.branch) || '-';
  const overallStatus = state.status || '-';
  const startedAt = formatTimestamp(state.started_at);
  const currentPhase = state.phase != null ? state.phase : -1;
  const history = state.phase_history || null;
  const outputs = state.outputs || {};

  // Build phase rows
  const phaseRows = PHASES.map((p) => {
    const status = getPhaseStatus(history, p.num, currentPhase);
    const icon = STATUS_ICONS[status] || STATUS_ICONS.pending;
    const duration = formatDuration(getPhaseDuration(history, p.num));
    return { ...p, status, icon, duration };
  });

  // Progress bar
  const total = PHASES.length; // 11
  const completedCount = phaseRows.filter((r) => r.status === 'completed').length;
  const pct = Math.round((completedCount / total) * 100);
  const bar = phaseRows
    .map((r) => PROGRESS_CHARS[r.status] || PROGRESS_CHARS.pending)
    .join('');

  // Current phase info
  const currentDef = PHASES.find((p) => p.num === currentPhase) || PHASES[0];
  const currentStatus = getPhaseStatus(history, currentPhase, currentPhase);

  // Next action
  const actionKey = `${currentPhase}:${currentStatus}`;
  let nextAction, nextDetail;
  if (currentStatus === 'failed') {
    [nextAction, nextDetail] = ['\u5904\u7406\u9519\u8BEF', '\u67E5\u770B\u9519\u8BEF\u4FE1\u606F\uFF0C\u51B3\u5B9A\u4FEE\u590D\u6216\u653E\u5F03'];
  } else if (NEXT_ACTIONS[actionKey]) {
    [nextAction, nextDetail] = NEXT_ACTIONS[actionKey];
  } else {
    [nextAction, nextDetail] = ['\u7EE7\u7EED\u6267\u884C', '\u51C6\u5907\u8FDB\u5165\u4E0B\u4E00\u9636\u6BB5'];
  }

  // Output list
  const outputKeys = Object.keys(outputs);
  const outputLines = outputKeys.length > 0
    ? outputKeys.map((k) => `    ${k}: ${outputs[k]}`).join('\n')
    : '    (\u65E0)';

  // Assemble dashboard
  const W = 60;
  const border = '+' + '='.repeat(W) + '+';
  const empty = '|' + ' '.repeat(W) + '|';

  function padLine(left, right) {
    const content = `  ${left}`;
    const rightPart = right ? `  ${right}` : '';
    const gap = W - content.length - rightPart.length;
    return '|' + content + ' '.repeat(Math.max(1, gap)) + rightPart + '|';
  }

  const lines = [
    border,
    padLine('SPRINT PROGRESS', id),
    border,
    padLine(`\u9700\u6C42: ${taskDesc}`, ''),
    padLine(`\u5206\u652F: ${branch}`, ''),
    padLine(`\u72B6\u6001: ${overallStatus}`, `\u542F\u52A8: ${startedAt}`),
    border,
    empty,
  ];

  for (const r of phaseRows) {
    const left = `${r.icon} ${r.label} ${r.name.padEnd(14)}`;
    lines.push(padLine(left, r.duration));
  }

  lines.push(empty);
  lines.push(padLine(`[${bar}] ${pct}%`, ''));
  lines.push(border);
  lines.push(padLine(`> \u5F53\u524D: Phase ${currentPhase} ${currentDef.name}`, ''));
  lines.push(padLine(`  \u72B6\u6001: ${currentStatus}`, ''));
  lines.push(empty);
  lines.push(padLine(`\u4E0B\u4E00\u6B65: ${nextAction}`, ''));
  lines.push(padLine(`  ${nextDetail}`, ''));
  lines.push(border);
  lines.push(padLine('\u8F93\u51FA\u7269:', ''));
  for (const line of outputLines.split('\n')) {
    lines.push(padLine(line, ''));
  }
  lines.push(border);

  return lines.join('\n');
}

// ── CLI entry ───────────────────────────────────────────────────────────

function main() {
  const statePath = process.argv[2] || path.join(process.cwd(), '.sprint-state', 'sprint-state.json');

  if (!fs.existsSync(statePath)) {
    console.log(`[INFO] \u672A\u627E\u5230\u6D3B\u8DC3\u7684 Sprint\u3002\u6587\u4EF6\u4E0D\u5B58\u5728: ${statePath}`);
    console.log('\u8BF7\u5148\u8FD0\u884C /sprint-flow "[\u9700\u6C42\u63CF\u8FF0]" \u542F\u52A8\u65B0 Sprint\u3002');
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    console.error(`[ERROR] \u65E0\u6CD5\u89E3\u6790 sprint-state.json: ${err.message}`);
    process.exit(1);
  }

  const dashboard = renderDashboard(state);
  console.log(dashboard);

  if (state.status === 'completed') {
    console.log('\n[INFO] Sprint \u5DF2\u5B8C\u6210\u3002');
  }
}

// Export for testing
module.exports = { renderDashboard, formatDuration, formatTimestamp, getPhaseStatus, PHASES, STATUS_ICONS, PROGRESS_CHARS, NEXT_ACTIONS };

// Run if executed directly
if (require.main === module) {
  main();
}
