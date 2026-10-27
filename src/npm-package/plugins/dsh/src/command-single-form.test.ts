/**
 * @test REQ-DSH-011 single-form command construction
 * @intent Verify buildCommand emits one unconditional xp-gate invocation per dialect,
 *         appends an explicit exit-code echo, and no longer branches on whether the
 *         CLI resolves — so "installed but broken" can never look like a pass.
 * @covers AC-DSH-011-07 AC-DSH-011-08
 *
 * Why: the old form probed with `command -v` / `Get-Command` and printed a hint on
 * the else branch while leaving the exit code at 0. A CLI that resolved but then
 * failed produced empty stdout with exit 0, which the model read as green.
 */

import { describe, it, expect } from "vitest"
import { buildCommand, GATE_WHITELIST, isGateAllowed } from "./command.js"

describe("buildCommand single form", () => {
  it("never branches on CLI presence in POSIX form", () => {
    const command = buildCommand({ subcommand: "check", target: "src", dialect: "posix" })
    expect(command).not.toContain("command -v")
    expect(command).not.toContain("if ")
    expect(command.trimStart().startsWith("xp-gate")).toBe(true)
  })

  it("never branches on CLI presence in PowerShell form", () => {
    const command = buildCommand({ subcommand: "check", target: "src", dialect: "powershell" })
    expect(command).not.toContain("Get-Command")
    expect(command.trimStart().startsWith("xp-gate")).toBe(true)
  })

  it("echoes the exit status so a missing CLI becomes a nonzero exit", () => {
    const posix = buildCommand({ subcommand: "principles", dialect: "posix" })
    expect(posix).toContain("exit:")
    expect(posix).toContain("2>&1")

    const powershell = buildCommand({ subcommand: "principles", dialect: "powershell" })
    expect(powershell).toContain("LASTEXITCODE")
  })

  it("keeps quoting model-controlled arguments in both dialects", () => {
    const posix = buildCommand({ subcommand: "check", target: "a b; rm -rf /", dialect: "posix" })
    expect(posix).toContain("'a b; rm -rf /'")

    const powershell = buildCommand({
      subcommand: "check",
      target: "a b; rm -rf /",
      dialect: "powershell",
    })
    expect(powershell).toContain("'a b; rm -rf /'")
  })

  it("filters gates through the allowlist before they reach the shell", () => {
    const command = buildCommand({
      subcommand: "check",
      target: "src",
      gates: ["principles", "not-a-gate", "arch"],
      dialect: "posix",
    })
    expect(command).toContain("principles,arch")
    expect(command).not.toContain("not-a-gate")
  })

  it("knows which gate ids are allowed", () => {
    expect(isGateAllowed("principles")).toBe(true)
    expect(isGateAllowed("nope")).toBe(false)
    expect(GATE_WHITELIST.length).toBeGreaterThan(0)
  })
})
