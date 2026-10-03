import { describe, it, expect } from "vitest"
import { resolve } from "node:path"
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

  it("escapes embedded single quotes with the quote-close idiom", () => {
    expect(shq("a'b")).toBe("'a'\\''b'")
  })

  /**
   * @test REQ-DSH-009
   * @intent 验证 shq() 对命令替换/反引号等 shell 元字符做 POSIX 单引号转义，防止命令注入
   * @covers AC-DSH-009-01
   */
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

  it("drops non-whitelisted gates before building the command", () => {
    const cmd = buildCommand({ subcommand: "check", target: "src", gates: ["principles", "bogus$(id)"] })
    expect(cmd).toContain("xp-gate check 'src' --gates 'principles'")
    expect(cmd).not.toContain("bogus")
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

  /**
   * @test REQ-DSH-005
   * @intent 验证 xp-gate CLI 缺失时 buildCommand 走 else 分支输出优雅降级安装提示，而非抛错或返回门禁失败
   * @covers AC-DSH-005-01
   */
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
    // path.resolve is platform-native, so assert against the same call rather
    // than a POSIX literal (which fails on Windows by construction).
    expect(resolveTarget("src", "/workspace")).toBe(resolve("/workspace", "src"))
  })

  it("resolves a Windows-relative path against a Windows cwd", () => {
    expect(resolveTarget("src", "C:\\workspace")).toBe(resolve("C:\\workspace", "src"))
  })
})

describe("GATE_WHITELIST", () => {
  it("contains only known xp-gate gate aliases", () => {
    expect(GATE_WHITELIST).toContain("principles")
    expect(GATE_WHITELIST).toContain("arch")
    expect(GATE_WHITELIST).toContain("secrets")
  })
})

/**
 * @test REQ-DSH-010
 * @intent 验证 PowerShell 方言下生成的命令使用 Get-Command/Write-Output 而非 POSIX 的
 *         command -v/printf，避免 DSH 在 win32（pwsh executor）下因语法错误导致三个工具全部不可用
 * @covers AC-DSH-010-01
 */
describe("PowerShell dialect (regression: DSH win32 uses the pwsh executor)", () => {
  it("uses Get-Command instead of command -v", () => {
    const cmd = buildCommand({ subcommand: "principles", target: "src/x.ts", dialect: "powershell" })
    expect(cmd).toContain("Get-Command xp-gate -ErrorAction SilentlyContinue")
    expect(cmd).not.toContain("command -v")
  })

  it("uses Write-Output instead of printf for the fallback hint", () => {
    const cmd = buildCommand({ subcommand: "check", target: "src", dialect: "powershell" })
    expect(cmd).toContain("Write-Output")
    expect(cmd).not.toContain("printf")
    expect(cmd).toContain(FALLBACK_MESSAGE)
  })

  it("never emits POSIX shell syntax that PowerShell cannot parse", () => {
    const cmd = buildCommand({ subcommand: "check", target: "src", gates: ["principles"], dialect: "powershell" })
    // `/dev/null` and `; then … ; fi` are the constructs that produced
    // "if语句中的'if'后缺少\"(\"" under the pwsh executor.
    expect(cmd).not.toContain("/dev/null")
    expect(cmd).not.toContain("then ")
    expect(cmd).not.toContain("; fi")
    expect(cmd).not.toContain("2>&1")
  })

  it("preserves the xp-gate invocation and gate subset", () => {
    const cmd = buildCommand({
      subcommand: "check",
      target: "src",
      gates: ["principles", "arch"],
      dialect: "powershell",
    })
    expect(cmd).toContain("xp-gate check 'src' --gates 'principles,arch'")
  })

  it("still drops non-whitelisted gates", () => {
    const cmd = buildCommand({
      subcommand: "check",
      target: "src",
      gates: ["principles", "bogus$(id)"],
      dialect: "powershell",
    })
    expect(cmd).toContain("--gates 'principles'")
    expect(cmd).not.toContain("bogus")
  })

  it("defaults to the POSIX dialect when none is given (backwards compatible)", () => {
    const cmd = buildCommand({ subcommand: "arch" })
    expect(cmd).toContain("command -v xp-gate")
  })
})
