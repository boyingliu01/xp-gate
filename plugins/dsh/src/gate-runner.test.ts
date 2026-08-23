/**
 * @test REQ-007 (超时与协作式取消分离)
 * @intent 验证 runXpGate 的取消/超时/退出码/sandbox denial 语义，以及 renderGateResult 的输出拼接
 * @covers AC-007
 */
import { describe, it, expect } from "vitest"
import type { ShellExecRequest, ShellRunResult } from "@deepseek-ai/dsh-shell"
import { renderGateResult, runXpGate, type XpGateShell } from "./gate-runner.js"

function result(over: Partial<ShellRunResult> = {}): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: "ok", truncated: false },
    stderr: { text: "", truncated: false },
    ...over,
  }
}

function makeShell(finalResult: ShellRunResult): { shell: XpGateShell; requests: ShellExecRequest[] } {
  const requests: ShellExecRequest[] = []
  const shell: XpGateShell = {
    resolve(req) {
      requests.push(req)
      return {
        command: req.command,
        workdir: req.workdir ?? "/workspace",
        timeoutMs: req.timeoutMs ?? 1000,
        stdoutMaxBytes: 1_000_000,
        signal: req.signal,
        sandboxPolicy: undefined,
      }
    },
    run() {
      return Promise.resolve(finalResult)
    },
  }
  return { shell, requests }
}

describe("renderGateResult", () => {
  it("renders stdout text", () => {
    expect(renderGateResult(result())).toBe("ok")
  })

  it("appends [exit code: N] on non-zero exit", () => {
    const r = renderGateResult(result({ exitCode: 2, stdout: { text: "boom", truncated: false } }))
    expect(r).toContain("boom")
    expect(r).toContain("[exit code: 2]")
  })

  it("marks a timeout without throwing", () => {
    const r = renderGateResult(result({ timedOut: true, exitCode: null, stdout: { text: "", truncated: false } }))
    expect(r).toContain("[timed out after 1000ms]")
  })

  it("marks a sandbox denial", () => {
    const r = renderGateResult(result({ sandbox: { mode: "workspace-write", denied: true } }))
    expect(r).toContain("denied")
  })

  it("includes stderr and truncation markers", () => {
    const r = renderGateResult(
      result({
        stderr: { text: "err", truncated: false },
        stdout: { text: "tail", truncated: true, spillPath: "/tmp/full" },
      }),
    )
    expect(r).toContain("err")
    expect(r).toContain("truncated")
  })
})

describe("runXpGate", () => {
  it("passes command/workdir/timeoutMs/signal to the shell", async () => {
    const signal = new AbortController().signal
    const { shell, requests } = makeShell(result())
    await runXpGate(shell, signal, "xp-gate check 'src'", "/workspace", 5000)
    expect(requests[0]?.command).toBe("xp-gate check 'src'")
    expect(requests[0]?.workdir).toBe("/workspace")
    expect(requests[0]?.timeoutMs).toBe(5000)
    expect(requests[0]?.signal).toBe(signal)
  })

  it("throws an AbortError with code ABORTED when the call was cancelled", async () => {
    const { shell } = makeShell(result({ aborted: true, exitCode: null }))
    await expect(runXpGate(shell, new AbortController().signal, "cmd", "/w", 1000)).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORTED",
    })
  })
})