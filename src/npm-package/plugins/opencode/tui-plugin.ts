/**
 * XP-Gate OpenCode TUI Slot Plugin
 *
 * Registers sidebar_content slot to display Sprint Flow progress
 * from .sprint-state/sprint-state.json.
 *
 * This is a separate plugin file because SDK 1.x PluginModule does not
 * support server + tui in the same module. Users register this file
 * in ~/.config/opencode/tui.json as:
 *   { "plugin": ["@boyingliu01/opencode-plugin/tui"] }
 *
 * The npm package exports "./tui" from package.json for this resolution.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { TuiPlugin, TuiSlotPlugin, TuiSlotProps } from "@opencode-ai/plugin/tui"
// ── Phase constants (inlined from ../../src/npm-package/lib/shared-phase-constants.js)
//   This file is inlined because the installed npm package does not bundle src/ at publish time. ──

const PHASE_NAMES: Record<string, string> = {
  '-1': 'ISOLATE',
  '-0.5': 'AUTO-ESTIMATE',
  '0': 'THINK',
  '1': 'PLAN',
  '2': 'BUILD',
  '3': 'REVIEW',
  '4': 'USER ACCEPT',
  '5': 'FEEDBACK',
  '6': 'SHIP',
  '7': 'LAND',
  '8': 'CLEANUP',
};

const PHASE_ORDER = ['-1', '-0.5', '0', '1', '2', '3', '4', '5', '6', '7', '8'];

function parseTime(value: unknown): number {
  return new Date(value as string).getTime();
}

function isStale(state: SprintState | null): boolean {
  if (!state || !state.started_at) return false;
  const latest = sprintTimestamp(state);
  return latest > 0 && Date.now() - latest > 3600000;
}

function sprintTimestamp(state: SprintState | null): number {
  if (!state || !state.started_at) return 0;
  const started = parseTime(state.started_at);
  if (isNaN(started)) return 0;
  let latest = started;
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      latest = ph.completed_at ? Math.max(latest, parseTime(ph.completed_at)) : latest;
      latest = ph.started_at ? Math.max(latest, parseTime(ph.started_at)) : latest;
    }
  }
  return latest;
}

// ── Sprint state schema ──

interface SprintReq {
  name?: string
  status?: "completed" | "in_progress" | "pending"
}

interface SprintPhaseHistory {
  phase: number | string
  phase_name?: string
  status?: "completed" | "in_progress" | "pending"
  started_at?: string
  completed_at?: string
  duration_seconds?: number
  reqs?: Record<string, SprintReq>
}

interface SprintState {
  id?: string
  phase?: number | string
  status?: string
  started_at?: string
  task_description?: string
  isolation?: { branch?: string; worktree_path?: string }
  metrics?: { tests_passed?: number; tests_failed?: number; coverage_pct?: number }
  phase_history?: SprintPhaseHistory[]
}

// ── Helpers ──

function readSprintState(dir: string): SprintState | null {
  try {
    const stateFile = join(dir, ".sprint-state", "sprint-state.json")
    if (!existsSync(stateFile)) return null
    return JSON.parse(readFileSync(stateFile, "utf8"))
  } catch {
    return null
  }
}

function statusSymbol(status: string | undefined, key: string, currentPhase: string | number | undefined): string {
  if (status === "completed") return "✓"
  if (status === "in_progress") return "→"
  if (String(currentPhase) === key) return "·"
  return "○"
}

function renderPhaseLine(key: string, history: SprintPhaseHistory | undefined, currentPhase: string | number | undefined): string {
  const name = history?.phase_name || PHASE_NAMES[key] || key
  const status = history?.status || (String(currentPhase) === key ? "in_progress" : "pending")
  const sym = statusSymbol(status, key, currentPhase)
  return `${sym} ${name.padEnd(14)} ${status === "completed" ? "done" : status === "in_progress" ? "active" : ""}`
    .replace(/\s+$/, "")
}

function buildPhaseLookup(state: SprintState): Record<string, SprintPhaseHistory> {
  const lookup: Record<string, SprintPhaseHistory> = {}
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      lookup[String(ph.phase)] = ph
    }
  }
  return lookup
}

function buildMetricsLine(metrics: SprintState["metrics"]): string | null {
  const parts: string[] = []
  if (metrics?.tests_passed != null) parts.push(`tests:${metrics.tests_passed}`)
  if (metrics?.coverage_pct != null) parts.push(`cov:${metrics.coverage_pct}%`)
  return parts.length > 0 ? parts.join(" ") : null
}

function buildStaleWarning(state: SprintState): string | null {
  if (!state || !state.started_at) return null
  return isStale(state) ? "⚠ idle >1h" : null
}

function renderBuildReqs(history: SprintPhaseHistory): string[] {
  if (!history.reqs) return []
  return Object.entries(history.reqs)
    .filter(([, r]) => r.name)
    .map(([id, r]) => `  ${statusSymbol(r.status, id, undefined)} ${r.name}`)
}

function appendBuildReqs(lines: string[], key: string, history: SprintPhaseHistory | undefined): void {
  if (key === "2" && history?.reqs) {
    lines.push(...renderBuildReqs(history))
  }
}

function renderPhaseLines(
  historyByPhase: Record<string, SprintPhaseHistory>,
  currentPhase: string | number | undefined,
): string[] {
  const lines: string[] = []
  for (const key of PHASE_ORDER) {
    const history = historyByPhase[key]
    if (!history && String(currentPhase) !== key) continue
    lines.push(renderPhaseLine(key, history, currentPhase))
    appendBuildReqs(lines, key, history)
  }
  return lines
}

function renderSprintSidebar(state: SprintState): string {
  if (!state || !state.task_description) return ""

  const lines: string[] = [`SPRINT: ${state.task_description}`]
  const metricsLine = buildMetricsLine(state.metrics)
  if (metricsLine) lines.push(metricsLine)

  const staleWarning = buildStaleWarning(state)
  if (staleWarning) lines.push(staleWarning)

  const historyByPhase = buildPhaseLookup(state)
  lines.push(...renderPhaseLines(historyByPhase, state.phase))

  return lines.join("\n")
}

// ── TUI Slot Plugin ──

const tuiPlugin: TuiSlotPlugin = {
  slots: {
    sidebar_content: (_props: TuiSlotProps) => {
      const dir = process.env.XP_GATE_PROJECT_DIR || process.cwd()
      const state = readSprintState(dir)
      if (!state) return null
      const text = renderSprintSidebar(state)
      if (!text) return null
      return text
    },
  },
}

// Wrap as TuiPlugin (async factory)
const plugin: TuiPlugin = async (api, _options, _meta) => {
  api.slots.register(tuiPlugin)
}

export { plugin as tui, readSprintState, renderSprintSidebar }
