/**
 * @test REQ-DSH-014 apiKey override on the Delphi config loader
 * @intent Verify loadDelphiConfig accepts a pre-resolved apiKey and uses it in place of
 *         resolving ${VAR} from the environment, so the plugin can feed it a value from
 *         DSH's credential store, and verify the override is scoped to the one name it
 *         was resolved for.
 * @covers AC-DSH-014-04 AC-DSH-014-05
 *
 * Why: the loader is synchronous and the credential service is asynchronous, so the
 * value has to be resolved by the caller and handed in. Without this seam the only way
 * to supply a key is an environment variable — precisely what the DSH process lacks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadDelphiConfig, DelphiSetupError } from "./delphi-config.js"

let dir: string

/**
 * A single-gateway config body: every expert must share one base_url, so the
 * provider block is built once and only its api_key varies per test.
 */
function configFor(apiKeyExpression: string): Record<string, unknown> {
  const provider = { base_url: "https://gw.example/v1", api_key: apiKeyExpression }
  const profile = {
    provider: "gw",
    providers: { gw: provider },
    experts: {
      architecture: { provider: "gw", model: "model-a" },
      technical: { provider: "gw", model: "model-b" },
      feasibility: { provider: "gw", model: "model-c" },
    },
  }
  return { active_profile: "test", profiles: { test: profile } }
}

/** Write a fixture config, surfacing any filesystem failure as a test error. */
function writeConfig(apiKeyExpression: string): void {
  try {
    writeFileSync(join(dir, ".delphi-config.json"), JSON.stringify(configFor(apiKeyExpression)), "utf8")
  } catch (error) {
    throw new Error(`cannot write fixture config: ${(error as Error).message}`)
  }
}

const GLOBAL = join(tmpdir(), "xp-gate-no-such-global.json")

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xp-gate-delphi-override-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("loadDelphiConfig apiKey override", () => {
  it("uses the override when the environment cannot supply the key", () => {
    writeConfig("${WHALECLOUD_API_KEY}")
    // The DSH process has no such variable; the override stands in for it.
    const resolved = loadDelphiConfig(dir, {}, GLOBAL, { WHALECLOUD_API_KEY: "resolved-from-store" })
    expect(resolved.apiKey).toBe("resolved-from-store")
  })

  it("still fails loudly, naming the variable, when no override is given", () => {
    writeConfig("${WHALECLOUD_API_KEY}")
    expect(() => loadDelphiConfig(dir, {}, GLOBAL)).toThrow(DelphiSetupError)
    try {
      loadDelphiConfig(dir, {}, GLOBAL)
    } catch (error) {
      expect((error as Error).message).toContain("WHALECLOUD_API_KEY")
    }
  })

  it("prefers an override over an environment value", () => {
    // The caller resolved from the authoritative store; that decision wins.
    writeConfig("${WHALECLOUD_API_KEY}")
    const resolved = loadDelphiConfig(dir, { WHALECLOUD_API_KEY: "from-env" }, GLOBAL, {
      WHALECLOUD_API_KEY: "from-store",
    })
    expect(resolved.apiKey).toBe("from-store")
  })

  it("leaves a literal api_key untouched by the override", () => {
    // A config that hard-codes a key references no variable, so there is nothing
    // for a variable-scoped override to replace.
    writeConfig("literal-key-value")
    const resolved = loadDelphiConfig(dir, {}, GLOBAL, { WHALECLOUD_API_KEY: "resolved-from-store" })
    expect(resolved.apiKey).toBe("literal-key-value")
  })
})

