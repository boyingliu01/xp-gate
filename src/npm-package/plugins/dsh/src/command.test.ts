import { describe, it, expect } from "vitest"
import { resolve } from "node:path"
import {
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
  it("builds an unconditional gate-check command with target + gates", () => {
    const cmd = buildCommand({ subcommand: "check", target: "src", gates: ["principles", "arch"] })
    // No presence probe: the command runs regardless and reports its own status.
    expect(cmd).toContain("xp-gate check 'src' --gates 'principles,arch'")
    expect(cmd).toContain("[XP-Gate] exit:")
    expect(cmd).not.toContain("command -v")
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

  // #447: the default path uses archlint's built-in rules — no --config.
  // Forcing the old default (`--config architecture.yaml`) hit the pre-0.16
  // schema that archlint itself rejects, so the flag is gone from the default.
  it("builds gate-arch without a config by default", () => {
    const cmd = buildCommand({ subcommand: "arch" })
    expect(cmd).toContain("xp-gate arch")
    expect(cmd).not.toContain("--config")
    expect(cmd).not.toContain("--use-config")
  })

  it("forwards an explicit config via the opt-in --use-config flag", () => {
    expect(buildCommand({ subcommand: "arch", config: "custom.yaml" })).toContain(
      "xp-gate arch --use-config 'custom.yaml'",
    )
  })

  /**
   * @test REQ-DSH-005
   * @intent 验证 xp-gate CLI 缺失时不再走 else 分支伪装成功：命令无条件执行并回显退出码，
   *         由渲染层把 command-not-found 判为 INDETERMINATE 并附安装提示。
   *         优雅降级保留（不抛错、不崩），但不再静默返回 exit 0。
   * @covers AC-DSH-005-01
   */
  it("degrades through the exit code instead of a fake success branch", () => {
    const cmd = buildCommand({ subcommand: "check", target: "src" })
    // No else branch: absence becomes a real nonzero exit the renderer can see.
    expect(cmd).not.toContain("else printf")
    expect(cmd).toContain("[XP-Gate] exit:")
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
 * @intent 验证 PowerShell 方言下生成的命令使用 Write-Output/$LASTEXITCODE 而非 POSIX 的
 *         printf/$?，避免 DSH 在 win32（pwsh executor）下因语法错误导致三个工具全部不可用
 * @covers AC-DSH-010-01
 */
describe("PowerShell dialect (regression: DSH win32 uses the pwsh executor)", () => {
  it("reports the exit code with $LASTEXITCODE instead of POSIX $?", () => {
    const cmd = buildCommand({ subcommand: "principles", target: "src/x.ts", dialect: "powershell" })
    expect(cmd).toContain("$LASTEXITCODE")
    expect(cmd).not.toContain("command -v")
    expect(cmd).not.toContain("Get-Command")
  })

  it("uses Write-Output instead of printf for the exit report", () => {
    const cmd = buildCommand({ subcommand: "check", target: "src", dialect: "powershell" })
    expect(cmd).toContain("Write-Output")
    expect(cmd).not.toContain("printf")
  })

  it("never emits POSIX shell syntax that PowerShell cannot parse", () => {
    const cmd = buildCommand({ subcommand: "check", target: "src", gates: ["principles"], dialect: "powershell" })
    // `/dev/null` and `; then … ; fi` are the constructs that produced
    // "if语句中的'if'后缺少\"(\"" under the pwsh executor. `2>&1` IS valid in
    // PowerShell and is used deliberately to merge stderr into the report.
    expect(cmd).not.toContain("/dev/null")
    expect(cmd).not.toContain("then ")
    expect(cmd).not.toContain("; fi")
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
    expect(cmd).toContain("printf")
    expect(cmd).not.toContain("Write-Output")
  })
})
