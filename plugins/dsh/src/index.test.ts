/**
 * @test REQ-001, REQ-003, REQ-004 (gate-check / gate-principles / gate-arch 工具注册)
 * @intent 验证 apply() 通过 ctx.tools.register 注册全部 3 个工具（参数/输出 schema 正确），并端到端接线 args→命令→shell
 * @covers AC-002, AC-005, REQ-001, REQ-003, REQ-004
 */
import { describe, it, expect } from "vitest"
import type { Context } from "@deepseek-ai/cordis"
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from "@deepseek-ai/dsh-shell"
import { apply } from "./index.js"

interface CapturedTool {
  name: string
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

function makeCtx(stdoutText: string) {
  const captured: unknown[] = []
  const requests: ShellExecRequest[] = []
  const shell = {
    resolve(req: ShellExecRequest): ShellExecSpec {
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
    run(): Promise<ShellRunResult> {
      return Promise.resolve({
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false,
        timeoutMs: 1000,
        stdout: { text: stdoutText, truncated: false },
        stderr: { text: "", truncated: false },
      })
    },
  }
  const ctx = { tools: { register: (def: unknown) => captured.push(def) }, shell } as unknown as Context
  return { ctx, captured, requests }
}

describe("apply", () => {
  it("registers all three tools", () => {
    const { ctx, captured } = makeCtx("ok")
    apply(ctx)
    const names = captured.map((c) => (c as CapturedTool).name)
    expect(names).toContain("gate-check")
    expect(names).toContain("gate-principles")
    expect(names).toContain("gate-arch")
  })

  it("gate-check execute builds the guarded command and returns rendered stdout", async () => {
    const { ctx, captured, requests } = makeCtx("gate report")
    apply(ctx)
    const gateCheck = captured.find((c) => (c as CapturedTool).name === "gate-check") as CapturedTool
    const out = await gateCheck.execute(
      { path: "/repo/src", gates: ["principles"] },
      { signal: new AbortController().signal },
    )
    expect(out).toBe("gate report")
    expect(requests[0]?.command).toContain("xp-gate check '/repo/src' --gates 'principles'")
  })

  it("gate-principles execute builds `xp-gate principles <path>`", async () => {
    const { ctx, captured, requests } = makeCtx("principles report")
    apply(ctx)
    const tool = captured.find((c) => (c as CapturedTool).name === "gate-principles") as CapturedTool
    const out = await tool.execute({ path: "/repo/src/app.ts" }, { signal: new AbortController().signal })
    expect(out).toBe("principles report")
    expect(requests[0]?.command).toContain("xp-gate principles '/repo/src/app.ts'")
  })

  it("gate-arch execute defaults config to architecture.yaml", async () => {
    const { ctx, captured, requests } = makeCtx("arch report")
    apply(ctx)
    const tool = captured.find((c) => (c as CapturedTool).name === "gate-arch") as CapturedTool
    const out = await tool.execute({}, { signal: new AbortController().signal })
    expect(out).toBe("arch report")
    expect(requests[0]?.command).toContain("xp-gate arch --config 'architecture.yaml'")
  })

  it("gate-arch execute honors a custom config", async () => {
    const { ctx, captured, requests } = makeCtx("arch report")
    apply(ctx)
    const tool = captured.find((c) => (c as CapturedTool).name === "gate-arch") as CapturedTool
    await tool.execute({ config: "custom.yaml" }, { signal: new AbortController().signal })
    expect(requests[0]?.command).toContain("xp-gate arch --config 'custom.yaml'")
  })
})