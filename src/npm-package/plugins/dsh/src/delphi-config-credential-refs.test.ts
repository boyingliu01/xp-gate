/**
 * @test REQ-DSH-014 credential reference discovery
 * @intent Verify the plugin can learn WHICH environment-variable names the Delphi
 *         config references, without resolving them, so it knows what to ask DSH's
 *         credential service for.
 * @covers AC-DSH-014-06
 *
 * Why: loadDelphiConfig is synchronous and the credential service is asynchronous, so
 * the tool must resolve first and load second. That needs a cheap way to read the
 * referenced names out of the config before any value exists — otherwise the loader
 * throws before the caller ever learns what to resolve.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { listCredentialReferences } from "./delphi-config.js"

let dir: string
const GLOBAL = join(tmpdir(), "xp-gate-no-such-global.json")

/** A single-gateway config body; only the api_key expression varies per test. */
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xp-gate-creds-refs-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("listCredentialReferences", () => {
  it("names the variable a ${VAR} api_key points at", () => {
    writeConfig("${WHALECLOUD_API_KEY}")
    expect(listCredentialReferences(dir, GLOBAL)).toEqual(["WHALECLOUD_API_KEY"])
  })

  it("returns nothing for a literal api_key", () => {
    writeConfig("literal-key-value")
    expect(listCredentialReferences(dir, GLOBAL)).toEqual([])
  })

  it("returns the variable name even when it is unset — never throws", () => {
    // This is the whole point: the caller needs the name in order to resolve it.
    writeConfig("${SOME_UNSET_KEY}")
    expect(listCredentialReferences(dir, GLOBAL)).toEqual(["SOME_UNSET_KEY"])
  })

  it("returns an empty list when no config exists at all", () => {
    expect(listCredentialReferences(dir, GLOBAL)).toEqual([])
  })
})
