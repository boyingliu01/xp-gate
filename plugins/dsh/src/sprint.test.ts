/**
 * @test REQ-DSH-013 sprint-flow subcommands are callable from the model
 * @intent Verify the sprint tool only ever builds a command from an enumerated
 *         subcommand, so exposing sprint state to the model does not widen the
 *         shell surface it already had.
 * @covers AC-DSH-013-01 AC-DSH-013-02 AC-DSH-013-03
 *
 * The sprint-flow skill tells the model to run sprint-status, phase-transition and
 * friends, but none of them were reachable from the plugin: a model following the
 * skill could only report that it could not proceed. Each of these is read-mostly
 * state, so the fix is a narrow tool, not a passthrough -- a passthrough would turn
 * one tool into the whole CLI.
 */

import { describe, expect, it } from "vitest"
import { SPRINT_SUBCOMMANDS, PHASE_STATUSES, buildSprintCommand, isSprintSubcommand } from "./sprint.js"

/** Collect the ids so a failure names what is missing rather than just a count. */
const IDS = SPRINT_SUBCOMMANDS.slice()

describe("sprint subcommand whitelist", () => {
  it("exposes every subcommand the sprint-flow skill references", () => {
    for (const needed of [
      "sprint-status",
      "phase-transition",
      "retro",
      "ui-review",
      "sprint-init",
      "sprint-audit",
    ]) {
      expect(IDS).toContain(needed)
    }
  })

  it("accepts only enumerated subcommands", () => {
    expect(isSprintSubcommand("sprint-status")).toBe(true)
    // Anything not in the list must not reach a shell, however plausible it looks.
    for (const rejected of ["", "uninstall", "sprint-status; rm -rf /", "$(whoami)", "gate-11"]) {
      expect(isSprintSubcommand(rejected)).toBe(false)
    }
  })

  it("builds sprint-status with structured options only", () => {
    const cmd = buildSprintCommand("sprint-status", { json: true, dir: "/repo" }, "powershell")
    expect(cmd).toContain("sprint-status")
    expect(cmd).toContain("--json")
    expect(cmd).toContain("--dir")
  })

  it("rejects a phase-transition whose status is not a documented value", () => {
    // A status is a second injection point, so it is enumerated rather than quoted.
    expect(PHASE_STATUSES).toEqual(["in_progress", "completed", "skipped", "failed", "paused"])
    expect(() =>
      buildSprintCommand("phase-transition", { phase: "3", status: "done; rm -rf /" }, "powershell"),
    ).toThrow()
  })

  it("quotes a path containing shell metacharacters", () => {
    const cmd = buildSprintCommand("sprint-status", { dir: "/tmp/a b; whoami" }, "powershell")
    // The whole value must stay one argument; the semicolon must not start a command.
    expect(cmd).not.toMatch(/; whoami\s*$/)
    expect(cmd).toContain("a b; whoami")
  })
})
