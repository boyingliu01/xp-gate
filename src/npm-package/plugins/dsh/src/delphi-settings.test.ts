/**
 * @test REQ-DSH-017 Delphi seats are configurable from the DSH settings document
 * @intent Verify the plugin's own `delphi` configuration layer, when present, wins
 *         over `.delphi-config.json` AND is held to the same three-seat invariants —
 *         three distinct models, no unexpanded placeholder — so a settings page
 *         cannot introduce a panel the skill would have rejected.
 * @covers AC-DSH-017-01 AC-DSH-017-02 AC-DSH-017-03
 *
 * Why this exists: the settings page is a new, user-editable surface for the one
 * setting that costs money per run. The invariants were previously enforced only
 * inside `loadDelphiConfig`'s validation of a JSON file; a value arriving through
 * DSH's settings document bypasses that file entirely, so the same checks have to
 * run on this path too. Enforcing them host-side (not only in the page) is the
 * point: the page is a convenience, the host is the authority.
 */

import { describe, expect, it } from "vitest"
import { seatsFromSettings, type DelphiSettingsLayer } from "./delphi-settings.js"
import { DelphiConfigError } from "./delphi.js"
import { DelphiSetupError } from "./delphi-config.js"

/** A settings layer whose seats are present, so tests may index them. */
interface SeatedLayer extends DelphiSettingsLayer {
  seats: NonNullable<DelphiSettingsLayer["seats"]>
}

/** A complete, valid three-seat settings layer. */
function valid(): SeatedLayer {
  return {
    baseUrl: "https://gw.example/v1",
    apiKey: "${WHALECLOUD_API_KEY}",
    seats: [
      { role: "architecture", model: "g-glm-5.3-flash" },
      { role: "technical", model: "g-qwen3.8-flash" },
      { role: "feasibility", model: "g-deepseek-flash" },
    ],
    thresholdPercent: 90,
    maxRounds: 5,
  }
}

describe("seatsFromSettings", () => {
  it("returns undefined when the settings layer is absent, so the JSON file still applies", () => {
    // The migration path: an existing .delphi-config.json user keeps working
    // untouched until they open the page and save something.
    expect(seatsFromSettings(undefined)).toBeUndefined()
  })

  it("carries three distinct seats and the gateway through", () => {
    const resolved = seatsFromSettings(valid())
    expect(resolved?.seats.map((s) => s.model)).toEqual([
      "g-glm-5.3-flash",
      "g-qwen3.8-flash",
      "g-deepseek-flash",
    ])
    expect(resolved?.baseUrl).toBe("https://gw.example/v1")
    expect(resolved?.thresholdPercent).toBe(90)
    expect(resolved?.maxRounds).toBe(5)
  })

  it("keeps a configured api key expression for the caller to resolve", () => {
    // Resolution belongs to the caller: only it can reach the credential store.
    expect(seatsFromSettings(valid())?.apiKeyExpression).toBe("${WHALECLOUD_API_KEY}")
  })

  it("rejects a panel whose models are not all distinct", () => {
    const layer = valid()
    layer.seats[2].model = layer.seats[0].model
    expect(() => seatsFromSettings(layer)).toThrow(DelphiConfigError)
  })

  it("rejects a panel that does not have exactly three seats", () => {
    const layer = valid()
    layer.seats = layer.seats.slice(0, 2)
    expect(() => seatsFromSettings(layer)).toThrow(DelphiConfigError)
  })

  it("rejects a blank model rather than treating it as an unpinned seat", () => {
    const layer = valid()
    layer.seats[1].model = "   "
    expect(() => seatsFromSettings(layer)).toThrow(DelphiConfigError)
  })

  it("rejects an unexpanded placeholder in a model id", () => {
    const layer = valid()
    layer.seats[0].model = "${MODEL_VAR}"
    expect(() => seatsFromSettings(layer)).toThrow(DelphiConfigError)
  })

  it("refuses a layer with no gateway instead of silently using a default", () => {
    const layer = valid()
    layer.baseUrl = ""
    expect(() => seatsFromSettings(layer)).toThrow(DelphiSetupError)
  })

  it("applies documented defaults for the consensus settings", () => {
    const resolved = seatsFromSettings({ ...valid(), thresholdPercent: undefined, maxRounds: undefined })
    expect(resolved?.thresholdPercent).toBe(90)
    expect(resolved?.maxRounds).toBe(5)
  })
})
