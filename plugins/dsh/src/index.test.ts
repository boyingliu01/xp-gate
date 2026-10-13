import { describe, it, expect } from "vitest"
import type { Context } from "@deepseek-ai/cordis"
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from "@deepseek-ai/dsh-shell"
import { apply } from "./index.js"

interface CapturedTool {
  name: string
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

// Boy Scout (#447): the inline shell mock pushed makeCtx to 5 brace levels.
// The spec/result builders keep every function at ≤4.
function makeSpec(req: ShellExecRequest): ShellExecSpec {
  return {
    command: req.command,
    workdir: req.workdir ?? "/workspace",
    timeoutMs: req.timeoutMs ?? 1000,
    stdoutMaxBytes: 1_000_000,
    signal: req.signal,
    sandboxPolicy: undefined,
  }
}

function makeRunResult(stdoutText: string): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: stdoutText, truncated: false },
    stderr: { text: "", truncated: false },
  }
}

function makeShell(stdoutText: string, requests: ShellExecRequest[]) {
  return {
    resolve(req: ShellExecRequest): ShellExecSpec {
      requests.push(req)
      return makeSpec(req)
    },
    run(): Promise<ShellRunResult> {
      return Promise.resolve(makeRunResult(stdoutText))
    },
  }
}

function makeCtx(stdoutText: string) {
  const captured: unknown[] = []
  const requests: ShellExecRequest[] = []
  const ctx = {
    tools: { register: (def: unknown) => captured.push(def) },
    shell: makeShell(stdoutText, requests),
  } as unknown as Context
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

  /**
   * @test REQ-DSH-002
   * @intent 验证 gate-check 工具注册（path required / gates optional）并端到端接线 args→命令→shell
   * @covers AC-DSH-002-01
   */
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

  /**
   * @test REQ-DSH-003
   * @intent 验证 gate-principles 工具执行生成 `xp-gate principles <path>` 守卫命令
   * @covers AC-DSH-003-01
   */
  it("gate-principles execute builds `xp-gate principles <path>`", async () => {
    const { ctx, captured, requests } = makeCtx("principles report")
    apply(ctx)
    const tool = captured.find((c) => (c as CapturedTool).name === "gate-principles") as CapturedTool
    const out = await tool.execute({ path: "/repo/src/app.ts" }, { signal: new AbortController().signal })
    expect(out).toBe("principles report")
    expect(requests[0]?.command).toContain("xp-gate principles '/repo/src/app.ts'")
  })

  /**
   * @test REQ-DSH-004
   * @intent 验证 gate-arch 工具执行生成 `xp-gate arch`（默认不带 --config，#447），显式 config 走 --use-config
   * @covers AC-DSH-004-01
   */
  it("gate-arch execute builds `xp-gate arch` with built-in rules by default", async () => {
    const { ctx, captured, requests } = makeCtx("arch report")
    apply(ctx)
    const tool = captured.find((c) => (c as CapturedTool).name === "gate-arch") as CapturedTool
    await tool.execute({}, { signal: new AbortController().signal })
    expect(requests[0]?.command).toContain("xp-gate arch")
    expect(requests[0]?.command).not.toContain("--config")
    await tool.execute({ config: "custom.yaml" }, { signal: new AbortController().signal })
    expect(requests[1]?.command).toContain("xp-gate arch --use-config 'custom.yaml'")
  })
})