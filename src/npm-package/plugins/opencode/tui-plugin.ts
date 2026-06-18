// @no-test-required: Mirror of plugins/opencode/tui-plugin.ts — tested in plugins/opencode/__tests__/
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

// ── Constants ──

const PHASE_NAMES: Record<string, string> = {
  "-1": "ISOLATE",
  "-0.5": "AUTO-ESTIMATE",
  "0": "THINK",
  "1": "PLAN",
  "2": "BUILD",
  "3": "REVIEW",
  "4": "USER ACCEPT",
  "5": "FEEDBACK",
  "6": "SHIP",
  "7": "LAND",
  "8": "CLEANUP",
}

const PHASE_ORDER = ["-1", "-0.5", "0", "1", "2", "3", "4", "5", "6", "7", "8"]

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

function isStale(state: SprintState): boolean {
  if (!state || !state.started_at) return false
  const started = new Date(state.started_at).getTime()
  if (isNaN(started)) return false
  let latest = started
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      if (ph.completed_at) {
        const t = new Date(ph.completed_at).getTime()
        if (!isNaN(t) && t > latest) latest = t
      }
      if (ph.started_at) {
        const t = new Date(ph.started_at).getTime()
        if (!isNaN(t) && t > latest) latest = t
      }
    }
  }
  return Date.now() - latest > 3_600_000
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

function renderSprintSidebar(state: SprintState): string {
  if (!state || !state.task_description) return ""

  const lines: string[] = []
  const metrics = state.metrics || {}
  const currentPhase = state.phase

  // Build lookup
  const historyByPhase: Record<string, SprintPhaseHistory> = {}
  if (Array.isArray(state.phase_history)) {
    for (const ph of state.phase_history) {
      historyByPhase[String(ph.phase)] = ph
    }
  }

  // Title
  lines.push(`SPRINT: ${state.task_description}`)

  // Metrics
  const metricParts: string[] = []
  if (metrics.tests_passed != null) {
    metricParts.push(`tests:${metrics.tests_passed}`)
  }
  if (metrics.coverage_pct != null) {
    metricParts.push(`cov:${metrics.coverage_pct}%`)
  }
  if (metricParts.length > 0) {
    lines.push(metricParts.join(" "))
  }

  // Stale warning
  if (isStale(state)) {
    lines.push("⚠ idle >1h")
  }

  // Phase progress
  for (const key of PHASE_ORDER) {
    const history = historyByPhase[key]
    // Only show phases with activity or current
    if (!history && String(currentPhase) !== key) continue
    const line = renderPhaseLine(key, history, currentPhase)
    lines.push(line)

    // REQ-level progress for BUILD phase
    if (key === "2" && history?.reqs) {
      const reqNames = Object.entries(history.reqs)
        .filter(([, r]) => r.name)
        .map(([id, r]) => `  ${statusSymbol(r.status, id, undefined)} ${r.name}`)
      if (reqNames.length > 0) lines.push(...reqNames)
    }
  }

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return text as any
    },
  },
}

// Wrap as TuiPlugin (async factory)
const plugin: TuiPlugin = async (api, _options, _meta) => {
  api.slots.register(tuiPlugin)
}

export { plugin as tui, readSprintState, renderSprintSidebar }
