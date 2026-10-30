import { describe, it, expect } from "vitest"
import type { Context } from "@deepseek-ai/cordis"
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from "@deepseek-ai/dsh-shell"
import type { SkillProvider, SkillProviderControl, SkillProviderObservation } from "@deepseek-ai/dsh-skill"
import { apply, findPlaceholderName, inject, renderText } from "./index.js"

type ProviderFactory = (control: SkillProviderControl) => SkillProvider

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
    // Resolved specs require the expiry policy; the request may omit it.
    onExpiry: "kill",
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
    // 0.2.0-rc.2 seam: execute() returns a handle whose result() settles.
    execute(): Promise<{ result(): Promise<ShellRunResult> }> {
      return Promise.resolve({ result: () => Promise.resolve(makeRunResult(stdoutText)) })
    },
  }
}

/** The repository ships this many skills; the count is part of the delivery promise. */
const EXPECTED_SKILL_COUNT = 12;

function makeCtx(stdoutText: string) {
  const captured: unknown[] = []
  const requests: ShellExecRequest[] = []
  const providers: ProviderFactory[] = []
  const hooks: string[] = []
  const ctx = {
    tools: { register: (def: unknown) => captured.push(def) },
    skills: { registerProvider: (create: ProviderFactory) => providers.push(create) },
    shell: makeShell(stdoutText, requests),
    // The plugin registers pre/post-execute hooks; recording the names is enough to
    // prove registration without standing up the real waterfall.
    on: (name: string) => hooks.push(name),
  } as unknown as Context
  return { ctx, captured, requests, providers, hooks }
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
   * @test REQ-DSH-006
   * @intent 验证 apply(ctx) 通过 ctx.skills.registerProvider 注册了 bundled skill provider，
   *         且该 provider 能列出 12 个 skill —— 这是 skill 对模型可见的唯一通路
   * @covers AC-DSH-006-02
   */
  it("registers the bundled skill provider that publishes all 12 skills", async () => {
    const { ctx, providers } = makeCtx("ok")
    apply(ctx)
    expect(providers).toHaveLength(1)

    const create = providers[0]
    expect(create).toBeDefined()
    if (!create) return
    // Recording invalidations rather than no-oping: listing must not invalidate, and
    // an empty stub would hide it if it started to. DSH's `invalidate` takes no
    // arguments, so the count is the whole signal.
    const invalidations: string[] = []
    const provider = create({
      signal: new AbortController().signal,
      invalidate: () => void invalidations.push("invalidated"),
    })
    expect(provider.name).toBe("xp-gate")

    const listed = await provider.list({})
    // DSH permits either a bare array or an observation object; this provider
    // answers with the array form.
    const candidates = Array.isArray(listed)
      ? listed
      : ((listed as SkillProviderObservation).candidates ?? [])
    expect(candidates).toHaveLength(EXPECTED_SKILL_COUNT)
    expect(invalidations).toHaveLength(0)
  })

  /**
   * @test REQ-DSH-006
   * @intent 验证 inject 声明了 "skills"，否则 ctx.skills 在该插件 apply 时可能尚未就绪
   * @covers AC-DSH-006-02
   */
  it("declares the skills capability in inject", () => {
    expect(inject).toContain("skills")
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
    expect(out).toBe("[XP-Gate] PASS\ngate report")
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
    expect(out).toBe("[XP-Gate] PASS\nprinciples report")
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

  /**
   * @test REQ-562
   * @intent 5 个工具曾各自内联一份完全相同的 render 闭包，在覆盖率报告里表现为 5 个
   *         未覆盖函数，而实际只有一行行为（#562）。提取为共享常量后只需测一次，
   *         也让"共享的输出约定"这件事在代码里显形，而不是 5 个巧合。
   * @covers AC-562-04
   */
  it("renderText wraps a tool result as a single text part", () => {
    expect(renderText(undefined, "hello")).toEqual([{ type: "text", text: "hello" }])
  })

  it("renderText keeps empty output as an empty text part, not a dropped one", () => {
    // A tool that legitimately produced nothing must still render one part; returning
    // [] would look to the host like the tool never answered.
    expect(renderText({ path: "x" }, "")).toEqual([{ type: "text", text: "" }])
  })

  /**
   * @test REQ-562
   * @intent `findPlaceholderName` 处在**安全路径**上：`resolveExpressionKey` 把"没找到占位符"
   *         解释为"用户直接写了一个明文 token"，并据此拒绝。所以这里正则错一下不是美观问题——
   *         对明文 key 误判为占位符会**直接放行**，对合法引用漏判会拒绝正确配置。
   * @covers AC-562-05
   */
  describe("findPlaceholderName", () => {
    it("AC-562-05: recognizes the ${VAR} spelling", () => {
      expect(findPlaceholderName("${WHALECLOUD_API_KEY}")).toBe("WHALECLOUD_API_KEY")
    })

    it("AC-562-05: recognizes the {env:VAR} spelling", () => {
      expect(findPlaceholderName("{env:OPENAI_API_KEY}")).toBe("OPENAI_API_KEY")
    })

    it("AC-562-05: ${VAR} wins when a value carries both spellings", () => {
      // Order matters: the shell form is checked first, so a value mixing both
      // resolves deterministically rather than depending on regex engine order.
      expect(findPlaceholderName("{env:A}${B}")).toBe("B")
    })

    it("AC-562-05: a literal token yields undefined -- this is what triggers the reject", () => {
      // The security-relevant case: a real key must NOT look like a placeholder.
      expect(findPlaceholderName("sk-live-abcdef123456")).toBeUndefined()
      expect(findPlaceholderName("")).toBeUndefined()
    })

    it("AC-562-05: near-misses that must not count as placeholders", () => {
      // A lowercase-first name, a digit-first name, and an empty ${} are all invalid
      // identifiers; treating any of them as a reference would bypass the guard.
      expect(findPlaceholderName("${1BAD}")).toBeUndefined()
      expect(findPlaceholderName("${}")).toBeUndefined()
      expect(findPlaceholderName("$VAR")).toBeUndefined()
      expect(findPlaceholderName("{env:}")).toBeUndefined()
    })

    it("AC-562-05: a placeholder embedded in surrounding text is still found", () => {
      expect(findPlaceholderName("Bearer ${TOKEN}")).toBe("TOKEN")
    })
  })
})
