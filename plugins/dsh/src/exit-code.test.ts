/**
 * @test REQ-669 Gate 判定不得因命令串自身缺陷而失真
 * @intent 这两个缺陷都不是"慢"或"报错"，而是**给出错误的结论**——尤其是假绿：
 *
 *         1. 方言按 `process.platform` 猜。它假设 "win32 ⇒ PowerShell"，这个前提在
 *            #442 时代成立；但 Windows 现在可以挂 Git Bash executor
 *            （`@very12345/dsh-bash-windows`）。于是生成 PowerShell 命令串丢进 bash，
 *            `Write-Output` 不存在 → 退出码 127 → 通过的 gate 报 GATE FAILED。
 *
 *         2. 退出码靠尾部文本标记传递，但**标记本身吃掉了退出码**。两个分支都用
 *            `printf`/`Write-Output` 收尾且都不 `exit`，复合命令的退出码等于最后一条
 *            命令的退出码 → 恒为 0。而 `classifyGateRun()` 只读 `result.exitCode`，
 *            从不看 stdout 里的 `exit:N`。于是**失败的 gate 被判 PASS**。
 *
 *         缺陷二更危险：缺陷一至少会让人怀疑，缺陷二会让人相信。
 *
 *         所以这里不靠字符串匹配断言——那证明不了退出码真的传出去了。真正的证明是
 *         起一个真实 shell 跑一遍，断言进程退出码等于内层命令的真实退出码。
 * @covers AC-669-01, AC-669-02, AC-669-03, AC-669-04
 */
import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import { buildCommand, detectDialectForShell } from "./command.js"
import { classifyGateRun } from "./gate-runner.js"

/** 用一个必然退出的内层命令替换真实 xp-gate，只考察后缀对退出码的传递。 */
function runInRealShell(command: string, shell: "bash" | "bash"): number {
  try {
    execFileSync(shell, ["-c", command], { stdio: "pipe", timeout: 20_000 })
    return 0
  } catch (error) {
    const code = (error as { status?: number | null }).status
    // `status` is null when the process was killed by a signal; surface that as
    // a distinct value so a hang can never be mistaken for a clean exit.
    return typeof code === "number" ? code : -1
  }
}

describe("#669 命令串的退出码必须真实传递", () => {
  it("AC-669-01: POSIX 后缀把内层退出码原样带出来（不是恒为 0）", () => {
    // 用 `sh -c 'exit 7'` 冒充失败的 gate。修复前：文本标记说 7，但进程退出码是 0，
    // 于是 classifyGateRun 看到 exitCode===0 + 有输出 → PASS。假绿。
    const suffix = buildCommand({ subcommand: "principles", dialect: "posix" })
      .replace(/^xp-gate principles/, "sh -c 'exit 7'")
    expect(runInRealShell(suffix, "bash")).toBe(7)
  })

  it("AC-669-02: POSIX 后缀在成功时仍返回 0（不能为了传失败码而让成功变红）", () => {
    const suffix = buildCommand({ subcommand: "principles", dialect: "posix" })
      .replace(/^xp-gate principles/, "sh -c 'exit 0'")
    expect(runInRealShell(suffix, "bash")).toBe(0)
  })

  it("AC-669-03: 方言由 executor 决定，而不是 process.platform", () => {
    // Git Bash executor 在 win32 上暴露 bashPath；按平台猜会得到 powershell。
    expect(detectDialectForShell({ bashPath: "C:\\Program Files\\Git\\bin\\bash.exe" }, "win32")).toBe("posix")
    // 显式声明优先于一切推断。
    expect(detectDialectForShell({ shellDialect: "bash" }, "win32")).toBe("posix")
    expect(detectDialectForShell({ dialect: "pwsh" }, "linux")).toBe("powershell")
    // 认不出来时回落到原平台默认 —— 等效旧行为，不会比现在更差。
    expect(detectDialectForShell({}, "win32")).toBe("powershell")
    expect(detectDialectForShell(null, "linux")).toBe("posix")
    // PowerShell executor 带 bashPath 的假想组合：显式声明优先。
    expect(detectDialectForShell({ shellDialect: "powershell", bashPath: "x" }, "win32")).toBe("powershell")
  })

  it("AC-669-04: classifyGateRun 对退出码与文本标记不一致的 run 报 INDETERMINATE", () => {
    // 即使后缀修好，退出码仍要穿过 shell → harness → 分类器这条脆弱链路。
    // 两者不一致时不能静默采信其中之一。
    const base = {
      timedOut: false,
      // ShellRunResult requires both liveness fields. These fixtures represent a
      // run that ended by itself, so "no signal" and "not aborted" are the honest
      // values — omitting them only typechecked because this file never ran.
      signal: null,
      aborted: false,
      timeoutMs: 1000,
      stdout: { text: "some output\n[XP-Gate] exit:7\n", truncated: false },
      stderr: { text: "", truncated: false },
    }
    // exitCode 说成功、标记说失败 → 冲突，不可判定。
    expect(classifyGateRun({ ...base, exitCode: 0 })).toBe("INDETERMINATE")
    // 两者都说失败 → 正常判 GATE FAILED。
    expect(classifyGateRun({ ...base, exitCode: 7 })).toBe("GATE FAILED")
    // 两者都说成功 → PASS。
    const ok = { ...base, stdout: { text: "ok\n[XP-Gate] exit:0\n", truncated: false } }
    expect(classifyGateRun({ ...ok, exitCode: 0 })).toBe("PASS")
  })
})
