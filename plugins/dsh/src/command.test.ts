/**
 * @test REQ-009 (命令注入防护)
 * @intent 验证 buildCommand/shq 纯函数：POSIX 单引号转义防注入、gates 白名单、优雅降级 fallback、target 路径解析
 * @covers AC-003, AC-005, AC-009
 */
import { describe, it, expect } from "vitest"
import {
  FALLBACK_MESSAGE,
  GATE_WHITELIST,
  buildCommand,
  isGateAllowed,
  resolveTarget,
  shq,
} from "./command.js"

describe("shq (POSIX single-quote escaping)", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shq("abc")).toBe("'abc'")
  })

  it("escapes embedded single quotes with the '\"' quote-close idiom", () => {
    expect(shq("a'b")).toBe("'a'\\''b'")
  })

  it("neutralizes shell metacharacters by quoting them literally", () => {
    const payload = "$(touch /tmp/pwned); `id`"
    expect(shq(payload)).toBe("'$(touch /tmp/pwned); `id`'")
  })
})

describe("isGateAllowed (enum whitelist)", () => {
  it("accepts whitelisted gate ids", () => {
    expect(isGateAllowed("principles")).toBe(true)
    expect(isGateAllowed("arch")).toBe(true)
    expect(isGateAllowed("duplicates")).toBe(true)
  })

  it("rejects unknown or injected gate ids", () => {
    expect(isGateAllowed("$(rm -rf)")).toBe(false)
    expect(isGateAllowed("0")).toBe(false)
    expect(isGateAllowed("")).toBe(false)
  })
})

describe("buildCommand", () => {
  it("builds a guarded gate-check command with target + gates", () => {
    const cmd = buildCommand({ subcommand: "check", target: "src", gates: ["principles", "arch"] })
    expect(cmd).toContain("command -v xp-gate")
    expect(cmd).toContain("xp-gate check 'src' --gates 'principles,arch'")
    expect(cmd).toContain(shq(FALLBACK_MESSAGE))
  })

  it("escapes a hostile target path", () => {
    const cmd = buildCommand({ subcommand: "check", target: "a'b$(id)" })
    expect(cmd).toContain("xp-gate check 'a'\\''b$(id)'")
  })

  it("builds gate-principles", () => {
    expect(buildCommand({ subcommand: "principles", target: "src/x.ts" })).toContain(
      "xp-gate principles 'src/x.ts'",
    )
  })

  it("builds gate-arch with the default config", () => {
    expect(buildCommand({ subcommand: "arch" })).toContain("xp-gate arch --config 'architecture.yaml'")
  })

  it("emits the graceful-degradation fallback when xp-gate is absent", () => {
    const cmd = buildCommand({ subcommand: "check", target: "src" })
    expect(cmd).toContain("else printf")
    expect(cmd).toContain(FALLBACK_MESSAGE)
  })
})

describe("resolveTarget", () => {
  it("keeps absolute paths unchanged", () => {
    expect(resolveTarget("/tmp/x", "/workspace")).toBe("/tmp/x")
  })

  it("resolves relative paths against the session cwd", () => {
    expect(resolveTarget("src", "/workspace")).toBe("/workspace/src")
  })
})

describe("GATE_WHITELIST", () => {
  it("contains only known xp-gate gate aliases", () => {
    expect(GATE_WHITELIST).toContain("principles")
    expect(GATE_WHITELIST).toContain("arch")
    expect(GATE_WHITELIST).toContain("secrets")
  })
})