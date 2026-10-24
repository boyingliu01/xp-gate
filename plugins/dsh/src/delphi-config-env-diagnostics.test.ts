import { describe, it, expect } from "vitest"
import { DelphiSetupError, expandEnv, expandEnvDetailed, resolveConfig } from "./delphi-config.js"

/**
 * @test REQ-DSH-016
 * @intent #576：「变量未设置」和「变量已设置为空串」以及「变量已设置但当前进程没有
 *         继承到」在旧实现里被渲染成同一句 `is not set in the environment`。
 *         第一句是事实错误，第二句丢掉了最常见的真实原因（宿主进程环境陈旧），
 *         把排查引向 key 本身、配置写法、网关权限——唯独不会想到重启宿主。
 *
 *         这组用例要求 expandEnv 不丢失这一区分，并要求报错文案把已知事实全部
 *         说出来：变量名、占位符形状、以及 env 中是否存在大小写不同的同名变量
 *         （Windows 环境变量大小写不敏感，POSIX 敏感——这是真实的平台差异）。
 *
 *         旁路探测（读取注册表 / shell 启动文件）只能作为可选诊断：探测本身
 *         出错必须静默降级为现有文案，绝不能让诊断成为新的失败点。
 * @covers AC-DSH-016-04
 */

const baseConfig = {
  active_profile: "whalecloud",
  profiles: {
    whalecloud: {
      provider: "whalecloud",
      providers: {
        whalecloud: {
          base_url: "https://lab.example.com/gpt-proxy",
          api_key: "${WHALECLOUD_API_KEY}",
        },
      },
      experts: [
        { id: "Expert A", role: "architecture", model: "g-glm-5.3-flash", max_tokens: 32000 },
        { id: "Expert B", role: "technical", model: "g-qwen3.8-flash" },
        { id: "Expert C", role: "feasibility", model: "g-deepseek-flash" },
      ],
      consensus: { threshold_percent: 90, max_review_rounds: 5 },
    },
  },
}

const configWith = (apiKey: string) => ({
  ...baseConfig,
  profiles: {
    whalecloud: {
      ...baseConfig.profiles.whalecloud,
      providers: {
        whalecloud: {
          base_url: "https://lab.example.com/gpt-proxy",
          api_key: apiKey,
        },
      },
    },
  },
})

/** Capture the error message a resolve call produces, or "" if it did not throw. */
function messageFrom(apiKey: string, env: Record<string, string>): string {
  try {
    resolveConfig(configWith(apiKey), env)
    return ""
  } catch (error) {
    return error instanceof DelphiSetupError ? error.message : `NOT-A-SETUP-ERROR: ${String(error)}`
  }
}

describe("expandEnvDetailed keeps the three outcomes apart (#576)", () => {
  it("anti-vacuity: the detailed form exists and expands a present variable", () => {
    // If this fails, every case below would pass against a stub.
    const result = expandEnvDetailed("Bearer ${TOK}!", { TOK: "secret" })
    expect(result.value).toBe("Bearer secret!")
    expect(result.missing).toEqual([])
    expect(result.empty).toEqual([])
  })

  it("reports a variable that the environment does not define as missing", () => {
    const result = expandEnvDetailed("${NOPE}", {})
    expect(result.value).toBe("")
    expect(result.missing).toEqual(["NOPE"])
    expect(result.empty).toEqual([])
  })

  it("reports a variable that is defined but empty as empty, not missing", () => {
    // "" is a CONFIGURATION error (someone set it wrong). Absent is an
    // ENVIRONMENT error (nobody set it). Conflating them sends the reader to the
    // wrong file (#576).
    const result = expandEnvDetailed("${TOK}", { TOK: "" })
    expect(result.value).toBe("")
    expect(result.missing).toEqual([])
    expect(result.empty).toEqual(["TOK"])
  })

  it("handles both placeholder spellings in one value", () => {
    const result = expandEnvDetailed("{env:A}-${B}-${C}", { A: "x", B: "" })
    expect(result.value).toBe("x--")
    expect(result.missing).toEqual(["C"])
    expect(result.empty).toEqual(["B"])
  })

  it("does not repeat a variable referenced twice", () => {
    const result = expandEnvDetailed("${DUP}${DUP}", {})
    expect(result.missing).toEqual(["DUP"])
  })

  it("expandEnv still returns just the string for existing callers", () => {
    expect(expandEnv("${NOPE}", {})).toBe("")
    expect(expandEnv("${TOK}", { TOK: "v" })).toBe("v")
  })
})

describe("the missing-key message names the actual situation (#576)", () => {
  it("says the variable is not set when it is absent", () => {
    const message = messageFrom("${WHALECLOUD_API_KEY}", {})
    expect(message).toContain("WHALECLOUD_API_KEY")
    expect(message).toMatch(/not set/i)
    // The remedy has to be reachable from the message alone.
    expect(message).toMatch(/set|export|environment/i)
  })

  it("does NOT claim the variable is unset when it is set to an empty string", () => {
    const message = messageFrom("${WHALECLOUD_API_KEY}", { WHALECLOUD_API_KEY: "" })
    expect(message).toContain("WHALECLOUD_API_KEY")
    // The false statement this issue is about.
    expect(message).not.toMatch(/is not set in the environment/i)
    expect(message).toMatch(/empty/i)
  })

  it("names the placeholder spelling used in the config", () => {
    // Which spelling appears in the config is the first thing a reader needs:
    // `${VAR}` and `{env:VAR}` expand through different code paths, and a typo
    // in the spelling looks exactly like an unset variable.
    expect(messageFrom("${WHALECLOUD_API_KEY}", {})).toMatch(/\$\{WHALECLOUD_API_KEY\}/)
    expect(messageFrom("{env:WHALECLOUD_API_KEY}", {})).toContain("{env:WHALECLOUD_API_KEY}")
  })

  it("points at a same-name variable whose case differs", () => {
    // Windows env vars are case-insensitive but a POSIX shell's are not, so a
    // value can be present under a different case and silently not match. The
    // message must surface the near-miss instead of reporting "not set".
    const message = messageFrom("${WHALECLOUD_API_KEY}", { whalecloud_api_key: "k" })
    expect(message).toContain("whalecloud_api_key")
    expect(message).toMatch(/case/i)
  })

  it("says nothing about case when there is no near-miss", () => {
    const message = messageFrom("${WHALECLOUD_API_KEY}", { OTHER: "x" })
    expect(message).not.toMatch(/case/i)
  })

  it("never echoes a literal api_key that is present", () => {
    // A literal key in the config is valid and resolves; it must not appear in
    // any diagnostic produced for OTHER providers.
    const secret = "sk-live-DO-NOT-LEAK-42"
    const config = {
      ...baseConfig,
      profiles: {
        whalecloud: {
          ...baseConfig.profiles.whalecloud,
          providers: {
            // Declared first so a later failure has already seen this value.
            literal: { base_url: "https://literal.example.com", api_key: secret },
            whalecloud: { base_url: "https://lab.example.com/gpt-proxy", api_key: "${WHALECLOUD_API_KEY}" },
          },
        },
      },
    }
    let message = ""
    try {
      resolveConfig(config, {})
    } catch (error) {
      message = String(error)
    }
    expect(message).toContain("WHALECLOUD_API_KEY")
    expect(message).not.toContain(secret)
  })

  it("names the literal-value case when api_key is an empty literal", () => {
    // `api_key: ""` references no variable, so no variable should be blamed.
    const message = messageFrom("", {})
    expect(message).toMatch(/no api_key/i)
    expect(message).not.toMatch(/WHALECLOUD_API_KEY/)
  })

  it("a provider with no api_key at all keeps its direct message", () => {
    const message = messageFrom("", {})
    expect(message).toMatch(/no api_key/i)
  })

  it("the diagnostic never turns into a failure of its own", () => {
    // A hostile/odd environment must degrade to a plain message, not throw
    // something that is not a DelphiSetupError.
    const weird = new Proxy(
      {},
      {
        get() {
          throw new Error("environment read exploded")
        },
        ownKeys() {
          throw new Error("environment enumeration exploded")
        },
      },
    ) as unknown as NodeJS.ProcessEnv
    let thrown: unknown
    try {
      resolveConfig(baseConfig, weird)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(DelphiSetupError)
  })
})
