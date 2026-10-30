/**
 * Delphi seats supplied through DSH's own settings document.
 *
 * `.delphi-config.json` remains the portable, cross-platform source that the skill,
 * the CI validator, and the other plugins share. This module adds a SECOND source —
 * the `delphi` section of the plugin's Config, editable from the Plugins page — and
 * the rules that keep the two from disagreeing in a way that costs money:
 *
 *  - the settings layer, when it has any seats, WINS (it is the more recent edit)
 *  - it must still satisfy every Delphi invariant (`validateSeats`) before a single
 *    request is made, because a form is a convenience and the host is the authority
 *  - an absent settings layer resolves to `undefined`, so an existing JSON user is
 *    never silently migrated to an empty panel
 *
 * @test REQ-DSH-017 Delphi seats are configurable from the DSH settings document
 * @intent 把 DSH settings 里的 delphi 段解析成与 JSON 同构的席位，并在这条新路径上
 *         重新执行三席/三模型互异/非占位符等不变量，避免表单绕过校验。
 * @covers AC-DSH-017-01 AC-DSH-017-02 AC-DSH-017-03
 */

import type { ExpertSeat } from "./delphi.js"
import { validateSeats } from "./delphi.js"
import { DelphiSetupError } from "./delphi-config.js"

/** One seat as the settings document stores it. */
export interface DelphiSettingsSeat {
  role: string
  model: string
  maxTokens?: number
}

/** The `delphi` section of the plugin Config. */
export interface DelphiSettingsLayer {
  baseUrl?: string
  apiKey?: string
  seats?: DelphiSettingsSeat[]
  thresholdPercent?: number
  maxRounds?: number
}

/** What {@link seatsFromSettings} produces: seats plus the transport they need. */
export interface SettingsReviewSetup {
  readonly seats: readonly ExpertSeat[]
  readonly baseUrl: string
  /** The still-unexpanded `api_key` expression; the caller resolves it. */
  readonly apiKeyExpression: string
  readonly thresholdPercent: number
  readonly maxRounds: number
}

/** Delphi's documented defaults, applied when the settings omit a consensus value. */
const DEFAULT_THRESHOLD_PERCENT = 90
const DEFAULT_MAX_ROUNDS = 5

/**
 * Is the settings layer actually configured?
 *
 * Judged by seats alone: a half-filled form (a gateway typed but no seats yet) must
 * not pre-empt the JSON file, or opening the page would quietly disable every
 * existing `.delphi-config.json` review.
 */
function isConfigured(layer: DelphiSettingsLayer | undefined): boolean {
  return Array.isArray(layer?.seats) && layer.seats.length > 0
}

/** Reject a layer that names no gateway, rather than dialling a guess. */
function requireBaseUrl(layer: DelphiSettingsLayer): string {
  const baseUrl = (layer.baseUrl ?? "").trim()
  if (baseUrl === "") {
    throw new DelphiSetupError(
      "The Delphi settings have seats but no base_url. Set the gateway URL, " +
        "or clear the seats to fall back to .delphi-config.json.",
    )
  }
  return baseUrl
}

/**
 * Turn the settings layer into a review setup, or `undefined` when it holds no seats.
 *
 * Throws the same errors the JSON path throws, so a caller can report either source
 * through one handler. `validateSeats` runs before any network call, which is what
 * makes a misconfigured panel a configuration error rather than a provider failure.
 */
export function seatsFromSettings(layer: DelphiSettingsLayer | undefined): SettingsReviewSetup | undefined {
  if (!isConfigured(layer)) return undefined
  // Narrowed by isConfigured; non-null assertions are avoided to keep strict TS honest.
  const configured = layer as DelphiSettingsLayer
  const rawSeats = configured.seats ?? []

  const seats: ExpertSeat[] = rawSeats.map((seat, index) => ({
    id: seat.role || `Expert ${String.fromCharCode(65 + index)}`,
    role: seat.role || `expert${index}`,
    // Trim: a model id pasted from a catalog picker can carry padding, and
    // `" model-a"` is not the model that was intended.
    model: (seat.model ?? "").trim(),
    maxTokens: seat.maxTokens,
  }))

  // The invariants are the reason this module exists; they run before the
  // transport is even built.
  validateSeats(seats)

  return {
    seats,
    baseUrl: requireBaseUrl(configured),
    apiKeyExpression: configured.apiKey ?? "",
    thresholdPercent: configured.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT,
    maxRounds: configured.maxRounds ?? DEFAULT_MAX_ROUNDS,
  }
}
