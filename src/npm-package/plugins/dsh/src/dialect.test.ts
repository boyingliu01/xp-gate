import { describe, it, expect } from "vitest"
import { detectDialect, shellQuote, shq } from "./dialect.js"

/**
 * @test REQ-DSH-010
 * @intent 验证 shell 方言探测与转义：win32 必须选 powershell（DSH 在 win32 启用 pwsh
 *         executor），其余平台选 posix，且两套转义都不能让引号/元字符逃逸出字符串
 * @covers AC-DSH-010-01
 */
describe("detectDialect", () => {
  it("selects powershell on win32 and posix elsewhere", () => {
    expect(detectDialect("win32")).toBe("powershell")
    expect(detectDialect("linux")).toBe("posix")
    expect(detectDialect("darwin")).toBe("posix")
  })

  it("matches the platform DSH actually enables an executor for", () => {
    // dsh-base enables pwsh-sandbox/tool-pwsh only on win32, and
    // bash-sandbox/tool-bash everywhere else.
    expect(detectDialect()).toBe(process.platform === "win32" ? "powershell" : "posix")
  })
})

describe("shellQuote", () => {
  it("uses the POSIX quote-close idiom", () => {
    expect(shellQuote("a'b", "posix")).toBe("'a'\\''b'")
    expect(shellQuote("abc", "posix")).toBe("'abc'")
  })

  it("doubles embedded quotes for PowerShell", () => {
    expect(shellQuote("a'b", "powershell")).toBe("'a''b'")
    expect(shellQuote("abc", "powershell")).toBe("'abc'")
  })

  it("neutralizes POSIX shell metacharacters literally", () => {
    const payload = "$(touch /tmp/pwned); `id`"
    expect(shellQuote(payload, "posix")).toBe("'$(touch /tmp/pwned); `id`'")
  })

  /**
   * @test REQ-DSH-011
   * @intent 验证 PowerShell 单引号内 $() 与反引号均为字面量，且内嵌引号被双写，
   *         使命令注入无法闭合字符串逃逸
   * @covers AC-DSH-011-01
   */
  it("neutralizes PowerShell metacharacters and prevents quote escape", () => {
    const payload = "$(touch /tmp/pwned); `id`"
    expect(shellQuote(payload, "powershell")).toBe("'$(touch /tmp/pwned); `id`'")
    // A payload that tries to close the string must have its quote doubled so it
    // stays inside a single literal argument.
    expect(shellQuote("a'; Remove-Item x; '", "powershell")).toBe("'a''; Remove-Item x; '''")
  })
})

describe("shq (deprecated POSIX wrapper)", () => {
  it("delegates to shellQuote with the posix dialect", () => {
    expect(shq("a'b")).toBe(shellQuote("a'b", "posix"))
  })
})
