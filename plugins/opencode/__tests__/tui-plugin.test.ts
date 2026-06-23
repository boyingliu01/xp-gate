/**
 * TUI Slot Plugin tests
 *
 * Tests for pure functions:
 * - readSprintState: file I/O + JSON parse
 * - isStale: staleness detection
 * - statusSymbol: status → icon mapping
 * - renderPhaseLine: single phase → formatted line
 * - renderSprintSidebar: full state → sidebar string
 */

import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// Import the functions under test
// Since the file uses type-only imports from @opencode-ai/plugin/tui,
// test runner provides a separate copy of the pure functions
import { readSprintState, renderSprintSidebar } from "../tui-plugin.ts"

// Inline single-sprint rendering logic for multi-sprint comparison
// (The module-level renderMultiSprintSidebar is not directly importable
//  since it uses module-level state. We test the composition here.)
function buildMultiSprintBlock(state: Record<string, unknown>, index: number): string {
  const lines: string[] = []
  const id = (state as any).id || `sprint-${index}`
  const desc = (state as any).task_description || id
  lines.push(`SPRINT: ${desc}`)
  if ((state as any).isolation?.branch) {
    lines.push(`  ${(state as any).isolation.branch}`)
  }
  const historyByPhase: Record<string, { status?: string; phase_name?: string }> = {}
  if (Array.isArray((state as any).phase_history)) {
    for (const ph of (state as any).phase_history) {
      historyByPhase[String(ph.phase)] = ph
    }
  }
  for (const key of ['-1', '-0.5', '0', '1', '2', '3', '4', '5', '6', '7', '8']) {
    const history = historyByPhase[key]
    if (!history && String((state as any).phase) !== key) continue
    const name = history?.phase_name || ({
      '-1': 'ISOLATE', '-0.5': 'AUTO-ESTIMATE', '0': 'THINK', '1': 'PLAN', '2': 'BUILD',
      '3': 'REVIEW', '4': 'USER ACCEPT', '5': 'FEEDBACK', '6': 'SHIP', '7': 'LAND', '8': 'CLEANUP',
    })[key] || key
    const sym = history?.status === 'completed' ? '✓' :
      history?.status === 'in_progress' ? '→' :
        (String((state as any).phase) === key ? '·' : '○')
    lines.push(`${sym} ${name.padEnd(14)} ${history?.status === 'completed' ? 'done' : history?.status === 'in_progress' ? 'active' : ''}`.replace(/\s+$/, ''))
  }
  return lines.join('\n')
}

function buildMultiSprintOutput(sprints: Record<string, unknown>[]): string | null {
  if (sprints.length === 0) return null
  const blocks = sprints.slice(0, 3).map((s, i) => buildMultiSprintBlock(s, i))
  if (sprints.length > 3) blocks.push(`… +${sprints.length - 3} more`)
  return blocks.join('\n---\n')
}

// Duplicate helpers here to test in isolation
function isStale(state: { started_at?: string; phase_history?: Array<{ started_at?: string; completed_at?: string }> }): boolean {
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

function renderPhaseLine(key: string, history: { status?: string; phase_name?: string } | undefined, currentPhase: string | number | undefined): string {
  const name = history?.phase_name || PHASE_NAMES[key] || key
  const status = history?.status || (String(currentPhase) === key ? "in_progress" : "pending")
  const sym = statusSymbol(status, key, currentPhase)
  return `${sym} ${name.padEnd(14)} ${status === "completed" ? "done" : status === "in_progress" ? "active" : ""}`
    .replace(/\s+$/, "")
}

// ── Test fixtures ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSprintState(overrides: Record<string, unknown> = {}): any {
  const base = {
    id: "sprint-001",
    phase: "2",
    status: "in_progress",
    started_at: new Date(Date.now() - 3_600_000).toISOString(),
    task_description: "Implement user login with OAuth2",
    metrics: { tests_passed: 42, coverage_pct: 87 },
    phase_history: [
      { phase: "-1", phase_name: "ISOLATE", status: "completed" as const, started_at: new Date(Date.now() - 86_400_000).toISOString(), completed_at: new Date(Date.now() - 86_000_000).toISOString() },
      { phase: "0", status: "completed" as const, started_at: new Date(Date.now() - 86_000_000).toISOString(), completed_at: new Date(Date.now() - 72_000_000).toISOString() },
      { phase: "1", status: "completed" as const, started_at: new Date(Date.now() - 72_000_000).toISOString(), completed_at: new Date(Date.now() - 36_000_000).toISOString() },
      { phase: "2", status: "in_progress" as const, reqs: { "REQ-001": { name: "JWT auth", status: "completed" as const }, "REQ-002": { name: "OAuth2 flow", status: "in_progress" as const } } },
    ],
  }
  return { ...base, ...overrides }
}

// ── isStale ──

void describe("isStale", () => {
  void it("returns false when state has no started_at", () => {
    assert.equal(isStale({}), false)
  })

  void it("returns false when started_at is recent", () => {
    const state = { started_at: new Date().toISOString() }
    assert.equal(isStale(state), false)
  })

  void it("returns true when started_at is >1h ago and no phase_history", () => {
    const state = { started_at: new Date(Date.now() - 7_200_000).toISOString() }
    assert.equal(isStale(state), true)
  })

  void it("returns false when latest phase_history is recent", () => {
    const state = {
      started_at: new Date(Date.now() - 7_200_000).toISOString(),
      phase_history: [
        { phase: "0", started_at: new Date(Date.now() - 3_600_000).toISOString(), completed_at: new Date(Date.now() - 60_000).toISOString() },
      ],
    }
    assert.equal(isStale(state), false)
  })

  void it("returns true when all activity is >1h ago", () => {
    const state = {
      started_at: new Date(Date.now() - 86_400_000).toISOString(),
      phase_history: [
        { phase: "-1", started_at: new Date(Date.now() - 86_000_000).toISOString(), completed_at: new Date(Date.now() - 85_000_000).toISOString() },
      ],
    }
    assert.equal(isStale(state), true)
  })

  void it("returns false when started_at is invalid date", () => {
    const state = { started_at: "not-a-date" }
    assert.equal(isStale(state), false)
  })
})

// ── statusSymbol ──

void describe("statusSymbol", () => {
  void it("returns ✓ for completed", () => {
    assert.equal(statusSymbol("completed", "0", undefined), "✓")
  })

  void it("returns → for in_progress", () => {
    assert.equal(statusSymbol("in_progress", "1", undefined), "→")
  })

  void it("returns · when key matches currentPhase", () => {
    assert.equal(statusSymbol(undefined, "2", "2"), "·")
  })

  void it("returns ○ for pending (no match)", () => {
    assert.equal(statusSymbol("pending", "3", "2"), "○")
  })

  void it("returns ✓ for completed even when key matches", () => {
    // completed takes priority over currentPhase match
    assert.equal(statusSymbol("completed", "2", "2"), "✓")
  })
})

// ── renderPhaseLine ──

void describe("renderPhaseLine", () => {
  void it("renders completed phase", () => {
    const line = renderPhaseLine("0", { status: "completed" }, "2")
    assert.ok(line.includes("✓"))
    assert.ok(line.includes("THINK"))
    assert.ok(line.includes("done"))
  })

  void it("renders in_progress phase", () => {
    const line = renderPhaseLine("2", { status: "in_progress" }, "2")
    assert.ok(line.includes("→"))
    assert.ok(line.includes("BUILD"))
    assert.ok(line.includes("active"))
  })

  void it("renders pending phase (current phase match)", () => {
    const line = renderPhaseLine("3", undefined, "2")
    assert.ok(line.includes("○"))
    assert.ok(line.includes("REVIEW"))
  })

  void it("renders current phase with arrow when no history entry (current assigned in_progress)", () => {
    const line = renderPhaseLine("2", undefined, "2")
    assert.ok(line.includes("→"))
    assert.ok(line.includes("BUILD"))
    assert.ok(line.includes("active"))
  })

  void it("uses custom phase_name from history", () => {
    const line = renderPhaseLine("2", { status: "completed", phase_name: "MY BUILD" }, "2")
    assert.ok(line.includes("MY BUILD"))
  })
})

// ── readSprintState ──

void describe("readSprintState", () => {
  const tmpDir = join(tmpdir(), "xp-gate-tui-test-" + randomUUID())

  before(() => {
    mkdirSync(join(tmpDir, ".sprint-state"), { recursive: true })
  })

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  void it("returns null when no sprint-state.json", () => {
    assert.equal(readSprintState(tmpDir), null)
  })

  void it("returns parsed state when file exists", () => {
    const state = { id: "test", phase: "1", task_description: "Test" }
    writeFileSync(join(tmpDir, ".sprint-state", "sprint-state.json"), JSON.stringify(state))
    const result = readSprintState(tmpDir)
    assert.notEqual(result, null)
    assert.equal(result?.id, "test")
    assert.equal(result?.phase, "1")
  })

  void it("returns null on malformed JSON", () => {
    writeFileSync(join(tmpDir, ".sprint-state", "sprint-state.json"), "{not-json")
    assert.equal(readSprintState(tmpDir), null)
  })

  void it("returns null when directory does not exist", () => {
    assert.equal(readSprintState("/nonexistent/path"), null)
  })
})

// ── renderSprintSidebar ──

void describe("renderSprintSidebar", () => {
  void it("returns empty string for null state", () => {
    assert.equal(renderSprintSidebar(null as unknown as Parameters<typeof renderSprintSidebar>[0]), "")
  })

  void it("returns empty string when no task_description", () => {
    assert.equal(renderSprintSidebar({} as Parameters<typeof renderSprintSidebar>[0]), "")
  })

  void it("includes sprint title on first line", () => {
    const output = renderSprintSidebar(makeSprintState() as unknown as Parameters<typeof renderSprintSidebar>[0])
    const lines = output.split("\n")
    assert.ok(lines[0].includes("SPRINT:"))
    assert.ok(lines[0].includes("OAuth2"))
  })

  void it("includes metrics when available", () => {
    const output = renderSprintSidebar(makeSprintState() as unknown as Parameters<typeof renderSprintSidebar>[0])
    assert.ok(output.includes("tests:42"))
    assert.ok(output.includes("cov:87%"))
  })

  void it("omits metrics section when none present", () => {
    const output = renderSprintSidebar(makeSprintState({ metrics: {} }) as any)
    assert.ok(!output.includes("tests:"))
    assert.ok(!output.includes("cov:"))
  })

  void it("shows stale warning when >1h idle", () => {
    const state = makeSprintState({ started_at: new Date(Date.now() - 7_200_000).toISOString(), phase_history: [] })
    const output = renderSprintSidebar(state)
    assert.ok(output.includes("idle"))
  })

  void it("does not show stale warning when recent activity", () => {
    const state = makeSprintState({
      started_at: new Date(Date.now() - 7_200_000).toISOString(),
      phase_history: [
        { phase: "0", started_at: new Date().toISOString(), completed_at: new Date().toISOString() },
      ],
    })
    const output = renderSprintSidebar(state)
    assert.ok(!output.includes("idle"))
  })

  void it("shows phases with activity or current", () => {
    const output = renderSprintSidebar(makeSprintState() as unknown as Parameters<typeof renderSprintSidebar>[0])
    // Should show ISOLATE (completed in history), THINK, PLAN, BUILD (current)
    assert.ok(output.includes("ISOLATE"))
    assert.ok(output.includes("THINK"))
    assert.ok(output.includes("PLAN"))
    assert.ok(output.includes("BUILD"))
    // Should NOT show REVIEW, FEEDBACK, etc. (no history, not current)
    assert.ok(!output.includes("REVIEW"))
    assert.ok(!output.includes("FEEDBACK"))
  })

  void it("shows REQ-level progress for BUILD phase", () => {
    const output = renderSprintSidebar(makeSprintState() as unknown as Parameters<typeof renderSprintSidebar>[0])
    assert.ok(output.includes("JWT"))
    assert.ok(output.includes("OAuth2"))
  })

  void it("renders correct status symbols per phase", () => {
    const output = renderSprintSidebar(makeSprintState() as unknown as Parameters<typeof renderSprintSidebar>[0])
    const lines = output.split("\n")
    const isolateLine = lines.find((l: string) => l.includes("ISOLATE"))
    assert.ok(isolateLine && isolateLine.startsWith("✓"), `Expected ISOLATE line to start with ✓, got: ${isolateLine}`)
  })
})

// ── Multi-Sprint Rendering ──

void describe("multi-sprint rendering", () => {
  void it("returns null for empty sprints array", () => {
    assert.equal(buildMultiSprintOutput([]), null)
  })

  void it("renders single sprint without separator", () => {
    const output = buildMultiSprintOutput([makeSprintState()])
    assert.ok(output !== null)
    assert.ok(!output!.includes("---"), "Single sprint should not have separator")
    assert.ok(output!.includes("SPRINT:"))
  })

  void it("renders two sprints separated by ---", () => {
    const sprint2 = makeSprintState({
      id: "sprint-002",
      task_description: "Second sprint",
      started_at: new Date(Date.now() - 7_200_000).toISOString(),
      phase: "1",
    })
    const output = buildMultiSprintOutput([makeSprintState(), sprint2])
    assert.ok(output !== null)
    assert.ok(output!.includes("---"), "Two sprints should be separated by ---")
    assert.ok(output!.includes("OAuth2"))
    assert.ok(output!.includes("Second sprint"))
  })

  void it("shows only first 3 sprints with overflow message for 4+", () => {
    const sprints = [1, 2, 3, 4, 5].map(i =>
      makeSprintState({
        id: `sprint-00${i}`,
        task_description: `Sprint ${i}`,
      })
    )
    const output = buildMultiSprintOutput(sprints)
    assert.ok(output !== null)
    assert.ok(output!.includes("+2 more"), "Should show overflow for 5 sprints")
    assert.ok(!output!.includes("Sprint 4"), "4th sprint should be collapsed")
    assert.ok(!output!.includes("Sprint 5"), "5th sprint should be collapsed")
  })

  void it("renders 3 sprints without overflow", () => {
    const sprints = [1, 2, 3].map(i =>
      makeSprintState({
        id: `sprint-00${i}`,
        task_description: `Sprint ${i}`,
      })
    )
    const output = buildMultiSprintOutput(sprints)
    assert.ok(output !== null)
    assert.ok(!output!.includes("more"), "3 sprints should not show overflow")
  })

  void it("uses sprint ID as fallback when task_description missing", () => {
    const sprint = makeSprintState({ task_description: undefined, id: "sprint-2026-06-23-01" })
    const output = buildMultiSprintBlock(sprint, 0)
    assert.ok(output.includes("sprint-2026-06-23-01"), "Should use sprint ID as fallback")
  })

  void it("shows branch info when isolation.branch present", () => {
    const sprint = makeSprintState({
      isolation: { branch: "sprint/my-feature" },
    })
    const output = buildMultiSprintBlock(sprint, 0)
    assert.ok(output.includes("sprint/my-feature"))
  })

  void it("does not crash on sprint with no started_at or phase_history", () => {
    const sprint = {
      id: "sprint-minimal",
      task_description: "Minimal sprint",
    }
    const output = buildMultiSprintBlock(sprint, 0)
    assert.ok(output.includes("Minimal sprint"))
  })
})
