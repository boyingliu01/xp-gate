/**
 * @test REQ-DSH-015 sprint-phase writes are gated the way the IDE plugin gates them
 * @intent Verify the pre-execute guard allows non-sprint projects, denies a sprint
 *         that has no APPROVED review, and never throws into the tool path.
 * @covers AC-DSH-015-01 AC-DSH-015-02
 *
 * Mirrors plugins/claude-code/bin/delphi-review-guard.sh, whose degrade rules are
 * already proven: an absent .sprint-state means "not a sprint project", so gating it
 * would punish every ordinary repository that installed the plugin.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { delphiGuardDecision } from "./hooks.js"

let dir: string

/** Build a scratch project, optionally with sprint state and a verdict. */
function project(state: "none" | "no-verdict" | "approved" | "rejected"): string {
  const root = mkdtempSync(join(dir, "proj-"))
  if (state === "none") return root
  try {
    mkdirSync(join(root, ".sprint-state"), { recursive: true })
    if (state !== "no-verdict") {
      const verdict = state === "approved" ? "APPROVED" : "REQUEST_CHANGES"
      writeFileSync(
        join(root, ".sprint-state", "delphi-reviewed.json"),
        JSON.stringify({ verdict, timestamp: "2026-10-27T10:00:00.000Z" }),
        "utf8",
      )
    }
  } catch (error) {
    throw new Error(`cannot build scratch project: ${(error as Error).message}`)
  }
  return root
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xp-gate-hooks-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("delphiGuardDecision", () => {
  it("allows a project with no sprint state at all", () => {
    // The plugin is installed repo-wide; gating a non-sprint repo would break it.
    expect(delphiGuardDecision(project("none"), "edit")).toBeUndefined()
  })

  it("denies a sprint whose review has not been recorded", () => {
    expect(delphiGuardDecision(project("no-verdict"), "write")).toBeDefined()
  })

  it("denies a sprint whose review was rejected", () => {
    const decision = delphiGuardDecision(project("rejected"), "edit")
    expect(decision).toBeDefined()
    // The reason has to name the current verdict, or the model cannot act on it.
    expect(decision?.reason).toContain("REQUEST_CHANGES")
  })

  it("allows a sprint once the review is APPROVED", () => {
    expect(delphiGuardDecision(project("approved"), "edit")).toBeUndefined()
  })

  it("ignores read-only tools", () => {
    // Reading is never what the guard protects against.
    expect(delphiGuardDecision(project("rejected"), "read")).toBeUndefined()
    expect(delphiGuardDecision(project("rejected"), "gate-check")).toBeUndefined()
  })

  it("treats a corrupt verdict file as unreviewed rather than crashing", () => {
    const root = project("none")
    try {
      mkdirSync(join(root, ".sprint-state"), { recursive: true })
      writeFileSync(join(root, ".sprint-state", "delphi-reviewed.json"), "{not json", "utf8")
    } catch (error) {
      throw new Error(`cannot corrupt verdict: ${(error as Error).message}`)
    }
    // A parse failure must not surface as a thrown error inside the tool pipeline.
    expect(() => delphiGuardDecision(root, "edit")).not.toThrow()
    expect(delphiGuardDecision(root, "edit")).toBeDefined()
  })
})

/**
 * @test REQ-DSH-015 sprint-phase writes are gated the way the IDE plugin gates them
 * @intent 验证守卫用「只读工具白名单」判定，而不是「已知写工具黑名单」：
 *         黑名单漏掉了 bash，而 shell 一条命令就能改文件，等于这道 HARD-GATE 可绕过。
 * @covers AC-DSH-015-01
 *
 * The listed names are the tools a DSH session actually exposes; `bash` is the
 * one that made the old blacklist bypassable, and the unlisted future tool is
 * the case a blacklist loses by construction.
 */
describe("delphiGuardDecision tool classification", () => {
  /** Read-only: none of these can modify a file, so none may be gated. */
  const READ_ONLY = ["read", "grep", "glob", "read_image", "list_agents"]

  /** Anything that can reach a shell or a file write, plus an unknown future tool. */
  const CAN_WRITE = ["write", "edit", "bash", "pwsh", "str_replace_editor", "some_future_tool"]

  it("never gates the read-only tools", () => {
    const root = project("rejected")
    for (const tool of READ_ONLY) {
      expect(delphiGuardDecision(root, tool), `${tool} must not be gated`).toBeUndefined()
    }
  })

  it("gates every tool that can modify code, including bash", () => {
    const root = project("rejected")
    for (const tool of CAN_WRITE) {
      expect(delphiGuardDecision(root, tool), `${tool} must be gated`).toBeDefined()
    }
  })

  it("still allows everything once the review is APPROVED", () => {
    const root = project("approved")
    for (const tool of CAN_WRITE) {
      expect(delphiGuardDecision(root, tool), `${tool} must pass`).toBeUndefined()
    }
  })

  it("still allows an ordinary repository that has no sprint state", () => {
    const root = project("none")
    // Unknown tools stay ungated outside a sprint: the guard protects the sprint
    // phase, not every repository that installed the plugin.
    for (const tool of [...CAN_WRITE, "some_future_tool"]) {
      expect(delphiGuardDecision(root, tool), `${tool} must pass`).toBeUndefined()
    }
  })
})
