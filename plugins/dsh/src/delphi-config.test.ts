import { describe, it, expect } from "vitest"
import { DelphiSetupError, expandEnv, resolveConfig } from "./delphi-config.js"

/**
 * @test REQ-DSH-016
 * @intent 验证 .delphi-config.json 的解析：active_profile 选择、${VAR} 与 {env:VAR}
 *         两种占位符展开、缺密钥/缺 provider 时给出可操作的错误，
 *         以及未展开的模型占位符在校验期被拦住（而非变成 provider 404）。
 * @covers AC-DSH-016-02
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

describe("expandEnv", () => {
  it("expands both ${VAR} and {env:VAR} spellings", () => {
    const env = { TOK: "secret" }
    expect(expandEnv("${TOK}", env)).toBe("secret")
    expect(expandEnv("{env:TOK}", env)).toBe("secret")
    expect(expandEnv("Bearer ${TOK}!", env)).toBe("Bearer secret!")
  })

  it("expands an unset variable to empty so the caller can detect it", () => {
    expect(expandEnv("${NOPE}", {})).toBe("")
  })
})

describe("resolveConfig", () => {
  it("resolves the active profile into seats and transport settings", () => {
    const cfg = resolveConfig(baseConfig, { WHALECLOUD_API_KEY: "k123" })
    expect(cfg.provider).toBe("whalecloud")
    expect(cfg.baseUrl).toBe("https://lab.example.com/gpt-proxy")
    expect(cfg.apiKey).toBe("k123")
    expect(cfg.seats).toHaveLength(3)
    expect(cfg.seats.map((s) => s.model)).toEqual([
      "g-glm-5.3-flash",
      "g-qwen3.8-flash",
      "g-deepseek-flash",
    ])
    // Per-seat budget is preserved: reasoning models need a larger one.
    expect(cfg.seats[0].maxTokens).toBe(32000)
    expect(cfg.thresholdPercent).toBe(90)
    expect(cfg.maxRounds).toBe(5)
  })

  it("names the missing environment variable instead of echoing the config", () => {
    // The config may hold a literal key, so the error must not interpolate it.
    let message = ""
    try {
      resolveConfig(baseConfig, {})
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/WHALECLOUD_API_KEY/)
    expect(message).toMatch(/not set/)
  })

  it("reports an unknown provider with the known alternatives", () => {
    const bad = structuredClone(baseConfig)
    bad.profiles.whalecloud.provider = "nope"
    expect(() => resolveConfig(bad, { WHALECLOUD_API_KEY: "k" })).toThrow(/not defined under "providers"/)
  })

  it("rejects an unexpanded model placeholder at config time", () => {
    const bad = structuredClone(baseConfig)
    bad.profiles.whalecloud.experts[1].model = "${QWEN_MODEL}"
    expect(() => resolveConfig(bad, { WHALECLOUD_API_KEY: "k" })).toThrow(/unexpanded/)
  })

  it("refuses to guess when several profiles exist and none is active", () => {
    const multi = {
      profiles: {
        a: { provider: "p", providers: { p: { base_url: "u", api_key: "k" } }, experts: [] },
        b: { provider: "p", providers: { p: { base_url: "u", api_key: "k" } }, experts: [] },
      },
    }
    expect(() => resolveConfig(multi, {})).toThrow(/No active_profile/)
  })

  it("enforces the three-distinct-model invariant through the config path too", () => {
    const dup = structuredClone(baseConfig)
    dup.profiles.whalecloud.experts[2].model = "g-qwen3.8-flash"
    expect(() => resolveConfig(dup, { WHALECLOUD_API_KEY: "k" })).toThrow(/distinct/)
  })

  it("raises DelphiSetupError so callers can present guidance, not a stack trace", () => {
    expect(() => resolveConfig(baseConfig, {})).toThrow(DelphiSetupError)
  })
})

/**
 * The shape xp-gate actually writes differs from the tidy array form: `experts`
 * is an OBJECT keyed by role, each expert names its own provider, and
 * `consensus` sits at the document root. This was found by running the loader
 * against the repo's real .delphi-config.json and is locked in here.
 */
describe("resolveConfig with the real on-disk schema", () => {
  const realWorld = {
    active_profile: "whalecloud",
    profiles: {
      whalecloud: {
        providers: {
          whalecloud: {
            base_url: "https://lab.iwhalecloud.com/gpt-proxy",
            api_key: "${WHALECLOUD_API_KEY}",
          },
        },
        experts: {
          architecture: { provider: "whalecloud", model: "g-glm-5.3-flash" },
          technical: { provider: "whalecloud", model: "g-qwen3.8-flash" },
          feasibility: { provider: "whalecloud", model: "g-deepseek-flash" },
        },
      },
    },
    consensus: { threshold_percent: 90, max_review_rounds: 5, distinct_models_required: true },
  }

  it("reads experts from the object form and uses the key as the role", () => {
    const cfg = resolveConfig(realWorld, { WHALECLOUD_API_KEY: "k" })
    expect(cfg.seats).toHaveLength(3)
    expect(cfg.seats.map((s) => s.role)).toEqual(["architecture", "technical", "feasibility"])
    expect(cfg.seats.map((s) => s.model)).toEqual([
      "g-glm-5.3-flash",
      "g-qwen3.8-flash",
      "g-deepseek-flash",
    ])
  })

  it("resolves the provider named per expert when the profile has no default", () => {
    // No profile-level "provider" key at all -- each seat carries its own.
    const cfg = resolveConfig(realWorld, { WHALECLOUD_API_KEY: "k" })
    expect(cfg.provider).toBe("whalecloud")
    expect(cfg.baseUrl).toBe("https://lab.iwhalecloud.com/gpt-proxy")
    expect(cfg.apiKey).toBe("k")
  })

  it("reads consensus from the document root", () => {
    const cfg = resolveConfig(realWorld, { WHALECLOUD_API_KEY: "k" })
    expect(cfg.thresholdPercent).toBe(90)
    expect(cfg.maxRounds).toBe(5)
  })

  it("still enforces three distinct models in the object form", () => {
    const dup = structuredClone(realWorld)
    dup.profiles.whalecloud.experts.feasibility.model = "g-qwen3.8-flash"
    expect(() => resolveConfig(dup, { WHALECLOUD_API_KEY: "k" })).toThrow(/distinct/)
  })

  it("rejects experts spread across different gateways", () => {
    // One shared base_url is required so a seat's key is never sent elsewhere.
    const split = structuredClone(realWorld) as {
      active_profile: string
      profiles: Record<
        string,
        {
          providers: Record<string, { base_url: string; api_key: string }>
          experts: Record<string, { provider: string; model: string }>
        }
      >
      consensus: { threshold_percent: number; max_review_rounds: number }
    }
    split.profiles.whalecloud.providers.other = {
      base_url: "https://elsewhere.example/v1",
      api_key: "k2",
    }
    split.profiles.whalecloud.experts.technical = {
      provider: "other",
      model: "g-qwen3.8-flash",
    }
    expect(() => resolveConfig(split, { WHALECLOUD_API_KEY: "k" })).toThrow(/share one gateway/)
  })
})
