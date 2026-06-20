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

function makeSprintState(overrides: Record<string, unknown> = {}) {
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
  return { ...base, ...overrides } as Record<string, unknown>
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
    const output = renderSprintSidebar(makeSprintState())
    const lines = output.split("\n")
    assert.ok(lines[0].includes("SPRINT:"))
    assert.ok(lines[0].includes("OAuth2"))
  })

  void it("includes metrics when available", () => {
    const output = renderSprintSidebar(makeSprintState())
    assert.ok(output.includes("tests:42"))
    assert.ok(output.includes("cov:87%"))
  })

  void it("omits metrics section when none present", () => {
    const output = renderSprintSidebar(makeSprintState({ metrics: {} }))
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
    const output = renderSprintSidebar(makeSprintState())
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
    const output = renderSprintSidebar(makeSprintState())
    assert.ok(output.includes("JWT"))
    assert.ok(output.includes("OAuth2"))
  })

  void it("renders correct status symbols per phase", () => {
    const output = renderSprintSidebar(makeSprintState())
    // ISOLATE completed → ✓
    const lines = output.split("\n")
    const isolateLine = lines.find((l: string) => l.includes("ISOLATE"))
    assert.ok(isolateLine && isolateLine.startsWith("✓"), `Expected ISOLATE line to start with ✓, got: ${isolateLine}`)
  })
})
