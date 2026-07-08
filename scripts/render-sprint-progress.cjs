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

// ── Phase definitions (ordered, 6 phases — compact redesign v2) ─────────
// Old 11-phase → New 6-phase mapping:
//   -1 ISOLATE + -0.5 AUTO-ESTIMATE → 1 PREP
//   0 THINK + 1 PLAN                → 2 DESIGN
//   2 BUILD                         → 3 BUILD
//   3 REVIEW + 4 FEEDBACK           → 4 VERIFY
//   5 SHIP + 6 LAND                 → 5 SHIP
//   7 USER ACCEPTANCE + 8 CLEANUP   → 6 CLOSE
const PHASES = [
  { num: 1, name: 'PREP',   label: 'Phase 1/6' },
  { num: 2, name: 'DESIGN', label: 'Phase 2/6' },
  { num: 3, name: 'BUILD',  label: 'Phase 3/6' },
  { num: 4, name: 'VERIFY', label: 'Phase 4/6' },
  { num: 5, name: 'SHIP',   label: 'Phase 5/6' },
  { num: 6, name: 'CLOSE',  label: 'Phase 6/6' },
];

// ── Legacy phase number → new phase number mapping (backward compat) ────
// Only map numbers that are UNAMBIGUOUSLY legacy:
//   - Negative numbers (-1, -0.5) are always legacy
//   - 0 is always legacy (THINK, doesn't exist in new model)
//   - 7, 8 are always legacy (USER ACCEPTANCE, CLEANUP — not in new model's 1-6)
// Numbers 1-6 are ambiguous (could be old or new), so they are NOT mapped here.
// For legacy 1-6, the phase_history entry's phase_name provides disambiguation.
const LEGACY_PHASE_MAP = {
  '-1': 1,         // ISOLATE → PREP
  '-0.5': 1,      // AUTO-ESTIMATE → PREP
  '0': 2,          // THINK → DESIGN
  '7': 6,          // USER ACCEPTANCE → CLOSE
  '8': 6,          // CLEANUP → CLOSE
};

/**
 * Detect whether a sprint-state uses legacy 11-phase or new 6-phase model.
 * Legacy markers: negative phase numbers, 0, 7, 8, or legacy phase names.
 * @param {object} state
 * @returns {boolean}
 */
function isLegacyState(state) {
  // Explicit schema version check
  if (state.schema_version === 2 || state.phase_model === 'compact') {
    return false;
  }
  // Check currentPhase for unambiguous legacy numbers
  const cp = state.phase;
  if (cp !== undefined && cp !== null) {
    const key = String(cp);
    if (['-1', '-0.5', '0', '7', '8'].includes(key)) return true;
  }
  // Check phase_history for legacy markers
  const history = state.phase_history;
  if (history) {
    for (const h of history) {
      const key = String(h.phase);
      if (['-1', '-0.5', '0', '7', '8'].includes(key)) return true;
      // Also check phase_name for legacy names that don't exist in new model
      if (h.phase_name && LEGACY_ONLY_NAMES[h.phase_name]) return true;
    }
  }
  return false;
}

// Phase names that only exist in legacy model (not in new 6-phase)
const LEGACY_ONLY_NAMES = {
  'ISOLATE': true,
  'AUTO-ESTIMATE': true,
  'THINK': true,
  'PLAN': true,
  'REVIEW': true,
  'FEEDBACK': true,
  'LAND': true,
  'USER ACCEPT': true,
  'USER ACCEPTANCE': true,
};

// Legacy phase names → new phase numbers (for phase_name based disambiguation)
const LEGACY_PHASE_NAMES = {
  'ISOLATE': 1,
  'AUTO-ESTIMATE': 1,
  'THINK': 2,
  'PLAN': 2,
  'BUILD': 3,
  'REVIEW': 4,
  'USER ACCEPT': 6,
  'USER ACCEPTANCE': 6,
  'FEEDBACK': 4,
  'SHIP': 5,
  'LAND': 5,
  'CLEANUP': 6,
};

// Legacy phase numbers 1-6 → new phase numbers (only applied when isLegacyState)
const LEGACY_NUM_MAP_1_6 = {
  1: 2,   // PLAN → DESIGN
  2: 3,   // BUILD → BUILD
  3: 4,   // REVIEW → VERIFY
  4: 4,   // FEEDBACK → VERIFY
  5: 5,   // SHIP → SHIP
  6: 5,   // LAND → SHIP
};

/**
 * Normalize a phase number: if it's a legacy number, map to new.
 * @param {number} phaseNum
 * @param {boolean} isLegacy - if true, treat 1-6 as legacy numbers too
 * @returns {number}
 */
function normalizePhaseNum(phaseNum, isLegacy) {
  const key = String(phaseNum);
  // Unambiguous legacy numbers always map
  if (LEGACY_PHASE_MAP[key] !== undefined) {
    return LEGACY_PHASE_MAP[key];
  }
  // Ambiguous 1-6: only map if we know this is a legacy state
  if (isLegacy && LEGACY_NUM_MAP_1_6[phaseNum] !== undefined) {
    return LEGACY_NUM_MAP_1_6[phaseNum];
  }
  return phaseNum;
}

/**
 * Normalize a phase_history entry to new phase number.
 * Uses phase_name for disambiguation when available.
 * @param {{phase: number, phase_name?: string}} entry
 * @param {boolean} isLegacy
 * @returns {number}
 */
function normalizeHistoryPhase(entry, isLegacy) {
  // If entry has phase_name and it's a legacy name, use name-based mapping
  if (entry.phase_name && LEGACY_PHASE_NAMES[entry.phase_name] !== undefined) {
    return LEGACY_PHASE_NAMES[entry.phase_name];
  }
  // Fall back to number-based mapping
  return normalizePhaseNum(entry.phase, isLegacy);
}

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

// ── Next-action lookup (6-phase model) ──────────────────────────────────
const NEXT_ACTIONS = {
  '1:completed':   ['确认设计', '检查 worktree 路径和规模评估，准备进入设计阶段'],
  '1:running':     ['准备环境', '正在创建 worktree 和评估规模'],
  '1:paused':      ['确认评估', '查看 PREP 结果，确认流程级别'],
  '2:completed':   ['确认设计', '设计已通过 Delphi 共识，检查 specification.yaml'],
  '2:running':     ['等待设计', 'brainstorming + autoplan + delphi-review 进行中'],
  '2:paused':      ['审阅设计', '设计文档等待您的 APPROVED 确认'],
  '3:completed':   ['开始验证', 'BUILD 完成，进入 Phase 4 VERIFY'],
  '3:running':     ['等待构建', 'ralph-loop 迭代中，无需操作'],
  '4:completed':   ['准备发布', '验证完成，准备进入 Phase 5 SHIP'],
  '4:running':     ['等待验证', 'code-walkthrough + QA + retro 进行中'],
  '4:paused':      ['等待验证', '验证阶段暂停，检查评审结果'],
  '5:completed':   ['确认合并', 'PR 已创建/合并，确认部署结果'],
  '5:running':     ['等待发布', 'PR 创建 + 合并 + 部署进行中'],
  '5:paused':      ['确认合并', 'PR 已创建，确认是否合并'],
  '6:completed':   ['Sprint 完成', '检查 Sprint Summary，如有 emergent issues 考虑 Sprint 2'],
  '6:running':     ['等待收尾', '用户验收或清理进行中'],
  '6:paused':      ['执行验收', '必须人工验收，请实际使用后确认'],
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
 * Handles both new (1-6) and legacy (-1 to 8) phase numbers.
 * @param {Array|null} history
 * @param {number} phaseNum - new phase number (1-6)
 * @param {number} currentPhase - normalized new phase number (1-6)
 * @param {boolean} isLegacy - whether the source state is legacy
 * @returns {string}
 */
function getPhaseStatus(history, phaseNum, currentPhase, isLegacy) {
  if (history) {
    // Check if any history entry maps to this new phase number
    const entry = history.find((h) => normalizeHistoryPhase(h, isLegacy) === phaseNum);
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
 * @param {number} phaseNum - new phase number (1-6)
 * @param {boolean} isLegacy
 * @returns {number|null}
 */
function getPhaseDuration(history, phaseNum, isLegacy) {
  if (!history) return null;
  const entry = history.find((h) => normalizeHistoryPhase(h, isLegacy) === phaseNum);
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
  // Detect legacy vs new phase model
  const isLegacy = isLegacyState(state);
  // Normalize currentPhase
  const rawPhase = state.phase != null ? state.phase : 1;
  const currentPhase = normalizePhaseNum(rawPhase, isLegacy);
  const history = state.phase_history || null;
  const outputs = state.outputs || {};

  // Build phase rows
  const phaseRows = PHASES.map((p) => {
    const status = getPhaseStatus(history, p.num, currentPhase, isLegacy);
    const icon = STATUS_ICONS[status] || STATUS_ICONS.pending;
    const duration = formatDuration(getPhaseDuration(history, p.num, isLegacy));
    return { ...p, status, icon, duration };
  });

  // Progress bar
  const total = PHASES.length; // 6
  const completedCount = phaseRows.filter((r) => r.status === 'completed').length;
  const pct = Math.round((completedCount / total) * 100);
  const bar = phaseRows
    .map((r) => PROGRESS_CHARS[r.status] || PROGRESS_CHARS.pending)
    .join('');

  // Current phase info
  const currentDef = PHASES.find((p) => p.num === currentPhase) || PHASES[0];
  const currentStatus = getPhaseStatus(history, currentPhase, currentPhase, isLegacy);

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
module.exports = { renderDashboard, formatDuration, formatTimestamp, getPhaseStatus, normalizePhaseNum, normalizeHistoryPhase, isLegacyState, LEGACY_PHASE_MAP, LEGACY_PHASE_NAMES, LEGACY_NUM_MAP_1_6, PHASES, STATUS_ICONS, PROGRESS_CHARS, NEXT_ACTIONS };

// Run if executed directly
if (require.main === module) {
  main();
}
