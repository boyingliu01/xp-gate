/**
 * @test REQ-OPENCODE-RUNCMD
 * @intent 插件被装进别人的环境，那里 CLI 可能**不在 PATH 上**、可能坏了、可能正在
 *         升级。AGENTS.md 的原则是 gracefully degrade，而且方向有讲究：
 *         **向"做得更少"降级，绝不向"声称成功"降级**。
 *
 *         这两条命令是所有 gate 工具的共同出口，所以它们的错误映射就是那个原则的
 *         落地点：
 *
 *         - 命令失败时必须返回 **stderr 或错误信息**，绝不返回空字符串——空串会
 *           被当成"没有发现问题"。
 *         - 命令成功但无输出时返回一句明确的"已完成（无输出）"，而不是空串。
 *         - 全局 CLI 不存在时 `runXpGate` 返回 ""（空），让调用方走源码回退；
 *           这个约定和上面"失败不返回空"是**不同**的，测试要分开钉住。
 *
 * @covers AC-OPENCODE-RUNCMD-01
 * @covers AC-OPENCODE-RUNCMD-02
 * @covers AC-OPENCODE-RUNCMD-03
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const execState: { calls: string[]; next: () => unknown } = {
  calls: [],
  next: () => ({ stdout: "" }),
}

vi.mock("node:child_process", () => ({
  exec: (cmd: string, _opts: unknown, cb: (e: unknown, r?: { stdout?: string }) => void) => {
    execState.calls.push(cmd)
    const outcome = execState.next()
    if (outcome instanceof Error) cb(outcome, undefined)
    else cb(null, outcome as { stdout?: string })
  },
  execFileSync: () => "",
  spawn: () => ({ on: () => {} }),
}))

vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>()
  return {
    ...actual,
    promisify: (fn: unknown) => (cmd: string, opts: unknown) =>
      new Promise((resolve, reject) => {
        ;(fn as (c: string, o: unknown, cb: (e: unknown, r?: unknown) => void) => void)(cmd, opts, (e, r) =>
          e ? reject(e) : resolve(r),
        )
      }),
  }
})

let t: any

beforeEach(async () => {
  execState.calls = []
  execState.next = () => ({ stdout: "" })
  const m = await import("../index.ts")
  t = m.__test
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("runCmd", () => {
  it("returns stdout when the command succeeds with output", async () => {
    execState.next = () => ({ stdout: "PASS 12 checks" })
    expect(await t.runCmd("xp-gate check .", "/w")).toBe("PASS 12 checks")
  })

  it("says explicitly that it completed when there is no output", async () => {
    // An empty string here would be read by the caller as "no findings".
    execState.next = () => ({ stdout: "" })
    const out = await t.runCmd("xp-gate check .", "/w")
    expect(out).toContain("completed")
    expect(out).not.toBe("")
  })

  it("returns stderr on failure, never an empty string", async () => {
    // The degrade-toward-less rule: a broken command must not look clean.
    const err = Object.assign(new Error("exit 1"), { stderr: "✗ Gate 4 failed" })
    execState.next = () => err
    expect(await t.runCmd("xp-gate check .", "/w")).toBe("✗ Gate 4 failed")
  })

  it("falls back to the error message when there is no stderr", async () => {
    execState.next = () => new Error("ENOENT xp-gate")
    expect(await t.runCmd("xp-gate check .", "/w")).toContain("ENOENT xp-gate")
  })

  it("still returns a non-empty string when the error has neither", async () => {
    execState.next = () => new Error("")
    const out = await t.runCmd("xp-gate check .", "/w")
    expect(out).not.toBe("")
    expect(out).toContain("failed")
  })
})

describe("runXpGate", () => {
  it("returns empty string when the global CLI is not on PATH", async () => {
    // This empty string is the FALLBACK SIGNAL, not a failure report: the caller
    // then runs the bundled source. It is deliberately different from runCmd's
    // contract, which never returns empty on failure.
    execState.next = () => new Error("not found")
    expect(await t.runXpGate("check .", "/w")).toBe("")
  })

  it("delegates to runCmd once the CLI is present", async () => {
    let call = 0
    execState.next = () => {
      call += 1
      return call === 1 ? { stdout: "/usr/bin/xp-gate" } : { stdout: "ok" }
    }
    expect(await t.runXpGate("check .", "/w")).toBe("ok")
    expect(execState.calls[0]).toContain("command -v xp-gate")
    expect(execState.calls[1]).toContain("xp-gate check .")
  })
})

describe("getUpgradeSuggestion", () => {
  it("stays silent when the CLI is unavailable", async () => {
    execState.next = () => new Error("not found")
    expect(await t.getUpgradeSuggestion("/w")).toBe("")
  })

  it("stays silent when the preview is not valid JSON", async () => {
    // A malformed preview must not surface as a broken suggestion in a tool result.
    let call = 0
    execState.next = () => {
      call += 1
      return call === 1 ? { stdout: "/usr/bin/xp-gate" } : { stdout: "not json" }
    }
    expect(await t.getUpgradeSuggestion("/w")).toBe("")
  })

  it("announces a newer release with the command to install it", async () => {
    let call = 0
    execState.next = () => {
      call += 1
      return call === 1
        ? { stdout: "/usr/bin/xp-gate" }
        : { stdout: JSON.stringify({ outdated: true, remote: "9.9.9" }) }
    }
    const msg = await t.getUpgradeSuggestion("/w")
    expect(msg).toContain("9.9.9")
    expect(msg).toContain("xp-gate upgrade")
  })
})
